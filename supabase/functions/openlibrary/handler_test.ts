// deno-lint-ignore-file require-await -- the stand-ins answer from memory, as the real ones do over the network
import { assertEquals } from '@std/assert'
import { PaceBusy } from '../_shared/pace.ts'
import { createOpenLibrary, userAgent } from './client.ts'
import { type Caller, createHandler, MAX_QUERY_BYTES } from './handler.ts'
import { fakeClock, recordedFetch } from './test_support.ts'

const MEMBER = '11111111-1111-4111-8111-111111111111'
const AGENT = userAgent('contact@example.com')
const SEARCH = 'https://openlibrary.org/search.json?q=moby+dick+melville&fields=key,title,author_name,cover_i&limit=1'

const ok = () => new Response('{"docs":[]}', { status: 200, headers: { 'content-type': 'application/json' } })

function setup(options: { upstream?: Record<string, () => Response | Promise<Response>>; throttle?: (member: string) => Promise<boolean>; caller?: Caller | null } = {}) {
  const recorded = recordedFetch(options.upstream ?? {})
  const logged: string[] = []
  const handler = createHandler({
    openlibrary: createOpenLibrary({ fetch: recorded.fetch, clock: fakeClock().clock, userAgent: AGENT }),
    authorize: async (request) => {
      if ('caller' in options) return options.caller ?? null
      const token = request.headers.get('authorization')
      return token === 'Bearer member' ? { member: MEMBER } : token === 'Bearer service' ? { member: null } : null
    },
    throttle: options.throttle,
    log: (message) => logged.push(message),
  })
  const call = (query: string, headers: Record<string, string> = { authorization: 'Bearer member' }) =>
    handler(new Request(`https://x.test/functions/v1/openlibrary?${query}`, { method: 'GET', headers }))
  return { handler, call, logged, recorded }
}

Deno.test("an allowed path: Open Library's answer as it is, with the params it was asked", async () => {
  const { call, recorded } = setup()
  const response = await call('path=%2Fsearch.json&q=moby+dick+melville&fields=key,title,author_name,cover_i&limit=1')
  assertEquals(response.status, 200)
  assertEquals((await response.json()).docs[0].title, 'Moby Dick')
  assertEquals(response.headers.get('cache-control'), 'private')
  assertEquals(response.headers.get('content-type'), 'application/json; charset=utf-8')
  // `path` is ours, never sent on; the query is Open Library's, and the request is identified.
  const asked = new URL(recorded.asked[0]!.url)
  assertEquals(asked.origin + asked.pathname, 'https://openlibrary.org/search.json')
  assertEquals(asked.searchParams.get('q'), 'moby dick melville')
  assertEquals(asked.searchParams.get('fields'), 'key,title,author_name,cover_i')
  assertEquals(asked.searchParams.get('limit'), '1')
  assertEquals(asked.searchParams.has('path'), false)
  assertEquals(recorded.asked[0]!.headers.get('user-agent'), AGENT)
})

Deno.test("a member's token is all that gets in; the service role too, and it is not throttled", async () => {
  const throttled: string[] = []
  const { call } = setup({
    upstream: { 'https://openlibrary.org/search.json?limit=1': ok },
    throttle: async (member) => {
      throttled.push(member)
      return true
    },
  })
  assertEquals((await call('path=%2Fsearch.json&limit=1', {})).status, 401)
  assertEquals((await call('path=%2Fsearch.json&limit=1', { authorization: 'Bearer anon' })).status, 401)
  assertEquals((await call('path=%2Fsearch.json&limit=1', { authorization: 'Bearer service' })).status, 200)
  assertEquals(throttled, [])
  assertEquals((await call('path=%2Fsearch.json&limit=1', { authorization: 'Bearer member' })).status, 200)
  assertEquals(throttled, [MEMBER])
})

Deno.test('over the per-member budget: 429 with a Retry-After, and nothing asked', async () => {
  const { call, recorded } = setup({ throttle: async () => false })
  const response = await call('path=%2Fsearch.json&limit=1')
  assertEquals(response.status, 429)
  assertEquals(await response.json(), { error: 'rate_limited' })
  assertEquals(response.headers.get('retry-after'), '60')
  assertEquals(recorded.asked.length, 0)
})

Deno.test("only the import's Open Library paths go out; the host is never the caller's", async () => {
  const { call, recorded } = setup()
  for (const path of ['/authors/OL29497A.json', '/search/inside.json', '/works/OL102749W.json', '//evil.example/x', '/search.json/../books/OL3704476M.json']) {
    const response = await call(`path=${encodeURIComponent(path)}&limit=1`)
    assertEquals(response.status, 400, path)
    assertEquals((await response.json()).error, 'path_not_allowed')
  }
  const withoutPath = await call('q=moby')
  assertEquals(withoutPath.status, 400)
  assertEquals((await withoutPath.json()).error, 'path_missing')
  const tooLong = await call(`path=%2Fsearch.json&q=${'x'.repeat(MAX_QUERY_BYTES)}`)
  assertEquals(tooLong.status, 400)
  assertEquals((await tooLong.json()).error, 'query_too_large')
  assertEquals(recorded.asked.length, 0)
})

