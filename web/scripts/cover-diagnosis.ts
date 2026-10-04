/**
 * Cover diagnosis (issue #63): why search results and Change edition rows load
 * their covers slowly and why many show the Placeholder. Not a test — it asks
 * the live APIs. Runs a sample of real queries through the same repositories
 * the app uses (data/search.ts, data/editions.ts), then fetches every cover a
 * row would show, the way the browser would, and records per image:
 *
 * - which result source the row came from, and which host the cover URL is on;
 * - HTTP status, redirects, bytes, time to headers and to the last byte;
 * - the image's own size, and whether it is a blank stand-in (OpenLibrary's
 *   1 × 1 GIF, a flat colour) or too small to be a cover;
 * - whether an <img> could show it (an image, not an HTML bot page) and whether
 *   it is readable cross-origin (CORS, which the thumbhash probe needs).
 *
 * For OpenLibrary and Apple it also compares the sizes each CDN offers, and for
 * German ISBNs it asks the German National Library (DNB) what a browser gets.
 *
 * The Catalogue is read straight from the local stack's database (the Catalogue
 * rows only, as `search_books` would find them); nothing is written.
 *
 *   cd web && pnpm tsx scripts/cover-diagnosis.ts [--out /tmp/libellus-63] [--lang de]
 *
 * Writes `diagnosis.json` (every image) and `diagnosis.md` (the tables) to --out.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import sharp from 'sharp'
import { parseIsbn, type Book } from '../app/data/books'
import type { CatalogueSearch } from '../app/data/catalogueSearch'
import { isPlaceholderImage } from '../app/data/covers'
import { createEditions } from '../app/data/editions'
import { bookFromRow, type BookRow } from '../app/data/library'
import { createSearch } from '../app/data/search'
import { coverSrc } from '../app/utils/cover'

const args = process.argv.slice(2)
const flag = (name: string, fallback: string) => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 && args[at + 1] ? args[at + 1]! : fallback
}
const OUT = flag('out', '/tmp/libellus-63')
const LANGUAGES = [flag('lang', 'de'), 'en']
const DB = process.env.LIBELLUS_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres'
/** A browser's per-host connection limit; images go out this many at a time. */
const CONCURRENCY = 6
const BROWSER_UA =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36'

const QUERIES = {
  english: ['pride and prejudice', 'moby dick', 'the great gatsby', 'jane eyre', 'frankenstein'],
  german: ['der zauberberg', 'die verwandlung kafka', 'im westen nichts neues', 'tschick', 'der vorleser'],
  recent: ['intermezzo rooney', 'james everett', 'orbital harvey', 'fourth wing', 'the women hannah'],
}
const LIBRARY_QUERIES = 5
const EDITION_BOOKS = 5

// ------------------------------------------------------------------ measuring

type Probe = {
  url: string
  status: number | 'error'
  redirects: number
  finalHost: string | null
  type: string | null
  bytes: number
  headersMs: number
  totalMs: number
  width: number | null
  height: number | null
  blank: boolean
  tooSmall: boolean
  cors: boolean
  /** Whether an <img> would show a cover: an image that is not blank. */
  displayable: boolean
}

async function probe(url: string, headers: Record<string, string> = {}): Promise<Probe> {
  const started = performance.now()
  let redirects = 0
  let current = url
  try {
    let response: Response
    for (;;) {
      response = await fetch(current, {
        redirect: 'manual',
        headers: { 'user-agent': BROWSER_UA, accept: 'image/avif,image/webp,image/*,*/*;q=0.8', origin: 'http://localhost:3020', ...headers },
      })
      const location = response.headers.get('location')
      if (response.status >= 300 && response.status < 400 && location && redirects < 5) {
        redirects++
        current = new URL(location, current).toString()
        await response.arrayBuffer().catch(() => undefined)
        continue
      }
      break
    }
    const headersMs = performance.now() - started
    const body = Buffer.from(await response.arrayBuffer())
    const totalMs = performance.now() - started
    const type = response.headers.get('content-type')
    let width: number | null = null
    let height: number | null = null
    let blank = false
    if (response.ok && type?.startsWith('image/')) {
      try {
        const image = sharp(body)
        const meta = await image.metadata()
        width = meta.width ?? null
        height = meta.height ?? null
        const { data, info } = await image.resize(100, 100, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
        blank = isPlaceholderImage({ width: info.width, height: info.height, data })
      } catch {
        blank = true
      }
    }
    const tooSmall = width !== null && height !== null && Math.min(width, height) < 20
    return {
      url,
      status: response.status,
      redirects,
      finalHost: new URL(current).hostname,
      type,
      bytes: body.length,
      headersMs: Math.round(headersMs),
      totalMs: Math.round(totalMs),
      width,
      height,
      blank,
      tooSmall,
      cors: Boolean(response.headers.get('access-control-allow-origin')),
      displayable: response.ok && Boolean(type?.startsWith('image/')) && !blank && !tooSmall,
    }
  } catch {
    return {
      url, status: 'error', redirects, finalHost: null, type: null, bytes: 0, headersMs: 0,
      totalMs: Math.round(performance.now() - started), width: null, height: null, blank: false, tooSmall: false, cors: false, displayable: false,
    }
  }
}

async function pool<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++
        out[index] = await work(items[index]!)
      }
    }),
  )
  return out
}

