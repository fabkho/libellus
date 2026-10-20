/**
 * The `import-job` edge function's HTTP side: `POST {"action": "run"}` runs one chunk of the import job that holds the
 * queue's slot (runner.ts) and answers what it did. Callers: the database (pg_net, `private.import_job_kick`: a chunk
 * just ended, a job started, or pg_cron's minute tick found one due) with the Vault secret `import_job_token`, or the
 * owner with the service-role key (a run by hand). Members never call it: they start a job with `start_import_job`.
 *
 * `POST {"action": "notify", "job": "<uuid>"}` sends the job's Web Push ("Import done", push.ts): the database kicks it when a
 * job turns done or failed (`private.import_push_kick`), the same caller, the same secret.
 *
 *   200 { state: 'idle' | 'done' | 'more' | 'paused' | 'gone', job?, saved, batches }
 *   200 { state: 'claimed' | 'taken', sent, gone, refused, later }   (notify)  ·  200 { state: 'off' } (no VAPID key set)
 *   401 unauthorized · 405 method_not_allowed · 400 action_invalid · 500 failed
 */
import type { NotifyResult } from './push.ts'
import type { ChunkResult } from './runner.ts'

export type HandlerDeps = {
  /** Whether the bearer token is the function's own secret or the service-role key. */
  authorize: (token: string) => Promise<boolean>
  /** One chunk (runner.ts `runChunk`, wired). */
  run: () => Promise<ChunkResult>
  /** Sends one job's push (push.ts `createNotify`, wired); absent while the function has no VAPID key: the job's push stays unclaimed. */
  notify?: (job: string) => Promise<NotifyResult>
  log?: (message: string) => void
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export function createHandler(deps: HandlerDeps): (request: Request) => Promise<Response> {
  const log = deps.log ?? ((message: string) => console.error(message))
  return async (request) => {
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' })
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
    if (!token || !(await deps.authorize(token))) return json(401, { error: 'unauthorized' })
    let body: unknown = null
    try {
      body = await request.json()
    } catch {
      body = null
    }
    const { action, job } = (body && typeof body === 'object' ? body : {}) as { action?: unknown; job?: unknown }
    if (action === 'notify') {
      if (typeof job !== 'string' || !UUID.test(job)) return json(400, { error: 'job_invalid' })
      if (!deps.notify) return json(200, { state: 'off' })
      try {
        return json(200, await deps.notify(job))
      } catch (error) {
        // The database could not be asked (the claim is given back): the next kick tries again.
        log(`import-job: notify failed: ${error instanceof Error ? error.message : error}`)
        return json(500, { error: 'failed' })
      }
    }
    if (action !== 'run') return json(400, { error: 'action_invalid' })
    try {
      return json(200, await deps.run())
    } catch (error) {
      // The claim or the release could not be asked (the database): the minute tick tries again.
      log(`import-job: run failed: ${error instanceof Error ? error.message : error}`)
      return json(500, { error: 'failed' })
    }
  }
}
