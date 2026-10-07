/**
 * The function's requests (issues #166–#168) with an in-memory store and the
 * recorded sources: draining the queue, a failing source putting the Book back,
 * the callers it accepts, a member's single Book, the remap.
 */
import { assert, assertEquals } from '@std/assert'
import { type Caller, createHandler } from './handler.ts'
import { createHttp, type FetchLike } from './http.ts'
import { LANGUAGES, type ScenarioName, SCENARIOS } from './scenarios.ts'
import { createSources } from './sources.ts'
import { createMemoryStore } from './store.ts'
import { fakeClock, recordedFetch } from './test_support.ts'

const ALL = Object.keys(SCENARIOS) as ScenarioName[]

function setup(options: { fetch?: FetchLike; books?: ScenarioName[] } = {}) {
  const time = fakeClock()
  const recorded = recordedFetch(ALL)
  // Rowling's author answers were not recorded (her scenario counts her as fetched).
  const memory = createMemoryStore((options.books ?? ALL.filter((n) => n !== 'rowling-feuerkelch')).map((name) => SCENARIOS[name]))
  const logs: string[] = []
  const handler = createHandler({
    store: memory.store,
    sources: createSources(createHttp({ fetch: options.fetch ?? recorded.fetch, userAgent: 'test', clock: time.clock }), LANGUAGES),
    authorize: (request): Promise<Caller> => {
      const token = request.headers.get('authorization')
      return Promise.resolve(token === 'Bearer service' ? 'service' : token === 'Bearer member' ? 'member' : null)
    },
    now: time.now,
    log: (message) => logs.push(message),
  })
  return { handler, memory, logs, asked: recorded.asked }
}

function post(body: unknown, token: string | null = 'service') {
  return new Request('http://localhost/enrich', {
    method: 'POST',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

Deno.test('drain: every queued Book is enriched and saved, each author once', async () => {
  const { handler, memory } = setup()
  const response = await handler(post({ action: 'drain' }))
  assertEquals(response.status, 200)
  assertEquals(await response.json(), { books: 4, failed: 0, authors: 0 })
  assertEquals(memory.saved.map((p) => p.book?.status), ['enriched', 'enriched', 'enriched', 'not_found'])
  assertEquals(memory.queue.length, 0)
  const fetchedAuthors = memory.saved.flatMap((p) => p.authors.filter((a) => a.fetched).map((a) => a.wikidata))
  assertEquals(fetchedAuthors, ['Q46248', 'Q181659', 'Q347461'])
})

Deno.test('a source that fails puts the Book back in the queue; nothing of it is stored', async () => {
  const recorded = recordedFetch(ALL)
  const failing: FetchLike = (url, init) =>
    url.includes('openlibrary.org/works/OL271163W') ? Promise.resolve(new Response('down', { status: 503 })) : recorded.fetch(url, init)
  const { handler, memory, logs } = setup({ fetch: failing, books: ['haldeman-forever-war'] })
  assertEquals(await (await handler(post({ action: 'drain' }))).json(), { books: 0, failed: 1, authors: 0 })
  assertEquals(memory.saved, [])
  assertEquals(memory.failures.map((f) => f.bookId), [SCENARIOS['haldeman-forever-war'].id])
  assert(memory.failures[0]!.error.includes('source_unavailable 503 openlibrary.org'))
  assert(logs.some((line) => line.includes('failed')))
})

Deno.test('callers: nobody is refused, a member may not drain, the service may', async () => {
  const { handler } = setup({ books: [] })
  assertEquals((await handler(post({ action: 'drain' }, null))).status, 401)
  assertEquals((await handler(post({ action: 'drain' }, 'member'))).status, 403)
  assertEquals((await handler(post({ action: 'status' }, 'member'))).status, 403)
  assertEquals((await handler(post({ action: 'drain' }, 'service'))).status, 200)
  assertEquals((await handler(post({ action: 'nonsense' }))).status, 400)
  assertEquals((await handler(new Request('http://localhost/enrich', { method: 'GET' }))).status, 405)
  assertEquals((await handler(new Request('http://localhost/enrich', { method: 'OPTIONS' }))).status, 200)
})

Deno.test('a member asks for one Book: that Book is enriched now, an unknown one is 404', async () => {
  const { handler, memory } = setup({ books: ['le-guin-earthsea', 'no-data'] })
  memory.queue.length = 0
  const id = SCENARIOS['le-guin-earthsea'].id
  const response = await handler(post({ action: 'book', bookId: id }, 'member'))
  assertEquals(await response.json(), { done: 1, failed: 0 })
  assertEquals(memory.saved.map((p) => p.book?.id), [id])
  const unknown = await handler(post({ action: 'book', bookId: '00000000-0000-4000-8000-0000000000ff' }, 'member'))
  assertEquals(unknown.status, 404)
})
