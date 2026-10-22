/**
 * The import assessment run (docs/plans/import-assessment.md): one FULL import of an export on the
 * local stack as the app does it (lookup, the cover fill over its whole budget, the write), then the
 * metrics of her resulting account, the same ones counted on a production account: entries, Books
 * without a cover, covers by source, a sample of the covers' real pixel sizes (stored `-L` and the
 * unsuffixed original), Books without ISBN, pages, language, description, Open Library work key, year;
 * "Needs a look" and its split; the wall time by phase; requests per host and kind, hits, refusals and
 * errors. Counts only, never a title or an ISBN: the output may go into a report. `--keep` leaves the
 * Catalogue Books her import made (the second member importing the same file then finds them).
 * `--sample-fields N` asks Open Library's edition record and the DNB's SRU for N of her Books that lack
 * pages (counts of what they would fill).
 *
 *   . env; pnpm tsx scripts/import-assessment.ts <export.csv> [--keep] [--budget-seconds 600] [--sample-fields 60]
 *
 * Only the local stack. The member is removed after (and her Catalogue Books unless `--keep`).
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
  options: { 'budget-seconds': { type: 'string', default: '600' }, keep: { type: 'boolean', default: false }, 'sample-fields': { type: 'string', default: '0' }, 'cover-sample': { type: 'string', default: '90' } },
})
const file = positionals[0]
if (!file) {
  console.error('import-assessment: name an export: pnpm tsx scripts/import-assessment.ts <export.csv>')
  process.exit(1)
}
process.env.LIBELLUS_TEST_RUN ??= 'assess'
const today = new Date().toISOString().slice(0, 10)
const mode = 'after' as 'before' | 'after'
const wallStart = performance.now()
const seconds = (from: number) => Math.round((performance.now() - from) / 100) / 10

// ------------------------------------------------------------------ requests, counted per host

type KindCount = { requests: number; hits: number; refused: number; serverErrors: number; failed: number; ms: number }
const kinds: Record<string, KindCount> = {}
const kindOf = (url: string): string => {
  const u = new URL(url)
  if (u.hostname === 'itunes.apple.com') return `apple.${u.pathname.slice(1)}${u.searchParams.get('isbn') ? '.isbn' : ''}${u.pathname === '/search' ? '.title' : ''}.${u.searchParams.get('country') ?? '?'}`
  if (u.hostname === 'openlibrary.org') return `openlibrary.${u.pathname.startsWith('/search.json') ? 'search' : u.pathname.startsWith('/isbn/') ? 'isbn-record' : u.pathname.startsWith('/api/books') ? 'api-books' : u.pathname.startsWith('/works/') ? 'work' : 'other'}`
  if (u.hostname === 'covers.openlibrary.org') return `covers.openlibrary.${u.pathname.startsWith('/b/isbn/') ? 'by-isbn' : 'by-id'}`
  if (u.hostname.endsWith('mzstatic.com')) return 'apple.artwork'
  if (u.hostname === 'services.dnb.de') return 'dnb.sru'
  return u.hostname
}
const entryOf = (kind: string) => (kinds[kind] ??= { requests: 0, hits: 0, refused: 0, serverErrors: 0, failed: 0, ms: 0 })
const snapshot = () => JSON.parse(JSON.stringify(kinds)) as Record<string, KindCount>
const minus = (now: Record<string, KindCount>, before: Record<string, KindCount>) =>
  Object.fromEntries(
    Object.entries(now)
      .map(([kind, v]) => {
        const b = before[kind]
        return [kind, { requests: v.requests - (b?.requests ?? 0), hits: v.hits - (b?.hits ?? 0), refused: v.refused - (b?.refused ?? 0), serverErrors: v.serverErrors - (b?.serverErrors ?? 0), failed: v.failed - (b?.failed ?? 0) }] as const
      })
      .filter(([, v]) => v.requests > 0),
  )

const countedFetch = async (url: string, init?: { signal?: AbortSignal }) => {
  const kind = kindOf(url)
  const entry = entryOf(kind)
  entry.requests++
  const started = performance.now()
  let response: Response
  try {
    response = await fetch(url, { ...init, headers: { 'User-Agent': 'libellus-import-assessment/1.0' } })
  } catch (error) {
    entry.failed++
    throw error
  }
  entry.ms += performance.now() - started
  if (response.status === 403 || response.status === 429) entry.refused++
  else if (response.status >= 500) entry.serverErrors++
  else if (response.ok && (kind.startsWith('apple.lookup') || kind.startsWith('apple.search'))) {
    try {
      if (((await response.clone().json()) as { resultCount?: number }).resultCount) entry.hits++
    } catch {
      /* not JSON */
    }
  } else if (response.ok && kind === 'openlibrary.search') {
    try {
      if (((await response.clone().json()) as { numFound?: number }).numFound) entry.hits++
    } catch {
      /* not JSON */
    }
  } else if (response.ok) entry.hits++
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
const email = uniqueEmail('import-assess')
const requested = await auth.requestSignUpCode({ email, inviteCode: await createInviteCode({ maxUses: 1 }) })
if (requested.error) throw new Error(`sign-up failed: ${requested.error}`)
const verified = await auth.verifyCode(email, await readMailedCode(email))
if (verified.error) throw new Error(`verification failed: ${verified.error}`)
const member = await auth.currentMember()
if (!member) throw new Error('no session')

