/**
 * `google-books`: Google Books as the app's last book source (issue #305). The function holds the API key
 * (`GOOGLE_BOOKS_API_KEY`, a function secret, never in the repository), keeps the answers in a table for at most a
 * day, counts every request against a daily budget and answers the app's questions; the browser never talks to Google.
 *
 *   POST /functions/v1/google-books  { "action": "isbn",   "isbn13": "9783499267017" }
 *   POST /functions/v1/google-books  { "action": "search", "query": "der schwarm schätzing", "languages": ["de-DE", "en"] }
 *   POST /functions/v1/google-books  { "action": "search", "title": "Der Schwarm", "authors": ["Frank Schätzing"] }
 *   POST /functions/v1/google-books  { "action": "book",   "isbn13": "9783499267017" }
 *   (any of them with "purpose": "import": the import's own, larger member bucket)
 *
 *   200 { status: 'found', volume }       isbn: the edition (a `GoogleVolume`, googleBooksRecord.ts)
 *   200 { status: 'not_found' }           isbn, book: Google has no volume with this ISBN-13
 *   200 { status: 'ok', volumes: [] }     search: up to ten volumes, ranked (the member's languages first)
 *   200 { status: 'found', book }         book: the Catalogue Book (made now if it was not there), a `books` row
 *   200 { status: 'unavailable', reason } 'not_configured' (no key set), 'budget' (the day's requests are spent),
 *                                         'blocked' (Google refused: the breaker is open), 'error' (down, slow, not JSON)
 *   400 { error: 'isbn_invalid' | 'book_unidentified' | 'action_unknown' } · 401 { error: 'unauthorized' }
 *   413 { error: 'payload_too_large' } · 429 { error: 'rate_limited' } · 502 { error: 'google_books_unavailable' }
 *
 * `unavailable` is 200, not an error: the app reads it as "this source has nothing", the other sources carry on and the
 * member sees nothing of it (data/googleBooks.ts). So the function can ship before the key exists.
 *
 * What it asks, in what order: an ISBN is one `isbn:` question; words are one free-text question, or `intitle:` and
 * `inauthor:` for a title and a first author. `langRestrict` only when exactly one language is asked for (the API takes
 * one; with several, the answer is ordered by them instead). One request per question, never more.
 *
 * What it keeps (the terms: docs/THIRD-PARTY.md, "Google Books"): every answer is in `google_books_cache` until its
 * `expires_at` and no longer: an answer's own `Cache-Control: max-age` (at most a day), none at all when it says
 * `no-store`, else `GOOGLE_BOOKS_CACHE_FALLBACK_SECONDS` (an hour; 0 keeps nothing); a miss six hours (it is our own
 * finding, not Google's content). The rows are parsed volumes: facts of the edition, the app's genres and the cover's
 * address, never the description. An expired row is never answered (and a cron purge deletes it). A failure is never stored.
 *
 * The daily budget (`google_books_budget_take`, `DAILY_BUDGET` = 900 of the ~1,000 a day the free quota gives the whole
 * app, counted by Google's day, Pacific time): past it the function answers `unavailable` instead of burning the rest.
 * A refusal (400/401/403/429) opens a breaker for ten minutes (one log line, `google_books_blocked`), during which no
 * request goes out. A member is held to a number of calls a minute (an import has a larger bucket of its own); the
 * service role (the import job, `enrich`) is not.
 *
 * Everything it talks to comes in from outside (index.ts wires the real ones), so the tests drive it with recordings.
 */
import type { GoogleVolume } from '../../../web/app/data/googleBooksRecord.ts'
import { toIsbn13 } from '../../../web/app/data/dnbRecord.ts'
import { GoogleUnavailable, type GoogleBooksClient } from './client.ts'
import { isbnQuery, titleQuery } from '../../../web/app/data/googleBooksRecord.ts'
import type { Caller } from '../_shared/caller.ts'

export type { Caller }

/** A row of the Catalogue the function makes and returns (the columns the app reads: data/library.ts `BookRow`). */
export type BookRow = {
  id: string
  title: string
  authors: string[]
  isbn13: string | null
  isbn10?: string | null
  page_count: number | null
  published_year: number | null
  language: string | null
  publisher: string | null
  cover_url: string | null
  source: string
  [column: string]: unknown
}

