import { assert, assertEquals } from '@std/assert'
import { createGoogleBooksClient } from './client.ts'
import {
  BREAKER_MS,
  createHandler,
  DAILY_BUDGET,
  IMPORT_BUDGET,
  MAX_FOUND_TTL_SECONDS,
  MEMBER_BUDGET,
  MISS_TTL_SECONDS,
  onlyLanguage,
  rankedBy,
  ttlSeconds,
} from './handler.ts'
import { fakeClock, ISBN_DE, ISBN_HIT, ISBN_MISS, memoryBudget, memoryCache, memoryCatalogue, post, recordedFetch, TEST_KEY } from './test_support.ts'

function setup(options: { key?: string | undefined; member?: string | null; budgetUsed?: number; extra?: Parameters<typeof recordedFetch>[0]; fallback?: number; throttle?: (member: string, budget: unknown) => Promise<boolean> } = {}) {
  const clock = fakeClock()
  const upstream = recordedFetch(options.extra)
  const { cache, rows } = memoryCache(clock)
  const budget = memoryBudget(options.budgetUsed ?? 0)
  const { catalogue, books } = memoryCatalogue()
  const logs: string[] = []
  const throttled: { member: string; budget: unknown }[] = []
  const handler = createHandler({
    google: createGoogleBooksClient({ fetch: upstream.fetch, apiKey: () => ('key' in options ? options.key : TEST_KEY) }),
    cache,
    catalogue,
    budget: (limit) => budget.take(limit),
    configured: () => Boolean(('key' in options ? options.key : TEST_KEY)?.trim()),
    authorize: (request) => Promise.resolve(request.headers.get('authorization') === 'Bearer member' ? { member: options.member === undefined ? 'ida' : options.member } : request.headers.get('apikey') === 'service' ? { member: null } : null),
    throttle: options.throttle ?? ((member, b) => (throttled.push({ member, budget: b }), Promise.resolve(true))),
    fallbackTtlSeconds: options.fallback === undefined ? undefined : () => options.fallback!,
    now: clock.now,
    log: (message) => logs.push(message),
  })
  const call = async (body: unknown, headers: Record<string, string> = { authorization: 'Bearer member' }) => {
    const response = await handler(post(body, headers))
    return { status: response.status, body: await response.json() }
  }
  return { call, upstream, rows, budget, books, logs, clock, throttled }
}

Deno.test('who may ask: a member or the service role, nobody else; bodies are bounded', async () => {
  const { call, upstream } = setup()
  assertEquals((await call({ action: 'isbn', isbn13: ISBN_HIT }, {})).status, 401)
  assertEquals((await call({ action: 'isbn', isbn13: ISBN_HIT }, { authorization: 'Bearer nobody' })).status, 401)
  assertEquals((await call({ action: 'isbn', isbn13: ISBN_HIT }, { apikey: 'service' })).status, 200)
  assertEquals((await call({ action: 'isbn', isbn13: '123' })).body, { error: 'isbn_invalid' })
  assertEquals((await call({ action: 'nope' })).body, { error: 'action_unknown' })
  assertEquals((await call({ action: 'search' })).body, { error: 'book_unidentified' })
  assertEquals((await call({ action: 'search', query: 'x'.repeat(5000) })).status, 413)
  assertEquals(upstream.asked.length, 1)
})

Deno.test('an ISBN: found, then answered from the cache; a miss is cached too', async () => {
  const { call, upstream, rows, budget } = setup()
  const first = await call({ action: 'isbn', isbn13: ISBN_HIT })
  assertEquals(first.body.status, 'found')
  assertEquals(first.body.volume.title, 'Das Leuchten der Nordsee')
  assert(!JSON.stringify(first.body).includes('blurb'))
  const again = await call({ action: 'isbn', isbn13: ISBN_HIT })
  assertEquals(again.body, first.body)
  assertEquals(upstream.asked.length, 1, 'the second ask costs nothing')
  assertEquals(budget.state.used, 1)
  assert(rows.has(`isbn:${ISBN_HIT}`))

  assertEquals((await call({ action: 'isbn', isbn13: ISBN_MISS })).body, { status: 'not_found' })
  assertEquals((await call({ action: 'isbn', isbn13: ISBN_MISS })).body, { status: 'not_found' })
  assertEquals(upstream.asked.length, 2)
  assertEquals(rows.get(`isbn:${ISBN_MISS}`)!.ttlSeconds, MISS_TTL_SECONDS, 'a miss is kept briefly')
})

Deno.test('the lifetime of a copy: Google\'s max-age (at most a day), none for no-store, the fallback when it says nothing', () => {
  assertEquals(ttlSeconds('found', 'public, max-age=600'), 600)
  assertEquals(ttlSeconds('found', 'public, max-age=999999'), MAX_FOUND_TTL_SECONDS)
  assertEquals(ttlSeconds('found', 'no-store'), 0)
  assertEquals(ttlSeconds('found', 'private, no-store, max-age=600'), 0)
  assertEquals(ttlSeconds('found', 'private, max-age=0'), 3600)
  assertEquals(ttlSeconds('found', null), 3600)
  assertEquals(ttlSeconds('found', 'private', 0), 0, 'the operator can keep nothing that states no lifetime')
  assertEquals(ttlSeconds('found', 'private', 10 ** 9), MAX_FOUND_TTL_SECONDS)
  assertEquals(ttlSeconds('not_found', 'no-store'), MISS_TTL_SECONDS, 'a miss is our own finding')
})