Deno.test('every path the import asks is allowed', async () => {
  const paths = ['/isbn/9780142437247.json', '/isbn/0142437247.json', '/works/OL102749W/editions.json', '/books/OL3704476M.json', '/api/books']
  const { call, recorded } = setup({ upstream: Object.fromEntries(paths.map((path) => [`https://openlibrary.org${path}?limit=1`, ok])) })
  for (const path of paths) {
    const response = await call(`path=${encodeURIComponent(path)}&limit=1`)
    assertEquals(response.status, 200, path)
  }
  assertEquals(recorded.asked.length, 5)
})

Deno.test("a refusal is passed through with its Retry-After and left in the owner's log", async () => {
  const { call, logged } = setup({
    upstream: {
      [SEARCH]: () => new Response('{"error": "429 Too Many Requests"}', { status: 429, headers: { 'retry-after': '30' } }),
    },
  })
  const response = await call('path=%2Fsearch.json&q=moby+dick+melville&fields=key,title,author_name,cover_i&limit=1')
  assertEquals(response.status, 429)
  assertEquals(response.headers.get('retry-after'), '30')
  assertEquals(await response.text(), '{"error": "429 Too Many Requests"}')
  assertEquals(logged, ['openlibrary_refused {"status":429,"path":"/search.json"}'])
})

Deno.test('upstream failures are what the caller reads: 502 when it is unreachable, 504 when it is slow', async () => {
  const failing = (error: Error) => setup({ upstream: { [SEARCH]: () => Promise.reject(error) } })
  const unreachable = await failing(new Error('fetch failed')).call('path=%2Fsearch.json&q=moby+dick+melville&fields=key,title,author_name,cover_i&limit=1')
  assertEquals(unreachable.status, 502)
  assertEquals(await unreachable.json(), { error: 'openlibrary_unavailable' })
  const timeoutError = new Error('timed out')
  timeoutError.name = 'TimeoutError'
  const timedOut = await failing(timeoutError).call('path=%2Fsearch.json&q=moby+dick+melville&fields=key,title,author_name,cover_i&limit=1')
  assertEquals(timedOut.status, 504)
  assertEquals(await timedOut.json(), { error: 'openlibrary_timeout' })
})

Deno.test('a 404 of Open Library is its answer, not a failure', async () => {
  const { call } = setup({
    upstream: {
      'https://openlibrary.org/isbn/0000000000.json?limit=1': () => new Response('{"error": "notfound"}', { status: 404 }),
    },
  })
  const response = await call('path=%2Fisbn%2F0000000000.json&limit=1')
  assertEquals(response.status, 404)
  assertEquals(await response.text(), '{"error": "notfound"}')
})

Deno.test('GET only, and the preflight the browser sends', async () => {
  const { handler } = setup({ upstream: { 'https://openlibrary.org/search.json?limit=1': ok } })
  const post = await handler(new Request('https://x.test/functions/v1/openlibrary?path=%2Fsearch.json&limit=1', { method: 'POST' }))
  assertEquals(post.status, 405)
  const preflight = await handler(new Request('https://x.test/functions/v1/openlibrary?path=%2Fsearch.json&limit=1', { method: 'OPTIONS' }))
  assertEquals(preflight.status, 204)
  assertEquals(preflight.headers.get('access-control-allow-origin'), '*')
  assertEquals(preflight.headers.get('access-control-allow-methods'), 'GET, OPTIONS')
})

Deno.test('a turn too far away is 503 busy with a Retry-After the client waits out, and nothing is asked', async () => {
  const recorded = recordedFetch()
  const handler = createHandler({
    openlibrary: createOpenLibrary({
      fetch: recorded.fetch,
      clock: fakeClock().clock,
      userAgent: AGENT,
      pace: { take: () => Promise.reject(new PaceBusy(3)), hold: () => Promise.resolve() },
    }),
    authorize: async () => ({ member: MEMBER }),
  })
  const response = await handler(new Request('https://x.test/functions/v1/openlibrary?path=%2Fsearch.json&q=moby', { method: 'GET', headers: { authorization: 'Bearer member' } }))
  assertEquals(response.status, 503)
  assertEquals(response.headers.get('retry-after'), '3')
  assertEquals(await response.json(), { error: 'busy', retry_after: 3 })
  assertEquals(recorded.asked.length, 0)
})
