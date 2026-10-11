/**
 * `goodreads-rating`: a Book's Goodreads rating by its ISBN-13, or by its title
 * and author when it has no ISBN, on demand (issue #69). The book page asks
 *
 *   GET  /functions/v1/goodreads-rating?isbn=<isbn13>&title=<title>&author=<name>[&author=…]
 *   POST /functions/v1/goodreads-rating  { "isbn13", "title", "authors": [] }
 *
 * (`isbn13` left out: the title and at least one author are then required.)
 *
 * as a signed-in member, and gets
 *
 *   200 { status: 'found', goodreadsId, rating, ratingsCount, reviewsCount, matchedBy, checkedAt }
 *   200 { status: 'not_found', checkedAt }
 *   400 { error: 'isbn_invalid' | 'book_unidentified' } · 401 { error: 'unauthorized' }
 *   413 { error: 'payload_too_large' } · 429 { error: 'rate_limited' }
 *   503 { error: 'busy' } · 502 { error: 'goodreads_unavailable' }
 *
 * A found rating checked within the last 30 days, or a miss within the last 7,
 * is answered from the cache. Two caches, and what a caller wrote is only ever
 * stored under what it was asked with: `goodreads_ratings` holds what Goodreads
 * said about an ISBN (`matchedBy: 'isbn'`, or a miss for that ISBN), and
 * `goodreads_title_ratings` what a title search found, by the normalised title
 * and authors (`titleKey`). A Book with an ISBN is asked by the ISBN first; when
 * Goodreads does not know it, the ISBN's miss is stored under the ISBN and the
 * title and the first author's surname are searched (`matchTitle`), the answer
 * stored under the title key and never under the ISBN: the title comes from the
 * caller, so it must not decide what every other member sees for that ISBN. A
 * failure is never stored. Two pages asking for the same Book at once share one
 * lookup. A body over 16 KB is refused, each author is cut to 200 characters,
 * a title key over 400 is not asked, and a member is held to a number of calls
 * a minute. Everything it talks to comes in from outside (index.ts wires the
 * real ones), so the tests drive it with recordings.
 */
import type { Goodreads } from './client.ts'
import { GoodreadsBusy } from './client.ts'
import {
  foundByTitle,
  type GoodreadsAnswer,
  type LookupBook,
  matchTitle,
  parseIsbn13,
  titleKey,
  titleQuery,
} from './goodreads.ts'

/** A row of `goodreads_ratings`: an answer and when Goodreads gave it. */
export type CachedAnswer = GoodreadsAnswer & { checkedAt: string }

/**
 * What an answer is cached by: the ISBN-13 (`goodreads_ratings`), or, for a
 * Book without an ISBN, its normalised title and authors (`goodreads_title_ratings`).
 */
export type CacheKey = { isbn13: string } | { titleKey: string }

export type RatingsCache = {
  get: (key: CacheKey) => Promise<CachedAnswer | null>
  put: (key: CacheKey, answer: CachedAnswer) => Promise<void>
}

/** A found rating is good for this long; then Goodreads is asked again. */
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
/** A miss is asked again sooner: Goodreads may learn the book, or the matching improve. */
export const NOT_FOUND_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

function keyId(key: CacheKey): string {
  return 'isbn13' in key ? key.isbn13 : `title:${key.titleKey}`
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
}

/** What a log line may carry of a key: it holds caller text. */
const MAX_LOG_KEY_CHARS = 120

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, ...headers, 'content-type': 'application/json; charset=utf-8' },
  })
}

/** Longest request body (or query string) taken: a Book is a title and a few names. */
export const MAX_BODY_BYTES = 16 * 1024
/** Longest author name kept. */
export const MAX_AUTHOR_CHARS = 200
/** Longest title key looked up: the table refuses over 1,000, and a real one is far shorter. */
export const MAX_KEY_CHARS = 400
/** What a member may ask in a minute (the function's own upstream budget is one request a second). */
export const MEMBER_LIMIT = 20
export const MEMBER_WINDOW_SECONDS = 60

/** Searches Goodreads for a Book by its title and first author. */
async function byTitle(book: LookupBook, goodreads: Goodreads): Promise<GoodreadsAnswer> {
  const query = titleQuery(book)
  if (!query || !book.authors.length) return { status: 'not_found' }
  const match = matchTitle(book, await goodreads.autoComplete(query))
  return match ? foundByTitle(match) : { status: 'not_found' }
}

