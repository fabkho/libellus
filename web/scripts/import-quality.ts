/**
 * The import's match quality on a real export, measured as the app runs it, on the LOCAL stack only: the
 * lookup with the same paced `fetch` and the same lookups as the import store (stores/import.ts), the cover
 * fill over its budget, and Choose edition opened on every row that needs a look while the fill still runs
 * (as she would). It prints counts, never a title, an author or an ISBN: matched automatically (to a real
 * Book: a source's edition), needs a look, unmatched (only the file's own row), matched but shown without a
 * cover, rows whose title search found no candidate at all, Choose edition with nothing to offer, and per
 * row the cause the pipeline's own data names (a source refused or failed, nothing found, only something
 * close found). The per-row audit, which does carry titles, goes only to the file `LIBELLUS_IMPORT_AUDIT`
 * names (keep it outside the repository or under a gitignored path such as `.shots/`).
 *
 *   LIBELLUS_IMPORT_CSV=/path/export.csv \
 *   [LIBELLUS_IMPORT_KEYS=/path/keys.txt]        only these row keys, one a line (a subset to iterate on)
 *   [LIBELLUS_IMPORT_AUDIT=/path/audit.json]     the per-row audit (local only: it names the books)
 *   [LIBELLUS_IMPORT_FILL_SECONDS=600]           the cover fill's budget (0: no fill)
 *   [LIBELLUS_IMPORT_PICKER=1]                   open Choose edition on every row that needs a look
 *   [LIBELLUS_IMPORT_APPLE_OUTAGE=90:20]         Apple refuses (429) for 20 s every 90 s, as it does on a bad day
 *   [LIBELLUS_IMPORT_OPENLIBRARY=proxy|direct]   the import's Open Library through the `openlibrary` function (the
 *                                                store's wiring, default) or direct as before it; the report says
 *                                                which way ran and whether the function failed over to direct
 *   [LIBELLUS_IMPORT_OPENLIBRARY_URL=…]          the function's address (default `${SUPABASE_URL}/functions/v1/openlibrary`)
 *   SUPABASE_URL=… SUPABASE_DB_URL=… MAILPIT_URL=… pnpm tsx scripts/import-quality.ts
 *
 * Runs on the code it finds: on a checkout before the import-quality fix it measures the old lookup and its
 * preview rule (the "before" of the PR). A throwaway member is signed up and removed after; nothing is
 * written but what the lookup caches.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import {
  autoCompleteUrl,
  foundByTitle,
  matchTitle,
  parseAutoComplete,
  pickByBookId,
  titleQuery as goodreadsQuery,
} from '../../supabase/functions/goodreads-rating/goodreads.ts'
import { createAuth } from '../app/data/auth'
import * as bookImport from '../app/data/bookImport'
import { createBookImport, editionChoices, needsLook, pacedFetch, type Edition } from '../app/data/bookImport'
import { createCatalogueSearch } from '../app/data/catalogueSearch'
import { createCoverFill, mergeCover } from '../app/data/coverFill'
import { createDnb, DNB_IMPORT_GAP_MS } from '../app/data/dnb'
import { verifyCover, type ProbedImage } from '../app/data/covers'
import { createEditions } from '../app/data/editions'
import type { FetchLike } from '../app/data/fetching'
import { parseExport } from '../app/data/import/detect'
import type { ImportBook } from '../app/data/import/rows'
import { viaOwnServer } from '../app/data/openLibraryProxy'
import { createSearch } from '../app/data/search'
import { createInviteCode, newClient, readMailedCode, sql, uniqueEmail } from '../tests/support/stack'

const file = process.env.LIBELLUS_IMPORT_CSV
if (!file) {
  console.error('import-quality: name the export: LIBELLUS_IMPORT_CSV=/path/export.csv pnpm tsx scripts/import-quality.ts')
  process.exit(1)
}
process.env.LIBELLUS_TEST_RUN ??= 'quality'
const fillSeconds = Number(process.env.LIBELLUS_IMPORT_FILL_SECONDS ?? 600)
const openPicker = process.env.LIBELLUS_IMPORT_PICKER === '1'
const [outageEvery, outageFor] = (process.env.LIBELLUS_IMPORT_APPLE_OUTAGE ?? '').split(':').map(Number)
const languages = ['de-DE', 'en-US']
const today = new Date().toISOString().slice(0, 10)
const started = performance.now()
const seconds = () => Math.round((performance.now() - started) / 1000)
/** The code under measurement: the fix's `reviewOf` and `candidates`, or the lookup before it. */
const fixed = 'reviewOf' in bookImport