export type Catalogue = {
  /** The Catalogue Book with this ISBN-13 (a member's Manual book is no Catalogue Book), or null. */
  find: (isbn13: string) => Promise<BookRow | null>
  /** Makes the Catalogue Book of a volume (source `import`); the one that is there already when another call made it first. */
  insert: (volume: GoogleVolume) => Promise<BookRow>
}

/** An answer kept in the table: what Google said, until `expiresAt`. */
export type CachedAnswer = { status: 'found' | 'not_found'; volumes: GoogleVolume[]; expiresAt: number }

export type Cache = {
  /** The row of a key, fresh or not (the handler checks `expiresAt`). */
  get: (key: string) => Promise<CachedAnswer | null>
  /** Keeps an answer for `ttlSeconds` from now. */
  put: (key: string, status: 'found' | 'not_found', volumes: GoogleVolume[], ttlSeconds: number) => Promise<void>
}

export type Budget = { bucket: string; limit: number }

/** What a member may ask in a minute (each call is at most one Google request, behind the cache and the daily budget). */
export const MEMBER_LIMIT = 30
export const MEMBER_WINDOW_SECONDS = 60
/** What one import may ask in a minute: its own bucket, so an import never spends the picker's and the palette's. */
export const IMPORT_LIMIT = 120
export const MEMBER_BUDGET: Budget = { bucket: 'google-books', limit: MEMBER_LIMIT }
export const IMPORT_BUDGET: Budget = { bucket: 'google-books-import', limit: IMPORT_LIMIT }

/** Requests to Google a (Pacific) day: 900 of the ~1,000 the default quota allows, a margin for the burst around the counter. */
export const DAILY_BUDGET = 900
/** After a refusal Google is left alone this long. */
export const BREAKER_MS = 10 * 60 * 1000

/** An answer that states no freshness (no `max-age`, `private`, `max-age=0`) is kept this long, unless the operator says otherwise. */
export const DEFAULT_FALLBACK_TTL_SECONDS = 60 * 60
/** The longest a found answer is ever kept, whatever its `max-age` says. */
export const MAX_FOUND_TTL_SECONDS = 24 * 60 * 60
/** A miss ("Google has no volume with this ISBN") is asked again after this. */
export const MISS_TTL_SECONDS = 6 * 60 * 60

/** Longest request body taken: an ISBN, or a title and a few names. */
export const MAX_BODY_BYTES = 4 * 1024
export const MAX_AUTHORS = 5
export const MAX_AUTHOR_CHARS = 200
export const MAX_TITLE_CHARS = 300
export const MAX_QUERY_CHARS = 200
/** Longest cache key: the table refuses more. */
export const MAX_KEY_CHARS = 400

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', ...headers } })
}

type Body = { action?: unknown; isbn13?: unknown; isbn?: unknown; query?: unknown; title?: unknown; authors?: unknown; languages?: unknown; purpose?: unknown }

async function readBody(request: Request): Promise<Body | 'too_large' | 'invalid'> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return 'too_large'
  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) return 'too_large'
  try {
    const body = JSON.parse(text)
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Body) : 'invalid'
  } catch {
    return 'invalid'
  }
}

