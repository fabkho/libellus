/**
 * The function's behaviour (issue #69, #111) with in-memory caches, a fake
 * clock and Goodreads answering from the recordings: the 30-day cache (misses
 * too), the title fallback, the edition by its Book Id and its 90-day cache,
 * the shared in-flight lookup, the one-a-second limit, the three-second
 * timeout, failures never stored, members only.
 *
 *   cd supabase/functions/goodreads-rating && deno test
 */
import { assert, assertEquals } from '@std/assert'
import { createGoodreads, type FetchLike, USER_AGENT } from './client.ts'
import { bookPageUrl, type EditionFound } from './edition.ts'
import {
  type CachedAnswer,
  type CachedEdition,
  createHandler,
  EDITION_MAX_AGE_MS,
  EDITION_MISS_MAX_AGE_MS,
  MAX_AGE_MS,
} from './handler.ts'
import { fakeClock, recordedFetch } from './test_support.ts'

const SMALL_GODS = { isbn13: '9780061803208', title: 'Small Gods', authors: ['Terry Pratchett'] }
const LEGION = { isbn13: '9798991234566', title: 'We Are Legion (We Are Bob)', authors: ['Dennis E. Taylor'] }
const SANDMAN = { isbn13: '9790000000001', title: 'The Sandman, Vol. 5: A Game of You', authors: ['Neil Gaiman'] }
const NOBODY = { isbn13: '9798991234566', title: 'Qxzvbnm Wplkjhg', authors: ['Ann Zzyzx'] }

function setup(
  options: {
    fetch?: FetchLike
    authorized?: boolean
    maxWaitMs?: number
    timeoutMs?: number
    /** Answers for URLs nobody recorded (a 404 book page). */
    extra?: Record<string, () => Response | Promise<Response>>
  } = {},
) {
  const time = fakeClock()
  const recorded = recordedFetch(options.extra)
  const store = new Map<string, CachedAnswer>()
  const editions = new Map<string, CachedEdition>()
  const logs: string[] = []
  const handler = createHandler({
    cache: {
      get: (isbn13) => Promise.resolve(store.get(isbn13) ?? null),
      put: (isbn13, answer) => {
        store.set(isbn13, answer)
        return Promise.resolve()
      },
    },
    editions: {
      get: (goodreadsId) => Promise.resolve(editions.get(goodreadsId) ?? null),
      put: (goodreadsId, edition) => {
        editions.set(goodreadsId, edition)
        return Promise.resolve()
      },
    },
    goodreads: createGoodreads({
      fetch: options.fetch ?? recorded.fetch,
      clock: time.clock,
      maxWaitMs: options.maxWaitMs,
      timeoutMs: options.timeoutMs,
    }),
    authorize: (request) =>
      Promise.resolve(options.authorized ?? request.headers.get('authorization') === 'Bearer member'),
    now: time.now,
    log: (message) => logs.push(message),
  })
  return { handler, store, editions, time, asked: recorded.asked, logs }
}

function ask(
  about: { isbn13?: string; title?: string; authors?: string[]; goodreadsId?: string },
  token = 'member',
) {
  return new Request('http://localhost/goodreads-rating', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(about),
  })
}

Deno.test('an ISBN Goodreads knows: asked once, identified, stored with its time, answered', async () => {
  const { handler, store, asked, time } = setup()
  const response = await handler(ask(SMALL_GODS))
  assertEquals(response.status, 200)
  assertEquals(response.headers.get('access-control-allow-origin'), '*')
  const body = await response.json()
  assertEquals(body, {
    status: 'found',
    matchedBy: 'isbn',
    goodreadsId: '6388978',
    rating: 4.32,
    ratingsCount: 137875,
    reviewsCount: 6116,
    checkedAt: new Date(time.now()).toISOString(),
  })
  assertEquals(store.get(SMALL_GODS.isbn13), body)
  assertEquals(asked.length, 1)
  assertEquals(asked[0]!.headers.get('user-agent'), USER_AGENT)
})

Deno.test('the same request as a GET with query parameters', async () => {
  const { handler } = setup()
  const url = `http://localhost/goodreads-rating?isbn=${SMALL_GODS.isbn13}&title=Small%20Gods&author=Terry%20Pratchett`
  const response = await handler(new Request(url, { headers: { authorization: 'Bearer member' } }))
  assertEquals((await response.json()).goodreadsId, '6388978')
})

