/**
 * The tests' Google Books: answers from the recordings in fixtures/ (hand-built from the documented volumes shape, and one
 * real 429), by question. A question nobody recorded fails the test, so no test ever reaches Google; and no test holds a key:
 * `apiKey` is a placeholder that only has to be non-empty.
 */
import { isbnQuery, titleQuery, volumesUrl } from '../../../web/app/data/googleBooksRecord.ts'
import type { GoogleVolume } from '../../../web/app/data/googleBooksRecord.ts'
import type { FetchLike } from './client.ts'
import type { Budget, BookRow, Cache, CachedAnswer, Catalogue } from './handler.ts'

export const fixture = (name: string): string => Deno.readTextFileSync(new URL(`./fixtures/${name}.json`, import.meta.url))

/** Invented ISBN-13s of the fixtures (979-10 range). */
export const ISBN_HIT = '9791034567898'
export const ISBN_MISS = '9791034567997'
export const ISBN_DE = '9791034567904'

export const TEST_KEY = 'test-key-not-a-secret'

const RECORDED: Record<string, { file: string; status?: number; headers?: Record<string, string> }> = {
  // No Cache-Control at all: the one case the fallback lifetime applies to.
  [volumesUrl(isbnQuery(ISBN_HIT))]: { file: 'isbn-hit' },
  [volumesUrl(isbnQuery(ISBN_MISS))]: { file: 'isbn-miss' },
  [volumesUrl(titleQuery('Der stille Hafen', 'Ida Beispiel')!)]: { file: 'title-german', headers: { 'cache-control': 'public, max-age=600' } },
  [volumesUrl('stille hafen beispiel')]: { file: 'title-german' },
  [volumesUrl('stille hafen beispiel', 'de')]: { file: 'title-german' },
  [volumesUrl(isbnQuery('9791034567911'))]: { file: 'quota-429', status: 429 },
  [volumesUrl(isbnQuery('9791034567928'))]: { file: 'quota-429', status: 500 },
}

/** A `fetch` that answers the recorded questions and remembers what was asked (never the key's value in `url`: it travels in a header). */
export function recordedFetch(extra: Record<string, () => Response | Promise<Response>> = {}) {
  const asked: { url: string; headers: Headers; redirect: string }[] = []
  const fetch: FetchLike = async (url, init) => {
    asked.push({ url, headers: new Headers(init.headers), redirect: init.redirect })
    if (extra[url]) return await extra[url]!()
    const found = RECORDED[url]
    if (!found) throw new Error(`No recording for ${url}`)
    return new Response(fixture(found.file), { status: found.status ?? 200, headers: { 'content-type': 'application/json; charset=UTF-8', ...(found.headers ?? {}) } })
  }
  return { fetch, asked }
}

/** A cache in memory: `rows` is what the table would hold. */
export function memoryCache(clock: { now: () => number }) {
  const rows = new Map<string, CachedAnswer & { fetchedAt: number; ttlSeconds: number }>()
  const cache: Cache = {
    get: (key) => Promise.resolve(rows.get(key) ?? null),
    put(key, status, volumes: GoogleVolume[], ttlSeconds) {
      rows.set(key, { status, volumes, expiresAt: clock.now() + ttlSeconds * 1000, fetchedAt: clock.now(), ttlSeconds })
      return Promise.resolve()
    },
  }
  return { cache, rows }
}

/** The day's counters in memory, with the refusal the real ones give past their limits (the slice is counted in the day, both or neither). */
export function memoryBudget(start = 0) {
  const state = { used: start, slices: {} as Record<string, number>, calls: [] as { limit: number; slice?: { scope: string; limit: number } }[] }
  return {
    state,
    take(limit: number, slice?: { scope: string; limit: number }): Promise<boolean> {
      state.calls.push({ limit, ...(slice ? { slice } : {}) })
      if (slice && (state.slices[slice.scope] ?? 0) >= slice.limit) return Promise.resolve(false)
      if (state.used >= limit) return Promise.resolve(false)
      state.used++
      if (slice) state.slices[slice.scope] = (state.slices[slice.scope] ?? 0) + 1
      return Promise.resolve(true)
    },
  }
}

/** A Catalogue in memory. */
export function memoryCatalogue(initial: BookRow[] = []) {
  const books = [...initial]
  const catalogue: Catalogue = {
    find: (isbn13) => Promise.resolve(books.find((book) => book.isbn13 === isbn13) ?? null),
    insert(volume) {
      const row: BookRow = {
        id: `book-${books.length + 1}`,
        title: volume.title,
        authors: volume.authors,
        isbn13: volume.isbn13,
        isbn10: volume.isbn10,
        page_count: volume.pageCount,
        published_year: volume.year,
        language: volume.language,
        publisher: volume.publisher,
        cover_url: volume.coverUrl,
        source: 'import',
      }
      books.push(row)
      return Promise.resolve(row)
    },
  }
  return { catalogue, books }
}

/** A clock the test moves. */
export function fakeClock(start = Date.parse('2026-11-05T10:00:00Z')) {
  let time = start
  return { now: () => time, advance: (ms: number) => (time += ms) }
}

export const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://example.test/functions/v1/google-books', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

export type Throttled = { member: string; budget: Budget }
