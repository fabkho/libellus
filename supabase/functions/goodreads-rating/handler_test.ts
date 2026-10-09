/**
 * The function's behaviour (issue #69) with an in-memory cache, a fake clock
 * and Goodreads answering from the recordings: the cache (found 30 days, a miss 7),
 * Books without an ISBN looked up by title and author,
 * the title fallback, the shared in-flight lookup, the one-a-second limit, the
 * three-second timeout, failures never stored, members only.
 *
 *   cd supabase/functions/goodreads-rating && deno test
 */
import { assert, assertEquals } from '@std/assert'
import { createGoodreads, type FetchLike, USER_AGENT } from './client.ts'
import { type CachedAnswer, createHandler, MAX_AGE_MS, NOT_FOUND_MAX_AGE_MS } from './handler.ts'
import { fakeClock, recordedFetch } from './test_support.ts'

const SMALL_GODS = { isbn13: '9780061803208', title: 'Small Gods', authors: ['Terry Pratchett'] }
const LEGION = { isbn13: '9798991234566', title: 'We Are Legion (We Are Bob)', authors: ['Dennis E. Taylor'] }
const SANDMAN = { isbn13: '9790000000001', title: 'The Sandman, Vol. 5: A Game of You', authors: ['Neil Gaiman'] }
const NOBODY = { isbn13: '9798991234566', title: 'Qxzvbnm Wplkjhg', authors: ['Ann Zzyzx'] }

/** The in-memory cache's key: the ISBN-13, or `title:` and the title key. */
function storeKey(key: { isbn13: string } | { titleKey: string }): string {
  return 'isbn13' in key ? key.isbn13 : `title:${key.titleKey}`
}

