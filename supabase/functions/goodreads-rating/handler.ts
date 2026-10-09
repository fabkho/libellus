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
 *   503 { error: 'busy' } · 502 { error: 'goodreads_unavailable' }
 *
 * A found rating checked within the last 30 days, or a miss within the last 7,
 * is answered from the cache: `goodreads_ratings` by ISBN, or, for a Book
 * without an ISBN, `goodreads_title_ratings` by its normalised title and
 * authors (`titleKey`). Otherwise Goodreads is asked by the
 * ISBN, then, when it does not know the ISBN, by the title and the first
 * author's surname (`matchTitle`), and the answer is stored with its time. A
 * failure is never stored. Two pages asking for the same Book at once share
 * one lookup. Everything it talks to comes in from outside (index.ts wires the
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

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' },
  })
}

/** Asks Goodreads about one Book: by the ISBN, then by title and author. */
export async function lookUp(book: LookupBook, goodreads: Goodreads): Promise<GoodreadsAnswer> {
  const byIsbn: GoodreadsAnswer = book.isbn13 ? await goodreads.reviewCounts(book.isbn13) : { status: 'not_found' }
  if (byIsbn.status === 'found') return byIsbn
  const query = titleQuery(book)
  if (!query || !book.authors.length) return byIsbn
  const match = matchTitle(book, await goodreads.autoComplete(query))
  return match ? foundByTitle(match) : { status: 'not_found' }
}

/** What the request asks about, from the query string or a JSON body. */
async function readBook(request: Request): Promise<LookupBook | { error: 'isbn_invalid' | 'book_unidentified' }> {
  let isbn: unknown, title: unknown, authors: unknown
  if (request.method === 'GET') {
    const params = new URL(request.url).searchParams
    isbn = params.get('isbn') ?? params.get('isbn13')
    title = params.get('title')
    authors = params.getAll('author')
  } else {
    let body: Record<string, unknown>
    try {
      body = (await request.json()) ?? {}
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
      ? authors.filter((a): a is string => typeof a === 'string' && Boolean(a.trim())).slice(0, 10)
      : [],
  }
  if (!isbn13 && !titleKey(book)) return { error: 'book_unidentified' }
  return book
}

export function createHandler(deps: {
  cache: RatingsCache
  goodreads: Goodreads
  /** True when the request comes from a signed-in member (or the service role). */
  authorize: (request: Request) => Promise<boolean>
  now?: () => number
  log?: (message: string) => void
}): (request: Request) => Promise<Response> {
  const now = deps.now ?? (() => Date.now())
  const log = deps.log ?? ((message) => console.error(message))
  /** Lookups running now, by ISBN: a second page asking waits for the first. */
  const inFlight = new Map<string, Promise<CachedAnswer>>()

  async function answer(book: LookupBook, key: CacheKey): Promise<CachedAnswer> {
    const cached = await deps.cache.get(key)
    if (cached && now() - Date.parse(cached.checkedAt) < (cached.status === 'found' ? MAX_AGE_MS : NOT_FOUND_MAX_AGE_MS)) {
      return cached
    }
    const fresh: CachedAnswer = { ...(await lookUp(book, deps.goodreads)), checkedAt: new Date(now()).toISOString() }
    try {
      await deps.cache.put(key, fresh)
    } catch (error) {
      // The member still gets the answer; the next page view asks again.
      log(`goodreads-rating: storing ${keyId(key)} failed: ${error}`)
    }
    return fresh
  }

  return async (request) => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS })
    if (request.method !== 'GET' && request.method !== 'POST') return json(405, { error: 'method_not_allowed' })
    if (!(await deps.authorize(request))) return json(401, { error: 'unauthorized' })
    const book = await readBook(request)
    if ('error' in book) return json(400, { error: book.error })
    const key: CacheKey = book.isbn13 ? { isbn13: book.isbn13 } : { titleKey: titleKey(book)! }
    const id = keyId(key)

    let running = inFlight.get(id)
    if (!running) {
      running = answer(book, key).finally(() => inFlight.delete(id))
      inFlight.set(id, running)
    }
    try {
      return json(200, await running)
    } catch (error) {
      if (error instanceof GoodreadsBusy) return json(503, { error: 'busy' })
      log(`goodreads-rating: ${id} failed: ${error}`)
      return json(502, { error: 'goodreads_unavailable' })
    }
  }
}
