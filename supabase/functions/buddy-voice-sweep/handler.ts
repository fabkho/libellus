/**
 * The `buddy-voice-sweep` edge function's HTTP side: `POST` removes the objects of deleted voice messages (sweep.ts) and answers what
 * it did. The only caller is the database (pg_net, `private.buddy_voice_kick`: a deletion queued an object, or the pg_cron jobs
 * `sweep-buddy-voice` (hourly) and `sweep-buddy-voice-queue` (every ten minutes)) with the Vault secret `buddy_voice_sweep_token`. **The function answers only a bearer equal to
 * `BUDDY_VOICE_SWEEP_TOKEN`** (not the service-role key: nothing else has a reason to start a sweep).
 *
 * The body `{"full": true}` (the hourly job) also makes the run look for objects no message points at (an upload nobody sent); a kick for a
 * deletion sends `{"full": false}` and only empties the queue, which is cheap. No body is a full run.
 *
 *   200 { state: 'idle' | 'ran', removed, rounds }
 *   401 unauthorized · 405 method_not_allowed · 503 not_configured · 500 failed
 */
import { sameSecret } from '../_shared/caller.ts'
import type { SweepResult } from './sweep.ts'

export type HandlerDeps = {
  /** `BUDDY_VOICE_SWEEP_TOKEN`; null = not set: nobody is let in. */
  token: string | null
  /** One sweep (sweep.ts `sweep`, wired); `full`: look for uploads nobody sent too. */
  run: (options: { full: boolean }) => Promise<SweepResult>
  log?: (message: string) => void
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

export function createHandler(deps: HandlerDeps): (request: Request) => Promise<Response> {
  const log = deps.log ?? ((message: string) => console.error(message))
  return async (request) => {
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' })
    if (!deps.token) return json(503, { error: 'not_configured', missing: ['BUDDY_VOICE_SWEEP_TOKEN'] })
    const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
    if (!given || !(await sameSecret(given, deps.token))) return json(401, { error: 'unauthorized' })
    // `full` unless the database said it does not need it.
    let full = true
    try {
      const body = (await request.json()) as { full?: unknown } | null
      if (body && body.full === false) full = false
    } catch {
      full = true
    }
    try {
      const result = await deps.run({ full })
      return json(200, { state: result.rounds === 0 ? 'idle' : 'ran', ...result })
    } catch (error) {
      // Nothing is lost: what was not removed is named again by the next run.
      const message = error instanceof Error ? error.message : String(error)
      log(`buddy-voice-sweep failed: ${message}`)
      return json(500, { error: 'failed' })
    }
  }
}
