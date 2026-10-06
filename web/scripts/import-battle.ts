/**
 * Measures the Goodreads import (issue #111) against a real export on the
 * local stack: a fresh test member, the file through the same repository the
 * import screen uses (live Apple Books, OpenLibrary and the Catalogue), the
 * rows written through `import_books`, the same file again, and what ended up
 * in her Library. Prints counts only, never a title, so the output may go into
 * an issue; `--rows <file>` writes the per-row detail (titles included) to a
 * file of your choosing, which stays out of git.
 *
 *   pnpm tsx scripts/import-battle.ts <export.csv> [--rows /tmp/rows.json] [--keep] [--goodreads]
 *
 * Options:
 *   --rows <file>   per-row detail (picked edition vs. the file) as JSON
 *   --keep          keep the test member and her Books (default: removed by id)
 *   --goodreads <how>  ask Goodreads about rows without an ISBN by their Book Id:
 *                   `function`, the `goodreads-rating` function of the local
 *                   stack (`supabase functions serve`), or `direct`, its client
 *                   run here (live, one request a second, nothing cached)
 *
 * Only the local stack: the member is `import-battle-<run>-<random>@libellus.test`
 * and is removed by her id afterwards, with the Catalogue Books her import made
 * that nobody else holds.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { createAuth } from '../app/data/auth'
import { createCatalogueSearch } from '../app/data/catalogueSearch'
import { createGoodreadsEditions, hintFromAnswer, type GoodreadsEditions } from '../app/data/goodreadsEditions'
import { createGoodreadsImport, pacedFetch, type Edition, type ImportRow, type RowOutcome } from '../app/data/goodreadsImport'
import { countByStatus, isEbookBinding, languageCode, parseGoodreads, titleLanguage, type GoodreadsBook } from '../app/data/import/goodreads'
import { createSearch } from '../app/data/search'
import { createGoodreads as createGoodreadsClient } from '../../supabase/functions/goodreads-rating/client.ts'
import { nodeLookupDeps } from './fable/node'
import { createInviteCode, newClient, readMailedCode, sql, uniqueEmail } from '../tests/support/stack'

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    rows: { type: 'string' },
    keep: { type: 'boolean', default: false },
    goodreads: { type: 'string' },
  },
})
const file = positionals[0]
if (!file) {
  console.error('import-battle: name an export: pnpm tsx scripts/import-battle.ts <export.csv>')
  process.exit(1)
}
process.env.LIBELLUS_TEST_RUN ??= 'battle'

const today = new Date().toISOString().slice(0, 10)
const seconds = (from: number) => Math.round((performance.now() - from) / 100) / 10

// ------------------------------------------------------------------ the file

const started = performance.now()
const text = readFileSync(file, 'utf8')
const parsed = parseGoodreads(text, today)
const problems = new Map<string, number>()
for (const book of parsed.books) for (const problem of book.problems) problems.set(problem.code, (problems.get(problem.code) ?? 0) + 1)
for (const row of parsed.skipped) problems.set(`skipped:${row.problem.code}`, (problems.get(`skipped:${row.problem.code}`) ?? 0) + 1)

// ---------------------------------------------------------------- the member

const email = uniqueEmail('import-battle')
const client = newClient()
const auth = createAuth(client)
const requested = await auth.requestSignUpCode({ email, inviteCode: await createInviteCode({ maxUses: 1 }) })
if (requested.error) throw new Error(`sign-up failed: ${requested.error}`)
const verified = await auth.verifyCode(email, await readMailedCode(email))
if (verified.error) throw new Error(`verification failed: ${verified.error}`)
const member = await auth.currentMember()
if (!member) throw new Error('no session')

// ------------------------------------------------------------------ matching

/** The function's client, run here: the same page reading and pace, without the cache. */
function directGoodreads(): GoodreadsEditions {
  const goodreads = createGoodreadsClient({ fetch: (url, init) => fetch(url, init), maxWaitMs: 60_000 })
  let queue: Promise<unknown> = Promise.resolve()
  return {
    edition(goodreadsId) {
      const turn = queue.then(async () => hintFromAnswer(await goodreads.bookPage(goodreadsId)))
      queue = turn.catch(() => undefined)
      return turn
    },
  }
}
const goodreadsLookup =
  args.goodreads === 'direct' ? directGoodreads() : args.goodreads === 'function' ? createGoodreadsEditions(client) : undefined

