/**
 * `catalogue-check`: the request/response side (social v2a contract §5). Everything it talks to
 * comes in from outside (index.ts wires the real ones), so the tests drive it with stand-ins.
 *
 *   POST /functions/v1/catalogue-check
 *   { "action": "drain", "limit"?: n }   service: check up to `limit` (8, at most 20) unchecked Books
 *   { "action": "status" }               service: the check at a glance
 *
 *   200 { checked, missed, failed, released } · 400 action_invalid · 401 unauthorized
 *   405 method_not_allowed · 500 check_failed
 *
 * Callers: the service-role key or the shared secret CATALOGUE_CHECK_TOKEN (pg_cron's call through
 * pg_net). There is no member caller: the function reads its work from the database queue and takes
 * nothing from the request but the action and a number.
 */
import { type CheckBook, lookupApple, lookupOpenLibrary, type Outcome } from './check.ts'
import type { Http } from '../enrich/http.ts'
import type { Store } from './store.ts'

export const CORS: HeadersInit = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

export const DEFAULT_BATCH = 8
export const MAX_BATCH = 20
/** The hosted limit is 150 s of wall clock; the sources are slow on purpose (one request a second). */
export const BUDGET_MS = 50_000

export type HandlerDeps = {
  store: Store
  http: Http
  authorize: (request: Request) => Promise<boolean>
  now?: () => number
  budgetMs?: number
  log?: (message: string) => void
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } })
}

export type Tally = { checked: number; missed: number; failed: number; released: number }

export function createHandler(deps: HandlerDeps): (request: Request) => Promise<Response> {
  const now = deps.now ?? (() => Date.now())
  const log = deps.log ?? ((message) => console.error(message))

  /** Checks the claimed Books one by one; each one's failure is its own. */
  async function checkAll(books: CheckBook[], deadline: number): Promise<Tally> {
    const tally: Tally = { checked: 0, missed: 0, failed: 0, released: 0 }
    let apple = new Map<string, Outcome>()
    const appleBooks = books.filter((book) => book.apple_id)
    if (appleBooks.length) {
      try {
        apple = await lookupApple(deps.http, appleBooks.map((book) => book.apple_id!))
      } catch (error) {
        log(`catalogue-check: Apple lookup failed: ${error}`)
      }
    }
    for (const book of books) {
      try {
        if (now() >= deadline && !(book.apple_id && apple.has(book.apple_id))) {
          await deps.store.release(book.id)
          tally.released++
          continue
        }
        const outcome: Outcome = book.apple_id
          ? apple.get(book.apple_id) ?? { status: 'unavailable', error: 'apple_lookup_failed' }
          : await lookupOpenLibrary(deps.http, book)
        if (outcome.status === 'found') {
          await deps.store.save(book.id, outcome.result)
          tally.checked++
        } else if (outcome.status === 'unknown') {
          await deps.store.miss(book.id)
          tally.missed++
        } else {
          await deps.store.failed(book.id, outcome.error)
          tally.failed++
        }
      } catch (error) {
        tally.failed++
        log(`catalogue-check: ${book.id} failed: ${error}`)
        await deps.store.failed(book.id, String(error instanceof Error ? error.message : error)).catch(() => {})
      }
    }
    return tally
  }

  return async (request) => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS })
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' })
    if (!(await deps.authorize(request))) return json(401, { error: 'unauthorized' })
    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return json(400, { error: 'action_invalid' })
    }
    try {
      switch (body?.action) {
        case 'drain': {
          const asked = typeof body.limit === 'number' && body.limit > 0 ? Math.floor(body.limit) : DEFAULT_BATCH
          const books = await deps.store.claim(Math.min(asked, MAX_BATCH))
          return json(200, await checkAll(books, now() + (deps.budgetMs ?? BUDGET_MS)))
        }
        case 'status':
          return json(200, await deps.store.status())
        default:
          return json(400, { error: 'action_invalid' })
      }
    } catch (error) {
      log(`catalogue-check: ${String(body?.action)} failed: ${error}`)
      return json(500, { error: 'check_failed' })
    }
  }
}
