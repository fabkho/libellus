/**
 * A cover at the size it is shown at, and the address of our own cache in front of the two cover hosts
 * (`functions/cover.js`, docs/HOSTING.md, "The cover cache"). Framework-free and without imports: the Pages
 * Function loads this very file, so the allowlist the browser builds addresses by is the one the Function
 * enforces (tests/cover-size.test.ts, tests/cover-function.test.ts).
 *
 * `coverSrc` (utils/cover.ts) is the app's rule for the token sizes (`sm` … `xl`). This is the same idea for a
 * cover drawn at a size no token names (the "You both read" reel's 300 px cards, a texture): say how big it is
 * on screen and the device's pixel ratio, get the smallest image that is still sharp.
 *
 * ```ts
 * coverFor(book.coverUrl, { height: 300, dpr: devicePixelRatio })             // the host's own sized URL
 * coverFor(book.coverUrl, { height: 300, dpr: devicePixelRatio, proxy: true }) // `/cover?u=…&w=…`, our cache
 * ```
 */

/** The address of the Function, on the app's own origin. */
export const COVER_PROXY_PATH = '/cover'

/**
 * The widths an image is asked for, in device pixels: the Apple boxes the app already uses (120, 240, 600 — so
 * a size the app asked for before is one the cache already has) and the steps between them. A few fixed steps,
 * not any number: every width is an entry in the cache, and a texture a pixel wider is not worth another.
 */
export const COVER_WIDTHS = [120, 240, 360, 480, 600] as const

/** A cover's shape: 2 wide for 3 high. A height is turned into the width the 2:3 cover has at it. */
const ASPECT = 2 / 3

/** Open Library's three sizes: the widths of their images, in pixels ('M' is "up to 180", 'L' about 330, 'S' 38). */
const OPEN_LIBRARY_WIDTH = { S: 38, M: 180, L: 326 } as const

/** Apple's artwork: `…/image/thumb/<path>/<name>.jpg/<w>x<h>bb.jpg` on `is<n>-ssl.mzstatic.com`. */
const APPLE_HOST = /^[a-z0-9-]+\.mzstatic\.com$/
const APPLE_PATH = /^(\/image\/thumb\/[\w./~+-]+?\.[a-z0-9]+)\/\d+x\d+bb\.(?:jpe?g|png|webp)$/i
/** Open Library's cover API: by cover id, ISBN, edition key. The one query the app sends (`default=false`) is kept. */
const OPEN_LIBRARY_HOST = 'covers.openlibrary.org'
const OPEN_LIBRARY_PATH = /^\/b\/(id|isbn|olid|oclc|lccn)\/([A-Za-z0-9]{1,20})-[SML]\.jpg$/

/** The width of a device pixel run a cover needs to be sharp: its CSS width (or height, as 2:3) times the pixel ratio. */
export function coverPixels({ width, height, dpr = 1 }: { width?: number; height?: number; dpr?: number }): number {
  const css = Math.max(width ?? 0, (height ?? 0) * ASPECT)
  return Math.ceil(css * (Number.isFinite(dpr) && dpr > 0 ? dpr : 1))
}

/** The smallest of `COVER_WIDTHS` that is at least `pixels` wide; the largest when none is. */
export function coverWidthFor(pixels: number): number {
  return COVER_WIDTHS.find((width) => width >= pixels) ?? COVER_WIDTHS[COVER_WIDTHS.length - 1]!
}

/** The two hosts' kinds of address; null for anything else (a source we do not know sizes of). */
type Known = { host: 'apple'; origin: string; base: string } | { host: 'openlibrary'; kind: string; key: string; query: string }

function known(input: string | null | undefined): Known | null {
  if (!input) return null
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
  if (APPLE_HOST.test(url.hostname)) {
    const match = APPLE_PATH.exec(url.pathname)
    return match && !url.search && !url.hash ? { host: 'apple', origin: url.origin, base: match[1]! } : null
  }
  if (url.hostname === OPEN_LIBRARY_HOST) {
    const match = OPEN_LIBRARY_PATH.exec(url.pathname)
    const query = url.search === '?default=false' ? url.search : ''
    return match && (!url.search || query) && !url.hash ? { host: 'openlibrary', kind: match[1]!, key: match[2]!, query } : null
  }
  return null
}

