/**
 * The `openlibrary` client against stand-in answers: identified (the User-Agent carries the
 * contact), paced at three requests a second per instance, a `Retry-After` held, a deadline and
 * an answer size cap. Nothing here reaches the network: the answers are fixtures/ recordings or
 * stubs.
 */
import { assert, assertEquals, assertRejects } from '@std/assert'
import { createOpenLibrary, MAX_RETRY_AFTER_MS, MIN_INTERVAL_MS, OpenLibraryUnavailable, userAgent } from './client.ts'
import { fakeClock, recordedFetch } from './test_support.ts'

const AGENT = userAgent('contact@example.com')

function setup(extra: Record<string, () => Response | Promise<Response>> = {}, options: { maxBodyBytes?: number } = {}) {
  const recorded = recordedFetch(extra)
  const { clock, slept } = fakeClock()
  const openlibrary = createOpenLibrary({ fetch: recorded.fetch, clock, userAgent: AGENT, maxBodyBytes: options.maxBodyBytes })
  return { openlibrary, recorded, slept }
}

const SEARCH = 'https://openlibrary.org/search.json?q=moby+dick+melville&fields=key,title,author_name,cover_i&limit=1'

Deno.test('the answer is passed on as it came, and the request is identified', async () => {
  const { openlibrary, recorded } = setup()
  const answer = await openlibrary.ask('/search.json', 'q=moby+dick+melville&fields=key,title,author_name,cover_i&limit=1')
  assertEquals(answer.status, 200)
  assertEquals(JSON.parse(answer.body).docs[0].title, 'Moby Dick')
  assertEquals(answer.contentType, 'application/json; charset=utf-8')
  assertEquals(answer.retryAfter, null)
  assertEquals(recorded.asked.length, 1)
  assertEquals(recorded.asked[0]!.url, SEARCH)
  assertEquals(recorded.asked[0]!.headers.get('user-agent'), 'Libellus/1.0 (contact@example.com)')
  assertEquals(recorded.asked[0]!.headers.get('accept'), 'application/json')
})

Deno.test('requests queue three a second apart', async () => {
  const { openlibrary, slept } = setup()
  await Promise.all([
    openlibrary.ask('/search.json', 'limit=1'),
    openlibrary.ask('/search.json', 'limit=2'),
    openlibrary.ask('/search.json', 'limit=3'),
    openlibrary.ask('/search.json', 'limit=4'),
  ]).catch(() => {})
  // The recorded answers only know one URL: what matters here is the spacing of the attempts.
  assert(slept.length >= 3)
  for (const ms of slept.slice(0, 3)) assertEquals(ms, MIN_INTERVAL_MS)
})

Deno.test('a refusal asks for a pause, and the pause is kept (capped)', async () => {
  const refused = () => new Response('slow down', { status: 429, headers: { 'retry-after': '120', 'content-type': 'text/plain' } })
  const { openlibrary, slept } = setup({ [SEARCH]: refused })
  const answer = await openlibrary.ask('/search.json', 'q=moby+dick+melville&fields=key,title,author_name,cover_i&limit=1')
  assertEquals(answer.status, 429)
  assertEquals(answer.retryAfter, '120')
  assertEquals(answer.body, 'slow down')
  await openlibrary.ask('/search.json', 'limit=1').catch(() => {})
  // 120 s asked, 30 s taken: the queue waits the capped pause, not the plain interval.
  assertEquals(slept.at(-1), MAX_RETRY_AFTER_MS)
})

Deno.test('a network error is unreachable, a timeout is a timeout', async () => {
  const failing = (error: Error) => {
    const { openlibrary } = setup({ [SEARCH]: () => Promise.reject(error) })
    return openlibrary
  }
  const unreachable = await assertRejects(
    () => failing(new Error('fetch failed')).ask('/search.json', 'q=moby+dick+melville&fields=key,title,author_name,cover_i&limit=1'),
    OpenLibraryUnavailable,
    'fetch failed',
  )
  assertEquals(unreachable.kind, 'unreachable')
  const timeoutError = new Error('timed out')
  timeoutError.name = 'TimeoutError'
  const timedOut = await assertRejects(() => failing(timeoutError).ask('/search.json', 'q=moby+dick+melville&fields=key,title,author_name,cover_i&limit=1'), OpenLibraryUnavailable)
  assertEquals(timedOut.kind, 'timeout')
})

Deno.test('an answer over the size cap is not passed on', async () => {
  const { openlibrary } = setup({ [SEARCH]: () => new Response('x'.repeat(100), { status: 200 }) }, { maxBodyBytes: 10 })
  await assertRejects(
    () => openlibrary.ask('/search.json', 'q=moby+dick+melville&fields=key,title,author_name,cover_i&limit=1'),
    OpenLibraryUnavailable,
    'body_too_large',
  )
})