const hostOf = (url: string | null): string => {
  if (!url) return 'none'
  // Real artwork lives under a UUID directory; the test suites' made-up URLs (left in a dev Catalogue) do not.
  if (/mzstatic\.com\//.test(url)) return /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//.test(url) ? 'apple' : 'apple (test fixture)'
  if (/covers\.openlibrary\.org\//.test(url)) return 'openlibrary'
  return new URL(url).hostname
}

// ------------------------------------------------------------- the Catalogue

const db = new pg.Client(DB)
await db.connect()

const catalogue: CatalogueSearch = {
  async search(query) {
    const isbn = parseIsbn(query)
    const { rows } = await db.query<BookRow>(
      'select * from public.search_books($1, 20) b where b.owner_id is null',
      [isbn ?? query],
    )
    return rows.map((row) => ({ book: bookFromRow(row), source: 'catalogue' as const, popularity: 0 }))
  },
  libraryEntries: async () => [],
}

const libraryBooks = (
  await db.query<BookRow>(
    `select * from public.books b
      where b.owner_id is null and exists (select 1 from public.library_entries e where e.book_id = b.id)
      order by md5(b.id::text) limit $1`,
    [LIBRARY_QUERIES + EDITION_BOOKS],
  )
).rows.map(bookFromRow)

/** Every Catalogue Book's stored cover: what the Library, Home and the Catalogue's search hits show. */
const storedCovers = (
  await db.query<{ id: string; title: string; cover_url: string | null }>('select id, title, cover_url from public.books where owner_id is null')
).rows

const queries: { group: string; query: string }[] = [
  ...Object.entries(QUERIES).flatMap(([group, list]) => list.map((query) => ({ group, query }))),
  ...libraryBooks.slice(0, LIBRARY_QUERIES).map((book) => ({ group: 'library', query: `${book.title} ${book.authors[0] ?? ''}`.trim() })),
]

// -------------------------------------------------------------------- search

/** API calls (not images) the repositories made, per host, with their time to the last byte. */
const apiTimings: { host: string; ms: number; ok: boolean }[] = []
const timedFetch: typeof fetch = async (input, init) => {
  const started = performance.now()
  const response = await fetch(input, init)
  const body = await response.arrayBuffer()
  apiTimings.push({ host: new URL(String(input)).hostname, ms: Math.round(performance.now() - started), ok: response.ok })
  return new Response(body, { status: response.status, headers: response.headers })
}

const search = createSearch({ fetch: timedFetch, languages: LANGUAGES, catalogue })

type Row = {
  kind: 'search' | 'edition'
  group: string
  query: string
  position: number
  title: string
  isbn13: string | null
  /** The source of the result row (the merge's pick). */
  source: string
  /** The host the row's cover URL is on. */
  coverHost: string
  stored: string | null
  shown: string | null
  probe: Probe | null
  /** For an ISBN that is German: what the DNB answers a browser. */
  dnb: Probe | null
}

const rows: Row[] = []

for (const { group, query } of queries) {
  const outcome = await search.search(query)
  outcome.results.forEach((result, position) => {
    const stored = result.book.coverUrl
    rows.push({
      kind: 'search', group, query, position, title: result.book.title, isbn13: result.book.isbn13,
      source: 'id' in result.book ? 'catalogue' : result.book.source,
      coverHost: hostOf(stored), stored, shown: coverSrc(stored, 'sm'), probe: null, dnb: null,
    })
  })
  process.stdout.write(`${query}: ${outcome.results.length} results\n`)
}

// ------------------------------------------------------------------ editions

const editions = createEditions({ fetch: timedFetch, languages: LANGUAGES, catalogue })
for (const book of libraryBooks.slice(LIBRARY_QUERIES)) {
  const outcome = await editions.find(book as Book)
  outcome.candidates.forEach((candidate, position) => {
    const stored = candidate.book.coverUrl
    rows.push({
      kind: 'edition', group: 'editions', query: book.title, position, title: candidate.book.title, isbn13: candidate.book.isbn13,
      source: 'id' in candidate.book ? 'catalogue' : candidate.book.source,
      coverHost: hostOf(stored), stored, shown: coverSrc(stored, 'sm'), probe: null, dnb: null,
    })
  })
  process.stdout.write(`editions of ${book.title}: ${outcome.candidates.length} rows\n`)
}
await db.end()

// --------------------------------------------------------------- the images

await pool(rows, CONCURRENCY, async (row) => {
  if (row.shown) row.probe = await probe(row.shown)
})

const storedRows: Row[] = storedCovers.map((book, position) => ({
  kind: 'edition', group: 'stored', query: '', position, title: book.title, isbn13: null, source: 'catalogue',
  coverHost: hostOf(book.cover_url), stored: book.cover_url, shown: coverSrc(book.cover_url, 'sm'), probe: null, dnb: null,
}))
await pool(storedRows, CONCURRENCY, async (row) => {
  if (row.shown) row.probe = await probe(row.shown)
})

// The DNB for German ISBNs (978-3), as a browser asks it.
const german = rows.filter((row) => row.kind === 'search').map((row) => ({ row, isbn: isbnOfRow(row) })).filter((x) => x.isbn?.startsWith('9783'))
function isbnOfRow(row: Row): string | null {
  return row.isbn13
}
await pool(german.slice(0, 20), 3, async ({ row, isbn }) => {
  row.dnb = await probe(`https://portal.dnb.de/opac/mvb/cover?isbn=${isbn}`, { referer: 'http://localhost:3020/' })
})

// The sizes each CDN offers, on a sample of covers it actually serves.
const sizeSamples: { provider: string; size: string; probe: Probe }[] = []
const olIds = [...new Set(rows.map((r) => /\/b\/id\/(\d+)-/.exec(r.stored ?? '')?.[1]).filter(Boolean))].slice(0, 20) as string[]
const appleBases = [...new Set(rows.map((r) => (hostOf(r.stored) === 'apple' ? r.stored : null)).filter(Boolean))].slice(0, 20) as string[]
for (const size of ['S', 'M', 'L'] as const) {
  const probes = await pool(olIds, CONCURRENCY, (id) => probe(`https://covers.openlibrary.org/b/id/${id}-${size}.jpg`))
  for (const p of probes) sizeSamples.push({ provider: 'openlibrary', size, probe: p })
}
for (const box of ['120x180', '200x300', '600x900'] as const) {
  const probes = await pool(appleBases, CONCURRENCY, (url) => probe(url.replace(/\/\d+x\d+bb\.(?:jpg|jpeg|png|webp)$/, `/${box}bb.jpg`)))
  for (const p of probes) sizeSamples.push({ provider: 'apple', size: box, probe: p })
}
// OpenLibrary by ISBN (the cover chain's last step, rate-limited per IP).
const isbns = [...new Set(rows.map(isbnOfRow).filter(Boolean))].slice(0, 15) as string[]
for (const p of await pool(isbns, CONCURRENCY, (isbn) => probe(`https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false`))) {
  sizeSamples.push({ provider: 'openlibrary-isbn', size: 'M', probe: p })
}

// ------------------------------------------------------------------ the report

mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'diagnosis.json'), JSON.stringify({ languages: LANGUAGES, queries, rows, storedRows, sizeSamples, apiTimings }, null, 2))

