import { assert, assertEquals, assertRejects } from '@std/assert'
import { isbnQuery, parseVolumes, titleQuery, volumesUrl } from '../../../web/app/data/googleBooksRecord.ts'
import { createGoogleBooksClient, GoogleUnavailable } from './client.ts'
import { fixture, ISBN_HIT, ISBN_MISS, recordedFetch, TEST_KEY } from './test_support.ts'

Deno.test('no key: nothing is asked and the answer is "not configured"', async () => {
  const { fetch, asked } = recordedFetch()
  const client = createGoogleBooksClient({ fetch, apiKey: () => undefined })
  const error = await assertRejects(() => client.ask(isbnQuery(ISBN_HIT)), GoogleUnavailable)
  assertEquals(error.kind, 'not_configured')
  assertEquals(asked, [])
  // A blank secret (set but empty) is no key either.
  const blank = createGoogleBooksClient({ fetch, apiKey: () => '   ' })
  await assertRejects(() => blank.ask(isbnQuery(ISBN_HIT)), GoogleUnavailable)
  assertEquals(asked, [])
})

Deno.test('the key travels in a header, never in the address', async () => {
  const { fetch, asked } = recordedFetch()
  const client = createGoogleBooksClient({ fetch, apiKey: () => TEST_KEY })
  await client.ask(isbnQuery(ISBN_HIT))
  assertEquals(asked.length, 1)
  assertEquals(asked[0]!.headers.get('x-goog-api-key'), TEST_KEY)
  assert(!asked[0]!.url.includes(TEST_KEY))
  assert(!/[?&]key=/.test(asked[0]!.url))
  assert(asked[0]!.url.startsWith('https://www.googleapis.com/books/v1/volumes?'))
})

Deno.test('the question asks for no description and only the fields the app reads', () => {
  const url = new URL(volumesUrl(titleQuery('Der stille Hafen', 'Ida Beispiel')!, 'de'))
  assertEquals(url.searchParams.get('q'), 'intitle:"Der stille Hafen" inauthor:"Ida Beispiel"')
  assertEquals(url.searchParams.get('langRestrict'), 'de')
  assertEquals(url.searchParams.get('printType'), 'books')
  assert(!url.searchParams.get('fields')!.includes('description'))
  assertEquals(new URL(volumesUrl('words')).searchParams.get('langRestrict'), null)
})

Deno.test('a hit: one volume per ISBN, the description dropped, the cover linked over https without the curl', async () => {
  const { fetch } = recordedFetch()
  const client = createGoogleBooksClient({ fetch, apiKey: () => TEST_KEY })
  const answer = await client.ask(isbnQuery(ISBN_HIT))
  assertEquals(answer.cacheControl, null)
  assertEquals(answer.volumes.length, 1, 'the second volume of the same ISBN is the first one again')
  const [volume] = answer.volumes
  assertEquals(volume, {
    id: 'ZZhit0001AAA',
    title: 'Das Leuchten der Nordsee',
    authors: ['Ida Beispiel'],
    isbn13: ISBN_HIT,
    // The fixture's ISBN-10 has a wrong check digit: it is no ISBN-10.
    isbn10: null,
    pageCount: 412,
    year: 2019,
    language: 'de',
    publisher: 'Musterverlag',
    genres: ['thriller'],
    coverUrl: 'https://books.google.com/books/content?id=ZZhit0001AAA&printsec=frontcover&img=1&zoom=1&source=gbs_api',
  })
  assert(!JSON.stringify(answer).includes('blurb'))
})

Deno.test('a miss is an answer with no volumes', async () => {
  const { fetch } = recordedFetch()
  const client = createGoogleBooksClient({ fetch, apiKey: () => TEST_KEY })
  assertEquals((await client.ask(isbnQuery(ISBN_MISS))).volumes, [])
})

Deno.test('categories map to the app\'s genres by the table; the rest is dropped', () => {
  const volumes = parseVolumes(JSON.parse(fixture('title-german')))
  assertEquals(volumes.map((volume) => [volume.language, volume.genres]), [
    ['de', ['romance']],
    ['en', ['romance']],
    ['de', []],
    ['de', ['poetry']],
    ['fr', ['ya', 'historical', 'biography']],
  ])
  // A volume without an ISBN stays in the list (isbn13 null): the app decides what it can add.
  assertEquals(volumes[2]!.isbn13, null)
  assertEquals(volumes[3]!.authors, [])
})

Deno.test('refusals are "blocked", a failing Google is "error"; nobody gets the answer body', async () => {
  const quota = recordedFetch({}).fetch
  const client = createGoogleBooksClient({ fetch: quota, apiKey: () => TEST_KEY })
  const blocked = await assertRejects(() => client.ask(isbnQuery('9791034567911')), GoogleUnavailable)
  assertEquals([blocked.kind, blocked.status], ['blocked', 429])
  const down = await assertRejects(() => client.ask(isbnQuery('9791034567928')), GoogleUnavailable)
  assertEquals([down.kind, down.status], ['error', 500])
  const offline = createGoogleBooksClient({ fetch: () => Promise.reject(new Error('network')), apiKey: () => TEST_KEY })
  assertEquals((await assertRejects(() => offline.ask(isbnQuery(ISBN_HIT)), GoogleUnavailable)).kind, 'error')
  const notJson = createGoogleBooksClient({ fetch: () => Promise.resolve(new Response('<html>', { status: 200 })), apiKey: () => TEST_KEY })
  assertEquals((await assertRejects(() => notJson.ask(isbnQuery(ISBN_HIT)), GoogleUnavailable)).kind, 'error')
})

Deno.test('nothing that is not a volume throws', () => {
  for (const body of [null, 'x', 3, {}, { items: 'no' }, { items: [null, 1, {}, { id: 'a' }, { id: 'a', volumeInfo: {} }] }]) assertEquals(parseVolumes(body), [])
})