// --------------------------------------------------------- every request, tagged with the call that sent it

type Request = { host: string; kind: string; status: number; results: number | null }
type Call = { what: 'catalogue' | 'isbn' | 'title' | 'picker' | 'goodreads'; query: string; requests: Request[]; error?: string }
const tag = new AsyncLocalStorage<Call>()
/** Apple's answers as the app sees them (any call, tagged or not): how many, and when it first refused. */
const apple = { sent: 0, firstRefusal: null as { at: number; after: number } | null }
const calls: Call[] = []

const kindOf = (url: URL) =>
  url.hostname === 'itunes.apple.com'
    ? `apple.${url.pathname.slice(1)}${(url.searchParams.get('isbn') ?? '').includes(',') ? '.batch' : ''}`
    : url.hostname === 'openlibrary.org'
      ? `openlibrary.${url.pathname.split('/')[1]?.replace('.json', '')}`
      : url.hostname

/** What the app's sources see: the paced `fetch`'s answer, including its own 429 for a host it is leaving alone. */
function observed(inner: FetchLike): FetchLike {
  return async (url, init) => {
    const call = tag.getStore()
    const where = new URL(url)
    let response: Awaited<ReturnType<FetchLike>>
    try {
      response = await inner(url, init)
    } catch (error) {
      call?.requests.push({ host: where.hostname, kind: kindOf(where), status: init?.signal?.aborted ? -2 : -1, results: null })
      throw error
    }
    let results: number | null = null
    if (response.ok && 'clone' in response && typeof response.clone === 'function') {
      try {
        const body = (await (response as Response).clone().json()) as { resultCount?: number; numFound?: number; entries?: unknown[] }
        results = body.resultCount ?? body.numFound ?? body.entries?.length ?? null
      } catch {
        /* not JSON */
      }
    }
    call?.requests.push({ host: where.hostname, kind: kindOf(where), status: response.status, results })
    if (where.hostname === 'itunes.apple.com') {
      apple.sent++
      if (response.status !== 200 && apple.firstRefusal === null) apple.firstRefusal = { at: seconds(), after: apple.sent - 1 }
    }
    return response
  }
}

/** The network, with Apple's bad days played back on demand: a window of refusals every so often (`LIBELLUS_IMPORT_APPLE_OUTAGE`). */
const network: FetchLike = async (url, init) => {
  if (outageEvery && outageFor && new URL(url).hostname === 'itunes.apple.com') {
    const at = (performance.now() - started) / 1000
    if (at % outageEvery >= outageEvery - outageFor) {
      return { ok: false, status: 429, json: async () => ({}), headers: { get: (name: string) => (name.toLowerCase() === 'retry-after' ? '10' : null) } }
    }
  }
  return fetch(url, {
    ...init,
    headers: { ...(init as { headers?: Record<string, string> } | undefined)?.headers, 'User-Agent': 'libellus-import-quality/1.0' },
  })
}

