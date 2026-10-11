/**
 * Measures the import's cover fill (data/coverFill.ts) against an export on the local stack: the
 * file's rows are looked up through the same repository the import screen uses (live Apple Books,
 * Open Library, the Catalogue), and the fill runs as it does in the app: rows without a cover are
 * queued as their edition arrives, the search lane is held until the first pass is over, then the
 * run waits for the fill to settle. Prints counts only, never a title or an ISBN, so the output may
 * go into an issue; nothing of the file is written anywhere.
 *
 *   SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_DB_URL=… MAILPIT_URL=… \
 *     pnpm tsx scripts/import-covers.ts <export.csv> [--mode before|after] [--budget-seconds 300]
 *
 * `--mode before` is the import without the fill (the rows go to the write as the lookup gave them),
 * `--mode after` (the default) runs the fill and writes what it found. Run them one after the other
 * on one stack: each removes its member and the Catalogue Books only her import made, so the second
 * does not find the first's Books.
 *
 * What it reports:
 *   - identified rows (matched to an edition, or named by an ISBN in the file) and how many of them
 *     came out of the lookup without a cover (`before`) and are still without one after the fill (`after`)
 *   - "Needs a look" as the import screen counted it before (a match without a cover, any row from the
 *     file) and as it counts it now, before and after the fill
 *   - seconds: the lookup, and the fill's time after the lookup ended (in the app it overlaps the preview)
 *   - requests per host in the lookup and in the fill, refusals per host, what each source found
 *   - after the write: her entries and Books by cover (none, Open Library, Apple), without ISBN, pages,
 *     language, description (counts of Books in her Library)
 *
 * Only the local stack: the member is `import-covers-<run>-<random>@libellus.test` and is removed after.
 */
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import sharp from 'sharp'
import { createAuth } from '../app/data/auth'
import { createCatalogueSearch } from '../app/data/catalogueSearch'
import { createBookImport, needsLook, pacedFetch, type Edition, type ImportRow } from '../app/data/bookImport'
import { createCoverFill, mergeCover, type CoverSource } from '../app/data/coverFill'
import type { ProbedImage } from '../app/data/covers'
import { parseExport } from '../app/data/import/detect'
import { createSearch } from '../app/data/search'
import { createInviteCode, newClient, readMailedCode, sql, uniqueEmail } from '../tests/support/stack'

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: { 'budget-seconds': { type: 'string', default: '600' }, mode: { type: 'string', default: 'after' } },
})
const file = positionals[0]
if (!file) {
  console.error('import-covers: name an export: pnpm tsx scripts/import-covers.ts <export.csv>')
  process.exit(1)
}
process.env.LIBELLUS_TEST_RUN ??= 'covers'
const today = new Date().toISOString().slice(0, 10)
const mode = args.mode === 'before' ? 'before' : 'after'
const seconds = (from: number) => Math.round((performance.now() - from) / 100) / 10

// ------------------------------------------------------------------ requests, counted per host

type HostCount = { requests: number; refused: number }
const hosts: Record<string, HostCount> = {}
const count = (url: string, status: number) => {
  const host = new URL(url).hostname
  const entry = (hosts[host] ??= { requests: 0, refused: 0 })
  entry.requests++
  if (status === 403 || status === 429 || status === 503) entry.refused++
}
const snapshot = () => JSON.parse(JSON.stringify(hosts)) as Record<string, HostCount>
const minus = (now: Record<string, HostCount>, before: Record<string, HostCount>) =>
  Object.fromEntries(
    Object.entries(now)
      .map(([host, value]) => [host, { requests: value.requests - (before[host]?.requests ?? 0), refused: value.refused - (before[host]?.refused ?? 0) }] as const)
      .filter(([, value]) => value.requests > 0),
  )

const countedFetch = async (url: string, init?: { signal?: AbortSignal }) => {
  const response = await fetch(url, { ...init, headers: { 'User-Agent': 'libellus-import-covers-measurement/1.0' } })
  count(url, response.status)
  return response
}

