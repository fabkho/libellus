import { assertEquals } from '@std/assert'
import { createHandler } from './handler.ts'

const request = (headers: Record<string, string> = {}, method = 'POST') => new Request('http://local/buddy-voice-sweep', { method, headers })
const ran = { removed: 3, rounds: 1 }
const post = (body: unknown, token = 'secret') =>
  new Request('http://local/buddy-voice-sweep', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: typeof body === 'string' ? body : JSON.stringify(body) })

Deno.test('only a POST with the token is let in', async () => {
  const handler = createHandler({ token: 'secret', run: () => Promise.resolve(ran) })
  assertEquals((await handler(request({}, 'GET'))).status, 405)
  assertEquals((await handler(request())).status, 401)
  assertEquals((await handler(request({ authorization: 'Bearer nope' }))).status, 401)
  const ok = await handler(request({ authorization: 'Bearer secret' }))
  assertEquals(ok.status, 200)
  assertEquals(await ok.json(), { state: 'ran', removed: 3, rounds: 1 })
})

Deno.test('a sweep with nothing to do says idle', async () => {
  const handler = createHandler({ token: 'secret', run: () => Promise.resolve({ removed: 0, rounds: 0 }) })
  const answer = await handler(request({ authorization: 'bearer secret' }))
  assertEquals(await answer.json(), { state: 'idle', removed: 0, rounds: 0 })
})

Deno.test('without a token set nobody is let in and the answer names what is missing', async () => {
  const handler = createHandler({ token: null, run: () => Promise.resolve(ran) })
  const answer = await handler(request({ authorization: 'Bearer anything' }))
  assertEquals(answer.status, 503)
  assertEquals(await answer.json(), { error: 'not_configured', missing: ['BUDDY_VOICE_SWEEP_TOKEN'] })
})

Deno.test('a failed run is a 500 that says nothing of why', async () => {
  const logged: string[] = []
  const handler = createHandler({
    token: 'secret',
    run: () => Promise.reject(new Error('storage: down')),
    log: (message) => logged.push(message),
  })
  const answer = await handler(request({ authorization: 'Bearer secret' }))
  assertEquals(answer.status, 500)
  assertEquals(await answer.json(), { error: 'failed' })
  assertEquals(logged, ['buddy-voice-sweep failed: storage: down'])
})

Deno.test('a run is a full one (it looks for uploads nobody sent) unless the database says full: false', async () => {
  const seen: boolean[] = []
  const handler = createHandler({ token: 'secret', run: ({ full }) => (seen.push(full), Promise.resolve(ran)) })
  await handler(post({ full: true }))
  await handler(post({ full: false }))
  await handler(post({}))
  await handler(post('not json'))
  await handler(request({ authorization: 'Bearer secret' }))
  assertEquals(seen, [true, false, true, true, true])
})