const catalogue = createCatalogueSearch(client)
const liveFetch = pacedFetch((url, init) => fetch(url, init), { gapMs: { 'itunes.apple.com': 250 } })
const repository = createGoodreadsImport(client, {
  lookups: {
    catalogue,
    search: createSearch({ fetch: liveFetch, languages: ['de-DE', 'en-US'], catalogue }),
    ...(goodreadsLookup ? { goodreads: goodreadsLookup } : {}),
  },
  probe: nodeLookupDeps().probe,
})

const editions: (Edition | null)[] = parsed.books.map(() => null)
const matchStart = performance.now()
await repository.match(parsed.books, { onEdition: (index, edition) => void (editions[index] = edition) })
const matchSeconds = seconds(matchStart)

// ------------------------------------------------------------------- writing

const rows: ImportRow[] = parsed.books.map((book, index) => ({
  key: book.key,
  title: book.title,
  authors: book.authors,
  status: book.status,
  session: book.session,
  extraReads: book.extraReads,
  pageCount: book.pageCount,
  otherKeys: book.otherKeys,
  addedOn: book.addedOn,
  // Every shelf kept, as the preview offers them.
  collections: book.shelves,
  book: editions[index]!.book,
  coverFrom: editions[index]!.coverFrom ?? null,
}))
const writeStart = performance.now()
const written = await repository.write(rows, { onWritten: () => {} })
const writeSeconds = seconds(writeStart)
const again = await repository.write(rows, { onWritten: () => {} })

const tally = (outcomes: RowOutcome[] | null) => {
  const counts: Record<string, number> = {}
  for (const outcome of outcomes ?? []) counts[outcome.outcome] = (counts[outcome.outcome] ?? 0) + 1
  return counts
}

// ------------------------------------------------------------- what she has

type EntryFigures = { status: string; n: number }
const entries = await sql<EntryFigures>(
  'select status::text, count(*)::int as n from public.library_entries where member_id = $1 group by 1 order by 1',
  [member.id],
)
const [sessions] = await sql<Record<string, number>>(
  `select count(*)::int as sessions,
          count(*) filter (where s.outcome = 'finished')::int as finished,
          count(*) filter (where s.outcome = 'abandoned')::int as abandoned,
          count(*) filter (where s.outcome is null)::int as open,
          count(*) filter (where s.ended_on is not null)::int as with_end,
          count(*) filter (where s.started_on is not null)::int as with_start,
          count(*) filter (where s.rating is not null)::int as rated,
          count(*) filter (where s.review is not null)::int as reviewed,
          count(*) filter (where s.review ~ '<[a-z/]')::int as review_html
     from public.reading_sessions s join public.library_entries e on e.id = s.entry_id
    where e.member_id = $1`,
  [member.id],
)
const [books] = await sql<Record<string, number>>(
  `select count(distinct b.id)::int as books,
          count(distinct b.id) filter (where b.cover_url is not null)::int as with_cover,
          count(distinct b.id) filter (where b.source = 'manual')::int as manual,
          count(distinct b.id) filter (where b.source = 'import')::int as import,
          count(distinct b.id) filter (where b.source = 'apple')::int as apple,
          count(distinct b.id) filter (where b.source = 'openlibrary')::int as openlibrary,
          count(distinct b.id) filter (where b.source not in ('manual', 'import', 'apple', 'openlibrary'))::int as other,
          count(*) filter (where e.page_count_override is not null)::int as own_page_count
     from public.library_entries e join public.books b on b.id = e.book_id
    where e.member_id = $1`,
  [member.id],
)
const [collections] = await sql<Record<string, number>>(
  `select count(distinct c.id)::int as collections, count(ce.*)::int as placed
     from public.collections c left join public.collection_entries ce on ce.collection_id = c.id
    where c.member_id = $1`,
  [member.id],
).catch(() => [{ collections: -1, placed: -1 }])

// --------------------------------------------------------- edition quality