/** Lower case, accents and punctuation gone: what a cache key is made of. */
export function keyText(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

/** The seconds an answer may be kept, from its own `Cache-Control` (see the header comment). `fallback`: what an answer without a stated lifetime gets. */
export function ttlSeconds(status: 'found' | 'not_found', cacheControl: string | null, fallback: number = DEFAULT_FALLBACK_TTL_SECONDS): number {
  // A miss is the function's own finding, not content Google returned: its time does not depend on the header.
  if (status === 'not_found') return MISS_TTL_SECONDS
  const control = (cacheControl ?? '').toLowerCase()
  if (/\bno-store\b/.test(control)) return 0
  const maxAge = /\b(?:s-)?max-age=(\d+)/.exec(control)
  if (maxAge && Number(maxAge[1]) > 0) return Math.min(Number(maxAge[1]), MAX_FOUND_TTL_SECONDS)
  return Math.min(Math.max(0, fallback), MAX_FOUND_TTL_SECONDS)
}

/** The one language a list of the member's languages narrows a question to, or null (none, or several: then they only order the answer). */
export function onlyLanguage(languages: readonly string[]): string | null {
  const codes = [...new Set(languages.map((language) => /^[a-z]{2}/i.exec(language)?.[0].toLowerCase()).filter((code): code is string => Boolean(code)))]
  return codes.length === 1 ? codes[0]! : null
}

/** The volumes with the member's languages first (a stable sort: Google's own order within a language). */
export function rankedBy(volumes: readonly GoogleVolume[], languages: readonly string[]): GoogleVolume[] {
  const order = [...new Set(languages.map((language) => /^[a-z]{2}/i.exec(language)?.[0].toLowerCase()).filter((code): code is string => Boolean(code)))]
  if (!order.length) return [...volumes]
  const place = (volume: GoogleVolume) => {
    const at = volume.language ? order.indexOf(volume.language) : -1
    return at < 0 ? order.length : at
  }
  return volumes.map((volume, index) => ({ volume, index })).sort((a, b) => place(a.volume) - place(b.volume) || a.index - b.index).map(({ volume }) => volume)
}

type Lookup = { status: 'found' | 'not_found'; volumes: GoogleVolume[] } | { status: 'unavailable'; reason: 'not_configured' | 'budget' | 'blocked' | 'error' }

export function createHandler(deps: {
  google: GoogleBooksClient
  cache: Cache
  catalogue: Catalogue
  /** Counts one request against the day's budget; false when the day is spent. Rejects when the counter cannot be asked. */
  budget: (limit: number) => Promise<boolean>
  /** Whether the API key is set: without it nothing is counted against the budget and nothing is asked (`unavailable`, `not_configured`). */
  configured: () => boolean
  authorize: (request: Request) => Promise<Caller | null>
  /** Counts one call of a member against a bucket; false when she is over its limit. Not asked for the service role. */
  throttle?: (member: string, budget: Budget) => Promise<boolean>
  /** `GOOGLE_BOOKS_CACHE_FALLBACK_SECONDS`: what an answer with no stated lifetime is kept; 0 keeps none. */
  fallbackTtlSeconds?: () => number
  dailyBudget?: number
  now?: () => number
  log?: (message: string) => void
}): (request: Request) => Promise<Response> {
  const log = deps.log ?? ((message) => console.error(message))
  const now = deps.now ?? (() => Date.now())
  const limit = deps.dailyBudget ?? DAILY_BUDGET
  let blockedUntil = 0
  let spentLogged = ''
  const inFlight = new Map<string, Promise<Lookup>>()

  /** One question, through the cache, the breaker and the day's budget; at most one request to Google. */
  function lookup(key: string, q: string, language: string | null): Promise<Lookup> {
    const running = inFlight.get(key)
    if (running) return running
    const task = (async (): Promise<Lookup> => {
      try {
        const kept = await deps.cache.get(key)
        if (kept && kept.expiresAt > now()) return { status: kept.status, volumes: kept.volumes }
      } catch (error) {
        log(`google-books: cache read failed: ${error}`)
      }
      if (!deps.configured()) return { status: 'unavailable', reason: 'not_configured' }
      if (now() < blockedUntil) return { status: 'unavailable', reason: 'blocked' }
      let allowed: boolean
      try {
        allowed = await deps.budget(limit)
      } catch (error) {
        log(`google-books: budget failed: ${error}`)
        return { status: 'unavailable', reason: 'error' }
      }
      if (!allowed) {
        // One line a day and instance: the owner's log shows the quota ran out, not every refused call.
        const day = new Date(now()).toISOString().slice(0, 10)
        if (spentLogged !== day) {
          spentLogged = day
          log(`google_books_budget_spent ${JSON.stringify({ limit, day })}`)
        }
        return { status: 'unavailable', reason: 'budget' }
      }
      try {
        const answer = await deps.google.ask(q, language)
        const status = answer.volumes.length ? 'found' : 'not_found'
        const ttl = ttlSeconds(status, answer.cacheControl, deps.fallbackTtlSeconds?.())
        if (ttl > 0) {
          try {
            await deps.cache.put(key, status, answer.volumes, ttl)
          } catch (error) {
            log(`google-books: cache write failed: ${error}`)
          }
        }
        return { status, volumes: answer.volumes }
      } catch (error) {
        if (!(error instanceof GoogleUnavailable)) {
          log(`google-books: ${key.slice(0, 40)} failed: ${error}`)
          return { status: 'unavailable', reason: 'error' }
        }
        if (error.kind === 'blocked') {
          blockedUntil = now() + BREAKER_MS
          log(`google_books_blocked ${JSON.stringify({ status: error.status, at: new Date(now()).toISOString() })}`)
        }
        return { status: 'unavailable', reason: error.kind }
      }
    })().finally(() => inFlight.delete(key))
    inFlight.set(key, task)
    return task
  }

  /** The volume that has an ISBN-13, by the ISBN question; null for a miss. */
  async function byIsbn(isbn13: string): Promise<{ volume: GoogleVolume | null } | { unavailable: string }> {
    const found = await lookup(`isbn:${isbn13}`, isbnQuery(isbn13), null)
    if (found.status === 'unavailable') return { unavailable: found.reason }
    return { volume: found.volumes.find((volume) => volume.isbn13 === isbn13) ?? null }
  }

  return async function handler(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' })
    const caller = await deps.authorize(request)
    if (!caller) return json(401, { error: 'unauthorized' })
    const body = await readBody(request)
    if (body === 'too_large') return json(413, { error: 'payload_too_large' })
    if (body === 'invalid') return json(400, { error: 'book_unidentified' })
    if (caller.member && deps.throttle) {
      let allowed: boolean
      try {
        allowed = await deps.throttle(caller.member, body.purpose === 'import' ? IMPORT_BUDGET : MEMBER_BUDGET)
      } catch (error) {
        log(`google-books: throttle failed: ${error}`)
        return json(502, { error: 'google_books_unavailable' })
      }
      if (!allowed) return json(429, { error: 'rate_limited' }, { 'retry-after': String(MEMBER_WINDOW_SECONDS) })
    }

    try {
      switch (body.action) {
        case 'isbn':
        case 'book': {
          const asked = body.isbn13 ?? body.isbn
          const isbn13 = typeof asked === 'string' ? toIsbn13(asked) : null
          if (!isbn13) return json(400, { error: 'isbn_invalid' })
          if (body.action === 'book') {
            const known = await deps.catalogue.find(isbn13)
            if (known) return json(200, { status: 'found', book: known })
          }
          const found = await byIsbn(isbn13)
          if ('unavailable' in found) return json(200, { status: 'unavailable', reason: found.unavailable })
          // An edition without authors or a title is no Book (an author-less volume is not added).
          if (!found.volume) return json(200, { status: 'not_found' })
          if (body.action === 'isbn') return json(200, { status: 'found', volume: found.volume })
          if (!found.volume.authors.length) return json(200, { status: 'not_found' })
          return json(200, { status: 'found', book: await deps.catalogue.insert(found.volume) })
        }
        case 'search': {
          const languages = Array.isArray(body.languages)
            ? body.languages.filter((language): language is string => typeof language === 'string').slice(0, 4).map((language) => language.slice(0, 12))
            : []
          const only = onlyLanguage(languages)
          const title = typeof body.title === 'string' ? body.title.trim().slice(0, MAX_TITLE_CHARS) : ''
          let key: string
          let q: string | null
          if (title) {
            const authors = Array.isArray(body.authors)
              ? body.authors.filter((a): a is string => typeof a === 'string' && Boolean(a.trim())).slice(0, MAX_AUTHORS).map((a) => a.trim().slice(0, MAX_AUTHOR_CHARS))
              : []
            q = titleQuery(title, authors[0] ?? '')
            key = `title:${keyText(title)}|${keyText(authors[0] ?? '')}|${only ?? ''}`
          } else {
            const query = typeof body.query === 'string' ? body.query.trim().slice(0, MAX_QUERY_CHARS) : ''
            q = query.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim() || null
            key = `q:${keyText(query)}|${only ?? ''}`
          }
          if (!q) return json(400, { error: 'book_unidentified' })
          if (key.length > MAX_KEY_CHARS) return json(400, { error: 'book_unidentified' })
          const found = await lookup(key, q, only)
          if (found.status === 'unavailable') return json(200, { status: 'unavailable', reason: found.reason })
          return json(200, { status: 'ok', volumes: rankedBy(found.volumes, languages) })
        }
        default:
          return json(400, { error: 'action_unknown' })
      }
    } catch (error) {
      log(`google-books: ${body.action} failed: ${error}`)
      return json(502, { error: 'google_books_unavailable' })
    }
  }
}
