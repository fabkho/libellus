/**
 * The `cover-store` edge function's HTTP side: `POST {"action": "run"}` stores the covers of one run (runner.ts) and
 * answers what it did. The only caller is the database (pg_net, `private.cover_store_kick`: the minute tick found a row
 * due, or a run just ended) with the Vault secret `cover_store_token`; the owner may call it by hand with the same
 * token. **The function answers only a bearer equal to `COVER_STORE_TOKEN`** (not the service-role key: nothing else has a
 * reason to start a run, and the key is a far bigger secret to put in a request).
 *
 *   200 { state: 'idle' | 'ran', claimed, stored, failed, throttled, deferred, gone, unsupported, stale, ms, kick? }
 *   401 unauthorized · 405 method_not_allowed · 400 action_invalid · 503 not_configured · 500 failed
 *
 * The `gc` action arrives with PR 6.
 */
import { sameSecret } from '../_shared/caller.ts'
import type { RunResult } from './runner.ts'

/** A secret or setting the run needs is not set: the names, never the values. */
export class NotConfigured extends Error {
  constructor(readonly missing: string[]) {
    super(`not configured: ${missing.join(', ')}`)
  }
}

export type HandlerDeps = {
  /** `COVER_STORE_TOKEN`; null = not set: nobody is let in. */
  token: string | null
  /** One run (runner.ts `runCoverStore`, wired). */
  run: () => Promise<RunResult>
  log?: (message: string) => void
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

export function createHandler(deps: HandlerDeps): (request: Request) => Promise<Response> {
  const log = deps.log ?? ((message: string) => console.error(message))
  return async (request) => {
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' })
    const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
    if (!given || !deps.token || !(await sameSecret(given, deps.token))) return json(401, { error: 'unauthorized' })
    let body: unknown = null
    try {
      body = await request.json()
    } catch {
      body = null
    }
    const { action } = (body && typeof body === 'object' ? body : {}) as { action?: unknown }
    if (action !== 'run') return json(400, { error: 'action_invalid' })
    try {
      return json(200, await deps.run())
    } catch (error) {
      if (error instanceof NotConfigured) {
        log(`cover-store: ${error.message}`)
        return json(503, { error: 'not_configured', missing: error.missing })
      }
      // The claim could not be asked (the database): the minute tick tries again.
      log(`cover-store: run failed: ${error instanceof Error ? error.message : error}`)
      return json(500, { error: 'failed' })
    }
  }
}
