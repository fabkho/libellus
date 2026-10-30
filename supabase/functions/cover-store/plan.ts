/**
 * Which images of a cover are fetched and stored, by the host of its address (`books.cover_url`): the variants (the
 * LARGEST first: it is fetched first and alone makes the key, key.ts), the thumbhash's source, and what paces them.
 * Nothing here touches the network. An address that is not one of the shapes below is `null`: `unsupported_url`,
 * terminal; we do not guess how to size it and the Book keeps showing its source address.
 *
 *   apple        `…/<w>x<h>bb.<ext>` on `*.mzstatic.com`   600x900bb.webp (key), 360x540, 240x360, 120x180: Apple renders
 *                WebP itself (Access-Control-Allow-Origin: *), so we never resize or encode. Thumbhash: `66x100bb.jpg`.
 *   openlibrary  `/b/<kind>/<key>-<S|M|L>.jpg`             -L (key), -M, always asked with `?default=false` (a missing cover is
 *                a 404, not a 1 × 1 GIF). Thumbhash: the -M bytes already fetched (one request less than a -S).
 *   goodreads    `i.gr-assets.com/<path>`                  the one image the address names. Thumbhash: that image.
 *   regal        `books.fabkho.dev/<path>`                 the one image. Thumbhash: that image.
 *
 * The sizes are Apple's 4 widths (a subset of `COVER_WIDTHS`, web/app/utils/coverSize.ts) and Open Library's 2. The
 * Apple shape is that file's `APPLE_PATH` (tests/plan_test.ts checks the two agree on a table of addresses).
 * `COVER_STORE_HOSTS` (index.ts) drops a host: its Books are `unsupported_url`.
 */

export type HostName = 'apple' | 'openlibrary' | 'goodreads' | 'regal'
export const ALL_HOSTS: readonly HostName[] = ['apple', 'openlibrary', 'goodreads', 'regal']

/** The Apple widths stored, largest first, and the box each is asked at (2:3; `bb` keeps the cover's own proportions in it). */
export const APPLE_WIDTHS = [600, 360, 240, 120] as const
const APPLE_THUMB = '66x100bb.jpg'

export type CoverPlan = {
  host: HostName
  /** Fetched first; its bytes make the key. */
  largest: string
  /** Fetched after the key is known, largest to smallest; never change it. */
  rest: string[]
  /** The image the thumbhash is made from (one of `largest` / `rest` when that is fetched anyway). */
  thumb: string
  /** Open Library's keyed covers (ISBN, OCLC, LCCN): 100 requests per address per 5 minutes there, paced at 0.3 a second. */
  keyed: boolean
  /** Open Library: the address of the cover's id (a by-id variant of `kind`), when the first redirect of a keyed address named it. */
  openLibrary?: { kind: string; key: string }
}

const APPLE_HOST = /^[a-z0-9-]+\.mzstatic\.com$/
const APPLE_PATH = /^(\/image\/thumb\/[\w./~+-]+?\.[a-z0-9]+)\/\d+x\d+bb\.(?:jpe?g|png|webp)$/i
const OPEN_LIBRARY_PATH = /^\/b\/(id|isbn|olid|oclc|lccn)\/([A-Za-z0-9]{1,20})-([SML])\.jpg$/
const KEYED = new Set(['isbn', 'oclc', 'lccn'])

function parse(input: string): URL | null {
  try {
    const url = new URL(input)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !/[\s]/.test(input) ? url : null
  } catch {
    return null
  }
}

export function openLibraryUrl(kind: string, key: string, size: 'S' | 'M' | 'L'): string {
  return `https://covers.openlibrary.org/b/${kind}/${key}-${size}.jpg?default=false`
}

function openLibraryPlan(kind: string, key: string): CoverPlan {
  const rest = openLibraryUrl(kind, key, 'M')
  return { host: 'openlibrary', largest: openLibraryUrl(kind, key, 'L'), rest: [rest], thumb: rest, keyed: KEYED.has(kind), openLibrary: { kind, key } }
}

/** The plan for a cover address, or null (`unsupported_url`): not a host we store from, or not a shape we know how to size. */
export function planCover(source: string, hosts: ReadonlySet<HostName> | readonly HostName[] = ALL_HOSTS): CoverPlan | null {
  const allowed = new Set<HostName>(hosts)
  const url = parse(source)
  if (!url) return null
  const host = url.hostname.toLowerCase()

  if (APPLE_HOST.test(host)) {
    if (!allowed.has('apple') || url.search || url.hash) return null
    const base = APPLE_PATH.exec(url.pathname)?.[1]
    if (!base) return null
    const at = (width: number) => `${url.origin}${base}/${width}x${Math.round(width * 1.5)}bb.webp`
    return {
      host: 'apple',
      largest: at(APPLE_WIDTHS[0]),
      rest: APPLE_WIDTHS.slice(1).map(at),
      thumb: `${url.origin}${base}/${APPLE_THUMB}`,
      keyed: false,
    }
  }

  if (host === 'covers.openlibrary.org') {
    if (!allowed.has('openlibrary') || url.hash || (url.search && url.search !== '?default=false')) return null
    const match = OPEN_LIBRARY_PATH.exec(url.pathname)
    return match ? openLibraryPlan(match[1]!, match[2]!) : null
  }

  if (host === 'i.gr-assets.com') {
    // The stored address has no query (books_cover_url constraint); a path is all it is.
    if (!allowed.has('goodreads') || url.search || url.hash || url.pathname === '/') return null
    return { host: 'goodreads', largest: url.href, rest: [], thumb: url.href, keyed: false }
  }

  if (host === 'books.fabkho.dev') {
    if (!allowed.has('regal') || url.search || url.hash || url.pathname === '/') return null
    return { host: 'regal', largest: url.href, rest: [], thumb: url.href, keyed: false }
  }

  return null
}

/**
 * The cover id an Open Library redirect names: a keyed address (`/b/isbn/…`) answers 302 to the image at archive.org,
 * whose path or `file=` parameter ends in the cover's 10-digit id (`…/0009363399-L.jpg`). With it the other sizes are asked
 * by id (not limited), so a keyed Book costs one keyed request, not two. Null when the address names none (it answered
 * the image directly, as it does for a cached one).
 */
export function coverIdFromLocation(location: string): string | null {
  const url = parse(location)
  if (!url || !(url.hostname === 'archive.org' || url.hostname.endsWith('.archive.org'))) return null
  const digits = /(?:^|[/=])(\d{10})-[SML]\.jpg$/.exec(url.pathname + url.search)?.[1]
  const id = digits ? String(Number(digits)) : null
  return id && id !== '0' ? id : null
}

/** The same plan with the other sizes asked by cover id (after a keyed address' redirect named it): no keyed request is left. */
export function byCoverId(plan: CoverPlan, id: string): CoverPlan {
  const rest = openLibraryUrl('id', id, 'M')
  return { ...plan, rest: [rest], thumb: rest, keyed: false, openLibrary: { kind: 'id', key: id } }
}
