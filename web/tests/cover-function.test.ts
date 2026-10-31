import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// The Pages Function itself, as Cloudflare loads it: plain ESM, driven with a context the test builds
// (docs/HOSTING.md, "The cover cache"). The host is stood in for by `fetch`, the cache by a Map.
import { onRequest } from '../functions/cover.js'

/**
 * `/cover?u=<cover URL>&w=<width>` (functions/cover.js): an allowlist of two hosts' covers, sized by the
 * app's own rule, kept in Cloudflare's Cache API for good and sent with CORS. No network: the hosts and the
 * cache are mocks, so what is checked is what the Function asks, stores and says.
 */

const SITE = 'https://libellus.fabkho.dev'
const APPLE = 'https://is1-ssl.mzstatic.com/image/thumb/Publication221/v4/c8/bf/b3/c8bf/9780593983768.d.jpg/600x900bb.jpg'
const OL = 'https://covers.openlibrary.org/b/id/8231856-L.jpg'
const HARDCOVER = 'https://assets.hardcover.app/edition/30524155/2d30ac0e2eb1f4cd0ea3a93b5cd8a1fa1a63e0e.jpeg'
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])

/** The Cache API's `default` cache, as a Map by address (put copies the response, match hands one back). */
function cacheStub() {
  const entries = new Map<string, { body: ArrayBuffer; init: ResponseInit }>()
  return {
    entries,
    match: vi.fn(async (request: Request) => {
      const stored = entries.get(request.url)
      return stored ? new Response(stored.body.slice(0), stored.init) : undefined
    }),
    put: vi.fn(async (request: Request, response: Response) => {
      entries.set(request.url, { body: await response.arrayBuffer(), init: { status: response.status, headers: [...response.headers] } })
    }),
  }
}

const hostAnswers = (bytes: Uint8Array = JPEG, init: ResponseInit & { url?: string } = {}) => {
  const { url, ...rest } = init
  const response = new Response(bytes, { status: 200, headers: { 'Content-Type': 'image/jpeg' }, ...rest })
  if (url) Object.defineProperty(response, 'url', { value: url })
  return response
}

type Waited = Promise<unknown>[]
function call(query: string, method = 'GET', headers: Record<string, string> = {}, env: Record<string, string> = {}) {
  const waited: Waited = []
  const request = new Request(`${SITE}/cover${query}`, { method, headers })
  const promise = onRequest({ request, env, waitUntil: (p: Promise<unknown>) => void waited.push(p) } as never)
  return { promise, settled: async () => { const response = await promise; await Promise.all(waited); return response } }
}
const ask = (u: string, w: string | number) => `?${new URLSearchParams({ u, w: String(w) })}`

