import type { CoverColors } from '../data/books'
import { appleArtwork } from '../data/apple'
import { openLibraryCoverAt } from '../data/openLibrary'
import { coverIsCacheable, coverProxyUrl, unproxied } from './coverSize'

/**
 * Where a cover's image comes from: the sources' sizes (Apple's CDN, Open Library), the chain of sizes a cover tries
 * and which URLs are one artwork. Framework-free, so a native port copies them and tests/cover-src.test.ts pins them.
 * `UiCover` (the base) asks for them through `ui.cover.sources` and `ui.cover.artworkOf` in `app/app.config.ts`; the
 * state a mounted cover moves through (`startCover`, `coverFailed`, …) is the base's `utils/coverShowing.ts`
 * (tests/cover-showing.test.ts).
 *
 * What a cover draws without its sources (the cloth of a Placeholder cover, the light it throws into the room, the
 * author line, a blank stand-in) is the shared UI base's: `utils/cloth.ts` there (`clothOf`, `glowOf`,
 * `formatAuthors`, `isBlankCover`, and the thumbhash placeholder `thumbhashDataUrl`, which keeps what it decoded:
 * auto-imported, or from `#layers/ui/app/utils/cloth`).
 */

/** A cover's two precomputed colours, `#rrggbb`, resolved once with the cover (data/books.ts). */
export type { CoverColors }

/** `UiCover`'s sizes. */
export type CoverSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

/**
 * The Apple artwork box each size asks for: about 3× the cover's width (tokens
 * `size.cover.*`: 30, 40, 72, 82, 140 px), so it is sharp at a phone's pixel
 * ratio and no larger (docs/covers.md: 120x180bb is 11 KB, 200x300bb 25 KB).
 * Neighbouring sizes share a box, so one download serves both (a search row
 * and the Add sheet). `xl` is the size a Book's cover is stored at, so the
 * book page shows the very image the Catalogue keeps.
 */
export const APPLE_BOX: Record<CoverSize, readonly [number, number]> = {
  xs: [120, 180],
  sm: [120, 180],
  md: [240, 360],
  lg: [240, 360],
  xl: [600, 900],
}

/** OpenLibrary's size for each: 'M' (180 px wide) up to `md`, 'L' (about 330 px) above. 'S' (38 px) is too small for any. */
export const OPENLIBRARY_SIZE: Record<CoverSize, 'M' | 'L'> = { xs: 'M', sm: 'M', md: 'M', lg: 'L', xl: 'L' }

/** The width asked of our cache for each Open Library size (utils/coverSize.ts: up to 180 px is 'M', above 'L'; its widths are 120, 240, …). */
const OPENLIBRARY_PROXY_WIDTH = { M: 120, L: 240 } as const

/**
 * The image to load for a cover shown at `size`. Apple's CDN renders any size
 * from the stored large URL, so a list row does not download the book page's
 * image; OpenLibrary has three sizes; other sources come as they are.
 *
 * `proxy`: through our own cache (`/cover?u=…&w=…`, functions/cover.js, utils/coverSize.ts) instead of the
 * host's address, for the hosts it serves; any other cover as it is. An address of ours given as `url`
 * is read as the cover it asks for, so `coverSrc(currentSrc, 'xl')` is the host's large one either way.
 */
export function coverSrc(url: string | null | undefined, size: CoverSize, proxy = false): string | null {
  if (!url) return null
  const stored = unproxied(url)
  const [width, height] = APPLE_BOX[size]
  const direct = /mzstatic\.com\//.test(stored) ? appleArtwork(stored, width, height) : openLibraryCoverAt(stored, OPENLIBRARY_SIZE[size])
  if (!proxy || !coverIsCacheable(stored)) return direct
  return coverProxyUrl(stored, /mzstatic\.com\//.test(stored) ? width : OPENLIBRARY_PROXY_WIDTH[OPENLIBRARY_SIZE[size]])
}

/** The tokens' cover widths in CSS px (`size.cover.*`, tokens.generated.css): what each size renders at, at every call site (the width is the size's token alone). */
export const COVER_WIDTH: Record<CoverSize, number> = { xs: 30, sm: 40, md: 72, lg: 82, xl: 140 }

/** Apple's artwork widths a cover chooses between: the distinct boxes of `APPLE_BOX`, narrowest first. */
const APPLE_WIDTHS = [...new Set(Object.values(APPLE_BOX).map(([width]) => width))].sort((a, b) => a - b)

/**
 * Candidates for the `srcset` of a cover shown at `size`: the same artwork at
 * the Apple boxes up to the one `size` asks for, by width, so the browser takes
 * the narrowest one that is sharp at its pixel ratio (a 140 px hero on a 1×
 * screen gets 240, not 600). Only Apple's artwork: its CDN renders any box, and
 * the widths are the boxes' own. OpenLibrary has no srcset: its 'M' and 'L' are
 * no fixed widths (a cover's 'M' is "up to 180 px"), so a width descriptor
 * would be a guess, and every extra OpenLibrary request costs a ~575 ms round
 * trip (docs/covers.md). A size with one candidate (`xs`, `sm`) has no srcset:
 * `coverSrc` is it. Null when there is none.
 */
export function coverSrcset(src: string | null | undefined, size: CoverSize): string | null {
  if (!src) return null
  // Offered the way `src` is: through our cache when `src` is an address of it.
  const url = unproxied(src)
  const proxy = url !== src
  if (!/mzstatic\.com\//.test(url) || appleArtwork(url, 1, 1) === url) return null
  const widths = APPLE_WIDTHS.filter((width) => width <= APPLE_BOX[size][0])
  if (widths.length < 2) return null
  return widths.map((width) => `${proxy ? coverProxyUrl(url, width) : appleArtwork(url, width, width * 1.5)} ${width}w`).join(', ')
}

/** The `sizes` of a cover's `srcset`: its token width, a fixed one (the cover never grows with its container). */
export function coverSizes(size: CoverSize): string {
  return `${COVER_WIDTH[size]}px`
}

/**
 * Every image a cover shown at `size` may load, in order: its own size, then the
 * same artwork at the size the Book's cover is stored at (`xl`), then at a list
 * row's (`sm`). One Book, one cover (docs/plans/covers-consistency.md): a size
 * that fails (a 503 from Open Library's archive, a size evicted from the
 * device's cache) is the same picture at another size, never another picture
 * and never the Placeholder while any size of it loads. So a list row and the
 * Book's page, which ask for different sizes, both show the Book's one cover or
 * both show none. Another artwork (OpenLibrary's cover by ISBN, a sibling
 * edition's) is never tried here: that is the Book's cover to decide, once,
 * where it is stored (data/covers.ts), not each place that shows it.
 */
export function coverChain(url: string | null | undefined, size: CoverSize): string[] {
  const own = coverSrc(url, size)
  if (!own) return []
  const direct = [...new Set([own, coverSrc(own, 'xl')!, coverSrc(own, 'sm')!])]
  // Asked through our cache: its answer first, and when the cache is down (a 502, a host without the Function) the host's own
  // addresses, the same artwork, so the cache is never the reason a cover is missing.
  return unproxied(url!) !== url ? [...new Set([coverSrc(url, size, true)!, ...direct])] : direct
}

/**
 * Which artwork a cover URL is of, whatever size it is asked at: Apple's box and
 * OpenLibrary's S/M/L are not part of it. Two URLs of one artwork are one image
 * to the member, at another size; two of another are another image.
 */
export function artworkOf(url: string): string {
  return openLibraryCoverAt(appleArtwork(unproxied(url), 1, 1), 'M')
}