/**
 * The cover URL at the smallest size that is at least `pixels` wide. Apple: the artwork box (width × 1.5, 2:3,
 * `bb` keeps the cover's own proportions inside it) of the next width in `COVER_WIDTHS`. Open Library: `-S`, `-M` or
 * `-L`, the smallest whose image is wide enough. An address that is not one of theirs (another host, a path
 * that does not look like their artwork) comes back as it is.
 */
export function coverVariant(url: string, pixels: number): string {
  const parsed = known(url)
  if (!parsed) return url
  if (parsed.host === 'apple') {
    const width = coverWidthFor(pixels)
    return `${parsed.origin}${parsed.base}/${width}x${Math.round(width / ASPECT)}bb.jpg`
  }
  const size = pixels <= OPEN_LIBRARY_WIDTH.S ? 'S' : pixels <= OPEN_LIBRARY_WIDTH.M ? 'M' : 'L'
  return `https://${OPEN_LIBRARY_HOST}/b/${parsed.kind}/${parsed.key}-${size}.jpg${parsed.query}`
}

/** Whether our cache can serve this cover (it is one of the two hosts' covers, in a shape it knows). */
export function coverIsCacheable(url: string | null | undefined): boolean {
  return known(url) !== null
}

/**
 * The address of a cover in our own cache: `/cover?u=<the cover URL>&w=<width>`, the width one of `COVER_WIDTHS`.
 * Not one of the two hosts' covers: the URL as it is (there is nothing to cache for it).
 */
export function coverProxyUrl(url: string, pixels: number, origin = ''): string {
  if (!known(url)) return url
  const query = new URLSearchParams({ u: url, w: String(coverWidthFor(pixels)) })
  return `${origin}${COVER_PROXY_PATH}?${query}`
}

/** What a cover shown at a size asks for. `proxy`: through our cache (the browser's own origin; false: the host's URL). */
export type CoverFor = { width?: number; height?: number; dpr?: number; proxy?: boolean; origin?: string }

/**
 * The image to load for a cover drawn `width` × `height` CSS pixels (either; the 2:3 cover has the other) at a device
 * pixel ratio of `dpr`: the smallest that is at least that many device pixels wide. Null/empty in, null out.
 */
export function coverFor(url: string | null | undefined, { proxy = false, origin = '', ...size }: CoverFor): string | null {
  if (!url) return null
  const pixels = coverPixels(size)
  return proxy ? coverProxyUrl(url, pixels, origin) : coverVariant(url, pixels)
}

/** The cover URL a `/cover?…` address of ours asks for; any other address as it is. */
export function unproxied(url: string): string {
  if (!url.startsWith(`${COVER_PROXY_PATH}?`) && !/^https?:\/\/[^/]+\/cover\?/.test(url)) return url
  try {
    return new URL(url, 'https://x.invalid').searchParams.get('u') ?? url
  } catch {
    return url
  }
}

/** What the Function does for an address: the host's URL to fetch (already at the size) and the width. Null: not served. */
export type CoverRequest = { source: string; width: number }

/**
 * Reads a request to `/cover` (its query string) and says what to fetch, or null when it is not one of the two hosts'
 * covers or not a width we serve (`w` one of `COVER_WIDTHS`; nothing else: no width asks for any size, every
 * width would be an entry of its own in the cache). The only door to the Function's fetch: an allowlist, not a
 * proxy.
 */
export function parseCoverRequest(search: string | URLSearchParams): CoverRequest | null {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search
  const u = params.get('u')
  const width = Number(params.get('w'))
  if (!u || u.length > 600 || !(COVER_WIDTHS as readonly number[]).includes(width)) return null
  if (!known(u)) return null
  return { source: coverVariant(u, width), width }
}
