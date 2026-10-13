// deno-lint-ignore-file require-await -- the stand-ins answer from memory, as the real ones do over the network
import { assert, assertEquals } from '@std/assert'
import { createDnb } from './client.ts'
import { type BookRow, type Budget, type Catalogue, createHandler, IMPORT_LIMIT, MEMBER_LIMIT, readCover } from './handler.ts'
import { fakeClock, fixture, recordedFetch } from './test_support.ts'

const MEMBER = '11111111-1111-4111-8111-111111111111'

function bookRow(fields: Partial<BookRow> = {}): BookRow {
  return {
    id: '22222222-2222-4222-8222-222222222222', title: 'T', authors: [], isbn13: null, isbn10: null, page_count: null, published_year: null,
    language: null, publisher: null, description: null, cover_url: null, cover_thumbhash: null, cover_dominant: null, cover_secondary: null,
    source: 'import', apple_id: null, openlibrary_edition_key: null, openlibrary_work_key: null, created_at: '2026-10-11T10:00:00Z', ...fields,
  }
}

function setup(options: { cover?: string | null; known?: BookRow | null; throttle?: (member: string, budget: Budget) => Promise<boolean>; fetch?: ReturnType<typeof recordedFetch> } = {}) {
  const recorded = options.fetch ?? recordedFetch()
  const inserted: unknown[] = []
  const catalogue: Catalogue = {
    find: async () => options.known ?? null,
    insert: async (edition, cover) => {
      inserted.push({ edition, cover })
      return bookRow({ title: edition.title, authors: edition.authors, isbn13: edition.isbn13, cover_url: cover?.coverUrl ?? null })
    },
  }
  const logged: string[] = []
  const handler = createHandler({
    dnb: createDnb({ fetch: recorded.fetch, clock: fakeClock().clock }),
    catalogue,
    cover: async () => options.cover ?? null,
    authorize: async (request) => {
      const token = request.headers.get('authorization')
      return token === 'Bearer member' ? { member: MEMBER } : token === 'Bearer service' ? { member: null } : null
    },
    throttle: options.throttle,
    log: (message) => logged.push(message),
  })
  const call = (body: unknown, headers: Record<string, string> = { authorization: 'Bearer member' }) =>
    handler(new Request('https://x.test/functions/v1/dnb-lookup', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }))
  return { call, inserted, logged, recorded }
}

Deno.test('an ISBN: the edition, with a cover when Open Library has one', async () => {
  const { call } = setup({ cover: 'https://covers.openlibrary.org/b/isbn/9783499267017-L.jpg' })
  const response = await call({ action: 'isbn', isbn13: '978-3-499-26701-7' })
  assertEquals(response.status, 200)
  const body = await response.json()
  assertEquals(body.status, 'found')
  assertEquals(body.edition, {
    title: 'Die Toten, die niemand vermisst: ein Fall für Sebastian Bergman ; Kriminalroman',
    authors: ['Michael Hjorth', 'Hans Rosenfeldt'],
    isbn13: '9783499267017',
    publisher: 'Rowohlt Polaris',
    year: 2013,
    language: 'ger',
    pages: 622,
    coverUrl: 'https://covers.openlibrary.org/b/isbn/9783499267017-L.jpg',
  })
})

Deno.test('an ISBN-10 is read as its ISBN-13; an ISBN nobody has is not_found; a bad one is refused', async () => {
  const { call } = setup()
  assertEquals((await (await call({ action: 'isbn', isbn: '3499267012' })).json()).status, 'found')
  assertEquals(await (await call({ action: 'isbn', isbn13: '9780000000002' })).json(), { status: 'not_found' })
  const bad = await call({ action: 'isbn', isbn13: '9783499267018' })
  assertEquals(bad.status, 400)
  assertEquals(await bad.json(), { error: 'isbn_invalid' })
})

Deno.test('editions: one per record with an ISBN-13, books only, each ISBN once', async () => {
  const { call } = setup()
  const body = await (await call({ action: 'editions', title: 'Der Schwarm', authors: ['Frank Schätzing'] })).json()
  assertEquals(body.status, 'ok')
  assert(body.editions.length > 0)
  assertEquals(new Set(body.editions.map((e: { isbn13: string }) => e.isbn13)).size, body.editions.length)
  // The Panem fixture holds readings: none of them is an edition.
  const panem = await (await call({ action: 'editions', title: 'Tödliche Spiele', authors: ['Suzanne Collins'] })).json()
  assert(panem.editions.every((e: { title: string }) => !/lesung|hörbuch/i.test(e.title)))
  assert(panem.editions.some((e: { title: string }) => e.title === 'Tödliche Spiele'))
})

Deno.test('editions without a title is refused', async () => {
  const response = await setup().call({ action: 'editions', title: '  ', authors: [] })
  assertEquals(response.status, 400)
})

Deno.test('book: the Catalogue Book is made from what the DNB says, never from what the caller sent', async () => {
  const { call, inserted } = setup({ cover: null })
  const response = await call({ action: 'book', isbn13: '9783499267017', title: 'Invented', authors: ['Nobody'] })
  const body = await response.json()
  assertEquals(body.status, 'found')
  assertEquals(body.book.isbn13, '9783499267017')
  assertEquals(inserted.length, 1)
  assertEquals((inserted[0] as { edition: { authors: string[] } }).edition.authors, ['Michael Hjorth', 'Hans Rosenfeldt'])
})

