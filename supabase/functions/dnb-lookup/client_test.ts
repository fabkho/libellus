// deno-lint-ignore-file require-await -- the stand-ins answer from memory, as the real ones do over the network
import { assert, assertEquals, assertRejects } from '@std/assert'
import { createDnb, DnbUnavailable, FAILURES_BEFORE_REST, MIN_INTERVAL_MS, REST_MS } from './client.ts'
import { fakeClock, fixture, recordedFetch } from './test_support.ts'

Deno.test('asks the recorded ISBN and says who is asking', async () => {
  const { fetch, asked } = recordedFetch()
  const records = await createDnb({ fetch, clock: fakeClock().clock }).byIsbn('9783499267017')
  assertEquals(records.length, 1)
  assertEquals(records[0]!.isbn13s, ['9783499267017'])
  assert(asked[0]!.headers.get('user-agent')?.startsWith('Libellus/1.0'))
})

Deno.test('keeps its requests MIN_INTERVAL_MS apart', async () => {
  const { fetch } = recordedFetch()
  const { clock, slept } = fakeClock()
  const dnb = createDnb({ fetch, clock })
  await Promise.all([dnb.byIsbn('9783499267017'), dnb.byIsbn('9783499267017'), dnb.byIsbn('9780000000002')])
  // The first goes at once; the others queue behind it (the fake clock moves as they sleep).
  assertEquals(slept.length, 2)
  assert(slept.every((ms) => ms >= MIN_INTERVAL_MS))
})

Deno.test('a diagnostic in a 200 answer is a failure, and a few in a row rest the source', async () => {
  const diagnostic = fixture('diagnostic')
  const { fetch, asked } = recordedFetch()
  const failing = async () => new Response(diagnostic, { status: 200 })
  const { clock, advance } = fakeClock()
  const dnb = createDnb({ fetch: (url, init) => (url.includes('9780000000002') ? failing() : fetch(url, init)), clock })
  for (let n = 0; n < FAILURES_BEFORE_REST; n++) await assertRejects(() => dnb.byIsbn('9780000000002'), DnbUnavailable)
  const before = asked.length
  await assertRejects(() => dnb.byIsbn('9783499267017'), DnbUnavailable, 'resting')
  assertEquals(asked.length, before)
  advance(REST_MS + 1)
  assertEquals((await dnb.byIsbn('9783499267017')).length, 1)
})

Deno.test('a non-2xx answer and a refused connection are failures too', async () => {
  const dnb = createDnb({ fetch: async () => new Response('busy', { status: 503 }), clock: fakeClock().clock })
  await assertRejects(() => dnb.byIsbn('9783499267017'), DnbUnavailable, '503')
  const down = createDnb({ fetch: async () => { throw new TypeError('connection refused') }, clock: fakeClock().clock })
  await assertRejects(() => down.byIsbn('9783499267017'), DnbUnavailable, 'connection refused')
})

Deno.test('a title too short to ask with is no request', async () => {
  const { fetch, asked } = recordedFetch()
  assertEquals(await createDnb({ fetch, clock: fakeClock().clock }).byTitle('X', 'A'), [])
  assertEquals(asked.length, 0)
})