Deno.test('an ISBN Goodreads does not know: found by title and author surname, without a review count', async () => {
  const { handler, asked, store } = setup()
  const body = await (await handler(ask(LEGION))).json()
  assertEquals(body.status, 'found')
  assertEquals(body.matchedBy, 'title')
  assertEquals(body.goodreadsId, '32109569')
  assertEquals(body.rating, 4.24)
  assertEquals(body.ratingsCount, 146833)
  assertEquals(body.reviewsCount, null)
  assertEquals(asked.map((a) => new URL(a.url).pathname), ['/book/review_counts.json', '/book/auto_complete'])
  assertEquals(store.get(LEGION.isbn13)?.status, 'found')
})

Deno.test('a Goodreads stub without ratings falls back to the title search as well', async () => {
  const { handler } = setup()
  const body = await (await handler(ask(SANDMAN))).json()
  assertEquals([body.matchedBy, body.goodreadsId], ['title', '25102'])
})

Deno.test('a miss is stored and not asked about again for 30 days', async () => {
  const { handler, asked, store, time } = setup()
  assertEquals((await (await handler(ask(NOBODY))).json()).status, 'not_found')
  assertEquals(store.get(NOBODY.isbn13)?.status, 'not_found')
  assertEquals(asked.length, 2)

  time.advance(MAX_AGE_MS - 60_000)
  assertEquals((await (await handler(ask(NOBODY))).json()).status, 'not_found')
  assertEquals(asked.length, 2)

  time.advance(120_000)
  await handler(ask(NOBODY))
  assertEquals(asked.length, 4)
})

Deno.test('without a title or an author, an unknown ISBN is a miss without a title search', async () => {
  const { handler, asked } = setup()
  assertEquals((await (await handler(ask({ isbn13: LEGION.isbn13, title: LEGION.title }))).json()).status, 'not_found')
  assertEquals(asked.length, 1)
})

Deno.test('a fresh cached rating is answered without Goodreads; a stale one is asked again', async () => {
  const { handler, asked, store, time } = setup()
  const old: CachedAnswer = {
    status: 'found',
    matchedBy: 'isbn',
    goodreadsId: '6388978',
    rating: 4.1,
    ratingsCount: 100,
    reviewsCount: 10,
    checkedAt: new Date(time.now() - 29 * 24 * 3600_000).toISOString(),
  }
  store.set(SMALL_GODS.isbn13, old)
  assertEquals(await (await handler(ask(SMALL_GODS))).json(), old)
  assertEquals(asked.length, 0)

  time.advance(2 * 24 * 3600_000)
  assertEquals((await (await handler(ask(SMALL_GODS))).json()).rating, 4.32)
  assertEquals(asked.length, 1)
})

Deno.test('two pages asking for the same ISBN at once share one lookup', async () => {
  const { handler, asked } = setup()
  const [a, b] = await Promise.all([handler(ask(SMALL_GODS)), handler(ask(SMALL_GODS))])
  assertEquals([a.status, b.status], [200, 200])
  assertEquals(asked.length, 1)
})

Deno.test('at most one Goodreads request a second; a queue too long is refused as busy', async () => {
  const { handler, time } = setup({ maxWaitMs: 1500 })
  const slept = () => time.now() - Date.parse('2026-10-04T10:00:00Z')
  await handler(ask(SMALL_GODS)) // one request, at once
  assertEquals(slept(), 0)
  await handler(ask(NOBODY)) // two more, each a second after the one before
  assertEquals(slept(), 2000)

  // Three at once, on a clock that stands still: the first goes, the second
  // waits its second, the third would wait two and is refused.
  const frozen = { now: () => 0, sleep: () => Promise.resolve() }
  const body = recordedFetch()
  const anyIsbn: FetchLike = (url, init) =>
    body.fetch(url.replace(/isbns=\d+/, `isbns=${SMALL_GODS.isbn13}`), init)
  const busy = createHandler({
    cache: { get: () => Promise.resolve(null), put: () => Promise.resolve() },
    editions: { get: () => Promise.resolve(null), put: () => Promise.resolve() },
    goodreads: createGoodreads({ fetch: anyIsbn, clock: frozen, maxWaitMs: 1500 }),
    authorize: () => Promise.resolve(true),
  })
  const statuses = await Promise.all(
    [SMALL_GODS.isbn13, '9780061803888', '9780061804717'].map(async (isbn13) => (await busy(ask({ isbn13 }))).status),
  )
  assertEquals(statuses.sort(), [200, 200, 503])
  assertEquals(body.asked.length, 2)
})