function setup(options: { fetch?: FetchLike; authorized?: boolean; maxWaitMs?: number; timeoutMs?: number } = {}) {
  const time = fakeClock()
  const recorded = recordedFetch()
  const store = new Map<string, CachedAnswer>()
  const logs: string[] = []
  const handler = createHandler({
    cache: {
      get: (key) => Promise.resolve(store.get(storeKey(key)) ?? null),
      put: (key, answer) => {
        store.set(storeKey(key), answer)
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
  return { handler, store, time, asked: recorded.asked, logs }
}

function ask(book: { isbn13?: string; title?: string; authors?: string[] }, token = 'member') {
  return new Request('http://localhost/goodreads-rating', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(book),
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

Deno.test('a miss is stored and not asked about again for 7 days', async () => {
  const { handler, asked, store, time } = setup()
  assertEquals((await (await handler(ask(NOBODY))).json()).status, 'not_found')
  assertEquals(store.get(NOBODY.isbn13)?.status, 'not_found')
  assertEquals(asked.length, 2)

  time.advance(NOT_FOUND_MAX_AGE_MS - 60_000)
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
  store.set(storeKey({ isbn13: SMALL_GODS.isbn13 }), old)
  assertEquals(await (await handler(ask(SMALL_GODS))).json(), old)
  assertEquals(asked.length, 0)

  time.advance(2 * 24 * 3600_000)
  assertEquals((await (await handler(ask(SMALL_GODS))).json()).rating, 4.32)
  assertEquals(asked.length, 1)
})

const DAY = 24 * 3600_000
const LEGION_NO_ISBN = { title: LEGION.title, authors: LEGION.authors }
const LEGION_KEY = 'title:we are legion we are bob|taylor'
const NOBODY_NO_ISBN = { title: NOBODY.title, authors: NOBODY.authors }

Deno.test('a miss is asked again after 7 days, a found rating only after 30', async () => {
  assertEquals(NOT_FOUND_MAX_AGE_MS, 7 * DAY)
  assertEquals(MAX_AGE_MS, 30 * DAY)
  const { handler, asked, store, time } = setup()
  const miss: CachedAnswer = { status: 'not_found', checkedAt: new Date(time.now() - 6 * DAY).toISOString() }
  store.set(NOBODY.isbn13, miss)
  assertEquals(await (await handler(ask(NOBODY))).json(), miss)
  assertEquals(asked.length, 0)

  time.advance(2 * DAY) // the miss is now 8 days old
  assertEquals((await (await handler(ask(NOBODY))).json()).checkedAt, new Date(time.now()).toISOString())
  assertEquals(asked.length, 2) // by ISBN, then by title
  assertEquals(store.get(NOBODY.isbn13)?.checkedAt, new Date(time.now()).toISOString())

  // A found rating of the same age (8 days) is still good.
  const found: CachedAnswer = {
    status: 'found',
    matchedBy: 'isbn',
    goodreadsId: '6388978',
    rating: 4.1,
    ratingsCount: 100,
    reviewsCount: 10,
    checkedAt: new Date(time.now() - 8 * DAY).toISOString(),
  }
  store.set(SMALL_GODS.isbn13, found)
  assertEquals(await (await handler(ask(SMALL_GODS))).json(), found)
  assertEquals(asked.length, 2)
})

Deno.test('a Book without an ISBN is found by title and author, cached by its title key', async () => {
  const { handler, asked, store } = setup()
  const response = await handler(ask(LEGION_NO_ISBN))
  assertEquals(response.status, 200)
  const body = await response.json()
  assertEquals(body.status, 'found')
  assertEquals(body.matchedBy, 'title')
  assertEquals(body.goodreadsId, '32109569')
  assertEquals(asked.length, 1) // no ISBN lookup, only the title search
  assert(asked[0]!.url.includes('/book/auto_complete?'))
  assertEquals(asked[0]!.headers.get('user-agent'), USER_AGENT)
  assertEquals([...store.keys()], [LEGION_KEY])

  // Asked again: from the cache, and the same title spelled differently is the same key.
  assertEquals((await (await handler(ask({ title: 'WE ARE LEGION (We Are Bob)', authors: ['Dennis Taylor'] }))).json()).goodreadsId, '32109569')
  assertEquals(asked.length, 1)
})

Deno.test('a Book without an ISBN that Goodreads does not know is a miss, stored and kept for 7 days', async () => {
  const { handler, asked, store, time } = setup()
  const body = await (await handler(ask(NOBODY_NO_ISBN))).json()
  assertEquals(body.status, 'not_found')
  assertEquals(asked.length, 1)
  assertEquals(store.get('title:qxzvbnm wplkjhg|zzyzx')?.status, 'not_found')

  time.advance(6 * DAY)
  await handler(ask(NOBODY_NO_ISBN))
  assertEquals(asked.length, 1)
  time.advance(2 * DAY)
  await handler(ask(NOBODY_NO_ISBN))
  assertEquals(asked.length, 2)
})

Deno.test('a Book without an ISBN does not share a row with the ISBN cache', async () => {
  const { handler, store } = setup()
  await handler(ask(LEGION)) // by ISBN: found by title behind it
  await handler(ask(LEGION_NO_ISBN))
  assertEquals([...store.keys()].sort(), [LEGION.isbn13, LEGION_KEY].sort())
})

Deno.test('without an ISBN the title and an author are needed; a bad ISBN is still refused', async () => {
  const { handler, asked } = setup()
  for (const body of [{ title: 'Something Wicked This Way Comes' }, { authors: ['Ray Bradbury'] }, { title: ' ', authors: ['Ray Bradbury'] }, {}]) {
    const response = await handler(ask(body))
    assertEquals(response.status, 400)
    assertEquals(await response.json(), { error: 'book_unidentified' })
  }
  const bad = await handler(ask({ isbn13: '9780061803209', title: 'Small Gods', authors: ['Terry Pratchett'] }))
  assertEquals(bad.status, 400)
  assertEquals(await bad.json(), { error: 'isbn_invalid' })
  assertEquals(asked.length, 0)
})

Deno.test('without an ISBN: busy and failures are answered as such and never stored', async () => {
  const failing = setup({ fetch: () => Promise.resolve(new Response('upstream', { status: 500 })) })
  const response = await failing.handler(ask(LEGION_NO_ISBN))
  assertEquals(response.status, 502)
  assertEquals(await response.json(), { error: 'goodreads_unavailable' })
  assertEquals(failing.store.size, 0)

  // Two lookups at once on a clock that stands still, a queue of one allowed: the second would wait too long.
  const frozen = { now: () => 0, sleep: () => Promise.resolve() }
  const recorded = recordedFetch()
  const store = new Map<string, CachedAnswer>()
  const busy = createHandler({
    cache: { get: () => Promise.resolve(null), put: (key, answer) => (store.set(storeKey(key), answer), Promise.resolve()) },
    goodreads: createGoodreads({ fetch: recorded.fetch, clock: frozen, maxWaitMs: 500 }),
    authorize: () => Promise.resolve(true),
  })
  const statuses = await Promise.all([LEGION_NO_ISBN, NOBODY_NO_ISBN].map(async (book) => (await busy(ask(book))).status))
  assertEquals(statuses.sort(), [200, 503])
  assertEquals(store.size, 1)
  assertEquals(recorded.asked.length, 1)
})

Deno.test('two pages asking for the same Book without an ISBN at once share one lookup', async () => {
  const { handler, asked } = setup()
  const [a, b] = await Promise.all([handler(ask(LEGION_NO_ISBN)), handler(ask(LEGION_NO_ISBN))])
  assertEquals([a.status, b.status], [200, 200])
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
