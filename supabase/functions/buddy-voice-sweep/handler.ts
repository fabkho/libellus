/**
 * The `buddy-voice-sweep` edge function's HTTP side: `POST` removes the objects of deleted voice messages (sweep.ts) and answers what
 * it did. The only caller is the database (pg_net, `private.buddy_voice_kick`: a deletion queued an object, or the hourly pg_cron job
 * `sweep-buddy-voice`) with the Vault secret `buddy_voice_sweep_token`. **The function answers only a bearer equal to
 * `BUDDY_VOICE_SWEEP_TOKEN`** (not the service-role key: nothing else has a reason to start a sweep).
 *
 *   200 { state: 'idle' | 'ran', removed, rounds }
 *   401 unauthorized · 405 method_not_allowed · 503 not_configured · 500 failed
 */
import { sameSecret } from '../_shared/caller.ts'
import type { SweepResult } from './sweep.ts'

export type HandlerDeps = {
  /** `BUDDY_VOICE_SWEEP_TOKEN`; null = not set: nobody is let in. */
  token: string | null
  /** One sweep (sweep.ts `sweep`, wired). */
  run: () => Promise<SweepResult>
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
    try {
      const result = await deps.run()
      return json(200, { state: result.rounds === 0 ? 'idle' : 'ran', ...result })
    } catch (error) {
      // Nothing is lost: what was not removed is named again by the next run.
      const message = error instanceof Error ? error.message : String(error)
      log(`buddy-voice-sweep failed: ${message}`)
      return json(500, { error: 'failed' })
    }
  }
}
