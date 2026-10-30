import { assert, assertEquals } from '@std/assert'
import { PaceBusy } from '../_shared/pace.ts'
import { allowedHost, createFetcher, KEYED_HOLD_MS, MAX_BYTES, MAX_HOPS } from './fetch.ts'
import { APPLE_BASE, fakePace, fixture, image, jpegOf, OL_L, redirect, status, web } from './test_support.ts'

const UA = 'Libellus/1.0 (test@example.com)'
const APPLE_L = `${APPLE_BASE}/600x900bb.webp`

function fetcherOver(routes: Parameters<typeof web>[0], options: { timeoutMs?: number; maxBytes?: number } = {}) {
  const hosts = web(routes)
  const keyed = fakePace()
  const id = fakePace()
  const logged: string[] = []
  const fetcher = createFetcher({ fetch: hosts.fetch, userAgent: UA, paces: { keyed: keyed.pace, id: id.pace }, log: (m) => logged.push(m), ...options })
  return { fetcher, hosts, keyed, id, logged }
}

Deno.test('a cover is fetched identified, with manual redirects, and its bytes are checked by magic bytes', async () => {
  const { fetcher, hosts } = fetcherOver({ [APPLE_L]: image(fixture('apple-600x900.webp'), 'image/webp') })
  const got = await fetcher.get(APPLE_L)
  assert(got.ok)
  assertEquals([got.info.kind, got.info.width, got.redirects], ['webp', 568, []])
  assertEquals(hosts.requests[0]!.headers.get('user-agent'), UA)
  assertEquals(hosts.requests[0]!.redirect, 'manual')
})

Deno.test('the Content-Type is not believed: HTML under an image type is not_image', async () => {
  const html = () => new Response('<html>blocked</html>', { headers: { 'content-type': 'image/jpeg' } })
  assertEquals(await fetcherOver({ [APPLE_L]: html }).fetcher.get(APPLE_L), { ok: false, kind: 'not_image' })
  // ... and an image under a text type is an image.
  const got = await fetcherOver({ [APPLE_L]: image(fixture('ol-L.jpg'), 'text/plain') }).fetcher.get(APPLE_L)
  assertEquals(got.ok, true)
})

Deno.test('redirects: followed by hand up to 3 hops, each on the allowlist, https and no port', async () => {
  const start = 'https://covers.openlibrary.org/b/id/1-L.jpg?default=false'
  const ok = fetcherOver({
    [start]: redirect('https://archive.org/download/a/b.zip/0000000001-L.jpg'),
    'https://archive.org/download/a/b.zip/0000000001-L.jpg': redirect('https://ia800409.us.archive.org/view_archive.php?file=0000000001-L.jpg'),
    'https://ia800409.us.archive.org/view_archive.php?file=0000000001-L.jpg': image(fixture('ol-L.jpg')),
  })
  const got = await ok.fetcher.get(start)
  assert(got.ok)
  assertEquals(got.redirects, ['https://archive.org/download/a/b.zip/0000000001-L.jpg', 'https://ia800409.us.archive.org/view_archive.php?file=0000000001-L.jpg'])

  // A relative Location is resolved against the hop.
  const relative = fetcherOver({ [APPLE_L]: redirect('/other.webp'), 'https://is1-ssl.mzstatic.com/other.webp': image(fixture('apple-120x180.webp')) })
  assertEquals((await relative.fetcher.get(APPLE_L)).ok, true)

  // Off the allowlist, plain http, a port, credentials, an IP literal, a look-alike: host_error, and nothing is requested there.
  for (const location of [
    'https://evil.example/x.jpg',
    'http://archive.org/x.jpg',
    'https://archive.org:8443/x.jpg',
    'https://user:pw@archive.org/x.jpg',
    'https://169.254.169.254/latest/meta-data',
    'https://archive.org.evil.example/x.jpg',
    'https://evilarchive.org/x.jpg',
    'https://notmzstatic.com/x.jpg',
    'https://localhost/x.jpg',
  ]) {
    const refused = fetcherOver({ [APPLE_L]: redirect(location) })
    assertEquals(await refused.fetcher.get(APPLE_L), { ok: false, kind: 'host_error' }, location)
    assertEquals(refused.hosts.urls(), [APPLE_L], location)
  }

  // Too many hops (MAX_HOPS redirects are followed, one more is refused), and a redirect without a Location.
  const hops = (count: number) => {
    const routes: Parameters<typeof web>[0] = {}
    for (let index = 0; index < count; index++) routes[`https://archive.org/h${index}`] = redirect(`https://archive.org/h${index + 1}`)
    routes[`https://archive.org/h${count}`] = image(fixture('ol-L.jpg'))
    return fetcherOver(routes)
  }
  assertEquals((await hops(MAX_HOPS).fetcher.get('https://archive.org/h0')).ok, true)
  assertEquals(await hops(MAX_HOPS + 1).fetcher.get('https://archive.org/h0'), { ok: false, kind: 'host_error' })
  assertEquals(await fetcherOver({ [APPLE_L]: status(302) }).fetcher.get(APPLE_L), { ok: false, kind: 'host_error' })
})

