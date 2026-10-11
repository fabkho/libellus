/**
 * `enrich`: the request/response side (issues #166–#168). Everything it talks
 * to comes in from outside (index.ts wires the real ones), so the tests drive
 * it with recordings and an in-memory store.
 *
 *   POST /functions/v1/enrich
 *   { "action": "drain", "limit"?: n }      service: work through the queue for up to
 *                                           `budgetMs` (90 s), then refresh stale authors
 *   { "action": "book", "bookId": "…" }     member or service: enrich one Catalogue Book now
 *   { "action": "author", "key": "Q46248" } member or service: refresh one author if stale
 *   { "action": "backfill", "limit"?: n }   service: queue every Book never enriched
 *   { "action": "remap" }                   service: apply the current genre mapping to
 *                                           every Book an older one computed (no source asked)
 *   { "action": "status" }                  service: the queue at a glance
 *
 *   200 { … what was done … } · 400 action_invalid · 401 unauthorized · 403 forbidden
 *   404 not_found · 405 method_not_allowed · 429 rate_limited · 502 source_unavailable
 *   503 busy (the member counter could not be asked)
 *
 * Callers: the service-role key, the shared secret ENRICH_TOKEN (pg_cron's
 * call through pg_net) or a signed-in member's access token (only `book` and
 * `author`, single-flight per key so two pages asking at once share one run, and
 * ten calls a minute per member: every one of them spends the shared Apple, Open
 * Library and Wikidata budget).
 */
import { GENRE_MAP_VERSION, mapGenres } from '../../../web/app/data/enrich/genres.ts'
import { appleGenres, type BookRow, type EnrichContext, enrichAuthor, enrichBook } from './enrich.ts'
import { SourceUnavailable } from './http.ts'
import type { Sources } from './sources.ts'
import type { Store } from './store.ts'

export const CORS: HeadersInit = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

/** How long one drain may run: the hosted limit is 150 s of wall clock. */
export const DRAIN_BUDGET_MS = 90_000
export const DRAIN_BATCH = 4

/** The service (the service-role key, ENRICH_TOKEN), a signed-in member (by id) or nobody. */
export type Caller = 'service' | { member: string } | null

/** What a member may ask of `book` and `author` in a minute. */
export const MEMBER_LIMIT = 10
export const MEMBER_WINDOW_SECONDS = 60

export type HandlerDeps = {
  store: Store
  sources: Sources
  authorize: (request: Request) => Promise<Caller>
  /** Counts one `book` or `author` call of a member; false when she is over her limit. */
  throttle?: (member: string) => Promise<boolean>
  now?: () => number
  budgetMs?: number
  log?: (message: string) => void
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } })
}