Deno.test('an answer is kept as long as its Cache-Control allows, and an expired copy is never answered', async () => {
  const { call, upstream, rows, clock } = setup()
  assertEquals((await call({ action: 'isbn', isbn13: ISBN_HIT })).body.status, 'found')
  // `private, max-age=0`: no stated lifetime, so the one-hour fallback.
  assertEquals(rows.get(`isbn:${ISBN_HIT}`)!.ttlSeconds, 3600)
  clock.advance(59 * 60 * 1000)
  await call({ action: 'isbn', isbn13: ISBN_HIT })
  assertEquals(upstream.asked.length, 1)
  clock.advance(2 * 60 * 1000)
  await call({ action: 'isbn', isbn13: ISBN_HIT })
  assertEquals(upstream.asked.length, 2, 'past its time the row is asked again')
})

Deno.test('fallback 0 keeps no copy of an answer that states no lifetime', async () => {
  const { call, rows, upstream } = setup({ fallback: 0 })
  await call({ action: 'isbn', isbn13: ISBN_HIT })
  await call({ action: 'isbn', isbn13: ISBN_HIT })
  assertEquals(rows.size, 0)
  assertEquals(upstream.asked.length, 2)
})

Deno.test('no key: "unavailable", nothing asked, nothing counted, nothing stored, no error', async () => {
  const { call, upstream, budget, rows, logs } = setup({ key: undefined })
  for (const body of [{ action: 'isbn', isbn13: ISBN_HIT }, { action: 'search', title: 'Der stille Hafen', authors: ['Ida Beispiel'] }, { action: 'book', isbn13: ISBN_HIT }]) {
    const answer = await call(body)
    assertEquals([answer.status, answer.body], [200, { status: 'unavailable', reason: 'not_configured' }])
  }
  assertEquals(upstream.asked, [])
  // Not counted either: the day's counter is for requests that go out.
  assertEquals(budget.state.used, 0)
  assertEquals(rows.size, 0)
  assertEquals(logs, [])
})

Deno.test('the daily budget: past 900 the function answers "unavailable" and asks Google nothing', async () => {
  const { call, upstream, logs } = setup({ budgetUsed: DAILY_BUDGET })
  const answer = await call({ action: 'isbn', isbn13: ISBN_HIT })
  assertEquals(answer.body, { status: 'unavailable', reason: 'budget' })
  assertEquals(upstream.asked, [])
  await call({ action: 'isbn', isbn13: ISBN_MISS })
  assertEquals(logs.filter((line) => line.startsWith('google_books_budget_spent')).length, 1, 'one line a day, not one per call')
})

Deno.test('a cached answer is still given when the budget is spent', async () => {
  const { call, budget } = setup()
  await call({ action: 'isbn', isbn13: ISBN_HIT })
  budget.state.used = DAILY_BUDGET
  assertEquals((await call({ action: 'isbn', isbn13: ISBN_HIT })).body.status, 'found')
})

Deno.test('the budget counts one request per lookup: two asks at once share one', async () => {
  const { call, budget, upstream } = setup()
  const [a, b] = await Promise.all([call({ action: 'isbn', isbn13: ISBN_HIT }), call({ action: 'isbn', isbn13: ISBN_HIT })])
  assertEquals(a.body, b.body)
  assertEquals([budget.state.used, upstream.asked.length], [1, 1])
})

Deno.test('a refusal opens the breaker for ten minutes: one log line, no request meanwhile, never stored', async () => {
  const { call, upstream, logs, clock, rows } = setup()
  const refused = await call({ action: 'isbn', isbn13: '9791034567911' })
  assertEquals(refused.body, { status: 'unavailable', reason: 'blocked' })
  assertEquals(logs.length, 1)
  assert(logs[0]!.startsWith('google_books_blocked {"status":429'))
  assert(!logs.join('\n').includes(TEST_KEY))
  assertEquals((await call({ action: 'isbn', isbn13: ISBN_HIT })).body, { status: 'unavailable', reason: 'blocked' })
  assertEquals(upstream.asked.length, 1)
  assertEquals(rows.size, 0)
  clock.advance(BREAKER_MS + 1)
  assertEquals((await call({ action: 'isbn', isbn13: ISBN_HIT })).body.status, 'found')
})

Deno.test('Google failing is "unavailable"/error and is not stored; the next call tries again', async () => {
  const { call, rows, upstream } = setup()
  assertEquals((await call({ action: 'isbn', isbn13: '9791034567928' })).body, { status: 'unavailable', reason: 'error' })
  assertEquals((await call({ action: 'isbn', isbn13: '9791034567928' })).body, { status: 'unavailable', reason: 'error' })
  assertEquals(rows.size, 0)
  assertEquals(upstream.asked.length, 2)
})

