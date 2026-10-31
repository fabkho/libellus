/**
 * The tests' world: the recorded public covers of fixtures/ (record_fixtures.ts: an Apple book's four widths and probe, an
 * Open Library cover by id at S/M/L, a Goodreads image; never a member's), a stand-in for the hosts' web, for R2 (an
 * S3 that checks the signature header and keeps what is PUT), for the database's RPCs and for the pace. Nothing is
 * fetched live.
 */
import { type Pace } from '../_shared/pace.ts'
import type { FetchLike } from './fetch.ts'
import type { Claimed, Done, FailReason, Store } from './store.ts'

export const fixture = (name: string): Uint8Array => Deno.readFileSync(new URL(`./fixtures/${name}`, import.meta.url))

/** Apple: the artwork of one public book. The REAL widths of its four variants are these (the `bb` box keeps the proportions). */
export const APPLE_BASE = 'https://is1-ssl.mzstatic.com/image/thumb/Publication122/v4/8d/3a/b4/8d3ab462-68ce-30ba-a9da-610286c41f49/9783641264864.jpg'
export const APPLE_URL = `${APPLE_BASE}/600x900bb.jpg`
export const APPLE_REAL_WIDTHS = [114, 227, 341, 568]
export const APPLE_VARIANTS = {
  [`${APPLE_BASE}/600x900bb.webp`]: 'apple-600x900.webp',
  [`${APPLE_BASE}/360x540bb.webp`]: 'apple-360x540.webp',
  [`${APPLE_BASE}/240x360bb.webp`]: 'apple-240x360.webp',
  [`${APPLE_BASE}/120x180bb.webp`]: 'apple-120x180.webp',
}
export const APPLE_PROBE = `${APPLE_BASE}/66x100bb.jpg`

export const OPENLIBRARY_ID_URL = 'https://covers.openlibrary.org/b/id/8231856-L.jpg'
export const OL_L = 'https://covers.openlibrary.org/b/id/8231856-L.jpg?default=false'
export const OL_M = 'https://covers.openlibrary.org/b/id/8231856-M.jpg?default=false'
export const GOODREADS_URL = 'https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1689110385i/187957173.jpg'
export const REGAL_URL = 'https://books.fabkho.dev/covers/one.jpg'
export const HARDCOVER_URL = 'https://assets.hardcover.app/edition/30524155/2d30ac0e2eb1f4cd0ea3a93b5cd8a1fa1a63e0e.jpeg'

export const SECRET = 'test-secret-not-a-real-one'

/** A JPEG that is only a header (the size is all the function reads before decoding), `width` × `height`. */
export function jpegOf(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 3,
    1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9,
  ])
}

// ----------------------------------------------------------------------------------------------- the hosts' web

export type Route = () => Response
export const image = (bytes: Uint8Array, type = 'image/jpeg'): Route => () => new Response(bytes as Uint8Array<ArrayBuffer>, { headers: { 'content-type': type } })
export const redirect = (to: string, status = 302): Route => () => new Response(null, { status, headers: { location: to } })
export const status = (code: number): Route => () => new Response(null, { status: code })

/** Answers from `routes` (an address not in it is a 404), and remembers every request. */
export function web(routes: Record<string, Route>) {
  const requests: { url: string; headers: Headers; redirect: RequestRedirect | undefined }[] = []
  let inFlight = 0
  let peak = 0
  const fetch: FetchLike = async (input, init) => {
    requests.push({ url: input, headers: new Headers(init.headers), redirect: init.redirect })
    inFlight++
    peak = Math.max(peak, inFlight)
    try {
      await Promise.resolve() // let the other lanes start: the peak is the real concurrency
      await Promise.resolve()
      const route = routes[input]
      return route ? route() : new Response(null, { status: 404 })
    } finally {
      inFlight--
    }
  }
  return { fetch, requests, urls: () => requests.map((request) => request.url), peak: () => peak }
}

/** Every recorded cover: Apple's four widths and the probe, Open Library's id covers, Goodreads, Regal's. */
export function coverRoutes(extra: Record<string, Route> = {}): Record<string, Route> {
  const routes: Record<string, Route> = {}
  for (const [url, name] of Object.entries(APPLE_VARIANTS)) routes[url] = image(fixture(name), 'image/webp')
  routes[APPLE_PROBE] = image(fixture('apple-66x100.jpg'))
  routes[OL_L] = redirect('https://archive.org/download/l_covers_0008/l_covers_0008_23.zip/0008231856-L.jpg')
  routes['https://archive.org/download/l_covers_0008/l_covers_0008_23.zip/0008231856-L.jpg'] = image(fixture('ol-L.jpg'))
  routes[OL_M] = image(fixture('ol-M.jpg'))
  routes[GOODREADS_URL] = image(fixture('goodreads.jpg'))
  routes[REGAL_URL] = image(fixture('goodreads.jpg'))
  routes[HARDCOVER_URL] = image(fixture('goodreads.jpg'))
  return { ...routes, ...extra }
}