export function createHandler(deps: HandlerDeps): (request: Request) => Promise<Response> {
  const now = deps.now ?? (() => Date.now())
  const log = deps.log ?? ((message) => console.error(message))
  const ctx: EnrichContext = {
    sources: deps.sources,
    authorFresh: (ref) => deps.store.authorFresh(ref),
    seriesFresh: (qid) => deps.store.seriesFresh(qid),
  }
  const inFlight = new Map<string, Promise<unknown>>()

  function once<T>(key: string, run: () => Promise<T>): Promise<T> {
    let running = inFlight.get(key) as Promise<T> | undefined
    if (!running) {
      running = run().finally(() => inFlight.delete(key))
      inFlight.set(key, running)
    }
    return running
  }

  /** Enriches claimed Books one by one; a failure goes back into the queue. */
  async function enrichAll(books: BookRow[]): Promise<{ done: number; failed: number }> {
    let apple = new Map<string, string[]>()
    let appleFailed = false
    try {
      apple = await appleGenres(books, deps.sources)
    } catch (error) {
      appleFailed = true
      log(`enrich: Apple lookup failed: ${error}`)
    }
    let done = 0
    let failed = 0
    for (const book of books) {
      try {
        const payload = await enrichBook(book, ctx, apple.get(book.id) ?? [])
        // Without Apple and without any other genre, try again later rather than store none.
        if (appleFailed && !payload.book?.genres.length) throw new Error('apple_unavailable')
        await deps.store.save(payload)
        done++
      } catch (error) {
        failed++
        log(`enrich: ${book.id} failed: ${error}`)
        await deps.store.failed(book.id, String(error instanceof Error ? error.message : error)).catch(() => {})
      }
    }
    return { done, failed }
  }

  async function drain(limit: number | null): Promise<Record<string, number>> {
    const deadline = now() + (deps.budgetMs ?? DRAIN_BUDGET_MS)
    let books = 0
    let failed = 0
    while (now() < deadline && (limit === null || books + failed < limit)) {
      const batch = await deps.store.claim(Math.min(DRAIN_BATCH, limit === null ? DRAIN_BATCH : limit - books - failed))
      if (!batch.length) break
      const result = await enrichAll(batch)
      books += result.done
      failed += result.failed
    }
    let authors = 0
    if (now() < deadline) {
      for (const stale of await deps.store.staleAuthors(3)) {
        if (now() >= deadline) break
        try {
          const ref = { wikidata: stale.wikidata_id, openlibrary: stale.openlibrary_key, name: stale.name }
          await deps.store.save(await enrichAuthor(ref, ctx))
          authors++
        } catch (error) {
          log(`enrich: author ${stale.id} failed: ${error}`)
        }
      }
    }
    return { books, failed, authors }
  }

  async function remap(): Promise<number> {
    let count = 0
    for (;;) {
      const rows = await deps.store.remapCandidates(GENRE_MAP_VERSION, 200)
      if (!rows.length) return count
      for (const row of rows) {
        const genres = mapGenres(Array.isArray(row.signals) ? row.signals : []).map((g, i) => ({ ...g, rank: i + 1 }))
        await deps.store.saveGenres(row.book_id, genres, GENRE_MAP_VERSION)
        count++
      }
    }
  }

  /** A response when this member may not ask now (over her limit, or the counter is down); null when she may. */
  async function refuse(caller: NonNullable<Caller>): Promise<Response | null> {
    if (caller === 'service' || !deps.throttle) return null
    try {
      if (await deps.throttle(caller.member)) return null
    } catch (error) {
      log(`enrich: rate limit check failed: ${error}`)
      return json(503, { error: 'busy' })
    }
    return new Response(JSON.stringify({ error: 'rate_limited' }), {
      status: 429,
      headers: { ...CORS, 'content-type': 'application/json', 'retry-after': String(MEMBER_WINDOW_SECONDS) },
    })
  }

  return async (request) => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS })
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' })
    const caller = await deps.authorize(request)
    if (!caller) return json(401, { error: 'unauthorized' })
    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return json(400, { error: 'action_invalid' })
    }
    const action = body?.action
    const limit = typeof body.limit === 'number' && body.limit > 0 ? Math.floor(body.limit) : null
    const serviceOnly = ['drain', 'backfill', 'remap', 'status']
    if (typeof action === 'string' && serviceOnly.includes(action) && caller !== 'service') {
      return json(403, { error: 'forbidden' })
    }

    try {
      switch (action) {
        case 'drain':
          return json(200, await drain(limit))
        case 'backfill':
          return json(200, { queued: await deps.store.backfill(limit) })
        case 'remap':
          return json(200, { remapped: await remap(), mapVersion: GENRE_MAP_VERSION })
        case 'status':
          return json(200, await deps.store.status())
        case 'book': {
          const bookId = typeof body.bookId === 'string' ? body.bookId : ''
          if (!/^[0-9a-f-]{36}$/i.test(bookId)) return json(400, { error: 'action_invalid' })
          const refused = await refuse(caller)
          if (refused) return refused
          if (!(await deps.store.request(bookId))) return json(404, { error: 'not_found' })
          return json(200, await once(`book:${bookId}`, async () => {
            // The request queued it (or found it queued); claiming takes it unless a run already has.
            const claimed = await deps.store.claim(1, bookId)
            return claimed.length ? await enrichAll(claimed) : { done: 0, failed: 0 }
          }))
        }
        case 'author': {
          const key = typeof body.key === 'string' ? body.key.trim() : ''
          const refused = await refuse(caller)
          if (refused) return refused
          const author = key ? await deps.store.authorByKey(key) : null
          if (!author) return json(404, { error: 'not_found' })
          if (!author.wikidata_id && !author.openlibrary_key) return json(200, { refreshed: false })
          const ref = { wikidata: author.wikidata_id, openlibrary: author.openlibrary_key, name: author.name }
          if (await deps.store.authorFresh(ref)) return json(200, { refreshed: false })
          await once(`author:${author.id}`, async () => deps.store.save(await enrichAuthor(ref, ctx)))
          return json(200, { refreshed: true })
        }
        default:
          return json(400, { error: 'action_invalid' })
      }
    } catch (error) {
      log(`enrich: ${String(action)} failed: ${error}`)
      if (error instanceof SourceUnavailable) return json(502, { error: 'source_unavailable' })
      return json(500, { error: 'enrich_failed' })
    }
  }
}
