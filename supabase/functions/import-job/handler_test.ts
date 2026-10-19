import { assertEquals } from '@std/assert'
import { createHandler } from './handler.ts'
import type { ChunkResult } from './runner.ts'

const SECRET = 'the-import-job-token'

function handler(run: () => Promise<ChunkResult> = () => Promise.resolve({ state: 'more', job: 'job-1', saved: 24, batches: 1 })) {
  const runs: number[] = []
  const handle = createHandler({
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
