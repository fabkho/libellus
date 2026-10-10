import { readFileSync } from 'node:fs'
import { onRequestPost } from '../functions/share.js'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { discardShared, pendingShare, readShared, sizeLabel, SHARE_KEEP_MS, SHARE_MAX_FILES, SHARE_MAX_FILE_BYTES, type SharedCache } from '@/data/ebooks/shared'
import { SHARED_EBOOKS_CACHE } from '@/data/localData'

/**
 * The share target (#91, #131) and security round F4: any page can POST the manifest's form to
 * /share. public/sw-share.js (the real file, run here on a fake worker scope and an in-memory
 * Cache Storage) refuses a POST that comes from another site, keeps only EPUBs within the limits
 * and never imports anything; data/ebooks/shared.ts lists what waits and hands over only the share
 * the member confirmed. The tap itself is e2e/share.spec.ts.
 */
const ORIGIN = 'https://libellus.test'
const ZIP = [0x50, 0x4b, 0x03, 0x04, 1, 2, 3]

/** A Cache keyed by path, as the worker and the page use it. */
function memoryCache() {
  const items = new Map<string, Response>()
  const path = (request: string | Request) => new URL(typeof request === 'string' ? request : request.url, ORIGIN).pathname
  const cache = {
    items,
    async put(request: string | Request, response: Response) {
      items.set(path(request), response)
    },
    async match(request: string | Request) {
      return items.get(path(request))?.clone()
    },
    async keys() {
      return [...items.keys()].map((key) => new Request(new URL(key, ORIGIN)))
    },
    async delete(request: string | Request) {
      return items.delete(path(request))
    },
  }
  return cache
}

/** The worker's file, loaded the way a worker scope would: its own `self`, `caches`, `Response`. */
function worker(now = () => Date.now()) {
  const cache = memoryCache()
  const listeners: Record<string, (event: unknown) => void> = {}
  const scope = {
    self: { location: { origin: ORIGIN }, addEventListener: (type: string, listener: (event: unknown) => void) => void (listeners[type] = listener) },
    caches: { open: async () => cache },
    Response,
    URL,
    URLSearchParams,
    Date: { now },
    Math,
    Uint8Array,
  } as Record<string, unknown>
  runInNewContext(readFileSync(new URL('../public/sw-share.js', import.meta.url), 'utf8'), scope)
  /** POSTs a form to /share the way the browser hands it to the worker's fetch listener. */
  async function post(parts: Record<string, string | File | File[]>, headers: Record<string, string> = {}) {
    const form = new FormData()
    for (const [key, value] of Object.entries(parts)) for (const item of Array.isArray(value) ? value : [value]) form.append(key, item)
    const request = new Request(`${ORIGIN}/share`, { method: 'POST', body: form, headers })
    const answered: { response?: Promise<Response> } = {}
    listeners.fetch!({ request, respondWith: (response: Promise<Response>) => void (answered.response = response) })
    return answered.response ? await answered.response : null
  }
  return { cache, post, scope }
}

const epub = (name = 'book.epub', { bytes = ZIP, type = 'application/epub+zip' } = {}) => new File([new Uint8Array(bytes)], name, { type })
const location = (response: Response | null) => response?.headers.get('location') ?? null