const digits = (value: string | null | undefined) => (value ?? '').replace(/\D/g, '')
type RowReport = Record<string, unknown>
const perRow: RowReport[] = []
const truth = { asked: 0, known: 0, languageSame: 0, languageOther: 0, languageUnknown: 0, kindSame: 0, pagesWithin10: 0 }
const edition = { isbnInFile: 0, goodreadsId: 0, exact: 0, exactFromFile: 0, coverLent: 0, otherEditionSameWork: 0, byTitle: 0, byTitleSameIsbn: 0, fromFile: 0, unsure: 0, byGoodreads: 0, pagesWithin10: 0, pagesKnown: 0 }
parsed.books.forEach((book: GoodreadsBook, index) => {
  const found = editions[index]!
  const picked = found.book
  if (book.isbn13) edition.isbnInFile++
  if (book.goodreadsId) edition.goodreadsId++
  if (!found.via && book.isbn13 && digits(picked.isbn13) === book.isbn13) edition.exactFromFile++
  if (found.coverFrom) edition.coverLent++
  if (found.unsure) edition.unsure++
  if (!found.via) edition.fromFile++
  if (found.via === 'title') edition.byTitle++
  if (found.via === 'goodreads') edition.byGoodreads++
  const sameIsbn = Boolean(book.isbn13) && digits(picked.isbn13) === book.isbn13
  if (found.via && sameIsbn) edition.exact++
  if (found.via === 'title' && sameIsbn) edition.byTitleSameIsbn++
  if (found.via && book.isbn13 && !sameIsbn) edition.otherEditionSameWork++
  // Rows Goodreads was asked about: the picked edition against Goodreads' own.
  if (found.hint !== undefined) truth.asked++
  if (found.hint) {
    truth.known++
    const wanted = languageCode(found.hint.language)
    const got = languageCode(picked.language) ?? titleLanguage(picked.title)
    if (!wanted || !got) truth.languageUnknown++
    else if (wanted === got) truth.languageSame++
    else truth.languageOther++
    if (isEbookBinding(found.hint.format) === (picked.source === 'apple')) truth.kindSame++
    const pages = found.hint.pageCount ?? book.pageCount
    if (pages && picked.pageCount && Math.abs(pages - picked.pageCount) <= pages * 0.1) truth.pagesWithin10++
  }
  if (book.pageCount && picked.pageCount) {
    edition.pagesKnown++
    if (Math.abs(book.pageCount - picked.pageCount) <= book.pageCount * 0.1) edition.pagesWithin10++
  }
  perRow.push({
    row: book.row,
    file: { title: book.title, authors: book.authors, isbn13: book.isbn13, pages: book.pageCount, year: book.year, shelf: book.shelf, extraReads: book.extraReads, shelves: book.shelves.length },
    picked: { title: picked.title, authors: picked.authors, isbn13: picked.isbn13, pages: picked.pageCount, year: picked.year, language: picked.language, source: picked.source, cover: Boolean(picked.coverUrl) },
    via: found.via,
    hint: found.hint ?? null,
    coverFrom: found.coverFrom ? { title: found.coverFrom.title, isbn13: found.coverFrom.isbn13 } : null,
    unsure: found.unsure,
    sameIsbn,
    problems: book.problems.map((problem) => problem.code),
  })
})

const shelves = countByStatus(parsed.books)
const report = {
  file: file.split('/').pop()!.replace(/[^a-z0-9._-]/gi, '_'),
  rowsRead: parsed.books.length + parsed.skipped.length,
  books: parsed.books.length,
  skipped: parsed.skipped.length,
  byStatus: shelves,
  extraReads: parsed.books.reduce((total, book) => total + book.extraReads, 0),
  shelvesOffered: new Set(parsed.books.flatMap((book) => book.shelves.map((name) => name.toLowerCase()))).size,
  problems: Object.fromEntries(problems),
  edition,
  goodreadsTruth: truth,
  firstImport: tally(written.data),
  firstImportError: written.error,
  reimport: tally(again.data),
  library: { entries: Object.fromEntries(entries.map((row) => [row.status, row.n])), ...sessions, ...books, ...collections },
  seconds: { match: matchSeconds, write: writeSeconds, total: seconds(started) },
}
console.log(JSON.stringify(report, null, 2))
if (args.rows) writeFileSync(args.rows, JSON.stringify(perRow, null, 2))

// ------------------------------------------------------------------ clean up

if (!args.keep) {
  const made = await sql<{ id: string }>(
    `select distinct b.id from public.books b join public.library_entries e on e.book_id = b.id
      where e.member_id = $1 and b.created_at >= now() - interval '2 hours'
        and not exists (select 1 from public.library_entries o where o.book_id = b.id and o.member_id <> $1)`,
    [member.id],
  )
  await sql('delete from auth.users where id = $1 and email = $2', [member.id, email])
  if (made.length) {
    await sql(
      `delete from public.books b where b.id = any($1::uuid[])
          and not exists (select 1 from public.library_entries e where e.book_id = b.id)`,
      [made.map((row) => row.id)],
    )
  }
  console.error(`import-battle: removed ${email} and ${made.length} Catalogue Books only her import made`)
} else {
  console.error(`import-battle: kept ${email} (${member.id})`)
}
