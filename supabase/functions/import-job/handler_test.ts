import { assertEquals } from '@std/assert'
import { createHandler } from './handler.ts'
import type { NotifyResult } from './push.ts'
import type { ChunkResult } from './runner.ts'

const SECRET = 'the-import-job-token'

function handler(
  run: () => Promise<ChunkResult> = () => Promise.resolve({ state: 'more', job: 'job-1', saved: 24, batches: 1 }),
  notify?: (job: string) => Promise<NotifyResult>,
) {
  const runs: number[] = []
  const handle = createHandler({
    notify,
    authorize: (token) => Promise.resolve(token === SECRET),
    run: () => {
      runs.push(1)
      return run()
    },
    log: () => {},
  })
  return { handle, runs }
}

const post = (body: unknown, token: string | null = SECRET) =>
  new Request('http://localhost/import-job', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

Deno.test('a run with the secret runs one chunk and says what it did', async () => {
  const { handle, runs } = handler()
  const response = await handle(post({ action: 'run' }))
  assertEquals(response.status, 200)
  assertEquals(await response.json(), { state: 'more', job: 'job-1', saved: 24, batches: 1 })
  assertEquals(runs.length, 1)
})

Deno.test('without the secret, nothing runs', async () => {
  const { handle, runs } = handler()
  assertEquals((await handle(post({ action: 'run' }, null))).status, 401)
  assertEquals((await handle(post({ action: 'run' }, 'a member token'))).status, 401)
  assertEquals(runs.length, 0)
})

Deno.test('only POST {"action": "run"}', async () => {
  const { handle, runs } = handler()
  assertEquals((await handle(new Request('http://localhost/import-job'))).status, 405)
  assertEquals((await handle(post({ action: 'drain' }))).status, 400)
  assertEquals((await handle(post('not json'))).status, 400)
  assertEquals(runs.length, 0)
})

Deno.test('a run the database refused answers 500 (the minute tick tries again)', async () => {
  const { handle } = handler(() => Promise.reject(new Error('import_job_claim: connection refused')))
  const response = await handle(post({ action: 'run' }))
  assertEquals(response.status, 500)
  assertEquals(await response.json(), { error: 'failed' })
})

const JOB = '0d6c5d52-67b6-4f5d-9d0e-2f3b1c9a7e11'
const SENT: NotifyResult = { state: 'claimed', sent: 1, gone: 0, refused: 0, later: 0 }

Deno.test('notify sends the job\'s push, never runs a chunk, and only for the secret', async () => {
  const told: string[] = []
  const { handle, runs } = handler(undefined, (job) => (told.push(job), Promise.resolve(SENT)))
  const response = await handle(post({ action: 'notify', job: JOB }))
  assertEquals(response.status, 200)
  assertEquals(await response.json(), SENT)
  assertEquals(told, [JOB])
  assertEquals(runs.length, 0)
  assertEquals((await handle(post({ action: 'notify', job: JOB }, 'a member token'))).status, 401)
  assertEquals(told.length, 1)
})

Deno.test('notify needs a job id, and says "off" while the function has no VAPID key (it claims nothing)', async () => {
  const { handle } = handler(undefined, () => Promise.resolve(SENT))
  assertEquals((await handle(post({ action: 'notify' }))).status, 400)
  assertEquals((await handle(post({ action: 'notify', job: 'not-a-uuid' }))).status, 400)
  const off = handler()
  const response = await off.handle(post({ action: 'notify', job: JOB }))
  assertEquals(response.status, 200)
  assertEquals(await response.json(), { state: 'off' })
})

Deno.test('a push the database could not be asked for answers 500 (the next kick tries again)', async () => {
  const { handle } = handler(undefined, () => Promise.reject(new Error('import_job_claim_push: connection refused')))
  const response = await handle(post({ action: 'notify', job: JOB }))
  assertEquals(response.status, 500)
  assertEquals(await response.json(), { error: 'failed' })
})
