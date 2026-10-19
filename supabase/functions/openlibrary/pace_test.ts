/**
 * The shared pace (../_shared/pace.ts) against a stand-in for `edge_pace_take` / `edge_pace_hold`: it books turns
 * like the database does (one row, `gap` apart, refused beyond the caller's patience), so several "instances" asking
 * at once keep to the one rate. Nothing waits for real: the clock only moves when something sleeps.
 */
import { assert, assertEquals, assertRejects } from '@std/assert'
import { localPace, PaceBusy, type Rpc, sharedPace } from '../_shared/pace.ts'
import { createOpenLibrary, MIN_INTERVAL_MS, PACE_MAX_WAIT_MS } from './client.ts'
import { fakeClock, recordedFetch } from './test_support.ts'

/** What `edge_pace_take` does in Postgres, on the fake clock. */
function database(now: () => number) {
  const next = new Map<string, number>()
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const rpc: Rpc = (name, args) => {
    calls.push({ name, args })
    const bucket = String(args.p_bucket)
    if (name === 'edge_pace_hold') {
      next.set(bucket, Math.max(next.get(bucket) ?? 0, now() + Number(args.p_ms)))
      return Promise.resolve({ data: null, error: null })
    }
    const slot = Math.max(next.get(bucket) ?? 0, now())
    const wait = slot - now()
    if (wait > Number(args.p_max_wait_ms)) return Promise.resolve({ data: [{ granted: false, wait_ms: wait - Number(args.p_max_wait_ms) }], error: null })
    next.set(bucket, slot + Number(args.p_gap_ms))
    return Promise.resolve({ data: [{ granted: true, wait_ms: wait }], error: null })
  }
  return { rpc, calls }
}

Deno.test('instances share one pace: the requests go out a gap apart, however many instances ask', async () => {
  const { clock, now } = fakeClock()
  const db = database(now)
  const instance = () => sharedPace({ rpc: db.rpc, bucket: 'openlibrary', gapMs: 340, maxWaitMs: 4000, clock })
  const [a, b, c] = [instance(), instance(), instance()]
  const wentOut: number[] = []
  const t0 = now()
  // Three instances, each asked twice, one after the other as the requests of a lookup come in.
  for (const pace of [a, b, c, a, b, c]) {
    await pace.take()
    wentOut.push(now() - t0)
  }
  assertEquals(wentOut, [0, 340, 680, 1020, 1360, 1700])
  assertEquals(db.calls.map((call) => call.args.p_gap_ms), Array(6).fill(340))
  assertEquals(db.calls.every((call) => call.args.p_bucket === 'openlibrary'), true)
})

Deno.test('a turn is slept for, and the first is now', async () => {
  const { clock, slept, now } = fakeClock()
  const db = database(now)
  const pace = sharedPace({ rpc: db.rpc, bucket: 'openlibrary', gapMs: 340, maxWaitMs: 4000, clock })
  await pace.take()
  assertEquals(slept, [])
  await pace.take()
  assertEquals(slept, [340])
})

Deno.test('a turn too far away is busy, with the seconds to come back after', async () => {
  const { clock, now } = fakeClock()
  const db = database(now)
  const pace = sharedPace({ rpc: db.rpc, bucket: 'openlibrary', gapMs: 1000, maxWaitMs: 500, clock })
  await pace.take()
  // The next turn is 1 s away, patience is 0.5 s: come back in 0.5 s, which is told as one whole second.
  const busy = await assertRejects(() => pace.take(), PaceBusy)
  assertEquals(busy.retryAfterSeconds, 1)
})

Deno.test("an upstream's Retry-After is the pace of every instance", async () => {
  const { clock, slept, now } = fakeClock()
  const db = database(now)
  const a = sharedPace({ rpc: db.rpc, bucket: 'openlibrary', gapMs: 340, maxWaitMs: 40_000, clock })
  const b = sharedPace({ rpc: db.rpc, bucket: 'openlibrary', gapMs: 340, maxWaitMs: 40_000, clock })
  await a.hold(8000)
  await b.take()
  assertEquals(slept, [8000])
  assertEquals(db.calls.some((call) => call.name === 'edge_pace_hold' && call.args.p_ms === 8000), true)
})

Deno.test("the database out of reach: this instance's own pace, and one line in the log", async () => {
  const { clock, slept } = fakeClock()
  const logged: string[] = []
  const rpc: Rpc = () => Promise.resolve({ data: null, error: { message: 'connection refused' } })
  const pace = sharedPace({ rpc, bucket: 'openlibrary', gapMs: 340, maxWaitMs: 4000, clock, log: (m) => logged.push(m) })
  await pace.take()
  await pace.take()
  await pace.take()
  assertEquals(slept, [340, 340])
  assertEquals(logged.length, 3)
  assert(logged[0]!.includes('connection refused'))
  // A hold that cannot be shared still holds this instance.
  await pace.hold(5000)
  await pace.take()
  assertEquals(slept.at(-1), 5000)
})

Deno.test('a rejected call and a strange answer are the same: the own pace', async () => {
  const { clock, slept } = fakeClock()
  const logged: string[] = []
  const throwing: Rpc = () => Promise.reject(new Error('fetch failed'))
  const strange: Rpc = () => Promise.resolve({ data: [{ nope: true }], error: null })
  for (const rpc of [throwing, strange]) {
    const pace = sharedPace({ rpc, bucket: 'dnb', gapMs: 200, maxWaitMs: 3000, clock, log: (m) => logged.push(m) })
    await pace.take()
    await pace.take()
  }
  assertEquals(slept, [200, 200])
  assertEquals(logged.length, 4)
})

Deno.test('the local pace keeps a gap and holds for a pause', async () => {
  const { clock, slept } = fakeClock()
  const pace = localPace({ gapMs: 340, clock })
  await pace.take()
  await pace.take()
  await pace.hold(3000)
  await pace.take()
  assertEquals(slept, [340, 3000])
})

Deno.test('Open Library is asked through the shared pace, and a refusal holds it for everyone', async () => {
  const { clock, now } = fakeClock()
  const db = database(now)
  const pace = sharedPace({ rpc: db.rpc, bucket: 'openlibrary', gapMs: MIN_INTERVAL_MS, maxWaitMs: PACE_MAX_WAIT_MS, clock })
  const search = 'https://openlibrary.org/search.json?q=moby+dick+melville&fields=key,title,author_name,cover_i&limit=1'
  const refused = () => new Response('slow down', { status: 429, headers: { 'retry-after': '7' } })
  const { fetch } = recordedFetch({ [search]: refused })
  const openlibrary = createOpenLibrary({ fetch, clock, userAgent: 'agent', pace })
  const answer = await openlibrary.ask('/search.json', 'q=moby+dick+melville&fields=key,title,author_name,cover_i&limit=1')
  assertEquals(answer.status, 429)
  assertEquals(db.calls.map((call) => call.name), ['edge_pace_take', 'edge_pace_hold'])
  assertEquals(db.calls[1]!.args.p_ms, 7000)
})

Deno.test("the longest wait plus Open Library's timeout fits under the import's call deadline", () => {
  // 4 s for the turn + 10 s for Open Library (client.ts REQUEST_TIMEOUT_MS) < the import's 15 s call deadline.
  assert(PACE_MAX_WAIT_MS + 10_000 < 15_000)
})
