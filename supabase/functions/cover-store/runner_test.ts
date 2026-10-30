import { assert, assertEquals } from '@std/assert'
import { createFetcher } from './fetch.ts'
import { coverKey } from './key.ts'
import { createR2 } from './r2.ts'
import { CONCURRENCY, RUN_LIMIT, runCoverStore, type RunnerDeps, type RunResult } from './runner.ts'
import type { Done } from './store.ts'
import { thumbBudget } from './thumb.ts'
import {
  APPLE_BASE, APPLE_PROBE, APPLE_REAL_WIDTHS, APPLE_URL, APPLE_VARIANTS, coverRoutes, fakePace, fakeS3, fakeStore, fixture, GOODREADS_URL, image, jpegOf,
  OL_L, OL_M, OPENLIBRARY_ID_URL, redirect, REGAL_URL, row, SECRET, status, web,
} from './test_support.ts'

type World = {
  rows: ReturnType<typeof row>[]
  routes?: Parameters<typeof coverRoutes>[0]
  cas?: (done: Done) => boolean
  deleting?: Set<string>
  s3?: Parameters<typeof fakeS3>[0]
  hosts?: RunnerDeps['hosts']
  concurrency?: number
  budget?: RunnerDeps['budget']
  deadlineMs?: number
  claimDelayMs?: number
}

/** One run over a queue of leased Books, the hosts' web, an S3, the database's RPCs and the pace, all stand-ins. */
async function run(options: World) {
  const hosts = web(coverRoutes(options.routes))
  const s3 = fakeS3(options.s3)
  const { store, calls } = fakeStore(options.rows, { cas: options.cas, deleting: options.deleting, claimDelayMs: options.claimDelayMs })
  const keyed = fakePace()
  const id = fakePace()
  const logged: string[] = []
  const log = (message: string) => logged.push(message)
  const fetcher = createFetcher({ fetch: hosts.fetch, userAgent: 'Libellus/1.0 (test)', paces: { keyed: keyed.pace, id: id.pace }, log })
  const r2 = createR2({ accountId: 'acct', accessKeyId: 'AKIAFAKE', secretAccessKey: 'fake', fetch: s3.fetch })
  const result = await runCoverStore({
    store, fetcher, r2, keySecret: SECRET, runner: 'fn:test', log, hosts: options.hosts,
    concurrency: options.concurrency, budget: options.budget, deadlineMs: options.deadlineMs,
  })
  return { result, hosts, s3, calls, keyed, id, logged }
}

const failedWith = (calls: ReturnType<typeof fakeStore>['calls']) => calls.failed.map((failure) => failure.reason)