Deno.test('a start address off the allowlist is never requested', async () => {
  const world = fetcherOver({})
  assertEquals(await world.fetcher.get('https://example.com/c.jpg'), { ok: false, kind: 'host_error' })
  assertEquals(await world.fetcher.get('http://covers.openlibrary.org/b/id/1-L.jpg'), { ok: false, kind: 'host_error' })
  assertEquals(world.hosts.urls(), [])
  assert(allowedHost('is2-ssl.mzstatic.com') && allowedHost('covers.openlibrary.org') && allowedHost('ia1.us.archive.org'))
  assert(!allowedHost('mzstatic.com') && !allowedHost('openlibrary.org') && !allowedHost('gr-assets.com'))
})

Deno.test('statuses: 404/410 are gone; 5xx, 401 and the rest are host_error; a body that is cut is host_error', async () => {
  assertEquals((await fetcherOver({ [APPLE_L]: status(404) }).fetcher.get(APPLE_L)).ok, false)
  assertEquals(await fetcherOver({ [APPLE_L]: status(404) }).fetcher.get(APPLE_L), { ok: false, kind: 'gone' })
  assertEquals(await fetcherOver({ [APPLE_L]: status(410) }).fetcher.get(APPLE_L), { ok: false, kind: 'gone' })
  for (const code of [500, 502, 503, 401, 403, 429, 204]) {
    assertEquals(await fetcherOver({ [APPLE_L]: status(code) }).fetcher.get(APPLE_L), { ok: false, kind: 'host_error' }, String(code))
  }
  const broken = () => new Response(new ReadableStream({ start: (c) => c.error(new TypeError('connection reset')) }))
  assertEquals(await fetcherOver({ [APPLE_L]: broken }).fetcher.get(APPLE_L), { ok: false, kind: 'host_error' })
})

Deno.test('a request that does not answer in time is a timeout (and so is a run that is told to stop)', async () => {
  const never = (_input: string, init: RequestInit) =>
    new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)))
  const keyed = fakePace()
  const slow = createFetcher({ fetch: never, userAgent: UA, paces: { keyed: keyed.pace, id: keyed.pace }, timeoutMs: 20 })
  assertEquals(await slow.get(APPLE_L), { ok: false, kind: 'timeout' })
  const stop = new AbortController()
  const stopped = createFetcher({ fetch: never, userAgent: UA, paces: { keyed: keyed.pace, id: keyed.pace }, timeoutMs: 60_000 })
  const pending = stopped.get(APPLE_L, { signal: stop.signal })
  stop.abort()
  assertEquals(await pending, { ok: false, kind: 'timeout' })
  // A network error that is not a timeout.
  const down = createFetcher({ fetch: () => Promise.reject(new TypeError('dns')), userAgent: UA, paces: { keyed: keyed.pace, id: keyed.pace } })
  assertEquals(await down.get(APPLE_L), { ok: false, kind: 'host_error' })
})

Deno.test('more than 2 MB is too_large, by Content-Length or by counting the stream', async () => {
  const big = new Uint8Array(MAX_BYTES + 1)
  big.set(fixture('ol-L.jpg'))
  assertEquals(await fetcherOver({ [APPLE_L]: image(big) }).fetcher.get(APPLE_L), { ok: false, kind: 'too_large' })
  const stream = () => new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(512 * 1024)) } }), { headers: { 'content-type': 'image/jpeg' } })
  assertEquals(await fetcherOver({ [APPLE_L]: stream }).fetcher.get(APPLE_L), { ok: false, kind: 'too_large' })
  const small = fetcherOver({ [APPLE_L]: image(fixture('ol-L.jpg')) }, { maxBytes: 100 })
  assertEquals(await small.fetcher.get(APPLE_L), { ok: false, kind: 'too_large' })
})

