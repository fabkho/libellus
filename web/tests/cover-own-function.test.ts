import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// The Pages Function itself, as Cloudflare loads it: plain ESM, driven with a context the test builds
// (docs/HOSTING.md, "Own covers"). The bucket is a fake R2 binding, the cache a Map.
import { onRequest } from '../functions/c/[[path]].js'

/**
 * `/c/<key>/<width>` (functions/c/[[path]].js): our stored copies from the private bucket, same origin, kept in the Cache
 * API for good. No network and no Cloudflare: what is checked is what the Function asks the bucket and the cache, stores
 * and says.
 */

const SITE = 'https://libellus.fabkho.dev'
const KEY = 'c0ffeec0ffeec0ffeec0ffeec0ffeec0'
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4])

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

/** A fake R2 bucket binding: `get(object name)` gives an object with a body and its metadata, or null. */
function bucket(objects: Record<string, { bytes: Uint8Array; type?: string }>) {
  return {
    get: vi.fn(async (name: string) => {
      const found = objects[name]
      return found ? { body: new Response(found.bytes).body, size: found.bytes.byteLength, httpMetadata: { contentType: found.type ?? 'image/webp' } } : null
    }),
  }
}

type Waited = Promise<unknown>[]
function call(path: string, { method = 'GET', headers = {}, env = {} as Record<string, unknown> } = {}) {
  const waited: Waited = []
  const request = new Request(`${SITE}${path}`, { method, headers })
  const promise = onRequest({ request, env, waitUntil: (p: Promise<unknown>) => void waited.push(p) } as never)
  return { promise, settled: async () => { const response = await promise; await Promise.all(waited); return response } }
}
const bytesOf = async (response: Response) => [...new Uint8Array(await response.arrayBuffer())]

let cache: ReturnType<typeof cacheStub>
let covers: ReturnType<typeof bucket>

beforeEach(() => {
  cache = cacheStub()
  covers = bucket({ [`c/${KEY}/240`]: { bytes: WEBP }, [`c/${KEY}/600`]: { bytes: WEBP, type: 'image/jpeg' } })
  vi.stubGlobal('caches', { default: cache })
})
afterEach(() => vi.unstubAllGlobals())

describe('the address', () => {
  it.each([
    ['no key', '/c'],
    ['a bare prefix', '/c/'],
    ['no width', `/c/${KEY}`],
    ['a width under 16', `/c/${KEY}/15`],
    ['a width over 2000', `/c/${KEY}/2001`],
    ['a width with a leading zero', `/c/${KEY}/0240`],
    ['a width that is not a whole number', `/c/${KEY}/240.5`],
    ['a signed width', `/c/${KEY}/+240`],
    ['an upper-case key', `/c/${KEY.toUpperCase()}/240`],
    ['a short key', `/c/${KEY.slice(2)}/240`],
    ['a long key', `/c/${KEY}ab/240`],
    ['a key that is not hex', `/c/${'z'.repeat(32)}/240`],
    ['a path inside', `/c/${KEY}/240/extra`],
    ['an encoded slash', `/c/${KEY}%2f240`],
  ])('is a 404 with no-store for %s, and asks neither the bucket nor the cache', async (_, path) => {
    const response = await call(path, { env: { COVERS: covers } }).settled()
    expect(response.status).toBe(404)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(covers.get).not.toHaveBeenCalled()
    expect(cache.match).not.toHaveBeenCalled()
    expect(cache.put).not.toHaveBeenCalled()
  })

  it.each(['POST', 'PUT', 'DELETE', 'PATCH'])('answers GET and HEAD only (%s is a 405)', async (method) => {
    const response = await call(`/c/${KEY}/240`, { method, env: { COVERS: covers } }).settled()
    expect(response.status).toBe(405)
    expect(covers.get).not.toHaveBeenCalled()
  })
})

describe('a miss', () => {
  it('reads the object c/<key>/<width>, answers it with the stored type and the headers of an image that never changes, and caches it', async () => {
    const response = await call(`/c/${KEY}/240`, { env: { COVERS: covers } }).settled()
    expect(covers.get).toHaveBeenCalledExactlyOnceWith(`c/${KEY}/240`)
    expect(response.status).toBe(200)
    expect(await bytesOf(response)).toEqual([...WEBP])
    expect(response.headers.get('Content-Type')).toBe('image/webp')
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Cross-Origin-Resource-Policy')).toBe('same-site')
    expect(response.headers.get('Content-Length')).toBe(String(WEBP.byteLength))
    expect(response.headers.get('X-Cover-Cache')).toBe('miss')
    // Same origin: no CORS asked for, none sent, never `*`.
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(cache.put).toHaveBeenCalledOnce()
    expect([...cache.entries.keys()]).toEqual([`${SITE}/c/${KEY}/240`])
  })

  it('serves the JPEG a stored object is, by its own type', async () => {
    const response = await call(`/c/${KEY}/600`, { env: { COVERS: covers } }).settled()
    expect(response.headers.get('Content-Type')).toBe('image/jpeg')
  })

  it('keys the cache by the path alone: a query string is no other entry', async () => {
    await call(`/c/${KEY}/240?v=1&x=2`, { env: { COVERS: covers } }).settled()
    expect([...cache.entries.keys()]).toEqual([`${SITE}/c/${KEY}/240`])
  })

  it('answers a HEAD as it would a GET', async () => {
    const response = await call(`/c/${KEY}/240`, { method: 'HEAD', env: { COVERS: covers } }).settled()
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/webp')
  })
})