Deno.test('Apple: four variants at their real widths, the key from the largest only, one upload each, thumbhash from the 66x100 probe', async () => {
  const world = await run({ rows: [row(1, APPLE_URL)] })
  const key = await coverKey(SECRET, fixture('apple-600x900.webp'))

  // The largest first, then the others, then the probe.
  assertEquals(world.hosts.urls(), [...Object.keys(APPLE_VARIANTS), APPLE_PROBE])
  assertEquals([...world.s3.objects.keys()].sort(), APPLE_REAL_WIDTHS.map((width) => `c/${key}/${width}`).sort())
  for (const width of APPLE_REAL_WIDTHS) assertEquals(world.s3.objects.get(`c/${key}/${width}`)?.contentType, 'image/webp')
  assertEquals(world.s3.objects.get(`c/${key}/568`)?.bytes, fixture('apple-600x900.webp'))

  assertEquals(world.calls.reserved, [key])
  assertEquals(world.calls.done.length, 1)
  const done = world.calls.done[0]!
  assertEquals([done.book, done.sourceUrl, done.key, done.widths, done.contentType], [row(1, APPLE_URL).book_id, APPLE_URL, key, APPLE_REAL_WIDTHS, 'image/webp'])
  assertEquals(done.bytes, ['120x180', '240x360', '360x540', '600x900'].reduce((sum, size) => sum + fixture(`apple-${size}.webp`).length, 0))
  assert(done.thumbhash && done.thumbhash.length >= 20)
  assert(/^#[0-9a-f]{6}$/.test(done.dominant ?? '') && /^#[0-9a-f]{6}$/.test(done.secondary ?? ''))
  assertEquals(world.result, { ...world.result, state: 'ran', claimed: 1, stored: 1, failed: 0, throttled: 0, deferred: 0, gone: 0, unsupported: 0, stale: 0 })
  assertEquals(world.calls.failed, [])
  assertEquals(world.calls.kicks, 1)
})

Deno.test('the key comes from the largest variant only: the smaller ones never change it', async () => {
  const plain = await run({ rows: [row(1, APPLE_URL)] })
  const other = await run({
    rows: [row(1, APPLE_URL)],
    routes: { [`${APPLE_BASE}/360x540bb.webp`]: image(fixture('apple-120x180.webp'), 'image/webp'), [`${APPLE_BASE}/120x180bb.webp`]: image(fixture('ol-S.jpg')) },
  })
  assertEquals(other.calls.done[0]!.key, plain.calls.done[0]!.key)
  // ... and different largest bytes are a different key.
  const largest = await run({ rows: [row(1, APPLE_URL)], routes: { [`${APPLE_BASE}/600x900bb.webp`]: image(fixture('apple-360x540.webp'), 'image/webp') } })
  assert(largest.calls.done[0]!.key !== plain.calls.done[0]!.key)
})

Deno.test('Open Library by cover id: -L (a redirect to archive.org followed by hand) then -M, JPEG, real widths; the -M bytes make the thumbhash', async () => {
  const world = await run({ rows: [row(1, OPENLIBRARY_ID_URL)] })
  const key = await coverKey(SECRET, fixture('ol-L.jpg'))
  assertEquals(world.hosts.urls(), [OL_L, 'https://archive.org/download/l_covers_0008/l_covers_0008_23.zip/0008231856-L.jpg', OL_M])
  assertEquals([...world.s3.objects.keys()].sort(), [`c/${key}/180`, `c/${key}/337`])
  assertEquals(world.s3.objects.get(`c/${key}/337`)?.contentType, 'image/jpeg')
  assertEquals(world.calls.done[0]!.widths, [180, 337])
  assert(world.calls.done[0]!.thumbhash)
  assertEquals([world.id.state.taken, world.keyed.state.taken], [2, 0])
})

Deno.test('Open Library by ISBN: the first redirect names the cover id, so the second size is asked by id (one keyed request, not two)', async () => {
  const keyedL = 'https://covers.openlibrary.org/b/isbn/9780441172719-L.jpg?default=false'
  const world = await run({
    rows: [row(1, 'https://covers.openlibrary.org/b/isbn/9780441172719-L.jpg')],
    routes: { [keyedL]: redirect('https://archive.org/download/l_covers_0008/l_covers_0008_23.zip/0008231856-L.jpg') },
  })
  assertEquals(world.hosts.urls(), [keyedL, 'https://archive.org/download/l_covers_0008/l_covers_0008_23.zip/0008231856-L.jpg', OL_M])
  assertEquals([world.keyed.state.taken, world.id.state.taken], [1, 1])
  assertEquals(world.calls.done[0]!.widths, [180, 337])
})

Deno.test('Open Library by ISBN that answers the image directly (no redirect names an id): both sizes are keyed requests', async () => {
  const keyedL = 'https://covers.openlibrary.org/b/isbn/9780441172719-L.jpg?default=false'
  const keyedM = 'https://covers.openlibrary.org/b/isbn/9780441172719-M.jpg?default=false'
  const world = await run({
    rows: [row(1, 'https://covers.openlibrary.org/b/isbn/9780441172719-L.jpg')],
    routes: { [keyedL]: image(fixture('ol-L.jpg')), [keyedM]: image(fixture('ol-M.jpg')) },
  })
  assertEquals(world.hosts.urls(), [keyedL, keyedM])
  assertEquals([world.keyed.state.taken, world.id.state.taken], [2, 0])
  assertEquals(world.calls.done[0]!.widths, [180, 337])
})

Deno.test('Open Library: a -M of the same width as the -L is stored once', async () => {
  const world = await run({ rows: [row(1, OPENLIBRARY_ID_URL)], routes: { [OL_M]: image(fixture('ol-L.jpg')) } })
  assertEquals(world.s3.puts.length, 1)
  assertEquals(world.calls.done[0]!.widths, [337])
  assertEquals(world.calls.done[0]!.bytes, fixture('ol-L.jpg').length)
})

Deno.test('Open Library: a -M that is not there (404) is skipped, the -L is stored', async () => {
  const world = await run({ rows: [row(1, OPENLIBRARY_ID_URL)], routes: { [OL_M]: status(404) } })
  assertEquals(world.calls.done[0]!.widths, [337])
  assertEquals(world.result.stored, 1)
})

Deno.test('Goodreads and Regal: the one image the address names, at its real width, no other request', async () => {
  const goodreads = await run({ rows: [row(1, GOODREADS_URL)] })
  assertEquals(goodreads.hosts.urls(), [GOODREADS_URL])
  assertEquals(goodreads.calls.done[0]!.widths, [318])
  assertEquals(goodreads.calls.done[0]!.contentType, 'image/jpeg')
  assert(goodreads.calls.done[0]!.thumbhash)
  assertEquals(goodreads.s3.puts.length, 1)

  const regal = await run({ rows: [row(1, REGAL_URL)] })
  assertEquals(regal.hosts.urls(), [REGAL_URL])
  assertEquals(regal.calls.done[0]!.widths, [318])
})

Deno.test('two Books with the same key: one upload, both Books done with it (a lent cover)', async () => {
  // Another address of the same Apple artwork (another size) and a second Book with the very same address.
  const world = await run({ rows: [row(1, APPLE_URL), row(2, `${APPLE_BASE}/100x100bb.jpg`), row(3, APPLE_URL)] })
  assertEquals(world.s3.puts.length, 4)
  assertEquals(world.calls.reserved.length, 3)
  assertEquals(new Set(world.calls.reserved).size, 1)
  assertEquals(world.calls.done.map((done) => done.key), Array(3).fill(world.calls.reserved[0]))
  assertEquals(world.calls.done.map((done) => done.widths), Array(3).fill(APPLE_REAL_WIDTHS))
  // The probe is fetched once for the three, the variants once.
  assertEquals(world.hosts.urls().filter((url) => url === APPLE_PROBE).length, 1)
  assertEquals(world.hosts.urls().filter((url) => url.endsWith('360x540bb.webp')).length, 1)
  assertEquals(world.result.stored, 3)
})

Deno.test('reserve refused (GC is deleting the key): nothing is uploaded, the row is booked again as deleting', async () => {
  const key = await coverKey(SECRET, fixture('apple-600x900.webp'))
  const world = await run({ rows: [row(1, APPLE_URL)], deleting: new Set([key]) })
  assertEquals(world.s3.puts, [])
  assertEquals(world.calls.done, [])
  assertEquals(world.calls.failed, [{ book: row(1, APPLE_URL).book_id, runner: 'fn:test', reason: 'deleting' }])
  assertEquals([world.result.stored, world.result.throttled], [0, 1])
  // The smaller variants were not even fetched.
  assertEquals(world.hosts.urls(), [`${APPLE_BASE}/600x900bb.webp`])
})

Deno.test('compare-and-swap miss (the cover changed meanwhile): the copy stays for the key, the row is booked again, counted as stale', async () => {
  const world = await run({ rows: [row(1, APPLE_URL)], cas: () => false })
  assertEquals(world.s3.puts.length, 4)
  assertEquals(failedWith(world.calls), ['deleting'])
  assertEquals([world.result.stored, world.result.stale, world.result.throttled], [0, 1, 0])
})

Deno.test('every failure kind is booked with its reason, nothing is stored, and no upload happens before the key is reserved', async () => {
  const big = new Uint8Array(2 * 1024 * 1024 + 1)
  big.set(fixture('ol-L.jpg'))
  const gif = Uint8Array.from([...new TextEncoder().encode('GIF89a'), 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0x3b])
  const largestApple = `${APPLE_BASE}/600x900bb.webp`
  const cases: [string, string, Parameters<typeof coverRoutes>[0], string][] = [
    ['Apple 404', APPLE_URL, { [largestApple]: status(404) }, 'gone'],
    ['Open Library 404 (?default=false: no cover)', OPENLIBRARY_ID_URL, { [OL_L]: status(404) }, 'gone'],
    ['Open Library GIF placeholder', OPENLIBRARY_ID_URL, { [OL_L]: image(gif, 'image/gif') }, 'gone'],
    ['tiny image', OPENLIBRARY_ID_URL, { [OL_L]: image(jpegOf(8, 12)) }, 'gone'],
    ['Open Library 403', OPENLIBRARY_ID_URL, { [OL_L]: status(403) }, 'throttled'],
    ['Open Library keyed 403', 'https://covers.openlibrary.org/b/isbn/9780000000002-L.jpg', { 'https://covers.openlibrary.org/b/isbn/9780000000002-L.jpg?default=false': status(403) }, 'throttled'],
    ['server error', APPLE_URL, { [largestApple]: status(503) }, 'host_error'],
    ['redirect off the allowlist', APPLE_URL, { [largestApple]: redirect('https://evil.example/c.webp') }, 'host_error'],
    ['redirect to the metadata address', OPENLIBRARY_ID_URL, { [OL_L]: redirect('http://169.254.169.254/latest/meta-data/') }, 'host_error'],
    ['HTML instead of an image', GOODREADS_URL, { [GOODREADS_URL]: image(new TextEncoder().encode('<html>captcha</html>')) }, 'not_image'],
    ['too large', GOODREADS_URL, { [GOODREADS_URL]: image(big) }, 'too_large'],
    ['wider than 2000 px', GOODREADS_URL, { [GOODREADS_URL]: image(jpegOf(2400, 3000)) }, 'too_large'],
    ['unsupported Apple address', 'https://is1-ssl.mzstatic.com/image/thumb/x/cover.jpg', {}, 'unsupported_url'],
    ['another host', 'https://example.com/cover.jpg', {}, 'unsupported_url'],
  ]
  for (const [name, url, routes, reason] of cases) {
    const world = await run({ rows: [row(1, url)], routes })
    assertEquals(failedWith(world.calls), [reason], name)
    assertEquals([world.s3.puts, world.calls.reserved, world.calls.done], [[], [], []], name)
    assertEquals(world.result.stored, 0, name)
  }
})

Deno.test('a failure after the key is reserved (a smaller variant, R2) books the Book again; nothing is marked done', async () => {
  const smaller = await run({ rows: [row(1, APPLE_URL)], routes: { [`${APPLE_BASE}/240x360bb.webp`]: status(500) } })
  assertEquals(failedWith(smaller.calls), ['host_error'])
  assertEquals([smaller.s3.puts, smaller.calls.done], [[], []]) // the PUTs start after every variant is in hand

  const timedOut = await run({ rows: [row(1, APPLE_URL)], routes: { [`${APPLE_BASE}/120x180bb.webp`]: () => { throw new DOMException('t', 'TimeoutError') } } })
  assertEquals(failedWith(timedOut.calls), ['timeout'])

  const r2 = await run({ rows: [row(1, APPLE_URL)], s3: { fail: () => 500 } })
  assertEquals(failedWith(r2.calls), ['r2_error'])
  assertEquals(r2.calls.done, [])
  assertEquals(r2.result.failed, 1)
})

Deno.test('Goodreads: at most 2 Books a run that need their thumbhash; the third is not fetched and is left for the next run', async () => {
  const urls = [1, 2, 3].map((n) => `https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/${n}i/${n}.jpg`)
  const routes = Object.fromEntries(urls.map((url, index) => [url, image(index === 0 ? fixture('goodreads.jpg') : fixture('goodreads-100.jpg'))]))
  const world = await run({ rows: urls.map((url, index) => row(index + 1, url)), routes })
  assertEquals(world.result.stored, 2)
  assertEquals(world.calls.failed, [])
  assertEquals(world.calls.released, [{ book: row(3, urls[2]!).book_id, runner: 'fn:test' }])
  assertEquals(world.hosts.urls().sort(), [urls[0], urls[1]].sort())
  assertEquals([world.result.deferred, world.result.throttled], [1, 0])

  // A Goodreads Book that already has its thumbhash costs no decode: not capped.
  const known = await run({ rows: urls.map((url, index) => row(index + 1, url, { thumbhash: false })), routes })
  assertEquals([known.result.stored, known.calls.done.map((done) => done.thumbhash)], [3, [null, null, null]])
})

Deno.test('the thumbhash is made only when the Book has none: no probe is fetched and no decode is spent otherwise', async () => {
  let clock = 0
  const budget = thumbBudget({ now: () => (clock += 10) })
  const world = await run({ rows: [row(1, APPLE_URL, { thumbhash: false })], budget })
  assertEquals(world.hosts.urls(), Object.keys(APPLE_VARIANTS))
  assertEquals([world.calls.done[0]!.thumbhash, world.calls.done[0]!.dominant, world.calls.done[0]!.secondary], [null, undefined, undefined])
  assertEquals(budget.spentMs(), 0)
  assertEquals(world.result.stored, 1)
})

Deno.test('the decode budget (500 ms): once spent, no Book that needs a thumbhash is started, and the rest stay queued', async () => {
  let clock = 0
  const budget = thumbBudget({ now: () => clock })
  // The first decode takes 600 ms (the fake clock moves while it runs).
  const slow = { ...budget, measure: <T>(decode: () => T) => budget.measure(() => (clock += 600, decode())) }
  const world = await run({
    rows: [row(1, APPLE_URL), row(2, OPENLIBRARY_ID_URL), row(3, GOODREADS_URL)],
    concurrency: 1,
    budget: slow,
  })
  assertEquals(world.result.stored, 1)
  assertEquals(world.calls.failed, [])
  assertEquals(world.calls.released.map((left) => left.book), [row(2, OPENLIBRARY_ID_URL).book_id, row(3, GOODREADS_URL).book_id])
  // Nothing was fetched for the two it refused.
  assertEquals(world.hosts.urls().filter((url) => !url.includes('mzstatic')), [])
  assert(budget.spentMs() >= 500)
})

Deno.test('the decode budget, checked again at the decode: Books admitted together, the second finds it spent after the copy is uploaded', async () => {
  let clock = 0
  const budget = thumbBudget({ now: () => clock })
  const slow = { ...budget, measure: <T>(decode: () => T) => budget.measure(() => (clock += 600, decode())) }
  const world = await run({ rows: [row(1, APPLE_URL), row(2, OPENLIBRARY_ID_URL)], concurrency: 2, budget: slow })
  assertEquals([world.result.stored, world.result.deferred], [1, 1])
  assertEquals(world.calls.done.length, 1)
  assertEquals(world.calls.released.length, 1)
})

Deno.test('a thumbhash probe that fails now is tried again with the Book; one that is not there is stored without', async () => {
  const flaky = await run({ rows: [row(1, APPLE_URL)], routes: { [APPLE_PROBE]: status(503) } })
  assertEquals(failedWith(flaky.calls), ['host_error'])
  assertEquals(flaky.calls.done, [])

  const missing = await run({ rows: [row(1, APPLE_URL)], routes: { [APPLE_PROBE]: status(404) } })
  assertEquals(missing.result.stored, 1)
  assertEquals(missing.calls.done[0]!.thumbhash, null)

  // Not a JPEG (Regal's image is a WebP): stored without a thumbhash, not failed.
  const webp = await run({ rows: [row(1, REGAL_URL)], routes: { [REGAL_URL]: image(fixture('apple-120x180.webp'), 'image/webp') } })
  assertEquals([webp.result.stored, webp.calls.done[0]!.thumbhash], [1, null])
})

Deno.test('a run leases 8 Books, works 4 at a time, kicks the next run, and logs counts and Book ids only', async () => {
  assertEquals([RUN_LIMIT, CONCURRENCY], [8, 4])
  const rows = Array.from({ length: 10 }, (_, index) => row(index + 1, GOODREADS_URL.replace('187957173', String(index)), { thumbhash: false }))
  const routes = Object.fromEntries(rows.map((r) => [r.source_url, image(fixture('goodreads-100.jpg'))]))
  const world = await run({ rows, routes })
  assertEquals(world.calls.claims, [{ runner: 'fn:test', limit: 8 }])
  assertEquals(world.result.claimed, 8)
  assertEquals(world.hosts.peak(), 4)
  assertEquals(world.result.stored, 8)
  assertEquals(world.calls.kicks, 1)
  assertEquals(world.result.kick, 'idle')
  const line = world.logged.find((message) => message.startsWith('cover-store: run '))!
  assert(/stored=8 failed=0 throttled=0 deferred=0 gone=0 unsupported=0 stale=0 ms=\d+ decode_ms=\d+$/.test(line), line)
})

Deno.test('an empty queue is idle: no request, no kick, no log line', async () => {
  const world = await run({ rows: [] })
  assertEquals(world.result, { state: 'idle', claimed: 0, stored: 0, failed: 0, throttled: 0, deferred: 0, gone: 0, unsupported: 0, stale: 0, ms: world.result.ms })
  assertEquals([world.hosts.urls(), world.calls.kicks, world.logged], [[], 0, []])
})

Deno.test('logs: a Book id and an error kind, never an address, a title or a key', async () => {
  const secretUrl = 'https://is1-ssl.mzstatic.com/image/thumb/Publication/PRIVATE-TITLE.jpg/600x900bb.jpg'
  const world = await run({
    rows: [row(1, secretUrl), row(2, 'https://example.com/PRIVATE-TITLE.jpg'), row(3, OPENLIBRARY_ID_URL), row(4, APPLE_URL)],
    routes: { [OL_L]: status(403) },
    s3: { fail: () => 500 },
  })
  assert(world.logged.length > 0)
  for (const message of world.logged) {
    assert(!/PRIVATE|mzstatic|openlibrary|https?:/i.test(message), message)
    assert(!/[0-9a-f]{32}/.test(message.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '')), message)
  }
  assert(world.logged.some((message) => message.includes(row(2, '').book_id) && message.includes('unsupported_url')))
})