const median = (values: number[]) => {
  if (!values.length) return '–'
  const sorted = [...values].sort((a, b) => a - b)
  return String(sorted[Math.floor(sorted.length / 2)])
}
const p90 = (values: number[]) => {
  if (!values.length) return '–'
  const sorted = [...values].sort((a, b) => a - b)
  return String(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))])
}
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '–')

function table(title: string, groups: Map<string, Row[]>): string {
  const lines = [
    `### ${title}`,
    '',
    '| group | rows | no URL | shown | 404/err | blank | too small | not an image | median ms | p90 ms | median KB | CORS |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ]
  for (const [name, list] of groups) {
    const probed = list.map((r) => r.probe).filter((p): p is Probe => p !== null)
    const ok = probed.filter((p) => p.displayable)
    lines.push(
      `| ${name} | ${list.length} | ${pct(list.filter((r) => !r.stored).length, list.length)} | ${pct(ok.length, list.length)} | ` +
        `${probed.filter((p) => p.status === 'error' || (typeof p.status === 'number' && p.status >= 400)).length} | ` +
        `${probed.filter((p) => p.blank).length} | ${probed.filter((p) => p.tooSmall).length} | ` +
        `${probed.filter((p) => p.status === 200 && !p.type?.startsWith('image/')).length} | ` +
        `${median(ok.map((p) => p.totalMs))} | ${p90(ok.map((p) => p.totalMs))} | ` +
        `${median(ok.map((p) => Math.round(p.bytes / 1024)))} | ${pct(probed.filter((p) => p.cors).length, probed.length)} |`,
    )
  }
  return lines.join('\n')
}

const by = (list: Row[], key: (row: Row) => string) => {
  const map = new Map<string, Row[]>()
  for (const row of list) map.set(key(row), [...(map.get(key(row)) ?? []), row])
  return map
}

const searchRows = rows.filter((r) => r.kind === 'search')
const editionRows = rows.filter((r) => r.kind === 'edition')
const sizeTable = [
  '### CDN sizes',
  '',
  '| provider | size | n | ok | median px (w×h) | median KB | median ms | p90 ms | redirects |',
  '|---|---|---|---|---|---|---|---|---|',
  ...[...new Set(sizeSamples.map((s) => `${s.provider} ${s.size}`))].map((name) => {
    const probes = sizeSamples.filter((s) => `${s.provider} ${s.size}` === name).map((s) => s.probe)
    const ok = probes.filter((p) => p.displayable)
    const [provider, size] = name.split(' ')
    return `| ${provider} | ${size} | ${probes.length} | ${ok.length} | ${median(ok.map((p) => p.width ?? 0))}×${median(ok.map((p) => p.height ?? 0))} | ` +
      `${median(ok.map((p) => Math.round(p.bytes / 1024)))} | ${median(ok.map((p) => p.totalMs))} | ${p90(ok.map((p) => p.totalMs))} | ${median(probes.map((p) => p.redirects))} |`
  }),
].join('\n')

const apiTable = [
  '### Search APIs (time to the last byte)',
  '',
  '| host | calls | failed | median ms | p90 ms |',
  '|---|---|---|---|---|',
  ...[...new Set(apiTimings.map((t) => t.host))].map((host) => {
    const list = apiTimings.filter((t) => t.host === host)
    return `| ${host} | ${list.length} | ${list.filter((t) => !t.ok).length} | ${median(list.map((t) => t.ms))} | ${p90(list.map((t) => t.ms))} |`
  }),
].join('\n')

const dnbProbes = rows.map((r) => r.dnb).filter((p): p is Probe => p !== null)
const dnbLine = `DNB (\`portal.dnb.de/opac/mvb/cover\`) for ${dnbProbes.length} German ISBNs: ${dnbProbes.filter((p) => p.displayable).length} images, ` +
  `${dnbProbes.filter((p) => p.status === 200 && !p.type?.startsWith('image/')).length} HTML pages, ` +
  `${dnbProbes.filter((p) => p.status !== 200).length} other answers (statuses ${[...new Set(dnbProbes.map((p) => p.status))].join(', ')}); ` +
  `CORS on ${dnbProbes.filter((p) => p.cors).length}.`

const report = [
  `# Cover diagnosis — ${new Date().toISOString().slice(0, 16)}Z, languages ${LANGUAGES.join(', ')}`,
  '',
  `${queries.length} queries, ${searchRows.length} search rows, ${editionRows.length} Change edition rows; images fetched ${CONCURRENCY} at a time with a mobile Chrome user agent, the size each row asks for (\`coverSrc(url, 'sm')\`).`,
  '',
  table('Search rows by result source', by(searchRows, (r) => r.source)),
  '',
  table('Search rows by cover host', by(searchRows, (r) => r.coverHost)),
  '',
  table('Search rows by query group', by(searchRows, (r) => r.group)),
  '',
  table('Change edition rows by source', by(editionRows, (r) => r.source)),
  '',
  table('Change edition rows by cover host', by(editionRows, (r) => r.coverHost)),
  '',
  table('Catalogue Books (stored covers) by cover host', by(storedRows, (r) => r.coverHost)),
  '',
  sizeTable,
  '',
  apiTable,
  '',
  dnbLine,
  '',
].join('\n')
writeFileSync(join(OUT, 'diagnosis.md'), report)
console.log(`\n${report}`)