// ----------------------------------------------------------------- lookup and fill

const catalogue = createCatalogueSearch(client)
const live = pacedFetch(countedFetch as never, { gapMs: { 'itunes.apple.com': 250 } })
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

let firstPassSeconds = 0
const matchStart = performance.now()
await repository.match(books, {
  onEdition(index, edition) {
    editions[index] = edition
    lookedUp[index] = edition
    wantCover(index)
  },
  onSecondPass: () => {
    if (!firstPassSeconds) firstPassSeconds = seconds(matchStart)
  },
})
fill.holdSearch(false)
const lookupSeconds = seconds(matchStart)
if (!firstPassSeconds) firstPassSeconds = lookupSeconds
const duringLookup = snapshot()
const fillStart = performance.now()
// The member reads the preview while the fill runs; here it is waited for, its budget is the bound.
await fill.settled(fillBudgetMs + 60_000)
const fillSeconds = seconds(fillStart)
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
const wallSeconds = seconds(wallStart)

// ------------------------------------------------------------------ her account, as counted in production

const [entries] = await sql<{ entries: number }>('select count(*)::int as entries from public.library_entries where member_id = $1', [member.id])
const [library] = await sql<Record<string, number>>(
  `select count(distinct b.id)::int as books,
          count(distinct b.id) filter (where b.cover_url is null)::int as no_cover,
          count(distinct b.id) filter (where b.cover_url like 'https://covers.openlibrary.org/%')::int as cover_open_library,
          count(distinct b.id) filter (where b.cover_url like '%mzstatic.com/%')::int as cover_apple,
          count(distinct b.id) filter (where b.cover_url is not null and b.cover_url not like 'https://covers.openlibrary.org/%' and b.cover_url not like '%mzstatic.com/%')::int as cover_other,
          count(distinct b.id) filter (where b.cover_url is not null and b.cover_thumbhash is null)::int as cover_without_thumbhash,
          count(distinct b.id) filter (where b.isbn13 is null)::int as no_isbn,
          count(distinct b.id) filter (where b.page_count is null)::int as no_pages,
          count(distinct b.id) filter (where b.language is null)::int as no_language,
          count(distinct b.id) filter (where b.description is null)::int as no_description,
          count(distinct b.id) filter (where b.openlibrary_work_key is null)::int as no_open_library_work_key,
          count(distinct b.id) filter (where b.published_year is null)::int as no_year,
          count(distinct b.id) filter (where b.source = 'apple')::int as source_apple,
          count(distinct b.id) filter (where b.source = 'openlibrary')::int as source_open_library,
          count(distinct b.id) filter (where b.source = 'import')::int as source_import,
          count(distinct b.id) filter (where b.source = 'manual')::int as source_manual
     from public.library_entries e join public.books b on b.id = e.book_id
    where e.member_id = $1`,
  [member.id],
)

const [effective] = await sql<Record<string, number>>(
  `select count(*) filter (where e.page_count_override is not null)::int as entries_with_own_page_count,
          count(*) filter (where coalesce(e.page_count_override, b.page_count) is null)::int as entries_without_any_page_count
     from public.library_entries e join public.books b on b.id = e.book_id where e.member_id = $1`,
  [member.id],
)

// ---------------------------------------------------- a sample of the covers, as they really are

