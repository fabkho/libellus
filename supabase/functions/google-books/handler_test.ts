import { assert, assertEquals } from '@std/assert'
import { isbnQuery, volumesUrl } from '../../../web/app/data/googleBooksRecord.ts'
import { createGoogleBooksClient } from './client.ts'
import {
  BREAKER_MS,
  createHandler,
  DAILY_BUDGET,
  ENRICH_DAILY_BUDGET,
  MAX_FOUND_TTL_SECONDS,
  MEMBER_BUDGET,
  MEMBER_DAILY_LIMIT,
  MISS_TTL_SECONDS,
  onlyLanguage,
  rankedBy,
  ttlSeconds,
} from './handler.ts'
import { fixture, fakeClock, ISBN_DE, ISBN_HIT, ISBN_MISS, memoryBudget, memoryCache, memoryCatalogue, post, recordedFetch, TEST_KEY } from './test_support.ts'

function setup(options: { key?: string | undefined; member?: string | null; budgetUsed?: number; memberDayLimit?: number; extra?: Parameters<typeof recordedFetch>[0]; fallback?: number; throttle?: (member: string, budget: unknown) => Promise<boolean> } = {}) {
  const clock = fakeClock()
  const upstream = recordedFetch(options.extra)
  const { cache, rows } = memoryCache(clock)
  const budget = memoryBudget(options.budgetUsed ?? 0)
  const { catalogue, books } = memoryCatalogue()
  const logs: string[] = []
  const throttled: { member: string; budget: unknown }[] = []
  const daily: Record<string, number> = {}
  const handler = createHandler({
    google: createGoogleBooksClient({ fetch: upstream.fetch, apiKey: () => ('key' in options ? options.key : TEST_KEY) }),
    cache,
    catalogue,
    budget: (limit, slice) => budget.take(limit, slice),
    memberDay: (member) => {
      daily[member] = (daily[member] ?? 0) + 1
      return Promise.resolve(daily[member]! <= (options.memberDayLimit ?? MEMBER_DAILY_LIMIT))
    },
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
  return { call, upstream, rows, budget, books, logs, clock, throttled, daily }
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

Deno.test('the lifetime of a copy, by each form of Cache-Control: only what the header allows, at most a day', () => {
  // A stated lifetime.
  assertEquals(ttlSeconds('found', 'public, max-age=600'), 600)
  assertEquals(ttlSeconds('found', 'max-age=600'), 600)
  assertEquals(ttlSeconds('found', 'PUBLIC, Max-Age=600'), 600)
  assertEquals(ttlSeconds('found', 'public, max-age=999999'), MAX_FOUND_TTL_SECONDS)
  assertEquals(ttlSeconds('found', 'public, max-age=86400'), MAX_FOUND_TTL_SECONDS)
  // s-maxage (a shared cache's lifetime) wins over max-age; both spellings are read right.
  assertEquals(ttlSeconds('found', 'public, s-maxage=300'), 300)
  assertEquals(ttlSeconds('found', 'public, max-age=600, s-maxage=120'), 120)
  assertEquals(ttlSeconds('found', 'public, s-maxage=0, max-age=600'), 0)
  // Nothing may be kept.
  for (const header of ['no-store', 'no-cache', 'private', 'private, max-age=0', 'private, max-age=600', 'public, max-age=0', 'max-age=0', 's-maxage=0', 'no-cache, max-age=600', 'private, no-store, max-age=600', 'no-cache="set-cookie", max-age=600', 'must-revalidate, no-transform, max-age=0']) {
    assertEquals(ttlSeconds('found', header), 0, header)
  }
  // A header that states no lifetime allows no copy either.
  assertEquals(ttlSeconds('found', 'public'), 0)
  assertEquals(ttlSeconds('found', 'must-revalidate'), 0)
  assertEquals(ttlSeconds('found', 'x-private-thing, max-age=600'), 600, 'a word that only contains "private" is not "private"')
  // No header at all: the one case the fallback applies to (an hour, the operator's word, never more than a day).
  assertEquals(ttlSeconds('found', null), 3600)
  assertEquals(ttlSeconds('found', ''), 3600)
  assertEquals(ttlSeconds('found', null, 0), 0, 'the operator can keep nothing of those')
  assertEquals(ttlSeconds('found', null, 10 ** 9), MAX_FOUND_TTL_SECONDS)
  assertEquals(ttlSeconds('found', 'private', 10 ** 9), 0, 'the fallback never rescues a header that forbids the copy')
  // A miss is our own finding.
  assertEquals(ttlSeconds('not_found', 'no-store'), MISS_TTL_SECONDS)
})

Deno.test('a header that allows no copy keeps no row, whatever the fallback says', async () => {
  const url = volumesUrl(isbnQuery(ISBN_HIT))
  for (const header of ['private, max-age=0', 'no-cache', 'no-store', 'max-age=0']) {
    const extra = { [url]: () => new Response(fixture('isbn-hit'), { headers: { 'cache-control': header } }) }
    const { call, rows, upstream } = setup({ extra })
    assertEquals((await call({ action: 'isbn', isbn13: ISBN_HIT })).body.status, 'found', header)
    await call({ action: 'isbn', isbn13: ISBN_HIT })
    assertEquals([rows.size, upstream.asked.length], [0, 2], header)
  }
})

Deno.test('an answer is kept as long as its Cache-Control allows, and an expired copy is never answered', async () => {
  const { call, upstream, rows, clock } = setup()
  assertEquals((await call({ action: 'isbn', isbn13: ISBN_HIT })).body.status, 'found')
  // No Cache-Control at all: the one-hour fallback.
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

Deno.test('a member is held to her bucket whatever she declares as her purpose, the service role to none', async () => {
  const { call, throttled } = setup()
  await call({ action: 'isbn', isbn13: ISBN_HIT })
  await call({ action: 'isbn', isbn13: ISBN_HIT, purpose: 'import' })
  await call({ action: 'isbn', isbn13: ISBN_HIT, purpose: 'enrich' })
  await call({ action: 'isbn', isbn13: ISBN_HIT }, { apikey: 'service' })
  assertEquals(throttled, [{ member: 'ida', budget: MEMBER_BUDGET }, { member: 'ida', budget: MEMBER_BUDGET }, { member: 'ida', budget: MEMBER_BUDGET }])
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

Deno.test('a 400 is the request\'s own error: no breaker; only a bad key (400 keyInvalid), 401, 403 and 429 open it', async () => {
  const url = (isbn: string) => volumesUrl(isbnQuery(isbn))
  const perRequest = JSON.stringify({ error: { code: 400, message: 'Invalid value', errors: [{ reason: 'invalid' }] } })
  const badKey = JSON.stringify({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', errors: [{ reason: 'keyInvalid' }] } })
  const { call, upstream, logs } = setup({
    extra: {
      [url(ISBN_HIT)]: () => new Response(perRequest, { status: 400 }),
      [url(ISBN_MISS)]: () => new Response(badKey, { status: 400 }),
    },
  })
  assertEquals((await call({ action: 'isbn', isbn13: ISBN_HIT })).body, { status: 'unavailable', reason: 'error' })
  assertEquals(logs.filter((line) => line.startsWith('google_books_blocked')), [], 'a 400 opens nothing')
  // The next member's question still goes out.
  assertEquals((await call({ action: 'isbn', isbn13: ISBN_DE })).body.status !== undefined, true)
  assertEquals(upstream.asked.length, 2)
  // A bad key is everybody's problem.
  assertEquals((await call({ action: 'isbn', isbn13: ISBN_MISS })).body, { status: 'unavailable', reason: 'blocked' })
  assertEquals(logs.filter((line) => line.startsWith('google_books_blocked {"status":400')).length, 1)
})

Deno.test('401 and 403 open the breaker like 429; a 5xx does not', async () => {
  for (const [status, blocked] of [[401, true], [403, true], [429, true], [500, false], [503, false]] as const) {
    const { call, logs } = setup({ extra: { [volumesUrl(isbnQuery(ISBN_HIT))]: () => new Response('{}', { status }) } })
    await call({ action: 'isbn', isbn13: ISBN_HIT })
    assertEquals(logs.some((line) => line.startsWith('google_books_blocked')), blocked, String(status))
  }
})

Deno.test('only two-letter codes of a short list reach Google as langRestrict', async () => {
  for (const [languages, expected] of [
    [['de'], 'de'], [['de-DE'], 'de'], [['DE'], 'de'],
    [['xx'], null], [['de;drop'], null], [['d'], null], [['../../x'], null], [[''], null], [['zz', 'de'], 'de'], [['de', 'en'], null],
  ] as [string[], string | null][]) {
    const { call, upstream } = setup()
    await call({ action: 'search', query: 'stille hafen beispiel', languages })
    assertEquals(new URL(upstream.asked[0]!.url).searchParams.get('langRestrict'), expected, JSON.stringify(languages))
  }
  // Not a list of text: ignored.
  const { call, upstream } = setup()
  await call({ action: 'search', query: 'stille hafen beispiel', languages: [3, null, { a: 1 }] })
  assertEquals(new URL(upstream.asked[0]!.url).searchParams.get('langRestrict'), null)
})

Deno.test('a member has a day of her own: past it only a cached answer is given; the service role has none', async () => {
  const { call, upstream, budget, daily } = setup({ memberDayLimit: 2 })
  assertEquals((await call({ action: 'isbn', isbn13: ISBN_HIT })).body.status, 'found')
  assertEquals((await call({ action: 'isbn', isbn13: ISBN_MISS })).body.status, 'not_found')
  // Her third lookup would go out to Google: refused, and the day's budget is not spent on it.
  assertEquals((await call({ action: 'isbn', isbn13: ISBN_DE })).body, { status: 'unavailable', reason: 'budget' })
  assertEquals([upstream.asked.length, budget.state.used], [2, 2])
  // A cached answer costs her nothing (her counter is not touched).
  assertEquals((await call({ action: 'isbn', isbn13: ISBN_HIT })).body.status, 'found')
  assertEquals(daily.ida, 3)
  // Another member has her own.
  const other = setup({ member: 'max', memberDayLimit: 2 })
  assertEquals((await other.call({ action: 'isbn', isbn13: ISBN_HIT })).body.status, 'found')
  // The service role is not counted per member.
  const service = setup({ memberDayLimit: 0 })
  assertEquals((await service.call({ action: 'isbn', isbn13: ISBN_HIT }, { apikey: 'service' })).body.status, 'found')
  assertEquals(service.daily, {})
  assert(MEMBER_DAILY_LIMIT === 60)
})

Deno.test('one member cannot spend the day\'s budget: 60 requests are her day, 900 the whole', async () => {
  const { call, budget } = setup()
  for (let i = 0; i < 70; i++) await call({ action: 'search', query: `unique words number ${i}` }).catch(() => null)
  // The recording knows none of those questions: each failed before counting nothing more than her own day.
  assertEquals(budget.state.used, MEMBER_DAILY_LIMIT)
})

Deno.test('enrich has a slice of the day: it stops quietly when the slice is gone, and members keep the rest', async () => {
  const { call, budget, upstream } = setup()
  const service = { apikey: 'service' }
  assertEquals((await call({ action: 'isbn', isbn13: ISBN_HIT, purpose: 'enrich' }, service)).body.status, 'found')
  assertEquals(budget.state.calls[0], { limit: DAILY_BUDGET, slice: { scope: 'enrich', limit: ENRICH_DAILY_BUDGET } })
  assertEquals(ENRICH_DAILY_BUDGET, 300)
  // The slice is spent (300 of the 900): enrich is refused, nothing goes out, nothing is thrown.
  budget.state.slices.enrich = ENRICH_DAILY_BUDGET
  const before = upstream.asked.length
  assertEquals((await call({ action: 'isbn', isbn13: ISBN_MISS, purpose: 'enrich' }, service)).body, { status: 'unavailable', reason: 'budget' })
  assertEquals(upstream.asked.length, before)
  // A member, and the import job (no purpose), still have the rest of the day.
  assertEquals((await call({ action: 'isbn', isbn13: ISBN_MISS })).body, { status: 'not_found' })
  assertEquals((await call({ action: 'isbn', isbn13: ISBN_DE }, service)).body.reason !== 'budget', true)
  // A member declaring "enrich" is a member: no slice for her.
  const memberCalls = budget.state.calls.filter((c) => !c.slice).length
  await call({ action: 'isbn', isbn13: '9791034567911', purpose: 'enrich' })
  assertEquals(budget.state.calls.filter((c) => !c.slice).length, memberCalls + 1)
})

Deno.test('the budget log line names the Pacific day, once, and the slice', async () => {
  // 2026-11-06 03:00 UTC is still 5 November in Pacific time.
  const { call, logs, clock } = setup({ budgetUsed: DAILY_BUDGET })
  clock.advance(Date.parse('2026-11-06T03:00:00Z') - clock.now())
  await call({ action: 'isbn', isbn13: ISBN_HIT })
  await call({ action: 'isbn', isbn13: ISBN_MISS })
  const lines = logs.filter((line) => line.startsWith('google_books_budget_spent'))
  assertEquals(lines.length, 1)
  assertEquals(JSON.parse(lines[0]!.slice('google_books_budget_spent '.length)), { limit: DAILY_BUDGET, scope: 'all', day: '2026-11-05' })
})

Deno.test('a question of nothing but punctuation is never sent, and no key of the cache is logged', async () => {
  const { call, upstream, logs } = setup()
  for (const body of [{ action: 'search', query: '???' }, { action: 'search', query: '  "  ' }, { action: 'search', title: '!!!', authors: ['Ida'] }, { action: 'search', query: '…' }]) {
    assertEquals((await call(body)).body, { error: 'book_unidentified' }, JSON.stringify(body))
  }
  assertEquals(upstream.asked, [])
  // A failure that is not Google's names no question.
  const failing = setup({ extra: { [volumesUrl('geheime woerter')]: () => Promise.reject(new TypeError('boom')) } })
  await failing.call({ action: 'search', query: 'geheime woerter' })
  assert(failing.logs.every((line) => !line.includes('geheime')), failing.logs.join('|'))
  assert(logs.every((line) => !line.includes('geheime')))
})

Deno.test('Google is never followed through a redirect: the key header cannot be forwarded', async () => {
  const { call, upstream } = setup()
  await call({ action: 'isbn', isbn13: ISBN_HIT })
  assertEquals(upstream.asked.map((a) => a.redirect), ['error'])
})