let cache: ReturnType<typeof cacheStub>
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  cache = cacheStub()
  vi.stubGlobal('caches', { default: cache })
  fetchMock = vi.fn(async () => hostAnswers())
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('the allowlist', () => {
  it.each([
    ['no address', ''],
    ['another host', ask('https://example.com/a.jpg', 240)],
    ['an internal address', ask('http://169.254.169.254/latest/meta-data', 240)],
    ['a look-alike host', ask('https://covers.openlibrary.org.evil.test/b/id/1-L.jpg', 240)],
    ['a path of the host that is no cover', ask('https://covers.openlibrary.org/a/olid/OL1A-L.jpg', 240)],
    ['a host over plain http', ask(APPLE.replace('https', 'http'), 240)],
    ['a look-alike of Hardcover\'s host', ask('https://assets.hardcover.app.evil.test/edition/1/a.jpeg', 240)],
    ['another Hardcover host', ask('https://cdn.hardcover.app/edition/1/a.jpeg', 240)],
    ['Hardcover\'s host over plain http', ask(HARDCOVER.replace('https', 'http'), 240)],
    ['a Hardcover address with a query', ask(`${HARDCOVER}?x=1`, 240)],
    ['a width it does not list', ask(APPLE, 300)],
    ['no width', `?u=${encodeURIComponent(APPLE)}`],
  ])('asks no host and says 400 for %s', async (_, query) => {
    const response = await call(query).settled()
    expect(response.status).toBe(400)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(cache.put).not.toHaveBeenCalled()
  })

  it('answers GET and HEAD only', async () => {
    expect((await call(ask(APPLE, 240), 'POST').settled()).status).toBe(405)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('a cover not in the cache yet', () => {
  it('is fetched at the size asked for, from the one host, once', async () => {
    const response = await call(ask(APPLE, 240)).settled()
    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![0]).toBe(APPLE.replace('600x900bb', '240x360bb'))
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(JPEG)
  })

  it('goes out for this app\'s pages to read, for a year, as the image it is', async () => {
    const response = await call(ask(OL, 240), 'GET', { Origin: SITE }).settled()
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(SITE)
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    expect(response.headers.get('Content-Type')).toBe('image/jpeg')
    expect(response.headers.get('Cross-Origin-Resource-Policy')).toBe('same-site')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('X-Cover-Cache')).toBe('miss')
    expect(response.headers.has('x-cover-stored-at')).toBe(false)
    expect(fetchMock.mock.calls[0]![0]).toBe(OL)
  })

  it('is fetched from Hardcover\'s host as the one image its address names, whatever the width', async () => {
    const response = await call(ask(HARDCOVER, 480)).settled()
    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![0]).toBe(HARDCOVER)
    await call(ask(HARDCOVER, 120)).settled()
    expect(fetchMock.mock.calls.every(([source]) => source === HARDCOVER)).toBe(true)
  })

  it('is put in the cache under the sized address, with the headers of a cover that never changes', async () => {
    await call(ask(APPLE, 240)).settled()
    expect(cache.put).toHaveBeenCalledTimes(1)
    const [key, stored] = cache.put.mock.calls[0]!
    expect(new URL(key.url).searchParams.get('v')).toBe(APPLE.replace('600x900bb', '240x360bb'))
    expect(stored.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    expect(stored.headers.has('Access-Control-Allow-Origin'), 'CORS is the asker\'s, not the stored copy\'s').toBe(false)
  })

  it('is one entry for the two spellings of the cover at a width', async () => {
    await call(ask(APPLE, 240)).settled()
    await call(ask(APPLE.replace('600x900bb', '120x180bb'), 240)).settled()
    expect(cache.entries.size).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('a cover in the cache', () => {
  it('comes from it and asks no host', async () => {
    await call(ask(APPLE, 240)).settled()
    fetchMock.mockClear()
    const response = await call(ask(APPLE, 240), 'GET', { Origin: SITE }).settled()
    expect(response.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(response.headers.get('X-Cover-Cache')).toBe('hit')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(SITE)
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    expect(response.headers.has('x-cover-stored-at')).toBe(false)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(JPEG)
  })

  it('is another entry at another width', async () => {
    await call(ask(APPLE, 240)).settled()
    await call(ask(APPLE, 480)).settled()
    expect(cache.entries.size).toBe(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  describe('older than a month', () => {
    const MONTH = 31 * 24 * 60 * 60 * 1000
    const age = () => {
      const key = [...cache.entries.keys()][0]!
      const stored = cache.entries.get(key)!
      const headers = new Headers(stored.init.headers)
      headers.set('x-cover-stored-at', String(Date.now() - MONTH))
      cache.entries.set(key, { ...stored, init: { ...stored.init, headers } })
    }

    it('is served as it is and fetched again behind the answer (stale-while-revalidate)', async () => {
      await call(ask(APPLE, 240)).settled()
      age()
      fetchMock.mockClear()
      fetchMock.mockImplementation(async () => hostAnswers(new Uint8Array([0xff, 0xd8, 9, 9])))
      const { promise, settled } = call(ask(APPLE, 240))
      const response = await promise
      expect(response.headers.get('X-Cover-Cache')).toBe('stale')
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(JPEG)
      await settled()
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const key = [...cache.entries.keys()][0]!
      expect(new Uint8Array(cache.entries.get(key)!.body)).toEqual(new Uint8Array([0xff, 0xd8, 9, 9]))
    })

    it('stays served when the host is down, and is not asked again by every request meanwhile', async () => {
      await call(ask(APPLE, 240)).settled()
      age()
      fetchMock.mockClear()
      fetchMock.mockImplementation(async () => new Response('down', { status: 503 }))
      const response = await call(ask(APPLE, 240)).settled()
      expect(response.status).toBe(200)
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(JPEG)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const second = await call(ask(APPLE, 240)).settled()
      expect(second.headers.get('X-Cover-Cache')).toBe('hit')
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(new Uint8Array(await second.arrayBuffer())).toEqual(JPEG)
    })

    it('stays served when the host does not answer at all', async () => {
      await call(ask(APPLE, 240)).settled()
      age()
      fetchMock.mockImplementation(async () => { throw new TypeError('network') })
      const response = await call(ask(APPLE, 240)).settled()
      expect(response.status).toBe(200)
      expect(response.headers.get('X-Cover-Cache')).toBe('stale')
    })
  })
})

describe('a host that does not give a cover', () => {
  it.each([
    ['a 503', () => new Response('x', { status: 503 }), 502],
    ['a 404', () => new Response('x', { status: 404 }), 404],
    ['a page that is no image', () => new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } }), 502],
    ['an empty answer', () => hostAnswers(new Uint8Array()), 502],
    ['more than any cover is', () => hostAnswers(new Uint8Array(3 * 1024 * 1024)), 502],
    ['a redirect that ended on another host', () => hostAnswers(JPEG, { url: 'https://example.com/x.jpg' }), 502],
  ])('is %s: no cover, nothing stored, not kept by anyone', async (_, answer, status) => {
    fetchMock.mockImplementation(async () => answer())
    const response = await call(ask(OL, 240)).settled()
    expect(response.status).toBe(status)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(cache.put).not.toHaveBeenCalled()
  })

  it('may redirect to Open Library’s archive, which is where its older covers are', async () => {
    fetchMock.mockImplementation(async () => hostAnswers(JPEG, { url: 'https://ia800000.us.archive.org/view_archive.php?x=1' }))
    expect((await call(ask(OL, 240)).settled()).status).toBe(200)
  })

  describe('redirects, followed by hand on the allowlist', () => {
    const redirect = (location: string, status = 302) => new Response(null, { status, headers: { Location: location } })
    const ARCHIVE = 'https://archive.org/download/l_covers_0008/0008231856-L.jpg'
    const STORAGE = 'https://ia800000.us.archive.org/view_archive.php?archive=/x.zip&file=0008231856-L.jpg'

    it('follows Open Library to the archive and its storage host, never letting fetch follow by itself', async () => {
      fetchMock.mockImplementation(async (url: string) => (url === OL ? redirect(ARCHIVE) : url === ARCHIVE ? redirect(STORAGE, 301) : hostAnswers()))
      const response = await call(ask(OL, 240)).settled()
      expect(response.status).toBe(200)
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([OL, ARCHIVE, STORAGE])
      expect(fetchMock.mock.calls.every(([, init]) => init.redirect === 'manual')).toBe(true)
    })

    it.each([
      ['another host', 'https://evil.example/x.jpg'],
      ['plain http', 'http://covers.openlibrary.org/b/id/1-L.jpg'],
      ['credentials', 'https://user:pass@archive.org/x.jpg'],
      ['a port', 'https://archive.org:8443/x.jpg'],
      ['a look-alike', 'https://archive.org.evil.example/x.jpg'],
      ['an internal address', 'https://169.254.169.254/latest/meta-data'],
    ])('stops at a redirect to %s: nothing is asked of it, nothing is stored', async (_, target) => {
      fetchMock.mockImplementation(async (url: string) => (url === OL ? redirect(target) : hostAnswers()))
      const response = await call(ask(OL, 240)).settled()
      expect(response.status).toBe(502)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([OL])
      expect(cache.put).not.toHaveBeenCalled()
    })

    it('gives up after three hops, and on a redirect without a Location', async () => {
      fetchMock.mockImplementation(async (url: string) => redirect(`${ARCHIVE}?n=${fetchMock.mock.calls.length}`))
      expect((await call(ask(OL, 240)).settled()).status).toBe(502)
      expect(fetchMock).toHaveBeenCalledTimes(4)
      fetchMock.mockReset()
      fetchMock.mockImplementation(async () => new Response(null, { status: 302 }))
      expect((await call(ask(APPLE, 120)).settled()).status).toBe(502)
    })
  })

  it('is a 502 when it does not answer', async () => {
    fetchMock.mockImplementation(async () => { throw new TypeError('network') })
    expect((await call(ask(OL, 240)).settled()).status).toBe(502)
  })
})

describe('without a cache (a local server)', () => {
  it('still answers, from the host every time', async () => {
    vi.stubGlobal('caches', undefined)
    const response = await call(ask(APPLE, 120), 'GET', { Origin: SITE }).settled()
    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(SITE)
  })
})

describe('who may ask (a guard against other sites, not against a flood: that is a Cloudflare rate-limiting rule)', () => {
  it('answers this app\'s own pages: Origin or Referer naming this host, or neither', async () => {
    expect((await call(ask(APPLE, 240), 'GET', { Origin: SITE }).settled()).status).toBe(200)
    expect((await call(ask(APPLE, 240), 'GET', { Referer: `${SITE}/friends/x` }).settled()).status).toBe(200)
    expect((await call(ask(APPLE, 240)).settled()).status).toBe(200)
    // A direct image load names no Origin and sends no CORS answer it would not use.
    expect((await call(ask(APPLE, 240), 'GET', { Referer: `${SITE}/` }).settled()).headers.has('Access-Control-Allow-Origin')).toBe(false)
  })

  it('refuses another site\'s page, with no CORS and nothing stored or fetched', async () => {
    for (const headers of [{ Origin: 'https://evil.example' }, { Referer: 'https://evil.example/page' }, { Origin: 'null' }, { Origin: SITE, Referer: 'https://evil.example/' }, { Referer: 'not an address' }]) {
      const response = await call(ask(APPLE, 240), 'GET', headers).settled()
      expect(response.status, JSON.stringify(headers)).toBe(403)
      expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    }
    expect(fetchMock).not.toHaveBeenCalled()
    expect(cache.put).not.toHaveBeenCalled()
  })

  it('answers the origins the project lists (a preview, a second domain), CORS for that origin alone', async () => {
    const env = { COVER_ALLOWED_ORIGINS: 'https://libellus-preview.pages.dev, https://staging.example' }
    const response = await call(ask(APPLE, 240), 'GET', { Origin: 'https://libellus-preview.pages.dev' }, env).settled()
    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://libellus-preview.pages.dev')
    expect((await call(ask(APPLE, 240), 'GET', { Origin: 'https://other.pages.dev' }, env).settled()).status).toBe(403)
  })

  it('never sends * and varies on Origin, so a copy kept for one page is not read as another\'s', async () => {
    const response = await call(ask(APPLE, 240), 'GET', { Origin: SITE }).settled()
    expect(response.headers.get('Access-Control-Allow-Origin')).not.toBe('*')
    expect(response.headers.get('Vary')).toBe('Origin')
  })
})