Deno.test('search by title and author: one request, the member\'s languages first, a cache on the question', async () => {
  const { call, upstream, rows } = setup()
  const body = { action: 'search', title: 'Der stille Hafen', authors: ['Ida Beispiel'], languages: ['en-US', 'de-DE'] }
  const first = await call(body)
  assertEquals(first.body.status, 'ok')
  // Two languages: no langRestrict, the English volume is ordered first.
  assertEquals(first.body.volumes.map((volume: { language: string }) => volume.language), ['en', 'de', 'de', 'de', 'fr'])
  assertEquals(new URL(upstream.asked[0]!.url).searchParams.get('langRestrict'), null)
  assertEquals((await call({ ...body, languages: ['de'] })).status, 200)
  assertEquals(upstream.asked.length, 2, 'a question in one language is another question')
  assertEquals(new URL(upstream.asked[1]!.url).searchParams.get('langRestrict'), 'de')
  await call(body)
  assertEquals(upstream.asked.length, 2)
  assert([...rows.keys()].every((key) => key.startsWith('title:der stille hafen|ida beispiel|')))
  // Max-age from Google is respected (public, max-age=600).
  assertEquals(rows.get('title:der stille hafen|ida beispiel|')!.ttlSeconds, 600)
})

Deno.test('free words are one question; an empty answer is "ok" with no volumes', async () => {
  const { call, upstream } = setup()
  const found = await call({ action: 'search', query: 'stille hafen beispiel' })
  assertEquals(found.body.status, 'ok')
  assertEquals(found.body.volumes.length, 5)
  assertEquals(new URL(upstream.asked[0]!.url).searchParams.get('q'), 'stille hafen beispiel')
})

Deno.test('a member is held to her bucket, an import to its own, the service role to none', async () => {
  const { call, throttled } = setup()
  await call({ action: 'isbn', isbn13: ISBN_HIT })
  await call({ action: 'isbn', isbn13: ISBN_HIT, purpose: 'import' })
  await call({ action: 'isbn', isbn13: ISBN_HIT }, { apikey: 'service' })
  assertEquals(throttled, [{ member: 'ida', budget: MEMBER_BUDGET }, { member: 'ida', budget: IMPORT_BUDGET }])
  const limited = setup({ throttle: () => Promise.resolve(false) })
  const answer = await limited.call({ action: 'isbn', isbn13: ISBN_HIT })
  assertEquals([answer.status, answer.body], [429, { error: 'rate_limited' }])
  assertEquals(limited.upstream.asked, [])
})

Deno.test('book: an existing Catalogue Book first; else made from what Google says, never from what the caller sends', async () => {
  const { call, books, upstream } = setup()
  const made = await call({ action: 'book', isbn13: ISBN_HIT, title: 'Forged', cover: { coverUrl: 'https://evil.example/x.jpg' } })
  assertEquals(made.body.status, 'found')
  assertEquals(made.body.book.title, 'Das Leuchten der Nordsee')
  assertEquals(made.body.book.source, 'import')
  assertEquals(made.body.book.cover_url, 'https://books.google.com/books/content?id=ZZhit0001AAA&printsec=frontcover&img=1&zoom=1&source=gbs_api')
  assertEquals(books.length, 1)
  const again = await call({ action: 'book', isbn13: ISBN_HIT })
  assertEquals(again.body.book.id, made.body.book.id)
  assertEquals(upstream.asked.length, 1)
  assertEquals((await call({ action: 'book', isbn13: ISBN_MISS })).body, { status: 'not_found' })
})

Deno.test('book: an edition without authors is not made', async () => {
  const noAuthor = JSON.stringify({ items: [{ id: 'ZZnoauth1', volumeInfo: { title: 'Hafenlichter', industryIdentifiers: [{ type: 'ISBN_13', identifier: ISBN_DE }] } }] })
  const { call, books } = setup({ extra: { [`https://www.googleapis.com/books/v1/volumes?${new URLSearchParams({ q: `isbn:${ISBN_DE}`, maxResults: '10', printType: 'books', fields: 'items(id,volumeInfo(title,authors,publisher,publishedDate,industryIdentifiers,pageCount,categories,language,imageLinks/thumbnail))' })}`]: () => new Response(noAuthor) } })
  assertEquals((await call({ action: 'book', isbn13: ISBN_DE })).body, { status: 'not_found' })
  assertEquals(books.length, 0)
})

Deno.test('language helpers', () => {
  assertEquals(onlyLanguage(['de-DE']), 'de')
  assertEquals(onlyLanguage(['de-DE', 'de']), 'de')
  assertEquals(onlyLanguage(['de-DE', 'en']), null)
  assertEquals(onlyLanguage([]), null)
  const volumes = [{ language: 'en' }, { language: null }, { language: 'de' }, { language: 'fr' }] as never[]
  assertEquals(rankedBy(volumes, ['de', 'en']).map((v: { language: string | null }) => v.language), ['de', 'en', null, 'fr'])
})