Deno.test('book: a Book the Catalogue has is returned without asking the DNB', async () => {
  const known = bookRow({ isbn13: '9783499267017', title: 'Known' })
  const { call, inserted, recorded } = setup({ known })
  const body = await (await call({ action: 'book', isbn13: '9783499267017' })).json()
  assertEquals(body.book.title, 'Known')
  assertEquals(inserted.length, 0)
  assertEquals(recorded.asked.length, 0)
})

Deno.test('book: an ISBN nobody has makes no Book', async () => {
  const { call, inserted } = setup()
  assertEquals(await (await call({ action: 'book', isbn13: '9780000000002' })).json(), { status: 'not_found' })
  assertEquals(inserted.length, 0)
})

Deno.test('an unknown action, a body that is no JSON object and a body that is too long are refused', async () => {
  const { call } = setup()
  assertEquals((await call({ action: 'delete' })).status, 400)
  assertEquals((await call([1, 2])).status, 400)
  assertEquals((await call({ action: 'editions', title: 'x'.repeat(5000) })).status, 413)
})

Deno.test('nobody, or the anon key, is unauthorized; the service role passes unthrottled', async () => {
  const throttled: string[] = []
  const { call } = setup({ throttle: async () => (throttled.push('x'), false) })
  assertEquals((await call({ action: 'isbn', isbn13: '9783499267017' }, {})).status, 401)
  assertEquals((await call({ action: 'isbn', isbn13: '9783499267017' }, { authorization: 'Bearer anon' })).status, 401)
  assertEquals((await call({ action: 'isbn', isbn13: '9783499267017' }, { authorization: 'Bearer service' })).status, 200)
  assertEquals(throttled.length, 0)
})

Deno.test(`a member over her limit (${MEMBER_LIMIT} a minute) gets 429 and nothing is asked`, async () => {
  const recorded = recordedFetch()
  const { call } = setup({ throttle: async () => false, fetch: recorded })
  const response = await call({ action: 'isbn', isbn13: '9783499267017' })
  assertEquals(response.status, 429)
  assertEquals(recorded.asked.length, 0)
})

Deno.test('a member is counted against her budget, an import (`purpose: "import"`) against its own', async () => {
  const budgets: Budget[] = []
  const { call } = setup({ throttle: async (_member, budget) => (budgets.push(budget), true) })
  await call({ action: 'isbn', isbn13: '9783499267017' })
  await call({ action: 'editions', title: 'Der Schwarm', authors: ['Frank Schätzing'], purpose: 'import' })
  assertEquals(budgets, [
    { bucket: 'dnb-lookup', limit: MEMBER_LIMIT },
    { bucket: 'dnb-lookup-import', limit: IMPORT_LIMIT },
  ])
  assert(MEMBER_LIMIT < IMPORT_LIMIT, 'an import asks a row at a time, far more than a member browsing')
})

Deno.test('when the DNB cannot answer: 502, and nothing is made', async () => {
  const recorded = recordedFetch({ ['https://services.dnb.de/sru/dnb?version=1.1&operation=searchRetrieve&query=num%3D9783499267017&recordSchema=oai_dc&maximumRecords=5']: () => new Response(fixture('diagnostic'), { status: 200 }) })
  const { call, inserted } = setup({ fetch: recorded })
  const response = await call({ action: 'book', isbn13: '9783499267017' })
  assertEquals(response.status, 502)
  assertEquals(await response.json(), { error: 'dnb_unavailable' })
  assertEquals(inserted.length, 0)
})

Deno.test('preflight and other methods', async () => {
  const { call } = setup()
  const handler = createHandler({ dnb: createDnb({ fetch: recordedFetch().fetch }), catalogue: { find: async () => null, insert: async () => bookRow() }, cover: async () => null, authorize: async () => null })
  assertEquals((await handler(new Request('https://x.test/', { method: 'OPTIONS' }))).status, 204)
  assertEquals((await handler(new Request('https://x.test/', { method: 'GET' }))).status, 405)
  assert(call)
})

Deno.test('book: the cover the app resolved is kept (Apple or Open Library only), else Open Library\'s', async () => {
  const sent = { coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/x/600x600bb.jpg', coverThumbhash: 'YTkGJwaRhWUIt4lbgnhZl3d4aAiI', coverColors: { dominant: '#112233', secondary: '#445566' } }
  const first = setup({ cover: 'https://covers.openlibrary.org/b/isbn/9783499267017-L.jpg' })
  await first.call({ action: 'book', isbn13: '9783499267017', cover: sent })
  assertEquals((first.inserted[0] as { cover: unknown }).cover, { coverUrl: sent.coverUrl, coverThumbhash: sent.coverThumbhash, dominant: '#112233', secondary: '#445566' })
  const elsewhere = setup({ cover: 'https://covers.openlibrary.org/b/isbn/9783499267017-L.jpg' })
  await elsewhere.call({ action: 'book', isbn13: '9783499267017', cover: { coverUrl: 'https://evil.example/c.jpg' } })
  assertEquals((elsewhere.inserted[0] as { cover: { coverUrl: string } }).cover.coverUrl, 'https://covers.openlibrary.org/b/isbn/9783499267017-L.jpg')
})

Deno.test('readCover leaves out what the Catalogue does not take', () => {
  assertEquals(readCover(null), null)
  assertEquals(readCover({ coverUrl: 'http://covers.openlibrary.org/x.jpg' }), null)
  assertEquals(readCover({ coverUrl: 'https://covers.openlibrary.org/b/isbn/1-L.jpg', coverThumbhash: '<script>', coverColors: { dominant: 'red', secondary: '#445566' } }), {
    coverUrl: 'https://covers.openlibrary.org/b/isbn/1-L.jpg', coverThumbhash: null, dominant: null, secondary: null,
  })
})