describe('a POST to /share from another site (F4)', () => {
  for (const header of ['cross-site', 'same-site']) {
    it(`is dropped without reading it when the browser says Sec-Fetch-Site: ${header}`, async () => {
      const { cache, post } = worker()
      const response = await post({ ebooks: epub('planted.epub') }, { 'Sec-Fetch-Site': header })
      expect(response?.status).toBe(303)
      expect(location(response)).toBe(`${ORIGIN}/`)
      expect(cache.items.size).toBe(0)
    })
  }

  it('is dropped when the Origin is another one and no Sec-Fetch-Site is shown', async () => {
    const { cache, post } = worker()
    const response = await post({ ebooks: epub() }, { Origin: 'https://attacker.example' })
    expect(location(response)).toBe(`${ORIGIN}/`)
    expect(cache.items.size).toBe(0)
  })

  it('is dropped too when it only carries a title and a link (a search is not for any page to start)', async () => {
    const { post } = worker()
    expect(location(await post({ title: 'x', url: 'https://a.example' }, { 'Sec-Fetch-Site': 'cross-site' }))).toBe(`${ORIGIN}/`)
  })

  for (const headers of <Record<string, string>[]>[{ 'Sec-Fetch-Site': 'none' }, { 'Sec-Fetch-Site': 'same-origin' }, { Origin: ORIGIN }, {}, { Origin: 'null' }]) {
    it(`keeps an OS share (${JSON.stringify(headers)}) for the member’s tap`, async () => {
      const { cache, post } = worker()
      const response = await post({ ebooks: epub('mine.epub') }, headers)
      expect(location(response)).toMatch(new RegExp(`^${ORIGIN}/share\\?ebooks=[a-z0-9]+$`))
      expect([...cache.items.keys()].some((key) => key.endsWith('/meta'))).toBe(true)
    })
  }

  it('still turns a shared link into the GET address', async () => {
    const { cache, post } = worker()
    const response = await post({ title: 'Piranesi', text: 'a book', url: 'https://example.com/b' }, { 'Sec-Fetch-Site': 'none' })
    expect(location(response)).toBe(`${ORIGIN}/share?title=Piranesi&text=a+book&url=https%3A%2F%2Fexample.com%2Fb`)
    expect(cache.items.size).toBe(0)
  })
})

describe('functions/share.js, when no service worker answered', () => {
  const post = (headers: Record<string, string>, extra: Record<string, string> = {}) => {
    const form = new FormData()
    for (const [key, value] of Object.entries({ title: 'Piranesi', ...extra })) form.append(key, value)
    return onRequestPost({ request: new Request(`${ORIGIN}/share`, { method: 'POST', body: form, headers }) })
  }

  it('sends a POST from another site Home, unread', async () => {
    expect((await post({ 'Sec-Fetch-Site': 'cross-site' })).headers.get('location')).toBe(`${ORIGIN}/`)
    expect((await post({ Origin: 'https://attacker.example' })).headers.get('location')).toBe(`${ORIGIN}/`)
  })

  it('still turns an OS share into the GET address', async () => {
    expect((await post({ 'Sec-Fetch-Site': 'none' })).headers.get('location')).toBe(`${ORIGIN}/share?title=Piranesi`)
    expect((await post({})).headers.get('location')).toBe(`${ORIGIN}/share?title=Piranesi`)
  })
})

describe('what the worker keeps', () => {
  it('only EPUBs: a name ending .epub or the EPUB type, and a zip’s first bytes', async () => {
    const { cache, post } = worker()
    const response = await post({
      ebooks: [
        epub('a.epub'),
        epub('b.EPUB', { type: '' }),
        epub('c', { type: 'application/epub+zip' }),
        epub('notes.txt', { type: 'text/plain' }),
        epub('fake.epub', { bytes: [1, 2, 3, 4, 5] }),
        epub('empty.epub', { bytes: [] }),
      ],
    })
    const id = new URL(location(response)!).searchParams.get('ebooks')!
    const meta = await (await cache.match(`/__shared/${id}/meta`))!.json()
    expect(meta.files.map((file: { name: string }) => file.name)).toEqual(['a.epub', 'b.EPUB', 'c'])
    // An empty file is not counted as offered at all.
    expect(meta.skipped).toBe(2)
  })

  it('says it did not arrive when nothing is an EPUB, and keeps nothing', async () => {
    const { cache, post } = worker()
    expect(location(await post({ ebooks: epub('notes.txt', { type: 'text/plain' }) }))).toBe(`${ORIGIN}/share?ebooks=missed`)
    expect(cache.items.size).toBe(0)
  })

  it('keeps at most 20 files of at most 100 MB each', async () => {
    const { cache, post, scope } = worker()
    const { isKeepable } = scope as { isKeepable: (file: unknown) => Promise<boolean> }
    const zipHead = { slice: () => ({ arrayBuffer: async () => new Uint8Array(ZIP).buffer }) }
    expect(await isKeepable({ ...zipHead, name: 'ok.epub', type: '', size: SHARE_MAX_FILE_BYTES })).toBe(true)
    expect(await isKeepable({ ...zipHead, name: 'big.epub', type: '', size: SHARE_MAX_FILE_BYTES + 1 })).toBe(false)
    const many = Array.from({ length: SHARE_MAX_FILES + 5 }, (_, index) => epub(`b${index}.epub`))
    const id = new URL(location(await post({ ebooks: many }))!).searchParams.get('ebooks')!
    const meta = await (await cache.match(`/__shared/${id}/meta`))!.json()
    expect(meta.files).toHaveLength(SHARE_MAX_FILES)
    expect(meta.skipped).toBe(5)
  })

  it('deletes a share nobody confirmed when the next one arrives', async () => {
    let clock = 1_000_000
    const { cache, post } = worker(() => clock)
    const first = new URL(location(await post({ ebooks: epub('old.epub') }))!).searchParams.get('ebooks')!
    clock += SHARE_KEEP_MS + 1
    const second = new URL(location(await post({ ebooks: epub('new.epub') }))!).searchParams.get('ebooks')!
    expect([...cache.items.keys()].filter((key) => key.includes(first))).toEqual([])
    expect([...cache.items.keys()].filter((key) => key.includes(second))).toHaveLength(2)
  })
})

