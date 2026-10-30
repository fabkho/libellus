import { assertEquals } from '@std/assert'
import { createHandler, NotConfigured } from './handler.ts'
import type { RunResult } from './runner.ts'

const TOKEN = 'a-cover-store-token-for-tests'
const RESULT: RunResult = { state: 'ran', claimed: 2, stored: 2, failed: 0, throttled: 0, deferred: 0, gone: 0, unsupported: 0, stale: 0, ms: 12 }

function world(token: string | null = TOKEN, run: () => Promise<RunResult> = () => Promise.resolve(RESULT)) {
  const calls = { run: 0 }
  const logged: string[] = []
  const handle = createHandler({ token, run: () => (calls.run++, run()), log: (message) => logged.push(message) })
  const post = (headers: Record<string, string>, body: unknown = { action: 'run' }, method = 'POST') =>
    handle(new Request('https://x.test/functions/v1/cover-store', { method, headers: { 'content-type': 'application/json', ...headers }, body: method === 'GET' ? undefined : JSON.stringify(body) }))
  return { post, calls, logged }
}

Deno.test('the token: only a bearer equal to COVER_STORE_TOKEN runs anything', async () => {
  const { post, calls } = world()
  const ok = await post({ authorization: `Bearer ${TOKEN}` })
  assertEquals([ok.status, await ok.json()], [200, RESULT])
  assertEquals(calls.run, 1)
  for (const headers of [{} as Record<string, string>, { authorization: 'Bearer ' }, { authorization: 'Bearer nope' }, { authorization: `Bearer ${TOKEN}x` }, { authorization: TOKEN.slice(1) },
    { apikey: TOKEN }, { 'x-token': TOKEN }]) {
    const refused = await post(headers)
    assertEquals([refused.status, await refused.json()], [401, { error: 'unauthorized' }], JSON.stringify(headers))
  }
  assertEquals(calls.run, 1)
})

Deno.test('no COVER_STORE_TOKEN set: nobody is let in, not even with an empty bearer', async () => {
  const { post, calls } = world(null)
  for (const authorization of ['Bearer ', 'Bearer undefined', 'Bearer null', `Bearer ${TOKEN}`]) assertEquals((await post({ authorization })).status, 401)
  assertEquals(calls.run, 0)
})

Deno.test('methods and actions: POST only; run only (gc comes with its own PR); a bad body is action_invalid', async () => {
  const { post, calls } = world()
  const auth = { authorization: `Bearer ${TOKEN}` }
  assertEquals((await post(auth, null, 'GET')).status, 405)
  assertEquals((await post(auth, null, 'DELETE')).status, 405)
  for (const body of [{}, { action: 'gc' }, { action: 'RUN' }, { action: ['run'] }, null, 'run']) {
    const refused = await post(auth, body)
    assertEquals([refused.status, await refused.json()], [400, { error: 'action_invalid' }], JSON.stringify(body))
  }
  const text = await createHandler({ token: TOKEN, run: () => Promise.reject(new Error('no')) })(new Request('https://x.test', { method: 'POST', headers: auth, body: 'not json' }))
  assertEquals(text.status, 400)
  assertEquals(calls.run, 0)
})

Deno.test('a run that cannot start: 503 with the names of what is not set, or 500 with no detail', async () => {
  const unset = world(TOKEN, () => Promise.reject(new NotConfigured(['COVER_KEY_SECRET', 'R2_COVERS_ACCOUNT_ID'])))
  const answer = await unset.post({ authorization: `Bearer ${TOKEN}` })
  assertEquals([answer.status, await answer.json()], [503, { error: 'not_configured', missing: ['COVER_KEY_SECRET', 'R2_COVERS_ACCOUNT_ID'] }])

  const broken = world(TOKEN, () => Promise.reject(new Error('cover_store_claim: connection to db.example refused')))
  const failed = await broken.post({ authorization: `Bearer ${TOKEN}` })
  assertEquals([failed.status, await failed.json()], [500, { error: 'failed' }])
  assertEquals(broken.logged, ['cover-store: run failed: cover_store_claim: connection to db.example refused'])
})