/** The request's text, or null when it is longer than MAX_BODY_BYTES (read only as far as that). */
async function boundedText(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

type ReadError = { error: 'isbn_invalid' | 'book_unidentified' | 'payload_too_large' }

/** What the request asks about, from the query string or a JSON body. */
async function readBook(request: Request): Promise<LookupBook | ReadError> {
  let isbn: unknown, title: unknown, authors: unknown
  if (request.method === 'GET') {
    if (request.url.length > MAX_BODY_BYTES) return { error: 'payload_too_large' }
    const params = new URL(request.url).searchParams
    isbn = params.get('isbn') ?? params.get('isbn13')
    title = params.get('title')
    authors = params.getAll('author')
  } else {
    const text = await boundedText(request)
    if (text === null) return { error: 'payload_too_large' }
    let body: Record<string, unknown>
    try {
      body = JSON.parse(text) ?? {}
    } catch {
      return { error: 'isbn_invalid' }
    }
    isbn = body.isbn13 ?? body.isbn
    title = body.title
    authors = body.authors
  }
  // No ISBN at all is a Book found by title and author; one that is not valid is refused.
  const given = typeof isbn === 'string' && isbn.trim() ? isbn : null
  const isbn13 = parseIsbn13(given)
  if (given && !isbn13) return { error: 'isbn_invalid' }
  const book: LookupBook = {
    isbn13,
    title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 500) : null,
    authors: Array.isArray(authors)
      ? authors
          .filter((a): a is string => typeof a === 'string' && Boolean(a.trim()))
          .slice(0, 10)
          .map((a) => a.trim().slice(0, MAX_AUTHOR_CHARS))
      : [],
  }
  const key = titleKey(book)
  // A title key the table would refuse is never asked: with an ISBN the title is left out, without one it is no Book.
  if (key && key.length > MAX_KEY_CHARS) {
    if (!isbn13) return { error: 'book_unidentified' }
    book.title = null
    book.authors = []
  } else if (!isbn13 && !key) return { error: 'book_unidentified' }
  return book
}

/** The member (or the service role, `member: null`) a request comes from. */
export type Caller = { member: string | null }

export function createHandler(deps: {
  cache: RatingsCache
  goodreads: Goodreads
  /** The signed-in member (or the service role) the request comes from; null for anybody else. */
  authorize: (request: Request) => Promise<Caller | null>
  /** Counts one call of a member; false when she is over her limit. Not asked for the service role. */
  throttle?: (member: string) => Promise<boolean>
  now?: () => number
  log?: (message: string) => void
}): (request: Request) => Promise<Response> {
  const now = deps.now ?? (() => Date.now())
  const log = deps.log ?? ((message) => console.error(message))
  /** Lookups running now, by ISBN and title key: a second page asking for the same Book waits for the first. */
  const inFlight = new Map<string, Promise<CachedAnswer>>()

  /**
   * An answer from the cache while it is fresh, else one Goodreads gives, stored with its time. A found
   * row under an ISBN that a title search made (the old code wrote those) counts as no row.
   */
  async function cached(key: CacheKey, ask: () => Promise<GoodreadsAnswer>): Promise<CachedAnswer> {
    const row = await deps.cache.get(key)
    const usable = row && !('isbn13' in key && row.status === 'found' && row.matchedBy !== 'isbn')
    if (usable && now() - Date.parse(row.checkedAt) < (row.status === 'found' ? MAX_AGE_MS : NOT_FOUND_MAX_AGE_MS)) {
      return row
    }
    const fresh: CachedAnswer = { ...(await ask()), checkedAt: new Date(now()).toISOString() }
    try {
      await deps.cache.put(key, fresh)
    } catch (error) {
      // The member still gets the answer; the next page view asks again.
      log(`goodreads-rating: storing ${keyId(key).slice(0, MAX_LOG_KEY_CHARS)} failed: ${error}`)
    }
    return fresh
  }

  async function answer(book: LookupBook, key: string | null): Promise<CachedAnswer> {
    let miss: CachedAnswer | null = null
    if (book.isbn13) {
      const isbn13 = book.isbn13
      const found = await cached({ isbn13 }, () => deps.goodreads.reviewCounts(isbn13))
      if (found.status === 'found') return found
      miss = found
    }
    if (!key) return miss!
    return await cached({ titleKey: key }, () => byTitle(book, deps.goodreads))
  }

  return async (request) => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS })
    if (request.method !== 'GET' && request.method !== 'POST') return json(405, { error: 'method_not_allowed' })
    const caller = await deps.authorize(request)
    if (!caller) return json(401, { error: 'unauthorized' })
    const book = await readBook(request)
    if ('error' in book) return json(book.error === 'payload_too_large' ? 413 : 400, { error: book.error })
    if (caller.member && deps.throttle) {
      let allowed: boolean
      try {
        allowed = await deps.throttle(caller.member)
      } catch (error) {
        log(`goodreads-rating: rate limit check failed: ${error}`)
        return json(503, { error: 'busy' })
      }
      if (!allowed) return json(429, { error: 'rate_limited' }, { 'retry-after': String(MEMBER_WINDOW_SECONDS) })
    }
    const key = titleKey(book)
    const id = `${book.isbn13 ?? ''}|${key ?? ''}`

    let running = inFlight.get(id)
    if (!running) {
      running = answer(book, key).finally(() => inFlight.delete(id))
      inFlight.set(id, running)
    }
    try {
      return json(200, await running)
    } catch (error) {
      if (error instanceof GoodreadsBusy) return json(503, { error: 'busy' })
      log(`goodreads-rating: ${id.slice(0, MAX_LOG_KEY_CHARS)} failed: ${error}`)
      return json(502, { error: 'goodreads_unavailable' })
    }
  }
}