type Size = { width: number; height: number; bytes: number }
async function sizeOf(url: string): Promise<Size | null> {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'libellus-import-assessment/1.0' }, signal: AbortSignal.timeout(60_000) })
    if (!response.ok) return null
    const buffer = Buffer.from(await response.arrayBuffer())
    const meta = await sharp(buffer, { limitInputPixels: false }).metadata()
    return meta.width && meta.height ? { width: meta.width, height: meta.height, bytes: buffer.length } : null
  } catch {
    return null
  }
}
const bucket = (height: number) => (height < 400 ? '<400' : height < 500 ? '400-499' : height < 700 ? '500-699' : '>=700')
const covered = await sql<{ cover_url: string }>(
  `select distinct b.cover_url from public.library_entries e join public.books b on b.id = e.book_id
    where e.member_id = $1 and b.cover_url is not null order by b.cover_url`,
  [member.id],
)
const pool = [...covered].sort(() => Math.random() - 0.5).slice(0, Number(args['cover-sample']))
const sizes = { openLibrary: [] as Size[], apple: [] as Size[], originals: [] as (Size & { absurd: boolean })[] }
for (const { cover_url: url } of pool) {
  const size = await sizeOf(url)
  if (!size) continue
  if (url.includes('openlibrary.org')) {
    sizes.openLibrary.push(size)
    // The unsuffixed original: what Open Library keeps (the `-L` size is capped at 500 px high).
    const original = await sizeOf(url.replace(/-[SML]\.jpg/, '.jpg').replace('?default=false', ''))
    if (original) sizes.originals.push({ ...original, absurd: original.height > 4000 || original.width / original.height > 1.5 || original.width / original.height < 0.25 })
  } else if (url.includes('mzstatic.com')) sizes.apple.push(size)
}
const histogram = (list: Size[]) => {
  const out: Record<string, number> = { '<400': 0, '400-499': 0, '500-699': 0, '>=700': 0 }
  for (const size of list) out[bucket(size.height)]++
  return out
}
const median = (list: number[]) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)] ?? null
const coverSizes = {
  sampled: pool.length,
  openLibraryStoredL: { n: sizes.openLibrary.length, heightBuckets: histogram(sizes.openLibrary), medianHeight: median(sizes.openLibrary.map((s) => s.height)), minHeight: Math.min(...sizes.openLibrary.map((s) => s.height)), maxHeight: Math.max(...sizes.openLibrary.map((s) => s.height)) },
  apple: { n: sizes.apple.length, heightBuckets: histogram(sizes.apple), medianHeight: median(sizes.apple.map((s) => s.height)) },
  openLibraryOriginal: {
    n: sizes.originals.length,
    heightBuckets: histogram(sizes.originals),
    medianHeight: median(sizes.originals.map((s) => s.height)),
    medianKB: Math.round((median(sizes.originals.map((s) => s.bytes)) ?? 0) / 1024),
    over1600: sizes.originals.filter((s) => s.height > 1600).length,
    over4000orOddShape: sizes.originals.filter((s) => s.absurd).length,
    maxHeight: Math.max(0, ...sizes.originals.map((s) => s.height)),
    maxKB: Math.round(Math.max(0, ...sizes.originals.map((s) => s.bytes)) / 1024),
  },
}

// ------------------------------------------------------------- how the rows were resolved

const resolved = { catalogue: 0, byIsbnApple: 0, byIsbnOpenLibrary: 0, byTitleApple: 0, byTitleOpenLibrary: 0, fromFileWithIsbn: 0, fromFileWithoutIsbn: 0, unsure: 0 }
books.forEach((book, index) => {
  const e = lookedUp[index]!
  if ('id' in e.book) resolved.catalogue++
  else if (e.via === 'isbn') e.book.source === 'apple' ? resolved.byIsbnApple++ : resolved.byIsbnOpenLibrary++
  else if (e.via === 'title') e.book.source === 'apple' ? resolved.byTitleApple++ : resolved.byTitleOpenLibrary++
  else (book.isbn13 ? resolved.fromFileWithIsbn++ : resolved.fromFileWithoutIsbn++)
  if (e.unsure) resolved.unsure++
})

// ------------------------------------------------------------------- "Needs a look"

type Split = { noMatch: number; noCover: number; probablyFine: number; unidentifiedOrUnsure?: number }
function split(editionsNow: (Edition | null)[], rule: 'old' | 'new'): Split {
  const out: Split = { noMatch: 0, noCover: 0, probablyFine: 0 }
  books.forEach((book, index) => {
    const edition = editionsNow[index]!
    const matched = Boolean(edition.via) && edition.book.source !== 'import'
    const verdict = matched ? 'matched' : 'fromFile'
    const noCover = matched && !edition.book.coverUrl
    const listed = verdict === 'fromFile' || (matched && (edition.via === 'title' || noCover)) || book.problems.length > 0
    if (!listed) return
    const shown = matched || edition.coverFrom ? (edition.coverFrom ?? edition.book) : null
    const look = rule === 'old' ? verdict === 'fromFile' || !shown?.coverUrl : needsLook(verdict, shown, { isbn13: edition.book.isbn13 ?? book.isbn13, unsure: edition.unsure })
    if (!look) out.probablyFine++
    else if (verdict === 'fromFile' && (rule === 'old' || !book.isbn13 || edition.unsure)) out.noMatch++
    else out.noCover++
  })
  return out
}
const needsALook = {
  oldRuleBeforeFill: split(lookedUp, 'old'),
  newRuleBeforeFill: split(lookedUp, 'new'),
  newRuleAfterFill: split(editions, 'new'),
}

