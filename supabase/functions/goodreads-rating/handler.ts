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
 *
 * The Goodreads import asks the same function about one edition instead
 * (issue #111), because an export row names its edition by a Book Id and
 * often has no ISBN at all:
 *
 *   GET  /functions/v1/goodreads-rating?goodreadsId=6388978
 *   POST /functions/v1/goodreads-rating  { "goodreadsId": "6388978" }
 *
 *   200 { status: 'found', goodreadsId, title, isbn13, isbn10, asin, language,
 *         pageCount, format, publisher, year, checkedAt }
 *   200 { status: 'not_found', checkedAt }
 *   400 { error: 'goodreads_id_invalid' } · the rest as above
 *
 * Which of the two a request asks for is decided by the field it carries. The
 * editions have their own cache (`goodreads_editions`): an edition barely
 * changes, so a found one is kept 90 days, a miss 30.
 */
import type { Goodreads } from './client.ts'
import { GoodreadsBusy } from './client.ts'
import { type EditionAnswer, parseGoodreadsId } from './edition.ts'
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

/** A row of `goodreads_editions`: what an edition is, and when it was read. */
export type CachedEdition = EditionAnswer & { checkedAt: string }

export type EditionsCache = {
  get: (goodreadsId: string) => Promise<CachedEdition | null>
  put: (goodreadsId: string, edition: CachedEdition) => Promise<void>
}

/** A cached answer is good for this long; then Goodreads is asked again. */
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
/** An edition is published once and then stands still: asked again only after a quarter. */
export const EDITION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000
/** A Book Id Goodreads did not know may be one it hides for a while: asked again monthly. */
export const EDITION_MISS_MAX_AGE_MS = MAX_AGE_MS

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

/**
 * What the request asks about: an edition by its Goodreads Book Id, a rating
 * by ISBN-13, or neither. The field that is there decides, so both shapes go
 * to the same address and the older one keeps working untouched.
 */
type Ask =
  | { kind: 'rating'; book: LookupBook }
  | { kind: 'edition'; goodreadsId: string }
  | { kind: 'invalid'; error: 'isbn_invalid' | 'goodreads_id_invalid' }

/** What the request asks about, from the query string or a JSON body. */
async function readAsk(request: Request): Promise<Ask> {
  let id: unknown, isbn: unknown, title: unknown, authors: unknown
  if (request.method === 'GET') {
    const params = new URL(request.url).searchParams
    id = params.get('goodreadsId') ?? params.get('goodreads_id')
    isbn = params.get('isbn') ?? params.get('isbn13')
    title = params.get('title')
    authors = params.getAll('author')
  } else {
    let body: Record<string, unknown>
    try {
      body = (await request.json()) ?? {}
    } catch {
      return { kind: 'invalid', error: 'isbn_invalid' }
    }
    id = body.goodreadsId ?? body.goodreads_id
    isbn = body.isbn13 ?? body.isbn
    title = body.title
    authors = body.authors
  }
  if (id !== null && id !== undefined && id !== '') {
    // An export writes the id as a number; the cache is keyed by its digits.
    const asked = typeof id === 'number' ? String(id) : typeof id === 'string' ? id : null
    const goodreadsId = parseGoodreadsId(asked)
    return goodreadsId ? { kind: 'edition', goodreadsId } : { kind: 'invalid', error: 'goodreads_id_invalid' }
  }
  const isbn13 = parseIsbn13(typeof isbn === 'string' ? isbn : null)
  if (!isbn13) return { kind: 'invalid', error: 'isbn_invalid' }
  return {
    kind: 'rating',
    book: {
      isbn13,
      title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 500) : null,
      authors: Array.isArray(authors)
        ? authors.filter((a): a is string => typeof a === 'string' && Boolean(a.trim())).slice(0, 10)
        : [],
    },
  }
}

export function createHandler(deps: {
  cache: RatingsCache
  editions: EditionsCache
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
  /** The same for editions, by Goodreads Book Id: an import asks in bursts. */
  const editionsInFlight = new Map<string, Promise<CachedEdition>>()

  /** The one lookup for this key, started here or already running elsewhere. */
  function share<T>(running: Map<string, Promise<T>>, key: string, start: () => Promise<T>): Promise<T> {
    let shared = running.get(key)
    if (!shared) {
      shared = start().finally(() => running.delete(key))
      running.set(key, shared)
    }
    return shared
  }

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

  async function answerEdition(goodreadsId: string): Promise<CachedEdition> {
    const cached = await deps.editions.get(goodreadsId)
    const maxAge = cached?.status === 'found' ? EDITION_MAX_AGE_MS : EDITION_MISS_MAX_AGE_MS
    if (cached && now() - Date.parse(cached.checkedAt) < maxAge) return cached
    const read = await deps.goodreads.bookPage(goodreadsId)
    const fresh: CachedEdition = { ...read, checkedAt: new Date(now()).toISOString() }
    try {
      await deps.editions.put(goodreadsId, fresh)
    } catch (error) {
      // The import still gets the edition; the next run asks again.
      log(`goodreads-rating: storing edition ${goodreadsId} failed: ${error}`)
    }
    return fresh
  }

  return async (request) => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS })
    if (request.method !== 'GET' && request.method !== 'POST') return json(405, { error: 'method_not_allowed' })
    if (!(await deps.authorize(request))) return json(401, { error: 'unauthorized' })
    const ask = await readAsk(request)
    if (ask.kind === 'invalid') return json(400, { error: ask.error })

    const running = ask.kind === 'edition'
      ? share(editionsInFlight, ask.goodreadsId, () => answerEdition(ask.goodreadsId))
      : share(inFlight, ask.book.isbn13, () => answer(ask.book))
    try {
      return json(200, await running)
    } catch (error) {
      if (error instanceof GoodreadsBusy) return json(503, { error: 'busy' })
      log(`goodreads-rating: ${ask.kind === 'edition' ? ask.goodreadsId : ask.book.isbn13} failed: ${error}`)
      return json(502, { error: 'goodreads_unavailable' })
    }
  }
}
