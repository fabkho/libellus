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
 *   200 { status: 'blocked', retryAfterSeconds }
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
 * a minute.
 *
 * A request with `cover: true` (and optionally `goodreadsBookId`, the id of the
 * Goodreads file's own row) asks for the book's Goodreads cover, a last-resort
 * cover source (docs/covers.md): it is a title request (an ISBN, if sent, is
 * ignored), the answer gains `coverUrl` (`goodreadsCoverUrl`: the linked address at
 * Goodreads' image host, or null) and `goodreadsId`, and the member is counted in
 * its own bucket (`goodreads-cover`, 40 a minute), so an import of a hundred rows
 * does not use up the ratings' 20. The hit with the given id is taken as it is (it
 * IS that edition); without one, the same-work rule decides (`matchTitle`). Only a
 * rule hit is cached (the caller names the title: an id may not decide what the
 * cache says about it). A cached found row that never asked for a cover is asked
 * once more; a cover Goodreads does not have is cached as the empty string.
 * Blocked: Goodreads answering 403, 429 or 503, a 202 or an empty body, something that is not
 * JSON, or JSON of another shape (`GoodreadsBlocked`, goodreads.ts) is a block, not a miss and not
 * our own `busy`. It is never cached. It opens a breaker for BREAKER_MS (10 minutes, the injected
 * clock): while it is open no request goes to Goodreads, and a lookup that would need one is answered
 * `200 { status: 'blocked', retryAfterSeconds }` (200, so the client reads it; an answer the cache
 * has is still given). Each opening writes ONE line, `goodreads_blocked {"status":403,"kind":"status","at":"…"}`
 * (Supabase function logs: alert on it).
 * Everything it talks to comes in from outside (index.ts wires the
 * real ones), so the tests drive it with recordings.
 */
import type { Goodreads } from './client.ts'
import { GoodreadsBusy } from './client.ts'
import {
  foundByTitle,
  GoodreadsBlocked,
  type GoodreadsAnswer,
  type LookupBook,
  matchTitle,
  parseIsbn13,
  pickByBookId,
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
/** After a block, Goodreads is left alone this long. */
export const BREAKER_MS = 10 * 60 * 1000
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
/** Calls a member may make per bucket in a window: the cover asks have their own, larger one (an import's rows). */
export const BUCKETS = {
  'goodreads-rating': { limit: MEMBER_LIMIT, windowSeconds: MEMBER_WINDOW_SECONDS },
  'goodreads-cover': { limit: 40, windowSeconds: MEMBER_WINDOW_SECONDS },
} as const
export type Bucket = keyof typeof BUCKETS

/** Searches Goodreads for a Book by its title and first author. */
async function byTitle(book: LookupBook, goodreads: Goodreads): Promise<GoodreadsAnswer> {
  const query = titleQuery(book)
  if (!query || !book.authors.length) return { status: 'not_found' }
  const match = matchTitle(book, await goodreads.autoComplete(query))
  return match ? foundByTitle(match) : { status: 'not_found' }
}

/** A request's whole question: the Book, and whether (and for which Goodreads edition) it wants the cover. */
type Question = { book: LookupBook; cover: boolean; goodreadsBookId: string | null }

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

const isTrue = (value: unknown) => value === true || value === 'true' || value === '1'

/** What the request asks about, from the query string or a JSON body. */
async function readBook(request: Request): Promise<Question | ReadError> {
  let isbn: unknown, title: unknown, authors: unknown, cover: unknown, bookId: unknown
  if (request.method === 'GET') {
    if (request.url.length > MAX_BODY_BYTES) return { error: 'payload_too_large' }
    const params = new URL(request.url).searchParams
    isbn = params.get('isbn') ?? params.get('isbn13')
    title = params.get('title')
    authors = params.getAll('author')
    cover = params.get('cover')
    bookId = params.get('goodreadsBookId')
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
    cover = body.cover
    bookId = body.goodreadsBookId
  }
  const wantsCover = isTrue(cover)
  const goodreadsBookId = typeof bookId === 'number' ? String(bookId) : bookId
  // No ISBN at all is a Book found by title and author; one that is not valid is refused. A cover is asked by title.
  const given = !wantsCover && typeof isbn === 'string' && isbn.trim() ? isbn : null
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
  return {
    book,
    cover: wantsCover,
    goodreadsBookId: wantsCover && typeof goodreadsBookId === 'string' && /^\d{1,20}$/.test(goodreadsBookId) ? goodreadsBookId : null,
  }
}

/** What the caller is told: the cover only when it asked for one, and then always (null: Goodreads has none). */
function view(answer: CachedAnswer, cover: boolean): Record<string, unknown> {
  const { coverUrl, ...rest } = answer.status === 'found' ? answer : { ...answer, coverUrl: undefined }
  if (!cover) return rest
  return answer.status === 'found'
    ? { ...rest, coverUrl: coverUrl || null }
    : { ...rest, goodreadsId: null, coverUrl: null }
}

/** The member (or the service role, `member: null`) a request comes from. */
export type Caller = { member: string | null }

export function createHandler(deps: {
  cache: RatingsCache
  goodreads: Goodreads
  /** The signed-in member (or the service role) the request comes from; null for anybody else. */
  authorize: (request: Request) => Promise<Caller | null>
  /** Counts one call of a member; false when she is over her limit. Not asked for the service role. */
  throttle?: (member: string, bucket: Bucket) => Promise<boolean>
  now?: () => number
  log?: (message: string) => void
}): (request: Request) => Promise<Response> {
  const now = deps.now ?? (() => Date.now())
  const log = deps.log ?? ((message) => console.error(message))
  /** Lookups running now, by ISBN and title key: a second page asking for the same Book waits for the first. */
  const inFlight = new Map<string, Promise<CachedAnswer>>()
  /** When the breaker closes again; 0 while it was never opened. */
  let blockedUntil = 0
  const isOpen = () => now() < blockedUntil

  /** Goodreads, behind the breaker: no call while it is open; a block opens it (one log line) and is rethrown. */
  async function guarded<T>(call: () => Promise<T>): Promise<T> {
    if (isOpen()) throw new GoodreadsBlocked(0, 'status')
    try {
      return await call()
    } catch (error) {
      if (error instanceof GoodreadsBlocked && !isOpen()) {
        blockedUntil = now() + BREAKER_MS
        log(`goodreads_blocked ${JSON.stringify({ status: error.status, kind: error.kind, at: new Date(now()).toISOString() })}`)
      }
      throw error
    }
  }
  const goodreads: Goodreads = {
    reviewCounts: (isbn13) => guarded(() => deps.goodreads.reviewCounts(isbn13)),
    autoComplete: (query) => guarded(() => deps.goodreads.autoComplete(query)),
  }

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

  /**
   * The Goodreads cover for a Book: from the title cache while it is fresh and says what a cover asks (a
   * found row that never asked is asked once more), else from one title search, where the hit with the
   * given id wins over the same-work rule. Only the rule's own hit is stored.
   */
  async function coverAnswer(book: LookupBook, key: string, goodreadsBookId: string | null): Promise<CachedAnswer> {
    const cacheKey = { titleKey: key }
    const row = await deps.cache.get(cacheKey)
    if (row && now() - Date.parse(row.checkedAt) < (row.status === 'found' ? MAX_AGE_MS : NOT_FOUND_MAX_AGE_MS)) {
      // A found row that has been asked for its cover answers it; a miss stays a miss unless an id may find it.
      if (row.status === 'found' ? row.coverUrl !== undefined : !goodreadsBookId) return row
    }
    const query = titleQuery(book)
    const results = query && book.authors.length ? await goodreads.autoComplete(query) : []
    const byRule = matchTitle(book, results)
    const hit = pickByBookId(results, goodreadsBookId) ?? byRule
    const checkedAt = new Date(now()).toISOString()
    const stored: CachedAnswer = { ...(byRule ? foundByTitle(byRule, true) : { status: 'not_found' as const }), checkedAt }
    try {
      await deps.cache.put(cacheKey, stored)
    } catch (error) {
      log(`goodreads-rating: storing ${keyId(cacheKey).slice(0, MAX_LOG_KEY_CHARS)} failed: ${error}`)
    }
    return hit ? { ...foundByTitle(hit, true), checkedAt } : stored
  }

  async function answer(book: LookupBook, key: string | null): Promise<CachedAnswer> {
    let miss: CachedAnswer | null = null
    if (book.isbn13) {
      const isbn13 = book.isbn13
      const found = await cached({ isbn13 }, () => goodreads.reviewCounts(isbn13))
      if (found.status === 'found') return found
      miss = found
    }
    if (!key) return miss!
    return await cached({ titleKey: key }, () => byTitle(book, goodreads))
  }

  return async (request) => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS })
    if (request.method !== 'GET' && request.method !== 'POST') return json(405, { error: 'method_not_allowed' })
    const caller = await deps.authorize(request)
    if (!caller) return json(401, { error: 'unauthorized' })
    const question = await readBook(request)
    if ('error' in question) return json(question.error === 'payload_too_large' ? 413 : 400, { error: question.error })
    const { book, cover, goodreadsBookId } = question
    if (caller.member && deps.throttle) {
      let allowed: boolean
      try {
        allowed = await deps.throttle(caller.member, cover ? 'goodreads-cover' : 'goodreads-rating')
      } catch (error) {
        log(`goodreads-rating: rate limit check failed: ${error}`)
        return json(503, { error: 'busy' })
      }
      if (!allowed) return json(429, { error: 'rate_limited' }, { 'retry-after': String(MEMBER_WINDOW_SECONDS) })
    }
    const key = titleKey(book)
    const id = `${book.isbn13 ?? ''}|${key ?? ''}${cover ? `|cover:${goodreadsBookId ?? ''}` : ''}`

    let running = inFlight.get(id)
    if (!running) {
      running = (cover ? coverAnswer(book, key!, goodreadsBookId) : answer(book, key)).finally(() => inFlight.delete(id))
      inFlight.set(id, running)
    }
    try {
      return json(200, view(await running, cover))
    } catch (error) {
      if (error instanceof GoodreadsBlocked) {
        return json(200, { status: 'blocked', retryAfterSeconds: Math.max(1, Math.ceil((blockedUntil - now()) / 1000)) })
      }
      if (error instanceof GoodreadsBusy) return json(503, { error: 'busy' })
      log(`goodreads-rating: ${id.slice(0, MAX_LOG_KEY_CHARS)} failed: ${error}`)
      return json(502, { error: 'goodreads_unavailable' })
    }
  }
}