// ----------------------------------------------- what else could fill the fields (samples)

const sampleFields = Number(args['sample-fields'])
let fields: Record<string, number> | undefined
if (sampleFields) {
  const lacking = await sql<{ isbn13: string }>(
    `select distinct b.isbn13 from public.library_entries e join public.books b on b.id = e.book_id
      where e.member_id = $1 and b.page_count is null and b.isbn13 is not null`,
    [member.id],
  )
  const picked = [...lacking].sort(() => Math.random() - 0.5).slice(0, sampleFields)
  fields = { sampled: picked.length, olRecord: 0, olPages: 0, olLanguage: 0, olWorkDescription: 0, olWorkKey: 0, dnbRecord: 0, dnbPages: 0, dnbLanguage: 0, dnbYear: 0, anyPages: 0 }
  const get = async (url: string) => {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'libellus-import-assessment/1.0' }, signal: AbortSignal.timeout(20_000) })
      return response.ok ? response : null
    } catch {
      return null
    }
  }
  for (const { isbn13 } of picked) {
    let pages = false
    const record = await get(`https://openlibrary.org/isbn/${isbn13}.json`)
    if (record) {
      const edition = (await record.json()) as { number_of_pages?: number; languages?: unknown[]; works?: { key: string }[] }
      fields.olRecord!++
      if (edition.number_of_pages) {
        fields.olPages!++
        pages = true
      }
      if (edition.languages?.length) fields.olLanguage!++
      const work = edition.works?.[0]?.key
      if (work) {
        fields.olWorkKey!++
        const w = await get(`https://openlibrary.org${work}.json`)
        if (w && (await w.json() as { description?: unknown }).description) fields.olWorkDescription!++
      }
    }
    const sru = await get(`https://services.dnb.de/sru/dnb?version=1.1&operation=searchRetrieve&query=${encodeURIComponent(`isbn=${isbn13}`)}&recordSchema=oai_dc&maximumRecords=1`)
    if (sru) {
      const xml = await sru.text()
      if (/<dc:title/.test(xml)) {
        fields.dnbRecord!++
        if (/<dc:format>[^<]*\d+\s*(S\.|Seiten|pages)/i.test(xml)) {
          fields.dnbPages!++
          pages = true
        }
        if (/<dc:language[^>]*>[a-z]{3}</.test(xml)) fields.dnbLanguage!++
        if (/<dc:date>\s*\d{4}/.test(xml)) fields.dnbYear!++
      }
    }
    if (pages) fields.anyPages!++
    await new Promise((resolve) => setTimeout(resolve, 600))
  }
}

// ------------------------------------------------------------------ the figures

const progress = fill.progress()
const report = {
  rows: books.length,
  entries: entries?.entries,
  seconds: { wall: wallSeconds, lookupFirstPass: firstPassSeconds, lookupSecondPassToEnd: Math.round((lookupSeconds - firstPassSeconds) * 10) / 10, lookup: lookupSeconds, fillAfterLookup: fillSeconds, write: writeSeconds },
  resolved,
  needsALook,
  coverFill: { rowsQueued: progress.total, answered: progress.done, found: progress.found, foundBy, calls: fill.calls() },
  requests: { duringLookup, afterLookup: minus(afterLookup, duringLookup), inWrite: minus(snapshot(), afterLookup), total: snapshot() },
  library: library,
  entriesPages: effective,
  coverSizes,
  fields,
  writeError: written.error,
}
console.log(JSON.stringify(report, null, 2))

// Her member, and (unless kept) the Catalogue Books only her import made, go.
const made = await sql<{ id: string }>(
  `select distinct b.id from public.books b join public.library_entries e on e.book_id = b.id
    where e.member_id = $1 and b.created_at >= now() - interval '6 hours'
      and not exists (select 1 from public.library_entries o where o.book_id = b.id and o.member_id <> $1)`,
  [member.id],
)
await sql('delete from auth.users where id = $1 and email = $2', [member.id, email])
if (!args.keep && made.length) {
  await sql(
    `delete from public.books b where b.id = any($1::uuid[]) and not exists (select 1 from public.library_entries e where e.book_id = b.id)`,
    [made.map((row) => row.id)],
  )
}
console.error(`import-assessment: removed ${email}${args.keep ? `; kept ${made.length} Catalogue Books` : ` and ${made.length} Catalogue Books only her import made`}`)