describe('what the page offers and takes (data/ebooks/shared.ts)', () => {
  /** A share as the worker stores it. */
  async function kept(cache: SharedCache & { put: (request: string, response: Response) => Promise<void> }, id: string, names: string[], at = Date.now()) {
    for (const [index, name] of names.entries()) void name, await cache.put(`/__shared/${id}/${index}`, new Response(new Uint8Array(ZIP)))
    const files = names.map((name, index) => ({ index, name, type: 'application/epub+zip', size: ZIP.length, lastModified: 1 }))
    await cache.put(`/__shared/${id}/meta`, new Response(JSON.stringify({ id, at, skipped: 0, files })))
  }

  it('lists the names and sizes of the share under the address’s id, and nothing else', async () => {
    const cache = memoryCache()
    await kept(cache, 'abc123abc123', ['a.epub', 'b.epub'])
    await kept(cache, 'zzz999zzz999', ['planted.epub'])
    expect(await pendingShare(cache, 'abc123abc123')).toEqual({
      id: 'abc123abc123',
      skipped: 0,
      files: [
        { index: 0, name: 'a.epub', size: ZIP.length },
        { index: 1, name: 'b.epub', size: ZIP.length },
      ],
    })
    expect(await pendingShare(cache, 'nothere1234')).toBeNull()
    expect(await pendingShare(cache, '../meta')).toBeNull()
  })

  it('offers nothing that is older than the hour it is kept for', async () => {
    const cache = memoryCache()
    await kept(cache, 'abc123abc123', ['a.epub'], 1_000)
    expect(await pendingShare(cache, 'abc123abc123', 1_000 + SHARE_KEEP_MS - 1)).not.toBeNull()
    expect(await pendingShare(cache, 'abc123abc123', 1_000 + SHARE_KEEP_MS + 1)).toBeNull()
    expect(await readShared(cache, 'abc123abc123', 1_000 + SHARE_KEEP_MS + 1)).toEqual([])
  })

  it('hands over only the files of the share that was confirmed', async () => {
    const cache = memoryCache()
    await kept(cache, 'abc123abc123', ['a.epub'])
    await kept(cache, 'zzz999zzz999', ['planted.epub'])
    const files = await readShared(cache, 'abc123abc123')
    expect(files.map((file) => file.name)).toEqual(['a.epub'])
    expect(files[0]!.type).toBe('application/epub+zip')
  })

  it('discards one share, or every share but the one on screen', async () => {
    const cache = memoryCache()
    await kept(cache, 'abc123abc123', ['a.epub'])
    await kept(cache, 'zzz999zzz999', ['planted.epub'])
    await discardShared(cache, { keep: 'abc123abc123' })
    expect([...cache.items.keys()].every((key) => key.includes('abc123abc123'))).toBe(true)
    await discardShared(cache, { only: 'abc123abc123' })
    expect(cache.items.size).toBe(0)
  })

  it('shows sizes plainly', () => {
    expect(sizeLabel(900)).toBe('1 KB')
    expect(sizeLabel(310 * 1024)).toBe('310 KB')
    expect(sizeLabel(2.4 * 1024 * 1024)).toBe('2.4 MB')
    expect(sizeLabel(25 * 1024 * 1024)).toBe('25 MB')
  })

  it('names the cache the worker and the device clear', () => {
    expect(SHARED_EBOOKS_CACHE).toBe('libellus-shared-ebooks')
    expect(readFileSync(new URL('../public/sw-share.js', import.meta.url), 'utf8')).toContain(`'${SHARED_EBOOKS_CACHE}'`)
  })
})