Deno.test('Goodreads failing or slow: 502, nothing stored, the next view asks again', async () => {
  const failing = setup({ fetch: () => Promise.resolve(new Response('upstream', { status: 500 })) })
  const response = await failing.handler(ask(SMALL_GODS))
  assertEquals(response.status, 502)
  assertEquals(await response.json(), { error: 'goodreads_unavailable' })
  assertEquals(failing.store.size, 0)

  // A request that never answers is cut off after the timeout (real time, shortened).
  const hanging: FetchLike = (_url, init) =>
    new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason)))
  const slow = setup({ fetch: hanging, timeoutMs: 20 })
  assertEquals((await slow.handler(ask(SMALL_GODS))).status, 502)
  assertEquals(slow.store.size, 0)
})

Deno.test('members only, a valid ISBN-13 only, CORS answered', async () => {
  const { handler, asked } = setup()
  assertEquals((await handler(ask(SMALL_GODS, 'anon'))).status, 401)
  assertEquals((await handler(ask({ isbn13: '9780061803209' }))).status, 400)
  assertEquals((await handler(ask({ isbn13: '0061803200' }))).status, 400)
  const preflight = await handler(new Request('http://localhost/goodreads-rating', { method: 'OPTIONS' }))
  assertEquals(preflight.status, 200)
  assert(preflight.headers.get('access-control-allow-headers')?.includes('authorization'))
  assertEquals(asked.length, 0)
})

// ------------------------------------------- the edition an import asks about

const SMALL_GODS_EDITION: EditionFound = {
  status: 'found',
  goodreadsId: '6388978',
  title: 'Small Gods',
  isbn13: '9780061803208',
  isbn10: '0061803200',
  asin: 'B000QTEA3I',
  language: 'en',
  pageCount: 26,
  format: 'Kindle Edition',
  publisher: 'HarperCollins ebooks',
  year: 2009,
}

Deno.test('an edition by its Book Id: its page read once as HTML, stored with its time, answered', async () => {
  const { handler, editions, asked, time } = setup()
  const response = await handler(ask({ goodreadsId: '6388978' }))
  assertEquals(response.status, 200)
  assertEquals(response.headers.get('access-control-allow-origin'), '*')
  const checkedAt = new Date(time.now()).toISOString()
  assertEquals(await response.json(), { ...SMALL_GODS_EDITION, checkedAt })
  assertEquals(asked.length, 1)
  assertEquals(asked[0]!.url, bookPageUrl('6388978'))
  // A page, not JSON — and the same name Goodreads sees on every other request.
  assertEquals(asked[0]!.headers.get('accept'), 'text/html')
  assertEquals(asked[0]!.headers.get('user-agent'), USER_AGENT)
  assertEquals(editions.get('6388978'), { ...SMALL_GODS_EDITION, checkedAt })

  // The query string asks the same thing, and is answered from the cache.
  const get = new Request('http://localhost/goodreads-rating?goodreadsId=6388978', {
    headers: { authorization: 'Bearer member' },
  })
  assertEquals(await (await handler(get)).json(), { ...SMALL_GODS_EDITION, checkedAt })
  assertEquals(asked.length, 1)
})

Deno.test('an edition is kept for ninety days, then read again', async () => {
  const { handler, editions, asked, time } = setup()
  const old: CachedEdition = {
    ...SMALL_GODS_EDITION,
    // Goodreads said paperback when it was read, a day before the ninety are up.
    format: 'Paperback',
    checkedAt: new Date(time.now() - (EDITION_MAX_AGE_MS - 24 * 3600_000)).toISOString(),
  }
  editions.set('6388978', old)
  assertEquals(await (await handler(ask({ goodreadsId: '6388978' }))).json(), old)
  assertEquals(asked.length, 0)

  time.advance(2 * 24 * 3600_000)
  assertEquals((await (await handler(ask({ goodreadsId: '6388978' }))).json()).format, 'Kindle Edition')
  assertEquals(asked.length, 1)
})

