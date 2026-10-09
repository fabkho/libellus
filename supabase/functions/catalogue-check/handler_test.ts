import { assertEquals } from '@std/assert'
import { BUDGET_MS, createHandler, DEFAULT_BATCH, MAX_BATCH } from './handler.ts'
import { answer, book, fakeClock, memoryStore, testHttp } from './test_support.ts'

const lookup = (ids: string, country: string) => `https://itunes.apple.com/lookup?id=${ids.replace(',', '%2C')}&country=${country}`
const ART = 'https://is1-ssl.mzstatic.com/image/thumb/a/b/c.jpg/100x100bb.jpg'

function setup(options: {
  queue?: ReturnType<typeof book>[]
  routes?: Parameters<typeof testHttp>[0]
  saveFails?: (id: string) => boolean
  budgetMs?: number
  clock?: ReturnType<typeof fakeClock>
} = {}) {
  const clock = options.clock ?? fakeClock()
  const { http, asked } = testHttp(options.routes ?? {}, clock)
  const { store, memory } = memoryStore(options.queue ?? [], { saveFails: options.saveFails })
  const logs: string[] = []
  const handler = createHandler({
    store,
    http,
    authorize: (request) => Promise.resolve(request.headers.get('authorization') === 'Bearer service'),
    now: clock.now,
    budgetMs: options.budgetMs,
    log: (message) => logs.push(message),
  })
  return { handler, memory, asked, logs }
}

function post(body: unknown, token: string | null = 'service') {
  return new Request('http://localhost/catalogue-check', {
    method: 'POST',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

Deno.test('only the service may call: no token, a member\'s token and a wrong method are refused before anything is claimed', async () => {
  const { handler, memory } = setup({ queue: [book()] })
  assertEquals((await handler(post({ action: 'drain' }, null))).status, 401)
  assertEquals((await handler(post({ action: 'drain' }, 'a-members-access-token'))).status, 401)
  assertEquals((await handler(new Request('http://localhost/catalogue-check', { method: 'GET' }))).status, 405)
  assertEquals((await handler(new Request('http://localhost/catalogue-check', { method: 'OPTIONS' }))).status, 200)
  assertEquals(memory.claims, [])
})

Deno.test('a body that is not an action is refused', async () => {
  const { handler, memory } = setup({ queue: [book()] })
  assertEquals((await handler(post('not json'))).status, 400)
  assertEquals((await handler(post({ action: 'book', bookId: 'x' }))).status, 400)
  assertEquals((await handler(post({}))).status, 400)
  assertEquals(memory.claims, [])
})

Deno.test('drain: each Book is checked at its source and stored, missed, or given back', async () => {
  const apple = book({ source: 'apple', apple_id: '1111' })
  const unknown = book({ source: 'apple', apple_id: '2222' })
  const olOk = book({ openlibrary_edition_key: 'OL1M' })
  const olMiss = book({ openlibrary_work_key: 'OL404W' })
  const olDown = book({ openlibrary_edition_key: 'OL5M' })
  const { handler, memory } = setup({
    queue: [apple, unknown, olOk, olMiss, olDown],
    routes: {
      [lookup('1111,2222', 'us')]: { results: [{ kind: 'ebook', trackId: 1111, trackName: 'Apple Title', artistName: 'An Author', description: 'Apple blurb', artworkUrl100: ART }] },
      'https://openlibrary.org/books/OL1M.json': { title: 'OL Title', description: 'OL blurb' },
      'https://openlibrary.org/books/OL5M.json': () => answer(503, 'down'),
    },
  })
  const response = await handler(post({ action: 'drain' }))
  assertEquals(response.status, 200)
  assertEquals(await response.json(), { checked: 2, missed: 2, failed: 1, released: 0 })
  assertEquals(memory.saved.map((s) => [s.id, s.result.title]), [[apple.id, 'Apple Title'], [olOk.id, 'OL Title']])
  assertEquals(memory.saved[0]!.result.cover_url, 'https://is1-ssl.mzstatic.com/image/thumb/a/b/c.jpg/600x900bb.jpg')
  assertEquals(memory.missed, [unknown.id, olMiss.id])
  assertEquals(memory.failed.map((f) => f.id), [olDown.id])
})

Deno.test('drain: the batch is the default, or what was asked up to the cap; nothing else of the request is read', async () => {
  const a = setup()
  await a.handler(post({ action: 'drain' }))
  await a.handler(post({ action: 'drain', limit: 3 }))
  await a.handler(post({ action: 'drain', limit: 5000, bookId: 'x', url: 'https://evil.example/', apple_id: '1' }))
  await a.handler(post({ action: 'drain', limit: 'many' }))
  assertEquals(a.memory.claims, [DEFAULT_BATCH, 3, MAX_BATCH, DEFAULT_BATCH])
  assertEquals(a.asked, [])
})

Deno.test('drain: a Book whose store fails goes back, the others go on', async () => {
  const bad = book({ openlibrary_edition_key: 'OL1M' })
  const good = book({ openlibrary_edition_key: 'OL2M' })
  const { handler, memory, logs } = setup({
    queue: [bad, good],
    routes: { 'https://openlibrary.org/books/OL1M.json': { title: 'Bad' }, 'https://openlibrary.org/books/OL2M.json': { title: 'Good' } },
    saveFails: (id) => id === bad.id,
  })
  assertEquals(await (await handler(post({ action: 'drain' }))).json(), { checked: 1, missed: 0, failed: 1, released: 0 })
  assertEquals(memory.saved.map((s) => s.id), [good.id])
  assertEquals(memory.failed.map((f) => f.id), [bad.id])
  assertEquals(logs.length, 1)
})

Deno.test('drain: out of time, the Books not yet tried are given back, not counted as attempts', async () => {
  const clock = fakeClock()
  const first = book({ openlibrary_edition_key: 'OL1M' })
  const second = book({ openlibrary_edition_key: 'OL2M' })
  const { handler, memory } = setup({
    clock,
    budgetMs: BUDGET_MS,
    queue: [first, second],
    routes: {
      'https://openlibrary.org/books/OL1M.json': () => {
        clock.advance(BUDGET_MS + 1)
        return answer(200, { title: 'Slow' })
      },
      'https://openlibrary.org/books/OL2M.json': { title: 'Never asked' },
    },
  })
  assertEquals(await (await handler(post({ action: 'drain' }))).json(), { checked: 1, missed: 0, failed: 0, released: 1 })
  assertEquals(memory.released, [second.id])
})

Deno.test('status answers the counts; a claim that throws answers 500 check_failed', async () => {
  const { handler } = setup({ queue: [book(), book()] })
  assertEquals(await (await handler(post({ action: 'status' }))).json(), { unchecked: 2, checked: 0, failed: 0, backingOff: 0 })
  const broken = createHandler({
    store: { ...memoryStore([]).store, claim: () => Promise.reject(new Error('db down')) },
    http: testHttp({}).http,
    authorize: () => Promise.resolve(true),
    log: () => {},
  })
  const response = await broken(post({ action: 'drain' }))
  assertEquals(response.status, 500)
  assertEquals(await response.json(), { error: 'check_failed' })
})