Deno.test('a GIF (Open Library\'s 1 x 1 placeholder) or an image under 16 px on a side is gone', async () => {
  const gif = Uint8Array.from([...new TextEncoder().encode('GIF89a'), 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0x3b])
  assertEquals(await fetcherOver({ [OL_L]: image(gif, 'image/gif') }).fetcher.get(OL_L), { ok: false, kind: 'gone' })
  assertEquals(await fetcherOver({ [OL_L]: image(jpegOf(15, 400)) }).fetcher.get(OL_L), { ok: false, kind: 'gone' })
  assertEquals(await fetcherOver({ [OL_L]: image(jpegOf(400, 15)) }).fetcher.get(OL_L), { ok: false, kind: 'gone' })
  assertEquals((await fetcherOver({ [OL_L]: image(jpegOf(16, 16)) }).fetcher.get(OL_L)).ok, true)
})

Deno.test('Open Library: 403 is retry-later (throttled), never gone; a keyed 403 holds the keyed pace and stops the run\'s keyed asks', async () => {
  const keyedUrl = 'https://covers.openlibrary.org/b/isbn/9780000000002-L.jpg?default=false'
  const world = fetcherOver({ [keyedUrl]: status(403), 'https://covers.openlibrary.org/b/id/1-L.jpg?default=false': status(403) })
  assertEquals(await world.fetcher.get(keyedUrl), { ok: false, kind: 'throttled' })
  assertEquals(world.keyed.state.held, [KEYED_HOLD_MS])
  assertEquals(world.keyed.state.taken, 1)
  // The next keyed ask of the run is not made at all.
  assertEquals(await world.fetcher.get('https://covers.openlibrary.org/b/isbn/9780000000019-L.jpg?default=false'), { ok: false, kind: 'throttled' })
  assertEquals(world.hosts.urls(), [keyedUrl])
  // An id cover answered 403 is throttled too, and holds nothing.
  assertEquals(await world.fetcher.get('https://covers.openlibrary.org/b/id/1-L.jpg?default=false'), { ok: false, kind: 'throttled' })
  assertEquals(world.keyed.state.held, [KEYED_HOLD_MS])
  assertEquals(await fetcherOver({ [OL_L]: status(429) }).fetcher.get(OL_L), { ok: false, kind: 'throttled' })
  // Other hosts' 403 is an error, not a rate limit.
  assertEquals(await fetcherOver({ [APPLE_L]: status(403) }).fetcher.get(APPLE_L), { ok: false, kind: 'host_error' })
})

Deno.test('Open Library: keyed covers wait on the keyed pace, id covers on the id pace, others on none; a turn too far away is throttled', async () => {
  const world = fetcherOver({
    'https://covers.openlibrary.org/b/isbn/1-L.jpg?default=false': image(fixture('ol-L.jpg')),
    'https://covers.openlibrary.org/b/oclc/2-L.jpg?default=false': image(fixture('ol-L.jpg')),
    'https://covers.openlibrary.org/b/lccn/3-L.jpg?default=false': image(fixture('ol-L.jpg')),
    'https://covers.openlibrary.org/b/id/4-L.jpg?default=false': image(fixture('ol-L.jpg')),
    'https://covers.openlibrary.org/b/olid/OL5M-L.jpg?default=false': image(fixture('ol-L.jpg')),
    [APPLE_L]: image(fixture('apple-600x900.webp')),
  })
  for (const url of ['https://covers.openlibrary.org/b/isbn/1-L.jpg?default=false', 'https://covers.openlibrary.org/b/oclc/2-L.jpg?default=false',
    'https://covers.openlibrary.org/b/lccn/3-L.jpg?default=false', 'https://covers.openlibrary.org/b/id/4-L.jpg?default=false',
    'https://covers.openlibrary.org/b/olid/OL5M-L.jpg?default=false', APPLE_L]) await world.fetcher.get(url)
  assertEquals([world.keyed.state.taken, world.id.state.taken], [3, 2])

  const busy = {
    take: () => Promise.reject(new PaceBusy(60)),
    hold: () => Promise.resolve(),
  }
  const hosts = web({ [OL_L]: image(fixture('ol-L.jpg')) })
  const waiting = createFetcher({ fetch: hosts.fetch, userAgent: UA, paces: { keyed: busy, id: busy } })
  assertEquals(await waiting.get(OL_L), { ok: false, kind: 'throttled' })
  assertEquals(hosts.urls(), [])
})