async function probe(url: string): Promise<ProbedImage | null> {
  const response = await fetch(url, { headers: { 'User-Agent': 'libellus-import-quality/1.0' } })
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

/** The `goodreads-rating` function's cover path run in this process (its pure parts, no cache): one live call. */
async function goodreadsCover({ title, authors, goodreadsBookId }: { title: string; authors: string[]; goodreadsBookId?: string | null }) {
  const query = goodreadsQuery({ isbn13: null, title, authors })
  if (!query || !authors.length) return null
  const response = await fetch(autoCompleteUrl(query), { headers: { 'user-agent': 'Libellus/1.0 (private book tracker; audit)', accept: 'application/json' } })
  const text = await response.text()
  if ([202, 403, 429, 503].includes(response.status)) return 'blocked' as const
  const results = parseAutoComplete(response.status, text)
  const hit = pickByBookId(results, goodreadsBookId ?? null) ?? matchTitle({ isbn13: null, title, authors }, results)
  return hit ? (foundByTitle(hit, true).coverUrl ?? null) : null
}

// ------------------------------------------------------------------- the file, the member, the app's wiring

const parsed = parseExport(readFileSync(file, 'utf8'), today)
const subset = process.env.LIBELLUS_IMPORT_KEYS
  ? new Set(readFileSync(process.env.LIBELLUS_IMPORT_KEYS, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean))
  : null
const books = subset ? parsed.books.filter((book) => subset.has(book.key)) : parsed.books

const client = newClient()
const auth = createAuth(client)
const email = uniqueEmail('import-quality')
const requested = await auth.requestSignUpCode({ email, inviteCode: await createInviteCode({ maxUses: 1 }) })
if (requested.error) throw new Error(`sign-up failed: ${requested.error}`)
const verified = await auth.verifyCode(email, await readMailedCode(email))
if (verified.error) throw new Error(`verification failed: ${verified.error}`)
const member = await auth.currentMember()
if (!member) throw new Error('no session')

// As the import store wires it (stores/import.ts: `importer`, `startFill`, the Choose edition lookup). The
// import's Open Library goes through the `openlibrary` function (identified, ~3/s) and falls back to direct at
// 1/s when the function fails (`LIBELLUS_IMPORT_OPENLIBRARY=direct` measures the direct way before it).
const routed = (process.env.LIBELLUS_IMPORT_OPENLIBRARY ?? 'proxy') !== 'direct'
const functionUrl = process.env.LIBELLUS_IMPORT_OPENLIBRARY_URL ?? `${process.env.SUPABASE_URL}/functions/v1/openlibrary`
const proxy = routed
  ? viaOwnServer(network, {
      functionUrl,
      apikey: process.env.SUPABASE_ANON_KEY,
      token: async () => (await client.auth.getSession()).data.session?.access_token ?? null,
    })
  : null
const paced = pacedFetch(proxy ?? network, {
  gapMs: routed ? { 'itunes.apple.com': 250, 'openlibrary.org': 340 } : { 'itunes.apple.com': 250 },
})
const live = Object.assign(observed(paced), { blockedFor: paced.blockedFor })
const catalogue = createCatalogueSearch(client)
// The National Library (data/dnb.ts), as the import store wires it: the ISBN fallback and the title
// ladder's one question, on the import's own budget (`purpose`) and pace (`gapMs`); every call counted.
const dnbCalls = { asked: 0, answered: 0, refused: 0 }
const rawDnb = createDnb(client, { purpose: 'import', gapMs: DNB_IMPORT_GAP_MS })
function counted<T>(task: () => Promise<T>): Promise<T> {
  dnbCalls.asked++
  return task().then(
    (answer) => (dnbCalls.answered++, answer),
    (error) => {
      dnbCalls.refused++
      throw error
    },
  )
}
const dnb = {
  lookupIsbn: (isbn13: string, options?: { signal?: AbortSignal }) => counted(() => rawDnb.lookupIsbn(isbn13, options)),
  editions: (book: { title: string; authors: string[] }, options?: { signal?: AbortSignal }) => counted(() => rawDnb.editions(book, options)),
}
const searcher = createSearch({ fetch: live, languages, catalogue, dnb })
function tagged<T>(what: Call['what'], query: string, task: () => Promise<T>): Promise<T> {
  const call: Call = { what, query, requests: [] }
  calls.push(call)
  return tag.run(call, task).catch((error: unknown) => {
    call.error = error instanceof Error ? error.message : String(error)
    throw error
  })
}
const search = {
  ...searcher,
  search: (text: string, options?: Parameters<typeof searcher.search>[1]) => tagged('title', text, () => searcher.search(text, options)),
  lookupIsbn: (isbn: string, options?: Parameters<typeof searcher.lookupIsbn>[1]) => tagged('isbn', isbn, () => searcher.lookupIsbn(isbn, options)),
}
const lookups = {
  catalogue: { search: (text: string, signal?: AbortSignal) => tagged('catalogue', text, () => catalogue.search(text, signal)) },
  search,
  dnb,
  busyFor: () => live.blockedFor('itunes.apple.com'),
  goodreads: (query: { title: string; authors: string[]; goodreadsBookId: string | null }) =>
    tagged('goodreads', query.title, async () => {
      const url = await goodreadsCover(query)
      if (!url || url === 'blocked') return url
      return verifyCover(url, { probe }).catch(() => null)
    }),
}
const repository = createBookImport(client, { lookups: lookups as never, probe })

// ------------------------------------------------------------------------------------------- the lookup

const editions: (Edition | null)[] = books.map(() => null)
const fill = createCoverFill({
  fetch: live,
  search: searcher,
  probe,
  hostBlockedFor: (host) => live.blockedFor(host),
  budgetMs: fillSeconds * 1000,
  goodreads: async (query) => goodreadsCover(query),
  onFound(key, found) {
    const index = books.findIndex((book) => book.key === key)
    const next = editions[index] && mergeCover(editions[index]!, found)
    if (next) editions[index] = next
  },
})
const hasCover = (edition: Edition) => Boolean(edition.book.coverUrl || edition.coverFrom?.coverUrl)
const matched = (edition: Edition) => Boolean(edition.via) && edition.book.source !== 'import'
const wantCover = (index: number) => {
  const edition = editions[index]!
  const goodreadsId = /^goodreads:(\d{1,20})$/.exec(books[index]!.key)?.[1]
  if (fillSeconds && !edition.unsure && !hasCover(edition))
    fill.add({ key: books[index]!.key, row: books[index]!, book: edition.book, alternatives: edition.alternatives, ...(goodreadsId ? { goodreadsId } : {}) })
  else fill.drop(books[index]!.key)
}

await repository.match(books, {
  onEdition(index, edition) {
    editions[index] = edition
    wantCover(index)
  },
})
fill.holdSearch(false)
const lookupSeconds = seconds()
const lookedUp = [...editions]

// ------------------------------------------------- the preview's tiers (stores/import.ts: `attention`)

type Tier = 'quiet' | 'probablyFine' | 'needsLook'
/** The preview's rule: the fix's `reviewOf`, or the rule the store had before it (needs a look: nothing identifies it, never a missing cover). */
function tierOf(book: ImportBook, edition: Edition): { tier: Tier; shownCover: boolean } {
  if (fixed) {
    const review = (bookImport as unknown as { reviewOf: (b: ImportBook, e: Edition, m: boolean) => { tier: Tier; shown: { coverUrl: string | null } | null } }).reviewOf(book, edition, matched(edition))
    return { tier: review.tier, shownCover: Boolean(review.shown?.coverUrl) }
  }
  const verdict = matched(edition) ? 'matched' : 'fromFile'
  const notes = (verdict === 'fromFile' ? 1 : 0) + (verdict === 'matched' && edition.via === 'title' ? 1 : 0) + (verdict === 'matched' && !edition.book.coverUrl ? 1 : 0) + book.problems.length
  const shown = verdict === 'matched' || edition.coverFrom ? (edition.coverFrom ?? edition.book) : null
  const look = needsLook(verdict, shown, { isbn13: edition.book.isbn13 ?? book.isbn13, unsure: edition.unsure })
  return { tier: !notes && !look ? 'quiet' : look ? 'needsLook' : 'probablyFine', shownCover: Boolean(shown?.coverUrl) }
}

// ------------------------------------------ Choose edition on what needs a look, while the fill runs (as she would)

type Picked = { editions: number; failed: boolean; appleRefused: boolean }
const pickerFound = new Map<number, Picked>()
if (openPicker) {
  // Before the fix the sheet had a lookup of its own (data/editions.ts, an unpaced `fetch`).
  const before = fixed ? null : createEditions({ fetch: observed(network), languages, catalogue })
  for (const [index, book] of books.entries()) {
    const edition = editions[index]!
    if (tierOf(book, edition).tier !== 'needsLook') continue
    const at = calls.length
    let offered: number
    let failed: boolean
    if (before) {
      const wanted = { ...edition.book, title: book.title, authors: book.authors, openLibraryWorkKey: edition.book.openLibraryWorkKey ?? edition.alternatives?.find((b) => b.openLibraryWorkKey)?.openLibraryWorkKey ?? null, id: '', createdAt: '' }
      const outcome = await tagged('picker', book.title, () => before.find(wanted as never)).catch(() => ({ candidates: [], failed: true }))
      offered = outcome.candidates.filter((choice) => !choice.current).length
      failed = outcome.failed
    } else {
      const outcome = await tagged('picker', book.title, () => (repository as unknown as { candidates: (r: ImportBook, e: Edition) => Promise<{ editions: unknown[]; failed: boolean }> }).candidates(book, edition)).catch(() => ({ editions: [], failed: true }))
      offered = outcome.editions.length
      failed = outcome.failed
    }
    // What the sheet lists besides the row itself: the match's own finds and the sheet's search.
    const shown = Math.max(offered, editionChoices(book, edition).filter((choice) => !choice.current && !choice.file).length)
    const requests = calls.slice(at).flatMap((call) => call.requests)
    pickerFound.set(index, { editions: shown, failed, appleRefused: requests.some((r) => r.host === 'itunes.apple.com' && r.status !== 200) })
  }
}

if (fillSeconds) await fill.settled(fillSeconds * 1000 + 60_000)
fill.stop()

// ------------------------------------------------------------------------------------- causes, per row

/** The calls the lookup made for one row: its ISBN, the title questions that begin with its title, its Goodreads ask. */
function callsOf(book: ImportBook): Call[] {
  const title = book.title.toLowerCase().slice(0, 12)
  return calls.filter((call) => call.what !== 'picker' && (call.query === book.isbn13 || ((call.what === 'title' || call.what === 'goodreads') && call.query.toLowerCase().startsWith(title))))
}

/** Why a row ended where it did, from its edition and the answers its calls got. */
function causeOf(book: ImportBook, edition: Edition, own: Call[]): string {
  const requests = own.flatMap((call) => call.requests)
  const refused = requests.some((r) => [403, 429, 503].includes(r.status))
  const failed = requests.some((r) => r.status === -1 || (r.status >= 500 && r.status !== 503))
  const lent = !edition.book.coverUrl && Boolean(edition.coverFrom?.coverUrl)
  if (matched(edition)) {
    const how = edition.via === 'isbn' ? 'isbn' : 'title'
    if (edition.unsure) return `${how}:unsure`
    return hasCover(edition) ? `${how}:${lent || edition.filled ? 'lentCover' : 'ownCover'}` : `${how}:noCover`
  }
  if (edition.unsure) return refused ? 'unmatched:sourceRefused' : failed ? 'unmatched:sourceFailed' : 'unmatched:timeout'
  if ((edition as { goodreadsOnly?: boolean }).goodreadsOnly) return 'unmatched:goodreadsOnly'
  if (edition.alternatives?.length) return book.isbn13 ? 'unmatched:fileIsbnWorkFound' : 'unmatched:workFoundNotTaken'
  if ((edition as { near?: unknown[] }).near?.length) return 'unmatched:onlyNear'
  if (refused) return 'unmatched:zeroAppleRefused'
  return 'unmatched:zeroCandidates'
}

// ------------------------------------------------------------------------------------------- the counts

const rows = books.map((book, index) => {
  const edition = editions[index]!
  const first = lookedUp[index]!
  const { tier, shownCover } = tierOf(book, edition)
  const own = callsOf(book)
  const titled = own.some((call) => call.what === 'title')
  const near = (first as { near?: unknown[] }).near?.length ?? 0
  return {
    book,
    edition,
    tier,
    shownCover,
    cause: causeOf(book, first, own),
    zeroCandidates: titled && !matched(first) && !(first.alternatives?.length) && !near,
    detail: [...new Set(own.flatMap((call) => call.requests).map((r) => `${r.kind}:${r.status}${r.results === null ? '' : `/${r.results}`}`))],
    picker: pickerFound.get(index) ?? null,
  }
})
const count = (test: (row: (typeof rows)[number]) => boolean) => rows.filter(test).length
const by = (key: (row: (typeof rows)[number]) => string) =>
  Object.fromEntries(Object.entries(rows.reduce<Record<string, number>>((out, row) => ((out[key(row)] = (out[key(row)] ?? 0) + 1), out), {})).sort())

const report = {
  code: fixed ? 'fix' : 'before',
  rows: books.length,
  openlibrary: { routed: routed ? 'proxy' : 'direct', fallback: proxy?.fallbackActive() ?? false },
  appleOutage: outageEvery ? `${outageFor}s every ${outageEvery}s` : null,
  seconds: { lookup: lookupSeconds, total: seconds() },
  apple,
  dnb: dnbCalls,
  matchedAutomatically: count((row) => matched(row.edition)),
  matchedByIsbn: count((row) => matched(row.edition) && row.edition.via === 'isbn'),
  matchedByTitle: count((row) => matched(row.edition) && row.edition.via === 'title'),
  matchedViaDnb: count((row) => matched(row.edition) && row.edition.book.source === 'dnb'),
  unmatched: count((row) => !matched(row.edition)),
  unmatchedWithFileIsbn: count((row) => !matched(row.edition) && Boolean(row.book.isbn13)),
  needsLook: count((row) => row.tier === 'needsLook'),
  probablyFine: count((row) => row.tier === 'probablyFine'),
  probablyFineWithoutCover: count((row) => row.tier === 'probablyFine' && !row.shownCover),
  matchedWithoutCover: count((row) => matched(row.edition) && !row.shownCover),
  withoutCover: count((row) => !row.shownCover),
  zeroCandidateRows: count((row) => row.zeroCandidates),
  unsure: count((row) => row.edition.unsure),
  // Raw genre labels the lookup collected (not stored yet): rows with at least one, and per source that gave one.
  genres: {
    rows: count((row) => Boolean(row.edition.genres?.length)),
    bySource: Object.fromEntries(
      ['apple', 'openlibrary', 'catalogue'].map((source) => [source, count((row) => Boolean(row.edition.genres?.some((genre) => genre.sources.includes(source as never))))]),
    ),
  },
  causes: by((row) => row.cause),
  causesOfNeedsLook: by((row) => (row.tier === 'needsLook' ? row.cause : 'notNeedsLook')),
  picker: openPicker
    ? {
        opened: pickerFound.size,
        noEdition: [...pickerFound.values()].filter((p) => p.editions === 0).length,
        appleRefused: [...pickerFound.values()].filter((p) => p.appleRefused).length,
        failed: [...pickerFound.values()].filter((p) => p.failed).length,
      }
    : null,
  requests: calls.flatMap((call) => call.requests).reduce<Record<string, number>>((out, r) => {
    const key = `${r.kind}:${r.status}`
    out[key] = (out[key] ?? 0) + 1
    return out
  }, {}),
}
console.log(JSON.stringify(report, null, 2))

if (process.env.LIBELLUS_IMPORT_AUDIT) {
  writeFileSync(
    process.env.LIBELLUS_IMPORT_AUDIT,
    JSON.stringify(
      rows.map((row) => ({
        key: row.book.key,
        title: row.book.title,
        authors: row.book.authors,
        isbn13: row.book.isbn13,
        binding: row.book.binding,
        tier: row.tier,
        cover: row.shownCover,
        via: row.edition.via,
        source: row.edition.book.source,
        matchedTitle: matched(row.edition) ? row.edition.book.title : null,
        matchedLanguage: matched(row.edition) ? row.edition.book.language : null,
        unsure: row.edition.unsure,
        alternatives: row.edition.alternatives?.length ?? 0,
        cause: row.cause,
        zeroCandidates: row.zeroCandidates,
        requests: row.detail,
        queries: callsOf(row.book).map((call) => `${call.what}:${call.query}`),
        picker: row.picker,
      })),
      null,
      1,
    ),
  )
}

// The throwaway member goes (nothing was written: only what the lookup cached).
await sql('delete from auth.users where id = $1 and email = $2', [member.id, email])
console.error(`import-quality: removed ${email}`)
process.exit(0)