describe('a hit', () => {
  it('is answered from the cache without asking the bucket', async () => {
    await call(`/c/${KEY}/240`, { env: { COVERS: covers } }).settled()
    covers.get.mockClear()
    const response = await call(`/c/${KEY}/240`, { env: { COVERS: covers } }).settled()
    expect(covers.get).not.toHaveBeenCalled()
    expect(cache.put).toHaveBeenCalledOnce()
    expect(response.status).toBe(200)
    expect(await bytesOf(response)).toEqual([...WEBP])
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    expect(response.headers.get('X-Cover-Cache')).toBe('hit')
  })

  it('works with nothing bound (the cache alone answers) and gives a page another origin\'s CORS only to that origin', async () => {
    await call(`/c/${KEY}/240`, { env: { COVERS: covers, COVER_ALLOWED_ORIGINS: 'https://libellus-3q1.pages.dev' }, headers: { Origin: 'https://libellus-3q1.pages.dev' } }).settled()
    const hit = await call(`/c/${KEY}/240`, { env: {}, headers: { Origin: SITE } }).settled()
    expect(hit.status).toBe(200)
    expect(hit.headers.get('Access-Control-Allow-Origin'), 'the first page\'s CORS header is not the cache\'s').toBe(SITE)
    const bare = await call(`/c/${KEY}/240`, { env: {} }).settled()
    expect(bare.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('is not hurt by a cache that fails', async () => {
    cache.match.mockRejectedValueOnce(new Error('cache down'))
    cache.put.mockRejectedValueOnce(new Error('cache down'))
    const response = await call(`/c/${KEY}/240`, { env: { COVERS: covers } }).settled()
    expect(response.status).toBe(200)
    expect(await bytesOf(response)).toEqual([...WEBP])
  })

  it('works without the Cache API at all (a local run)', async () => {
    vi.stubGlobal('caches', undefined)
    const response = await call(`/c/${KEY}/240`, { env: { COVERS: covers } }).settled()
    expect(response.status).toBe(200)
  })
})

describe('what is not there', () => {
  it('is a 404 with no-store for an object the bucket does not have, and is not cached', async () => {
    const response = await call(`/c/${KEY}/360`, { env: { COVERS: covers } }).settled()
    expect(response.status).toBe(404)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(cache.put).not.toHaveBeenCalled()
  })

  it('is a 404 with no-store while the bucket is not bound (before the owner\'s release step)', async () => {
    for (const env of [{}, { COVERS: undefined }, { COVERS: {} }]) {
      const response = await call(`/c/${KEY}/240`, { env }).settled()
      expect(response.status).toBe(404)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    }
  })

  it('is a 502 with no-store when the bucket fails, and nothing keeps it', async () => {
    covers.get.mockRejectedValueOnce(new Error('R2 down'))
    const response = await call(`/c/${KEY}/240`, { env: { COVERS: covers } }).settled()
    expect(response.status).toBe(502)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(cache.put).not.toHaveBeenCalled()
  })

  it('serves nothing that is not an image (a stray object is a 404, not a download)', async () => {
    const odd = bucket({ [`c/${KEY}/240`]: { bytes: WEBP, type: 'text/html' } })
    const response = await call(`/c/${KEY}/240`, { env: { COVERS: odd } }).settled()
    expect(response.status).toBe(404)
    expect(cache.put).not.toHaveBeenCalled()
  })
})

describe('who may ask', () => {
  it.each([
    ['a foreign Origin', { Origin: 'https://evil.example' }],
    ['a foreign Referer', { Referer: 'https://evil.example/page' }],
    ['a Referer that names a look-alike of this host', { Referer: `${SITE}.evil.example/` }],
    ['a Referer on another port of this host', { Referer: 'https://libellus.fabkho.dev:8443/x' }],
  ])('is a 403 with no-store for %s, and the bucket and the cache are left alone', async (_, headers) => {
    const response = await call(`/c/${KEY}/240`, { env: { COVERS: covers }, headers }).settled()
    expect(response.status).toBe(403)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(covers.get).not.toHaveBeenCalled()
    expect(cache.match).not.toHaveBeenCalled()
  })

  it('lets this app (Referer as an <img> sends it), a listed origin, and a request that names nobody', async () => {
    const env = { COVERS: covers, COVER_ALLOWED_ORIGINS: 'https://betterreads.de, https://libellus-3q1.pages.dev' }
    for (const headers of [{ Referer: `${SITE}/library` }, { Referer: 'https://betterreads.de/library' }, {}] as Record<string, string>[]) {
      expect((await call(`/c/${KEY}/240`, { env, headers }).settled()).status, JSON.stringify(headers)).toBe(200)
    }
    const listed = await call(`/c/${KEY}/240`, { env, headers: { Origin: 'https://betterreads.de' } }).settled()
    expect(listed.headers.get('Access-Control-Allow-Origin')).toBe('https://betterreads.de')
  })

  it('judges the foreign Referer before the cache, so a cached copy is not an open door', async () => {
    await call(`/c/${KEY}/240`, { env: { COVERS: covers } }).settled()
    const response = await call(`/c/${KEY}/240`, { env: { COVERS: covers }, headers: { Referer: 'https://evil.example/' } }).settled()
    expect(response.status).toBe(403)
  })
})