// ------------------------------------------------------------------------------------------------------- R2

/**
 * A stand-in S3: checks the request is a signed PUT, DELETE or LIST of `libellus-covers` and keeps the objects. A DELETE of
 * an object that is not there answers 204, as S3 and R2 do. `fail` makes a PUT answer that status, `failDelete` a DELETE.
 */
export function fakeS3(options: { fail?: (path: string) => number | null; failDelete?: (path: string) => number | null; failList?: () => number | null } = {}) {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>()
  const puts: string[] = []
  const deletes: string[] = []
  const lists: string[] = []
  const fetch = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    if (!/^AWS4-HMAC-SHA256 Credential=[^/]+\/\d{8}\/auto\/s3\/aws4_request,/.test(request.headers.get('authorization') ?? '')) {
      return new Response('unsigned', { status: 403 })
    }
    if (request.method === 'GET' && decodeURIComponent(url.pathname) === '/libellus-covers' && url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') ?? ''
      lists.push(prefix)
      const failure = options.failList?.()
      if (failure) return new Response('<Error>secret detail</Error>', { status: failure })
      const keys = [...objects.keys()].filter((path) => path.startsWith(prefix)).sort()
      const xml = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>libellus-covers</Name><Prefix>${prefix}</Prefix><IsTruncated>false</IsTruncated>${keys.map((path) => `<Contents><Key>${path}</Key><Size>1</Size></Contents>`).join('')}</ListBucketResult>`
      return new Response(xml, { headers: { 'content-type': 'application/xml' } })
    }
    const path = decodeURIComponent(url.pathname).replace(/^\/libellus-covers\//, '')
    if (request.method === 'DELETE') {
      deletes.push(path)
      const failure = options.failDelete?.(path)
      if (failure) return new Response('<Error>secret detail</Error>', { status: failure })
      objects.delete(path)
      return new Response(null, { status: 204 })
    }
    if (request.method !== 'PUT') return new Response('method', { status: 405 })
    puts.push(path)
    const failure = options.fail?.(path)
    if (failure) return new Response('<Error>secret detail</Error>', { status: failure })
    objects.set(path, { bytes: new Uint8Array(await request.arrayBuffer()), contentType: request.headers.get('content-type') ?? '' })
    return new Response(null, { status: 200 })
  }
  return { fetch, objects, puts, deletes, lists }
}

// ------------------------------------------------------------------------------------------ the pace, the store

export function fakePace() {
  const pace = { taken: 0, held: [] as number[] }
  const instance: Pace = {
    take() {
      pace.taken++
      return Promise.resolve()
    },
    hold(ms) {
      pace.held.push(ms)
      return Promise.resolve()
    },
  }
  return { pace: instance, state: pace }
}

const bookId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

/** A leased Book as `cover_store_claim` hands it out. */
export function row(n: number, sourceUrl: string, options: { thumbhash?: boolean; colours?: boolean } = {}): Claimed {
  return { book_id: bookId(n), source_url: sourceUrl, attempts: 0, needs_thumbhash: options.thumbhash ?? true, needs_colours: options.colours ?? true }
}

/** The database's RPCs over an in-memory queue. `cas` answers `cover_store_done`, `deleting` are the keys GC is deleting. */
export function fakeStore(rows: Claimed[], options: { cas?: (done: Done) => boolean; deleting?: Set<string>; claimDelayMs?: number } = {}) {
  const calls = {
    claims: [] as { runner: string; limit: number }[],
    reserved: [] as string[],
    done: [] as Done[],
    failed: [] as { book: string; runner: string; reason: FailReason }[],
    released: [] as { book: string; runner: string }[],
    kicks: 0,
  }
  const store: Store = {
    async claim(runner, limit) {
      calls.claims.push({ runner, limit })
      if (options.claimDelayMs) await new Promise((resolve) => setTimeout(resolve, options.claimDelayMs))
      return rows.slice(0, limit)
    },
    reserve(key) {
      calls.reserved.push(key)
      return Promise.resolve(!options.deleting?.has(key))
    },
    done(done) {
      calls.done.push(done)
      return Promise.resolve(options.cas ? options.cas(done) : true)
    },
    failed(book, runner, reason) {
      calls.failed.push({ book, runner, reason })
      return Promise.resolve(true)
    },
    release(book, runner) {
      calls.released.push({ book, runner })
      return Promise.resolve(true)
    },
    kick() {
      calls.kicks++
      return Promise.resolve('idle')
    },
  }
  return { store, calls }
}
