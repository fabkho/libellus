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
import { autoCompleteUrl, titleKey } from './goodreads.ts'
import { createGoodreads, type FetchLike, USER_AGENT } from './client.ts'
import { BREAKER_MS, BUCKETS, type CachedAnswer, createHandler, MAX_AGE_MS, MAX_BODY_BYTES, MAX_KEY_CHARS, NOT_FOUND_MAX_AGE_MS } from './handler.ts'
import { fakeClock, recordedFetch, recording } from './test_support.ts'

const SMALL_GODS = { isbn13: '9780061803208', title: 'Small Gods', authors: ['Terry Pratchett'] }
const LEGION = { isbn13: '9798991234566', title: 'We Are Legion (We Are Bob)', authors: ['Dennis E. Taylor'] }
const SANDMAN = { isbn13: '9790000000001', title: 'The Sandman, Vol. 5: A Game of You', authors: ['Neil Gaiman'] }
const NOBODY = { isbn13: '9798991234566', title: 'Qxzvbnm Wplkjhg', authors: ['Ann Zzyzx'] }

/** The in-memory cache's key: the ISBN-13, or `title:` and the title key. */
function storeKey(key: { isbn13: string } | { titleKey: string }): string {
  return 'isbn13' in key ? key.isbn13 : `title:${key.titleKey}`
}

function setup(
  options: {
    fetch?: FetchLike
    authorized?: boolean
    maxWaitMs?: number
    timeoutMs?: number
    throttle?: (member: string, bucket: string) => Promise<boolean>
    /** Answers for URLs nobody recorded (or instead of a recording), by URL. */
    extra?: Record<string, () => Response | Promise<Response>>
  } = {},
) {
  const time = fakeClock()
  const recorded = recordedFetch(options.extra)
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
    authorize: (request) => {
      const token = request.headers.get('authorization')
      const allowed = options.authorized ?? (token === 'Bearer member' || token === 'Bearer other' || token === 'Bearer service')
      return Promise.resolve(allowed ? { member: token === 'Bearer service' ? null : (token ?? '').slice(7) } : null)
    },
    throttle: options.throttle,
    now: time.now,
    sleep: time.clock.sleep,
    log: (message) => logs.push(message),
  })
  return { handler, store, time, asked: recorded.asked, logs }
}

function ask(
  book: { isbn13?: string; title?: string; authors?: string[]; cover?: boolean; goodreadsBookId?: string },
  token = 'member',
) {
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
  // The ISBN's own answer (a miss) is stored under the ISBN; what the title search found only under the title key.
  assertEquals(store.get(LEGION.isbn13)?.status, 'not_found')
  const byTitle = store.get(LEGION_KEY)
  assert(byTitle?.status === 'found' && byTitle.matchedBy === 'title')
})

Deno.test('a Goodreads stub without ratings falls back to the title search as well', async () => {
  const { handler } = setup()
  const body = await (await handler(ask(SANDMAN))).json()
  assertEquals([body.matchedBy, body.goodreadsId], ['title', '25102'])
})