/** The browser's probe, in Node: a CORS-less fetch, sharp for the pixels; a refusal throws, a 404 is "no image". */
async function probe(url: string): Promise<ProbedImage | null> {
  const response = await countedFetch(url)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Could not load ${url}: ${response.status}`)
  try {
    const image = sharp(Buffer.from(await response.arrayBuffer()))
    const meta = await image.metadata()
    if (!meta.width || !meta.height) return null
    const { data, info } = await image.resize(100, 100, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    return { width: meta.width, height: meta.height, pixels: { width: info.width, height: info.height, data: new Uint8ClampedArray(data) } }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- the file and the member

const parsed = parseExport(readFileSync(file, 'utf8'), today)
const client = newClient()
const auth = createAuth(client)
const email = uniqueEmail('import-covers')
const requested = await auth.requestSignUpCode({ email, inviteCode: await createInviteCode({ maxUses: 1 }) })
if (requested.error) throw new Error(`sign-up failed: ${requested.error}`)
const verified = await auth.verifyCode(email, await readMailedCode(email))
if (verified.error) throw new Error(`verification failed: ${verified.error}`)
const member = await auth.currentMember()
if (!member) throw new Error('no session')

// ----------------------------------------------------------------- lookup and fill

const catalogue = createCatalogueSearch(client)
const live = pacedFetch(countedFetch, { gapMs: { 'itunes.apple.com': 250 } })
const searcher = createSearch({ fetch: live, languages: ['de-DE', 'en-US'], catalogue })
const repository = createBookImport(client, { lookups: { catalogue, search: searcher }, probe })

const books = parsed.books
const editions: (Edition | null)[] = books.map(() => null)
/** What the lookup gave each row, before any fill: the row's first look at a cover. */
const lookedUp: (Edition | null)[] = books.map(() => null)
const foundBy: Record<CoverSource, number> = { sibling: 0, openlibrary: 0, search: 0 }

const identified = (edition: Edition, isbn13: string | null) =>
  !edition.unsure && ((Boolean(edition.via) && edition.book.source !== 'import') || (!edition.via && Boolean(isbn13)))
const hasCover = (edition: Edition) => Boolean(edition.book.coverUrl || edition.coverFrom?.coverUrl)

const fillBudgetMs = Number(args['budget-seconds']) * 1000
const fill = createCoverFill({
  fetch: live,
  search: searcher,
  probe,
  hostBlockedFor: (host) => live.blockedFor(host),
  budgetMs: Number(args['budget-seconds']) * 1000,
  onFound(key, found) {
    if (mode === 'before') return
    const index = books.findIndex((book) => book.key === key)
    const edition = editions[index]
    const next = edition && mergeCover(edition, found)
    if (!next) return
    editions[index] = next
    foundBy[found.source]++
  },
})

function wantCover(index: number) {
  const book = books[index]!
  const edition = editions[index]!
  const wanted = !edition.unsure && !('id' in edition.book) && edition.book.source !== 'manual' && !hasCover(edition)
  if (mode === 'before') return
  if (wanted) fill.add({ key: book.key, row: book, book: edition.book, alternatives: edition.alternatives })
  else fill.drop(book.key)
}

const matchStart = performance.now()
await repository.match(books, {
  onEdition(index, edition) {
    editions[index] = edition
    lookedUp[index] = edition
    wantCover(index)
  },
})
fill.holdSearch(false)
const matchSeconds = seconds(matchStart)
const duringLookup = snapshot()
const fillStart = performance.now()
// Waits for the fill to settle: its budget is the bound.
if (mode === 'after') await fill.settled(fillBudgetMs + 60_000)
const fillSeconds = mode === 'after' ? seconds(fillStart) : 0
const afterLookup = snapshot()

// ------------------------------------------------------------------ the write, as Import writes it

const rows: ImportRow[] = books.map((book, index) => ({
  key: book.key,
  title: book.title,
  authors: book.authors,
  status: book.status,
  session: book.session,
  extraReads: book.extraReads,
  earlierReads: book.earlierReads,
  pageCount: book.pageCount,
  otherKeys: book.otherKeys,
  addedOn: book.addedOn,
  collections: book.shelves,
  book: editions[index]!.book,
  coverFrom: editions[index]!.coverFrom ?? null,
}))
const writeStart = performance.now()
const written = await repository.write(rows, {
  onWritten: () => {},
  refresh: (row) => {
    const edition = editions[books.findIndex((book) => book.key === row.key)]
    return edition ? { ...row, book: edition.book, coverFrom: edition.coverFrom ?? null } : row
  },
})
const writeSeconds = seconds(writeStart)
fill.stop()

const [entries] = await sql<{ entries: number }>('select count(*)::int as entries from public.library_entries where member_id = $1', [member.id])
const [library] = await sql<Record<string, number>>(
  `select count(distinct b.id)::int as books,
          count(distinct b.id) filter (where b.cover_url is null)::int as no_cover,
          count(distinct b.id) filter (where b.cover_url like 'https://covers.openlibrary.org/%')::int as cover_open_library,
          count(distinct b.id) filter (where b.cover_url like '%mzstatic.com/%')::int as cover_apple,
          count(distinct b.id) filter (where b.cover_url is not null and b.cover_thumbhash is null)::int as cover_without_thumbhash,
          count(distinct b.id) filter (where b.isbn13 is null)::int as no_isbn,
          count(distinct b.id) filter (where b.page_count is null)::int as no_pages,
          count(distinct b.id) filter (where b.language is null)::int as no_language,
          count(distinct b.id) filter (where b.description is null)::int as no_description,
          count(distinct b.id) filter (where b.published_year is null)::int as no_year
     from public.library_entries e join public.books b on b.id = e.book_id
    where e.member_id = $1`,
  [member.id],
)

// ------------------------------------------------------------------ the figures

type Look = { listed: boolean; look: boolean }
const lookOf = (index: number, edition: Edition, rule: 'before' | 'now'): Look => {
  const book = books[index]!
  const matched = Boolean(edition.via) && edition.book.source !== 'import'
  const verdict = matched ? 'matched' : 'fromFile'
  const listed = verdict === 'fromFile' || (matched && (edition.via === 'title' || !edition.book.coverUrl)) || book.problems.length > 0
  const shown = matched || edition.coverFrom ? (edition.coverFrom ?? edition.book) : null
  const look =
    rule === 'before'
      ? verdict === 'fromFile' || !shown?.coverUrl
      : needsLook(verdict, shown, { isbn13: edition.book.isbn13 ?? book.isbn13, unsure: edition.unsure })
  return { listed, look }
}

let identifiedRows = 0
let withoutCoverBefore = 0
let withoutCoverAfter = 0
let needsLookBefore = 0
let needsLookAfterOldRule = 0
let needsLookAfter = 0
let listedRows = 0
let queued = 0
books.forEach((book, index) => {
  const before = lookedUp[index]!
  const after = editions[index]!
  if (identified(before, book.isbn13)) {
    identifiedRows++
    if (!hasCover(before)) withoutCoverBefore++
    if (!hasCover(after)) withoutCoverAfter++
  }
  if (!hasCover(before) && !before.unsure && !('id' in before.book) && before.book.source !== 'manual') queued++
  const was = lookOf(index, before, 'before')
  if (was.listed) listedRows++
  if (was.listed && was.look) needsLookBefore++
  const oldAfter = lookOf(index, after, 'before')
  if (oldAfter.listed && oldAfter.look) needsLookAfterOldRule++
  const now = lookOf(index, after, 'now')
  if (now.listed && now.look) needsLookAfter++
})

const progress = fill.progress()
const report = {
  rows: books.length,
  skipped: parsed.skipped.length,
  identifiedRows,
  identifiedWithoutCover: { before: withoutCoverBefore, after: withoutCoverAfter },
  needsALook: { before: needsLookBefore, afterWithOldRule: needsLookAfterOldRule, afterWithNewRule: needsLookAfter, listedInAll: listedRows },
  coverFill: { rowsQueued: queued, answered: progress.done, found: progress.found, foundBy, calls: fill.calls() },
  seconds: { lookup: matchSeconds, fillAfterLookup: fillSeconds, write: writeSeconds },
  requestsDuringLookup: duringLookup,
  requestsAfterLookup: minus(afterLookup, duringLookup),
  requestsInWrite: minus(snapshot(), afterLookup),
  budgetSeconds: Number(args['budget-seconds']),
  mode,
  writeError: written.error,
  libraryAfterWrite: { entries: entries?.entries, ...library },
}
console.log(JSON.stringify(report, null, 2))

// Her member, and the Catalogue Books only her import made, go (the next run must not find them).
const made = await sql<{ id: string }>(
  `select distinct b.id from public.books b join public.library_entries e on e.book_id = b.id
    where e.member_id = $1 and b.created_at >= now() - interval '3 hours'
      and not exists (select 1 from public.library_entries o where o.book_id = b.id and o.member_id <> $1)`,
  [member.id],
)
await sql('delete from auth.users where id = $1 and email = $2', [member.id, email])
if (made.length) {
  await sql(
    `delete from public.books b where b.id = any($1::uuid[]) and not exists (select 1 from public.library_entries e where e.book_id = b.id)`,
    [made.map((row) => row.id)],
  )
}
console.error(`import-covers: removed ${email} and ${made.length} Catalogue Books only her import made`)