Deno.test('a call to the database that fails after the work does not lose the others', async () => {
  const hosts = web(coverRoutes())
  const { store, calls } = fakeStore([row(1, APPLE_URL), row(2, GOODREADS_URL)])
  let reserves = 0
  const flaky = { ...store, reserve: (key: string) => (++reserves === 1 ? Promise.reject(new Error('db down')) : store.reserve(key)) }
  const keyed = fakePace()
  const s3 = fakeS3()
  const logged: string[] = []
  const result: RunResult = await runCoverStore({
    store: flaky,
    fetcher: createFetcher({ fetch: hosts.fetch, userAgent: 'x', paces: { keyed: keyed.pace, id: keyed.pace }, log: () => {} }),
    r2: createR2({ accountId: 'a', accessKeyId: 'k', secretAccessKey: 's', fetch: s3.fetch }),
    keySecret: SECRET, runner: 'fn:test', concurrency: 1, log: (message) => logged.push(message),
  })
  assertEquals([result.stored, result.failed], [1, 1])
  assertEquals(failedWith(calls), ['host_error'])
})

Deno.test('past the run\'s deadline the Books not started are left for the next run (released, no attempt counted), with no request', async () => {
  const world = await run({ rows: [row(1, APPLE_URL), row(2, GOODREADS_URL), row(3, OPENLIBRARY_ID_URL)], deadlineMs: 5, claimDelayMs: 30, concurrency: 1 })
  assertEquals(world.hosts.urls(), [])
  assertEquals(world.calls.failed, [])
  assertEquals(world.calls.released.map((left) => left.book), [1, 2, 3].map((n) => row(n, '').book_id))
  assertEquals([world.result.deferred, world.result.stored, world.result.failed], [3, 0, 0])
})