Deno.test('a miss is stored and not asked about again for 7 days', async () => {
  const { handler, asked, store, time } = setup({ extra: NOBODY_LISTED })
  assertEquals((await (await handler(ask(NOBODY))).json()).status, 'not_found')
  assertEquals(store.get(NOBODY.isbn13)?.status, 'not_found')
  assertEquals(store.get(NOBODY_KEY)?.status, 'not_found')
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
const NOBODY_KEY = 'title:qxzvbnm wplkjhg|zzyzx'

Deno.test('a miss is asked again after 7 days, a found rating only after 30', async () => {
  assertEquals(NOT_FOUND_MAX_AGE_MS, 7 * DAY)
  assertEquals(MAX_AGE_MS, 30 * DAY)
  const { handler, asked, store, time } = setup({ extra: NOBODY_LISTED })
  const miss: CachedAnswer = { status: 'not_found', checkedAt: new Date(time.now() - 6 * DAY).toISOString() }
  store.set(NOBODY.isbn13, miss)
  store.set(NOBODY_KEY, miss)
  assertEquals(await (await handler(ask(NOBODY))).json(), miss)
  assertEquals(asked.length, 0)

  time.advance(2 * DAY) // the miss is now 8 days old
  const again = await (await handler(ask(NOBODY))).json()
  assertEquals(asked.length, 2) // by ISBN, then by title
  assert(Date.parse(store.get(NOBODY.isbn13)!.checkedAt) > Date.parse(miss.checkedAt) + 7 * DAY)
  assertEquals(store.get(NOBODY_KEY)?.checkedAt, again.checkedAt) // the answer is the title search's

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
  const { handler, asked, store, time } = setup({ extra: NOBODY_LISTED })
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
    authorize: () => Promise.resolve({ member: 'member' }),
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
    authorize: () => Promise.resolve({ member: 'member' }),
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

// ------------------------------------------- security round: F2 (the ISBN cache)

Deno.test('F2: a title the caller names never decides what an ISBN shows (the poisoning attack)', async () => {
  const { handler, store } = setup()
  // The attacker names an ISBN Goodreads does not know with the title and author of another, well-rated Book.
  const attack = await (await handler(ask({ isbn13: LEGION.isbn13, title: SANDMAN.title, authors: SANDMAN.authors }))).json()
  assertEquals(attack.goodreadsId, '25102') // what she is told, for her own question
  // Nothing about the Sandman is stored under the ISBN: only the ISBN's own answer, a miss.
  assertEquals(store.get(LEGION.isbn13)?.status, 'not_found')
  assertEquals([...store.keys()].sort(), [LEGION.isbn13, 'title:the sandman vol 5 a game of you|gaiman'].sort())
  // Another member with that ISBN and its real title gets the real Book, not the attacker's.
  const victim = await (await handler(ask(LEGION, 'other'))).json()
  assertEquals(victim.goodreadsId, '32109569')
  // And a lookup by the ISBN alone (what the Library reads through the database) finds no rating.
  assertEquals((await (await handler(ask({ isbn13: LEGION.isbn13 }, 'other'))).json()).status, 'not_found')
  // The Library's relationship reads rows with matched_by 'isbn' only: none was written.
  for (const [key, row] of store) if (!key.startsWith('title:')) assert(row.status === 'not_found' || row.matchedBy === 'isbn')
})

Deno.test('F2: two lookups of one ISBN with different titles at once do not share an answer', async () => {
  const { handler } = setup()
  const [attack, victim] = await Promise.all([
    handler(ask({ isbn13: LEGION.isbn13, title: SANDMAN.title, authors: SANDMAN.authors })),
    handler(ask(LEGION, 'other')),
  ])
  assertEquals((await attack.json()).goodreadsId, '25102')
  assertEquals((await victim.json()).goodreadsId, '32109569')
})

Deno.test('F2: a rating a title search stored under an ISBN (the old code did) is not taken from the cache', async () => {
  const { handler, store, time } = setup()
  store.set(LEGION.isbn13, {
    status: 'found',
    matchedBy: 'title',
    goodreadsId: '234225',
    rating: 5,
    ratingsCount: 9,
    reviewsCount: null,
    checkedAt: new Date(time.now()).toISOString(),
  })
  const body = await (await handler(ask(LEGION))).json()
  assertEquals(body.goodreadsId, '32109569')
  assertEquals(store.get(LEGION.isbn13)?.status, 'not_found') // replaced by what Goodreads said about the ISBN
})

// ---------------------------------- security round: F15 (input bounds, log size)

Deno.test('F15: a body over 16 KB is refused without a lookup, by its declared size and by its real one', async () => {
  const { handler, asked } = setup()
  const huge = JSON.stringify({ title: 'x', authors: ['a'.repeat(MAX_BODY_BYTES)] })
  const declared = await handler(
    new Request('http://localhost/goodreads-rating', {
      method: 'POST',
      headers: { authorization: 'Bearer member', 'content-length': String(huge.length) },
      body: huge,
    }),
  )
  assertEquals([declared.status, await declared.json()], [413, { error: 'payload_too_large' }])

  // No Content-Length: a stream that would go on for ever is cut after 16 KB.
  let sent = 0
  const endless = new ReadableStream<Uint8Array>({
    pull(controller) {
      sent += 1024
      controller.enqueue(new Uint8Array(1024).fill(97))
      if (sent > 10 * MAX_BODY_BYTES) controller.close()
    },
  })
  const streamed = await handler(
    new Request('http://localhost/goodreads-rating', {
      method: 'POST',
      headers: { authorization: 'Bearer member' },
      body: endless,
      // @ts-expect-error Deno needs it for a streamed body
      duplex: 'half',
    }),
  )
  assertEquals(streamed.status, 413)
  assert(sent <= 3 * MAX_BODY_BYTES, `read ${sent} bytes`)

  const get = await handler(
    new Request(`http://localhost/goodreads-rating?title=x&author=${'a'.repeat(MAX_BODY_BYTES)}`, {
      headers: { authorization: 'Bearer member' },
    }),
  )
  assertEquals(get.status, 413)
  assertEquals(asked.length, 0)
})

Deno.test('F15: an author is cut to 200 characters; a title key the table would refuse is not asked', async () => {
  const { handler, asked, store } = setup()
  // Three surnames of 200 characters make a key over 400. With an ISBN: the ISBN is asked, the title search is left out.
  const names = ['a', 'b', 'c'].map((letter) => letter.repeat(300))
  const withIsbn = await handler(ask({ isbn13: LEGION.isbn13, title: LEGION.title, authors: names }))
  assertEquals(withIsbn.status, 200)
  assertEquals(asked.map((a) => new URL(a.url).pathname), ['/book/review_counts.json'])
  assertEquals([...store.keys()], [LEGION.isbn13])

  // Without one it is no Book Goodreads can be asked about.
  const without = await handler(ask({ title: LEGION.title, authors: names }))
  assertEquals([without.status, await without.json()], [400, { error: 'book_unidentified' }])
  assertEquals(asked.length, 1)
})

Deno.test('F15: what is asked of Goodreads carries an author of at most 200 characters', async () => {
  const urls: string[] = []
  const nothing = recording('auto-complete-nothing')
  const { handler, store } = setup({
    fetch: (url) => {
      urls.push(url)
      return Promise.resolve(new Response(nothing.body, { headers: { 'content-type': 'application/json' } }))
    },
  })
  const response = await handler(ask({ title: LEGION.title, authors: ['Dennis ' + 'x'.repeat(5000)] }))
  assertEquals(response.status, 200)
  assertEquals(urls.length, 1)
  assert(decodeURIComponent(urls[0]!).length < 400, `asked ${urls[0]!.length} characters`)
  for (const key of store.keys()) assert(key.length <= MAX_KEY_CHARS + 'title:'.length)
})

Deno.test('F15: a log line carries at most 120 characters of a key', async () => {
  const { handler, logs } = setup({ fetch: () => Promise.resolve(new Response('upstream', { status: 500 })) })
  const title = 'y'.repeat(300)
  const response = await handler(ask({ title, authors: ['Dennis Taylor'] }))
  assertEquals(response.status, 502)
  assertEquals(logs.length, 1)
  assert(logs[0]!.startsWith('goodreads-rating: '))
  assert(logs[0]!.length < 120 + 80, `log line of ${logs[0]!.length} characters`)
})

// -------------------------------- security round: F16 (a limit per member)

Deno.test('F16: a member over her limit gets 429 and no lookup; the service role is not counted', async () => {
  const counted: string[] = []
  const calls = new Map<string, number>()
  const { handler, asked } = setup({
    throttle: (member) => {
      counted.push(member)
      calls.set(member, (calls.get(member) ?? 0) + 1)
      return Promise.resolve(calls.get(member)! <= 2)
    },
  })
  assertEquals((await handler(ask(SMALL_GODS))).status, 200)
  assertEquals((await handler(ask(SMALL_GODS))).status, 200)
  const over = await handler(ask(LEGION))
  assertEquals([over.status, await over.json()], [429, { error: 'rate_limited' }])
  assertEquals(over.headers.get('retry-after'), '60')
  assertEquals(asked.length, 1) // only the first call went upstream; the third was refused before any lookup
  // Another member has her own count; the service role is not counted at all.
  assertEquals((await handler(ask(SMALL_GODS, 'other'))).status, 200)
  assertEquals((await handler(ask(SMALL_GODS, 'service'))).status, 200)
  assertEquals(counted, ['member', 'member', 'member', 'other'])
  // A request that is no Book is not counted.
  await handler(ask({}, 'other'))
  assertEquals(counted.length, 4)
})

Deno.test('F16: when the counter cannot be asked the answer is 503, never an unlimited lookup', async () => {
  const { handler, asked, logs } = setup({ throttle: () => Promise.reject(new Error('db down')) })
  const response = await handler(ask(SMALL_GODS))
  assertEquals([response.status, await response.json()], [503, { error: 'busy' }])
  assertEquals(asked.length, 0)
  assertEquals(logs.length, 1)
})

// -------------------------------- the Goodreads cover (a last-resort cover source)

const SANDMAN_NO_ISBN = { title: SANDMAN.title, authors: SANDMAN.authors }
const SANDMAN_KEY = `title:${titleKey(SANDMAN_NO_ISBN)}`
const SANDMAN_COVER = 'https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1312279891i/25102.jpg'
const ABSOLUTE_COVER = 'https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1558896137i/10864102.jpg'
/** The whole-title search of the Sandman book (the first a cover request without an ISBN makes) and its short one. */
const SANDMAN_FULL = autoCompleteUrl('The Sandman, Vol. 5: A Game of You Neil Gaiman')

/** A Goodreads answer made of a recording's body, for another query's URL. */
const answerLike = (name: Parameters<typeof recording>[0]) => () =>
  new Response(recording(name).body, { status: 200, headers: { 'content-type': 'application/json' } })
/** `auto_complete`'s soft throttle: 200 and an empty list. */
const emptyList = () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
/** The whole-title search answers the list that holds the Absolute edition's id (an edition the title rule does not take). */
/** The title search for NOBODY answers a list (another book's): Goodreads is answering and has not this one, a real miss. */
const NOBODY_LISTED = { [autoCompleteUrl('Qxzvbnm Wplkjhg Zzyzx')]: answerLike('auto-complete-sandman') }
const withAbsolute = { [SANDMAN_FULL]: answerLike('auto-complete-sandman') }

Deno.test('cover: without an ISBN the whole title with the first author is asked first; the answer has the cover without its size token and the Goodreads id', async () => {
  const { handler, asked, store } = setup()
  const body = await (await handler(ask({ ...SANDMAN_NO_ISBN, cover: true }))).json()
  assertEquals([body.status, body.goodreadsId, body.coverUrl], ['found', '25102', SANDMAN_COVER])
  assertEquals(asked.map((a) => a.url), [SANDMAN_FULL])
  const row = store.get(SANDMAN_KEY)
  assert(row?.status === 'found' && row.coverUrl === SANDMAN_COVER)
})

Deno.test('cover: an ISBN that is not valid does not matter, the title is asked', async () => {
  const { handler } = setup()
  const response = await handler(ask({ ...SANDMAN_NO_ISBN, isbn13: 'nonsense', cover: true }))
  assertEquals(response.status, 200)
  assertEquals((await response.json()).coverUrl, SANDMAN_COVER)
})

Deno.test('cover: the result with the given Goodreads book id is taken, whatever its title; the cache keeps the rule\'s hit', async () => {
  const { handler, store } = setup({ extra: withAbsolute })
  const body = await (await handler(ask({ ...SANDMAN_NO_ISBN, cover: true, goodreadsBookId: '10864102' }))).json()
  // "The Absolute Sandman, Volume 5" is not the Book's title: only the id makes it the answer.
  assertEquals([body.status, body.goodreadsId, body.coverUrl], ['found', '10864102', ABSOLUTE_COVER])
  const row = store.get(SANDMAN_KEY)
  assert(row?.status === 'found' && row.goodreadsId === '25102' && row.coverUrl === SANDMAN_COVER)
})

Deno.test('cover: an id Goodreads does not return falls back to the same-work rule', async () => {
  const { handler } = setup()
  const body = await (await handler(ask({ ...SANDMAN_NO_ISBN, cover: true, goodreadsBookId: '999' }))).json()
  assertEquals([body.goodreadsId, body.coverUrl], ['25102', SANDMAN_COVER])
})

const NOBODY_FULL = autoCompleteUrl('Qxzvbnm Wplkjhg Ann Zzyzx')

Deno.test('cover: a title that matches nothing, and an id that is not there, is not_found with no cover when Goodreads answered a list', async () => {
  // Goodreads answers books, none of them this one: a miss.
  const { handler, store } = setup({ extra: { [NOBODY_FULL]: answerLike('auto-complete-we-are-legion') } })
  const body = await (await handler(ask({ ...NOBODY, isbn13: undefined, cover: true, goodreadsBookId: '5' }))).json()
  assertEquals([body.status, body.goodreadsId, body.coverUrl], ['not_found', null, null])
  assertEquals(store.get(`title:${titleKey(NOBODY)}`)?.status, 'not_found')
})

Deno.test('cover: an image Goodreads stands in for (nophoto) is no cover, and that is cached as "none"', async () => {
  const { handler, asked, store } = setup()
  const book = { ...SANDMAN_NO_ISBN, cover: true, goodreadsBookId: '210810558' }
  const body = await (await handler(ask(book))).json()
  assertEquals([body.status, body.goodreadsId, body.coverUrl], ['found', '210810558', null])
  // The id's edition is not the rule's hit; the rule's hit (25102) is what is stored.
  const row = store.get(SANDMAN_KEY)
  assert(row?.status === 'found' && row.coverUrl === SANDMAN_COVER)
  // A book whose own stored hit has no cover: asked once, then answered as "none" without Goodreads.
  store.set(SANDMAN_KEY, { ...row!, coverUrl: null } as CachedAnswer)
  asked.length = 0
  assertEquals((await (await handler(ask({ ...SANDMAN_NO_ISBN, cover: true }))).json()).coverUrl, null)
  assertEquals(asked.length, 0)
})

Deno.test('cover: a cached found row that never asked for a cover is refreshed once, then answered from the cache', async () => {
  const { handler, asked, store } = setup()
  assertEquals((await (await handler(ask(SANDMAN_NO_ISBN))).json()).coverUrl, undefined)
  const plain = store.get(SANDMAN_KEY)
  assert(plain?.status === 'found' && plain.coverUrl === undefined)
  assertEquals(asked.length, 1)

  const body = await (await handler(ask({ ...SANDMAN_NO_ISBN, cover: true }))).json()
  assertEquals(body.coverUrl, SANDMAN_COVER)
  assertEquals(asked.length, 2)
  const refreshed = store.get(SANDMAN_KEY)
  assert(refreshed?.status === 'found' && refreshed.coverUrl === SANDMAN_COVER)

  assertEquals((await (await handler(ask({ ...SANDMAN_NO_ISBN, cover: true }))).json()).coverUrl, SANDMAN_COVER)
  assertEquals(asked.length, 2)
})

Deno.test('cover: a cached miss is asked again when an id or an ISBN may find the book, not otherwise', async () => {
  const { handler, asked, store } = setup({ extra: withAbsolute })
  store.set(SANDMAN_KEY, { status: 'not_found', checkedAt: new Date(Date.parse('2026-10-04T10:00:00Z')).toISOString() })
  assertEquals((await (await handler(ask({ ...SANDMAN_NO_ISBN, cover: true }))).json()).status, 'not_found')
  assertEquals(asked.length, 0)
  const body = await (await handler(ask({ ...SANDMAN_NO_ISBN, cover: true, goodreadsBookId: '10864102' }))).json()
  assertEquals([asked.length, body.coverUrl], [1, ABSOLUTE_COVER])
  // An ISBN asks again too: its search is a new question.
  const byIsbn = setup({ extra: { [autoCompleteUrl(SANDMAN.isbn13)]: answerLike('auto-complete-sandman') } })
  byIsbn.store.set(SANDMAN_KEY, { status: 'not_found', checkedAt: new Date(Date.parse('2026-10-04T10:00:00Z')).toISOString() })
  const found = await (await byIsbn.handler(ask({ ...SANDMAN, cover: true }))).json()
  assertEquals([byIsbn.asked.length, found.status, found.goodreadsId], [1, 'found', '25102'])
})

Deno.test('cover: a rating request never tells the cover (and a refresh writes none: index.ts leaves the column alone)', async () => {
  const { handler, store, time } = setup()
  await handler(ask({ ...SANDMAN_NO_ISBN, cover: true }))
  const body = await (await handler(ask(SANDMAN_NO_ISBN))).json()
  assertEquals('coverUrl' in body, false)
  // Stale: the rating path asks again and writes an answer without a cover (the table keeps what it has).
  time.advance(MAX_AGE_MS + 1000)
  const refreshed = await (await handler(ask(SANDMAN_NO_ISBN))).json()
  assertEquals('coverUrl' in refreshed, false)
  const row = store.get(SANDMAN_KEY)
  assert(row?.status === 'found' && row.coverUrl === undefined)
})

Deno.test('cover: GET with cover=1 and goodreadsBookId; a malformed id is dropped', async () => {
  const { handler } = setup({ extra: withAbsolute })
  const url = (id: string) =>
    `http://localhost/goodreads-rating?cover=1&goodreadsBookId=${id}&title=${encodeURIComponent(SANDMAN.title)}&author=Neil%20Gaiman`
  const get = (id: string) => handler(new Request(url(id), { headers: { authorization: 'Bearer member' } }))
  assertEquals((await (await get('10864102')).json()).goodreadsId, '10864102')
  assertEquals((await (await get('1; drop')).json()).goodreadsId, '25102')
})

Deno.test('cover: GET with isbn takes the ISBN for the cover search', async () => {
  const { handler, asked } = setup({ extra: { [autoCompleteUrl(CROWN.isbn13)]: answerLike('auto-complete-crown-bones-isbn') } })
  const url = `http://localhost/goodreads-rating?cover=1&isbn=${CROWN.isbn13}&title=${encodeURIComponent(CROWN.title)}&author=${encodeURIComponent(CROWN.authors[0]!)}`
  const body = await (await handler(new Request(url, { headers: { authorization: 'Bearer member' } }))).json()
  assertEquals([asked.length, body.goodreadsId], [1, '59478256'])
})

Deno.test('cover: its own rate bucket (goodreads-cover), apart from the ratings\'', async () => {
  const counted: [string, string][] = []
  const { handler } = setup({
    throttle: (member, bucket) => {
      counted.push([member, bucket])
      return Promise.resolve(bucket !== 'goodreads-cover' || counted.filter(([, b]) => b === bucket).length <= 2)
    },
  })
  assertEquals((await handler(ask(SMALL_GODS))).status, 200)
  assertEquals((await handler(ask({ ...SANDMAN_NO_ISBN, cover: true }))).status, 200)
  assertEquals((await handler(ask({ ...SANDMAN_NO_ISBN, cover: true }))).status, 200)
  const over = await handler(ask({ ...SANDMAN_NO_ISBN, cover: true }))
  assertEquals([over.status, await over.json()], [429, { error: 'rate_limited' }])
  // The ratings' own bucket is not used up by the covers.
  assertEquals((await handler(ask(SMALL_GODS))).status, 200)
  assertEquals(counted.map(([, b]) => b), [
    'goodreads-rating',
    'goodreads-cover',
    'goodreads-cover',
    'goodreads-cover',
    'goodreads-rating',
  ])
  assertEquals(BUCKETS['goodreads-cover'], { limit: 40, windowSeconds: 60 })
  assertEquals(BUCKETS['goodreads-rating'].limit, 20)
})

Deno.test('cover: a many-search lookup is still ONE call of the member\'s bucket', async () => {
  const counted: string[] = []
  const { handler, asked } = setup({
    throttle: (_member, bucket) => {
      counted.push(bucket)
      return Promise.resolve(true)
    },
    extra: { [autoCompleteUrl(CROWN.isbn13)]: emptyList },
  })
  await handler(ask({ ...CROWN, cover: true }))
  assert(asked.length >= 3)
  assertEquals(counted, ['goodreads-cover'])
})

Deno.test('cover: Goodreads failing is a 502 and nothing is stored; a cover without a title is no Book', async () => {
  const { handler, store } = setup({ fetch: () => Promise.reject(new Error('down')) })
  assertEquals((await handler(ask({ ...SANDMAN_NO_ISBN, cover: true }))).status, 502)
  assertEquals(store.size, 0)
  assertEquals((await handler(ask({ isbn13: SMALL_GODS.isbn13, cover: true }))).status, 400)
})

// ------------------------------------------------ the cover search: ISBN first, full title, short title

const CROWN = { isbn13: '9783453321540', title: 'Crown and Bones', authors: ['Jennifer L. Armentrout'] }
const CROWN_KEY = `title:${titleKey(CROWN)}`
const CROWN_COVER = 'https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1635512998i/59478256.jpg'
const ROSES_1 = { isbn13: '9783865527127', title: 'Blood & Roses - Buch 1', authors: ['Callie Hart'] }
const ROSES_2 = { title: 'Blood & Roses - Buch 2', authors: ['Callie Hart'] }
const ROSES_3 = { isbn13: '9783865527363', title: 'Blood & Roses - Buch 3', authors: ['Callie Hart'] }
const FALL = { title: 'A Fall to Forgive', authors: ['Morgane Moncomble'] }
const JINGLE = { title: 'A Jingle Bell Mingle', authors: ['Julie Murphy'] }

const paths = (asked: { url: string }[]) => asked.map((a) => decodeURIComponent(new URL(a.url).searchParams.get('q') ?? ''))

Deno.test('cover search: the ISBN-13 is asked first and its hit ends the search (the title search ranks other books)', async () => {
  const { handler, asked, store } = setup()
  const body = await (await handler(ask({ ...CROWN, cover: true }))).json()
  assertEquals([body.status, body.goodreadsId, body.coverUrl], ['found', '59478256', CROWN_COVER])
  assertEquals(paths(asked), [CROWN.isbn13])
  // The ISBN came from the caller: it never decides what the title cache says for everybody.
  assertEquals(store.size, 0)
})

Deno.test('cover search: the same book without its ISBN is a miss, asked by its whole title and then its main title', async () => {
  const { handler, asked, store } = setup()
  const body = await (await handler(ask({ title: CROWN.title, authors: CROWN.authors, cover: true }))).json()
  assertEquals([body.status, body.goodreadsId, body.coverUrl], ['not_found', null, null])
  assertEquals(paths(asked), ['Crown and Bones Jennifer L. Armentrout', 'Crown and Bones Armentrout'])
  assertEquals(store.get(CROWN_KEY)?.status, 'not_found')
})

Deno.test('cover search: an ISBN Goodreads does not know goes on to the whole title', async () => {
  const { handler, asked } = setup({ extra: { [autoCompleteUrl(ROSES_2.title)]: emptyList } })
  // Buch 2 has no ISBN in the file: the whole title (a volume mark kept) finds it exactly.
  const body = await (await handler(ask({ ...ROSES_2, cover: true }))).json()
  assertEquals([body.status, body.goodreadsId], ['found', '45730013'])
  assertEquals(paths(asked), ['Blood & Roses - Buch 2 Callie Hart'])
  // An ISBN that answers nothing is passed over.
  const second = setup({ extra: { [autoCompleteUrl('9783865527165')]: emptyList } })
  const again = await (await second.handler(ask({ ...ROSES_2, isbn13: '9783865527165', cover: true }))).json()
  assertEquals([again.goodreadsId, paths(second.asked)], ['45730013', ['9783865527165', 'Blood & Roses - Buch 2 Callie Hart']])
})

Deno.test('cover search: Blood & Roses Buch 1 and Buch 3 are found by their ISBN, not taken for each other', async () => {
  const { handler, asked } = setup()
  const one = await (await handler(ask({ ...ROSES_1, cover: true }))).json()
  const three = await (await handler(ask({ ...ROSES_3, cover: true }))).json()
  assertEquals([one.goodreadsId, three.goodreadsId], ['42832296', '43883077'])
  assertEquals(paths(asked), [ROSES_1.isbn13, ROSES_3.isbn13])
  // Without an ISBN: Buch 3's whole title is searched; the answer for Buch 1 is not Buch 3's (nor the other way round).
  const noIsbn = setup({ extra: { [autoCompleteUrl('Blood & Roses - Buch 3 Callie Hart')]: answerLike('auto-complete-blood-roses-buch-1') } })
  const body = await (await noIsbn.handler(ask({ title: ROSES_3.title, authors: ROSES_3.authors, cover: true }))).json()
  assertEquals(body.status === 'found', false)
})

Deno.test('cover search: a title Goodreads words a little differently is found with the author (a word more, a credit after it)', async () => {
  const { handler, asked, store } = setup()
  const fall = await (await handler(ask({ ...FALL, cover: true }))).json()
  assertEquals([fall.status, fall.goodreadsId], ['found', '244201756'])
  const jingle = await (await handler(ask({ ...JINGLE, cover: true }))).json()
  // Goodreads shows its stand-in for this book: found, with no cover.
  assertEquals([jingle.status, jingle.goodreadsId, jingle.coverUrl], ['found', '253403547', null])
  assertEquals(paths(asked), ['A Fall to Forgive Morgane Moncomble', 'A Jingle Bell Mingle Julie Murphy'])
  assertEquals(store.size, 2)
  // …and only with the author: another surname is no match.
  const stranger = setup({ extra: { [autoCompleteUrl('A Fall to Forgive Anna Other')]: answerLike('auto-complete-fall-to-forgive'), [autoCompleteUrl('A Fall to Forgive Other')]: emptyList } })
  const other = await (await stranger.handler(ask({ ...FALL, authors: ['Anna Other'], cover: true }))).json()
  assertEquals(other.status, 'not_found')
})

Deno.test('cover search: the first accepted hit ends it; a miss asks the next query only', async () => {
  const { handler, asked } = setup({ extra: { [autoCompleteUrl('Blood & Roses - Buch 3 Callie Hart')]: answerLike('auto-complete-blood-roses-buch-1') } })
  // Buch 3, no ISBN: whole title (nothing accepted: Buch 1's list) then the main title (the English series: no Buch 3).
  const body = await (await handler(ask({ title: ROSES_3.title, authors: ROSES_3.authors, cover: true }))).json()
  assertEquals(body.status, 'not_found')
  assertEquals(paths(asked), ['Blood & Roses - Buch 3 Callie Hart', 'Blood & Roses Hart'])
})

// ----------------------------------------------- an empty list is not a miss

Deno.test('cover `[]`: every query answering an empty list is "unsure": retried with growing waits, never stored, never "not found"', async () => {
  const empty = { [autoCompleteUrl('Qxzvbnm Wplkjhg Ann Zzyzx')]: emptyList, [autoCompleteUrl('Qxzvbnm Wplkjhg Zzyzx')]: emptyList }
  const { handler, asked, store, time } = setup({ extra: empty })
  const response = await handler(ask({ title: NOBODY.title, authors: NOBODY.authors, cover: true }))
  assertEquals(response.status, 200)
  assertEquals(await response.json(), { status: 'unsure', retryAfterSeconds: 30 })
  // Two queries, then the first again after 1.5 s and 3 s.
  assertEquals(paths(asked), ['Qxzvbnm Wplkjhg Ann Zzyzx', 'Qxzvbnm Wplkjhg Zzyzx', 'Qxzvbnm Wplkjhg Ann Zzyzx', 'Qxzvbnm Wplkjhg Ann Zzyzx'])
  assert(time.slept.includes(1500) && time.slept.includes(3000))
  assertEquals(store.size, 0)
})

Deno.test('cover `[]`: a throttled first answer is retried and the book found', async () => {
  let calls = 0
  const full = autoCompleteUrl('A Fall to Forgive Morgane Moncomble')
  const { handler, asked, store, time } = setup({
    extra: {
      [full]: () => (++calls <= 2 ? emptyList() : answerLike('auto-complete-fall-to-forgive')()),
      [autoCompleteUrl('A Fall to Forgive Moncomble')]: emptyList,
    },
  })
  const body = await (await handler(ask({ ...FALL, cover: true }))).json()
  assertEquals([body.status, body.goodreadsId], ['found', '244201756'])
  // full (empty), short (empty), full again after 1.5 s (a list: found).
  assertEquals(paths(asked).length, 4)
  assert(time.slept.includes(1500))
  assert(store.get(`title:${titleKey(FALL)}`)?.status === 'found')
})

Deno.test('cover `[]`: a query that answered a list proves Goodreads is answering: the other `[]` is a real miss, cached', async () => {
  const { handler, asked, store } = setup({ extra: { [autoCompleteUrl('Crown and Bones Armentrout')]: emptyList } })
  // Whole title answers the English series (no match); the main title answers `[]`.
  const body = await (await handler(ask({ title: CROWN.title, authors: CROWN.authors, cover: true }))).json()
  assertEquals(body.status, 'not_found')
  assertEquals(asked.length, 2) // no retry
  assertEquals(store.get(CROWN_KEY)?.status, 'not_found')
})

Deno.test('cover `[]`: an unsure answer is asked again at the next request (nothing was cached); the retries stay inside the search budget', async () => {
  let empty = true
  const full = autoCompleteUrl('A Fall to Forgive Morgane Moncomble')
  const { handler, store, time } = setup({
    extra: {
      [full]: () => (empty ? emptyList() : answerLike('auto-complete-fall-to-forgive')()),
      [autoCompleteUrl('A Fall to Forgive Moncomble')]: () => (empty ? emptyList() : answerLike('auto-complete-fall-to-forgive')()),
    },
  })
  assertEquals((await (await handler(ask({ ...FALL, cover: true }))).json()).status, 'unsure')
  assertEquals(store.size, 0)
  // Well inside what a call may take (the client gives one 20 s).
  assert(time.now() - Date.parse('2026-10-04T10:00:00Z') <= 12_000)
  empty = false
  assertEquals((await (await handler(ask({ ...FALL, cover: true }))).json()).status, 'found')
})

Deno.test('ratings `[]`: the title search answering an empty list is "unsure", not a miss: nothing is cached for the title, and the next ask goes to Goodreads again', async () => {
  // NOBODY by title alone: the recording is `[]` (a book Goodreads does not know, or a soft throttle: the two look alike).
  const { handler, asked, store } = setup()
  const body = await (await handler(ask(NOBODY_NO_ISBN))).json()
  assertEquals(body, { status: 'unsure', retryAfterSeconds: 30 })
  assertEquals(asked.length, 1)
  assertEquals(store.size, 0)
  assertEquals((await (await handler(ask(NOBODY_NO_ISBN))).json()).status, 'unsure')
  assertEquals(asked.length, 2) // asked again: no miss was kept
})

Deno.test('ratings `[]`: an ISBN Goodreads does not know (a 404, a real miss) is stored under the ISBN; the title search behind it answering `[]` is unsure and stored nowhere', async () => {
  const { handler, asked, store } = setup()
  const body = await (await handler(ask(NOBODY))).json()
  assertEquals(body.status, 'unsure')
  assertEquals(asked.map((a) => new URL(a.url).pathname), ['/book/review_counts.json', '/book/auto_complete'])
  assertEquals(store.get(NOBODY.isbn13)?.status, 'not_found')
  assertEquals(store.has(NOBODY_KEY), false)
})

Deno.test('ratings `[]`: a list that does not hold the Book is still a miss, cached; a list that holds it is found', async () => {
  const { handler, store } = setup({ extra: NOBODY_LISTED })
  assertEquals((await (await handler(ask(NOBODY_NO_ISBN))).json()).status, 'not_found')
  assertEquals(store.get(NOBODY_KEY)?.status, 'not_found')
  const found = await (await setup().handler(ask(LEGION_NO_ISBN))).json()
  assertEquals(found.status, 'found')
})

Deno.test('cover `[]`: a 202 or an empty body is still a block (breaker), not unsure', async () => {
  const { handler, logs } = setup({ fetch: () => Promise.resolve(new Response('', { status: 202 })) })
  const body = await (await handler(ask({ ...FALL, cover: true }))).json()
  assertEquals(body.status, 'blocked')
  assertEquals(logs.filter((line) => line.startsWith('goodreads_blocked ')).length, 1)
})

// ------------------------------------------------------------------ blocked

const BLOCKS: { name: string; response: () => Response; status: number; kind: string }[] = [
  { name: '403', response: () => new Response('forbidden', { status: 403 }), status: 403, kind: 'status' },
  { name: '429', response: () => new Response('slow down', { status: 429 }), status: 429, kind: 'status' },
  { name: '503', response: () => new Response('later', { status: 503 }), status: 503, kind: 'status' },
  { name: 'a 202', response: () => new Response('', { status: 202 }), status: 202, kind: 'empty' },
  { name: 'an empty body', response: () => new Response('', { status: 200 }), status: 200, kind: 'empty' },
  { name: 'HTML', response: () => new Response('<html>robot?</html>', { status: 200 }), status: 200, kind: 'not_json' },
  { name: 'another JSON shape', response: () => new Response('{"nope":1}', { status: 200 }), status: 200, kind: 'shape' },
]

for (const block of BLOCKS) {
  for (const route of ['rating', 'cover'] as const) {
    Deno.test(`blocked: ${block.name} on the ${route} route opens the breaker for 10 minutes, one log line, nothing cached`, async () => {
      let calls = 0
      const { handler, store, time, logs } = setup({
        fetch: () => {
          calls++
          return Promise.resolve(block.response())
        },
      })
      const book = route === 'cover' ? { ...SANDMAN_NO_ISBN, cover: true } : SMALL_GODS
      const first = await handler(ask(book))
      assertEquals(first.status, 200)
      assertEquals(await first.json(), { status: 'blocked', retryAfterSeconds: 600 })
      assertEquals(store.size, 0)
      assertEquals(calls, 1)
      const lines = logs.filter((line) => line.startsWith('goodreads_blocked '))
      assertEquals(lines.length, 1)
      assertEquals(JSON.parse(lines[0]!.slice('goodreads_blocked '.length)), {
        status: block.status,
        kind: block.kind,
        at: new Date(time.now()).toISOString(),
      })

      // Open: no call, whatever the Book, the same answer, no further log line, a shrinking wait.
      time.advance(BREAKER_MS - 60_000)
      for (const other of [book, NOBODY, { ...NOBODY, cover: true }]) {
        const again = await handler(ask(other))
        assertEquals(await again.json(), { status: 'blocked', retryAfterSeconds: 60 })
      }
      assertEquals(calls, 1)
      assertEquals(logs.filter((line) => line.startsWith('goodreads_blocked ')).length, 1)
      assertEquals(store.size, 0)
    })
  }
}

Deno.test('blocked: the breaker closes after 10 minutes, Goodreads is asked again, a new block is a new line', async () => {
  let blocked = true
  const recorded = recordedFetch()
  let calls = 0
  const { handler, time, logs, store } = setup({
    fetch: (url, init) => {
      calls++
      return blocked ? Promise.resolve(new Response('no', { status: 403 })) : recorded.fetch(url, init)
    },
  })
  assertEquals((await (await handler(ask(SMALL_GODS))).json()).status, 'blocked')
  time.advance(BREAKER_MS - 1)
  assertEquals((await (await handler(ask(SMALL_GODS))).json()).status, 'blocked')
  assertEquals(calls, 1)

  time.advance(1)
  blocked = false
  const body = await (await handler(ask(SMALL_GODS))).json()
  assertEquals([body.status, body.goodreadsId], ['found', '6388978'])
  assertEquals(calls, 2)
  assertEquals(store.size, 1)

  blocked = true
  time.advance(MAX_AGE_MS + 1) // the cached rating is stale, so Goodreads is asked, and blocks again
  assertEquals((await (await handler(ask(SMALL_GODS))).json()).status, 'blocked')
  assertEquals(logs.filter((line) => line.startsWith('goodreads_blocked ')).length, 2)
})

Deno.test('blocked: a fresh cached answer is still given while the breaker is open; a plain miss and a 404 open nothing', async () => {
  let calls = 0
  let blocked = false
  const recorded = recordedFetch()
  const { handler, logs, store } = setup({
    fetch: (url, init) => {
      calls++
      return blocked ? Promise.resolve(new Response('no', { status: 403 })) : recorded.fetch(url, init)
    },
  })
  // A 404 is a miss (stored), not a block.
  assertEquals((await (await handler(ask({ isbn13: NOBODY.isbn13 }))).json()).status, 'not_found')
  assertEquals(logs, [])
  assertEquals((await (await handler(ask(SMALL_GODS))).json()).status, 'found')
  blocked = true
  assertEquals((await (await handler(ask({ ...SANDMAN_NO_ISBN, cover: true }))).json()).status, 'blocked')
  const before = calls
  assertEquals((await (await handler(ask(SMALL_GODS))).json()).status, 'found')
  assertEquals(calls, before)
  assertEquals(store.has(SANDMAN_KEY), false)
})

Deno.test('blocked: two lookups at once that both meet the block open the breaker once', async () => {
  const { handler, logs } = setup({ fetch: () => Promise.resolve(new Response('no', { status: 403 })), maxWaitMs: 5000 })
  const answers = await Promise.all([ask(SMALL_GODS), ask({ ...SANDMAN_NO_ISBN, cover: true })].map(async (r) => (await handler(r)).json()))
  assertEquals(answers.map((a) => a.status), ['blocked', 'blocked'])
  assertEquals(logs.filter((line) => line.startsWith('goodreads_blocked ')).length, 1)
})

Deno.test('blocked: our own busy and a plain failure (500) are not blocks', async () => {
  const failing = setup({ fetch: () => Promise.resolve(new Response('upstream', { status: 500 })) })
  assertEquals((await failing.handler(ask(SMALL_GODS))).status, 502)
  assertEquals(failing.logs.filter((line) => line.startsWith('goodreads_blocked ')).length, 0)
  assertEquals((await failing.handler(ask(SMALL_GODS))).status, 502) // asked again, no breaker
})
