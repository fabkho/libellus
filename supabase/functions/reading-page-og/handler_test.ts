/**
 * The function's behaviour (issue #171) with the database and the cover hosts
 * answered from the stub: a token that leads nowhere is a 404, a page and a
 * card come back as a 1200×630 PNG cached for a day, and a cover host that
 * refuses, 404s or never answers only costs that one cover.
 *
 *   cd supabase/functions/reading-page-og && deno task test
 */
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { createHandler, MAX_AGE_SECONDS } from './handler.ts'
import type { PublicBookCard, PublicReadingPage } from './page.ts'
import { ANON_KEY, isPng, pngSize, readFixture, STACK_URL, type StubPlan, stubFetch } from './test_support.ts'

const TOKEN = 'a-reading-page-token-1'
const BOOK = 'b3d7f0c2-91a4-4e58-ae60-7c1d2e3f4a5b'

const page = () => readFixture('page.json') as PublicReadingPage
const card = () => readFixture('card.json') as PublicBookCard

function setup(plan: StubPlan) {
  const stub = stubFetch(plan)
  const logs: string[] = []
  const handler = createHandler({
    supabaseUrl: STACK_URL,
    anonKey: ANON_KEY,
    fetch: stub.fetch,
    // Short, so the test that lets a cover host hang does not wait 2.5 seconds.
    coverTimeoutMs: 50,
    log: (message) => logs.push(message),
  })
  return { handler, asked: stub.asked, logs }
}

const ask = (query: string) => new Request(`http://localhost/reading-page-og${query}`)

async function png(response: Response): Promise<Uint8Array> {
  return new Uint8Array(await response.arrayBuffer())
}

Deno.test('a page becomes a 1200×630 PNG, cached for a day', async () => {
  const { handler, asked } = setup({ page: page(), cover: 'png' })
  const response = await handler(ask(`?token=${TOKEN}`))

  assertEquals(response.status, 200)
  assertEquals(response.headers.get('content-type'), 'image/png')
  assertEquals(response.headers.get('cache-control'), `public, max-age=${MAX_AGE_SECONDS}`)
  const bytes = await png(response)
  assert(isPng(bytes), 'the answer does not start with the PNG signature')
  assertEquals(pngSize(bytes), { width: 1200, height: 630 })

  // The page came from the public function, with the token as its only argument.
  assertStringIncludes(asked[0], '/rest/v1/rpc/public_reading_page')
  // Only https covers are fetched: the shelf's http one is left to its block.
  assert(asked.slice(1).every((url) => url.startsWith('https://')), asked.join(', '))
})

Deno.test('a Book card becomes a 1200×630 PNG', async () => {
  const { handler, asked } = setup({ card: card(), cover: 'png' })
  const response = await handler(ask(`?token=${TOKEN}&book=${BOOK}`))

  assertEquals(response.status, 200)
  const bytes = await png(response)
  assert(isPng(bytes))
  assertEquals(pngSize(bytes), { width: 1200, height: 630 })
  assertStringIncludes(asked[0], '/rest/v1/rpc/public_book_card')
})

Deno.test('a card without a Rating says where the Book stands instead', async () => {
  const reading: PublicBookCard = { ...card(), status: 'reading', ended_on: null, rating: null, review: null }
  const { handler } = setup({ card: reading, cover: 'png' })
  const response = await handler(ask(`?token=${TOKEN}&book=${BOOK}`))
  assertEquals(response.status, 200)
  assert(isPng(await png(response)))
})

Deno.test('a page with no name and nothing but the sections still draws', async () => {
  const bare: PublicReadingPage = {
    name: null,
    sections: { reading: false, year: false, favourites: false, finished: false, shelf: false },
  }
  const { handler, asked } = setup({ page: bare })
  const response = await handler(ask(`?token=${TOKEN}`))
  assertEquals(response.status, 200)
  assertEquals(pngSize(await png(response)), { width: 1200, height: 630 })
  // Nothing to show means nothing to fetch: the database and no cover host.
  assertEquals(asked.length, 1)
})

Deno.test('a token that leads nowhere is a 404, image or not', async () => {
  const { handler } = setup({ page: null, card: null })
  assertEquals((await handler(ask(`?token=${TOKEN}`))).status, 404)
  assertEquals((await handler(ask(`?token=${TOKEN}&book=${BOOK}`))).status, 404)
})

Deno.test('a token or a Book id that cannot exist is a 404 without asking the database', async () => {
  const { handler, asked } = setup({ page: page() })
  assertEquals((await handler(ask(''))).status, 404)
  assertEquals((await handler(ask('?token=short'))).status, 404)
  assertEquals((await handler(ask(`?token=${TOKEN}&book=nonsense`))).status, 404)
  assertEquals(asked, [])
})

Deno.test('a cover host that refuses, 404s or never answers costs only that cover', async () => {
  for (const cover of ['error', 'not-found', 'hang'] as const) {
    const { handler } = setup({ page: page(), cover })
    const response = await handler(ask(`?token=${TOKEN}`))
    assertEquals(response.status, 200, `cover: ${cover}`)
    const bytes = await png(response)
    assert(isPng(bytes), `cover: ${cover}`)
    assertEquals(pngSize(bytes), { width: 1200, height: 630 })
  }
})

Deno.test('a database that cannot be asked is a 502, and says so in the log', async () => {
  const { handler, logs } = setup({ rpcStatus: 500 })
  const response = await handler(ask(`?token=${TOKEN}`))
  assertEquals(response.status, 502)
  assertStringIncludes(logs.join('\n'), 'reading-page-og')
})

Deno.test('anything but GET is refused', async () => {
  const { handler } = setup({ page: page() })
  const response = await handler(new Request(`http://localhost/reading-page-og?token=${TOKEN}`, { method: 'POST' }))
  assertEquals(response.status, 405)
})