Deno.test('a Book Id Goodreads shows nothing for is a miss, kept for thirty days', async () => {
  const gone = bookPageUrl('9999999')
  const { handler, editions, asked, time } = setup({ extra: { [gone]: () => new Response('nope', { status: 404 }) } })
  const response = await handler(ask({ goodreadsId: '9999999' }))
  assertEquals(response.status, 200)
  assertEquals(await response.json(), { status: 'not_found', checkedAt: new Date(time.now()).toISOString() })
  assertEquals(editions.get('9999999')?.status, 'not_found')

  // A page that renders other Books than the one asked for is a miss too.
  assertEquals(await (await handler(ask({ goodreadsId: '1111111' }))).json(), {
    status: 'not_found',
    checkedAt: new Date(time.now()).toISOString(),
  })
  assertEquals(asked.length, 2)

  time.advance(EDITION_MISS_MAX_AGE_MS - 24 * 3600_000)
  assertEquals((await (await handler(ask({ goodreadsId: '9999999' }))).json()).status, 'not_found')
  assertEquals(asked.length, 2)
  time.advance(2 * 24 * 3600_000)
  assertEquals((await (await handler(ask({ goodreadsId: '9999999' }))).json()).status, 'not_found')
  assertEquals(asked.length, 3)
})

Deno.test('two rows of the same export asking for one edition share its lookup', async () => {
  const { handler, asked } = setup()
  const [a, b] = await Promise.all([handler(ask({ goodreadsId: '6388978' })), handler(ask({ goodreadsId: '6388978' }))])
  assertEquals([a.status, b.status], [200, 200])
  assertEquals(asked.length, 1)
})

Deno.test('an import in a hurry is refused as busy, and nothing is stored', async () => {
  // Three editions at once, on a clock that stands still: the first goes, the
  // second waits its second, the third would wait two and is refused.
  const frozen = { now: () => 0, sleep: () => Promise.resolve() }
  const pages = recordedFetch()
  const anyPage: FetchLike = (url, init) => pages.fetch(url.replace(/book\/show\/\d+/, 'book/show/6388978'), init)
  const stored = new Map<string, CachedEdition>()
  const busy = createHandler({
    cache: { get: () => Promise.resolve(null), put: () => Promise.resolve() },
    editions: {
      get: () => Promise.resolve(null),
      put: (goodreadsId, edition) => {
        stored.set(goodreadsId, edition)
        return Promise.resolve()
      },
    },
    goodreads: createGoodreads({ fetch: anyPage, clock: frozen, maxWaitMs: 1500 }),
    authorize: () => Promise.resolve(true),
  })
  const statuses = await Promise.all(
    ['6388978', '6388979', '6388980'].map(async (goodreadsId) => (await busy(ask({ goodreadsId }))).status),
  )
  assertEquals(statuses.sort(), [200, 200, 503])
  assertEquals(pages.asked.length, 2)
  // The refused one is not a miss: it was never asked.
  assertEquals(stored.size, 2)
})

Deno.test('the book page failing: 502, nothing stored, the next import asks again', async () => {
  const failing = setup({ fetch: () => Promise.resolve(new Response('upstream', { status: 500 })) })
  const response = await failing.handler(ask({ goodreadsId: '6388978' }))
  assertEquals(response.status, 502)
  assertEquals(await response.json(), { error: 'goodreads_unavailable' })
  assertEquals(failing.editions.size, 0)
})

Deno.test('only a Goodreads Book Id is asked about; the ISBN shape is untouched', async () => {
  const { handler, asked } = setup()
  assertEquals((await handler(ask({ goodreadsId: '6388978' }, 'anon'))).status, 401)
  for (const goodreadsId of ['6388978-small-gods', 'kca://book/x', '1234567890123', ' ']) {
    const response = await handler(ask({ goodreadsId }))
    assertEquals(response.status, 400)
    assertEquals(await response.json(), { error: 'goodreads_id_invalid' })
  }
  // Neither field: still the older shape's own refusal.
  assertEquals(await (await handler(ask({ title: 'Small Gods' }))).json(), { error: 'isbn_invalid' })
  // Both: the Book Id is the exact edition, so it wins.
  const both = await handler(ask({ goodreadsId: '6388978', isbn13: SMALL_GODS.isbn13 }))
  assertEquals((await both.json()).format, 'Kindle Edition')
  assertEquals(asked.length, 1)
  assertEquals(asked[0]!.url, bookPageUrl('6388978'))
})
