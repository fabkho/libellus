/**
 * `goodreads-rating`: a Book's Goodreads rating by its ISBN-13, on demand
 * (issue #69). The book page asks
 *
 *   GET  /functions/v1/goodreads-rating?isbn=<isbn13>&title=<title>&author=<name>[&author=…]
 *   POST /functions/v1/goodreads-rating  { "isbn13", "title", "authors": [] }
 *
 * as a signed-in member, and gets
 *
 *   200 { status: 'found', goodreadsId, rating, ratingsCount, reviewsCount, matchedBy, checkedAt }
 *   200 { status: 'not_found', checkedAt }
 *   400 { error: 'isbn_invalid' } · 401 { error: 'unauthorized' }
 *   503 { error: 'busy' } · 502 { error: 'goodreads_unavailable' }
 *
 * An ISBN checked within the last 30 days is answered from the cache
 * (`goodreads_ratings`), a miss included. Otherwise Goodreads is asked by the
 * ISBN, then, when it does not know the ISBN, by the title and the first
 * author's surname (`matchTitle`), and the answer is stored with its time. A
 * failure is never stored. Two pages asking for the same ISBN at once share
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
  titleQuery,
} from './goodreads.ts'

/** A row of `goodreads_ratings`: an answer and when Goodreads gave it. */
export type CachedAnswer = GoodreadsAnswer & { checkedAt: string }

export type RatingsCache = {
  get: (isbn13: string) => Promise<CachedAnswer | null>
  put: (isbn13: string, answer: CachedAnswer) => Promise<void>
}

/** A cached answer is good for this long; then Goodreads is asked again. */
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

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
  const byIsbn = await goodreads.reviewCounts(book.isbn13)
  if (byIsbn.status === 'found') return byIsbn
  const query = titleQuery(book)
  if (!query || !book.authors.length) return byIsbn
  const match = matchTitle(book, await goodreads.autoComplete(query))
  return match ? foundByTitle(match) : { status: 'not_found' }
}

/** What the request asks about, from the query string or a JSON body. */
async function readBook(request: Request): Promise<LookupBook | null> {
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
      return null
    }
    isbn = body.isbn13 ?? body.isbn
    title = body.title
    authors = body.authors
  }
  const isbn13 = parseIsbn13(typeof isbn === 'string' ? isbn : null)
  if (!isbn13) return null
  return {
    isbn13,
    title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 500) : null,
    authors: Array.isArray(authors)
      ? authors.filter((a): a is string => typeof a === 'string' && Boolean(a.trim())).slice(0, 10)
      : [],
  }
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

  async function answer(book: LookupBook): Promise<CachedAnswer> {
    const cached = await deps.cache.get(book.isbn13)
    if (cached && now() - Date.parse(cached.checkedAt) < MAX_AGE_MS) return cached
    const fresh: CachedAnswer = { ...(await lookUp(book, deps.goodreads)), checkedAt: new Date(now()).toISOString() }
    try {
      await deps.cache.put(book.isbn13, fresh)
    } catch (error) {
      // The member still gets the answer; the next page view asks again.
      log(`goodreads-rating: storing ${book.isbn13} failed: ${error}`)
    }
    return fresh
  }

  return async (request) => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS })
    if (request.method !== 'GET' && request.method !== 'POST') return json(405, { error: 'method_not_allowed' })
    if (!(await deps.authorize(request))) return json(401, { error: 'unauthorized' })
    const book = await readBook(request)
    if (!book) return json(400, { error: 'isbn_invalid' })

    let running = inFlight.get(book.isbn13)
    if (!running) {
      running = answer(book).finally(() => inFlight.delete(book.isbn13))
      inFlight.set(book.isbn13, running)
    }
    try {
      return json(200, await running)
    } catch (error) {
      if (error instanceof GoodreadsBusy) return json(503, { error: 'busy' })
      log(`goodreads-rating: ${book.isbn13} failed: ${error}`)
      return json(502, { error: 'goodreads_unavailable' })
    }
  }
}
