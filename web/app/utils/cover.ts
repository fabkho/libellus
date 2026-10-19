import type { CoverColors } from '../data/books'
import { appleArtwork } from '../data/apple'
import { openLibraryCoverAt } from '../data/openLibrary'

/**
 * Where a cover's image comes from, and what a mounted cover (components/ui/Cover.vue) shows: the sources' sizes
 * (Apple's CDN, Open Library), the chain of sizes a cover tries, and the state it moves through. Framework-free, so a
 * native port copies them and tests/cover-src.test.ts and tests/cover-showing.test.ts pin them.
 *
 * What a cover draws without its sources (the cloth of a Placeholder cover, the light it throws into the room, the
 * author line, a blank stand-in) is the shared UI base's: `utils/cloth.ts` there (`clothOf`, `glowOf`,
 * `formatAuthors`, `isBlankCover`, auto-imported, or from `#ui/utils/cloth`). The thumbhash placeholder is the app's
 * own still (utils/thumbhash.ts): it keeps every decoded hash, the base's decodes on every call.
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

/**
 * The image to load for a cover shown at `size`. Apple's CDN renders any size
 * from the stored large URL, so a list row does not download the book page's
 * image; OpenLibrary has three sizes; other sources come as they are.
 */
export function coverSrc(url: string | null | undefined, size: CoverSize): string | null {
  if (!url) return null
  const [width, height] = APPLE_BOX[size]
  if (/mzstatic\.com\//.test(url)) return appleArtwork(url, width, height)
  return openLibraryCoverAt(url, OPENLIBRARY_SIZE[size])
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
export function coverSrcset(url: string | null | undefined, size: CoverSize): string | null {
  if (!url || !/mzstatic\.com\//.test(url) || appleArtwork(url, 1, 1) === url) return null
  const widths = APPLE_WIDTHS.filter((width) => width <= APPLE_BOX[size][0])
  if (widths.length < 2) return null
  return widths.map((width) => `${appleArtwork(url, width, width * 1.5)} ${width}w`).join(', ')
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
  return [...new Set([own, coverSrc(own, 'xl')!, coverSrc(own, 'sm')!])]
}

/**
 * Which artwork a cover URL is of, whatever size it is asked at: Apple's box and
 * OpenLibrary's S/M/L are not part of it. Two URLs of one artwork are one image
 * to the member, at another size; two of another are another image.
 */
export function artworkOf(url: string): string {
  return openLibraryCoverAt(appleArtwork(url, 1, 1), 'M')
}

/**
 * What a mounted cover (UiCover) shows, as a state it moves through; framework
 * free, so the rule is pinned by tests/cover-showing.test.ts and a native port
 * copies it. The rule: **a cover shows its Book's cover, and follows it**. One
 * Book, one cover (docs/plans/covers-consistency.md): a list row that stays
 * mounted (Home and the Library are kept alive) and the Book's page, mounted
 * later, show the same picture because both show what the Book says now. A new
 * `src` of another artwork (a refresh, a cover the Catalogue filled, another
 * edition) starts the cover afresh; another size of the artwork in view is no
 * other image (`artworkOf`): it takes over once it has loaded. A size that fails
 * moves on to the same artwork's other sizes (`coverChain`), then the Placeholder.
 * (Until this rule a cover in view held on to its first artwork, A8 in
 * docs/covers.md: that is what let a kept-alive row and a fresh page differ.)
 */
export interface CoverShowing {
  /** The sources to try in order: `src`, then the same artwork at its other sizes. */
  chain: readonly string[]
  /** Which of `chain` is in the image. */
  attempt: number
  /** What the cover is of; a change of it starts the cover afresh, even at the same artwork. */
  identity: string
  /** The image in view (loaded, not blank), or null while none is. */
  shown: string | null
  /** Whether the image may offer its sizes (`srcset`); not after a size of it failed. */
  srcset: boolean
}

/** What a cover is asked to show. */
export interface CoverInput {
  src: string | null | undefined
  /** The same artwork at other sizes, to try in turn when `src` fails (`coverChain`). */
  fallbacks: readonly string[]
  identity: string
}

const chainOf = ({ src, fallbacks }: CoverInput): readonly string[] => (src ? [...new Set([src, ...fallbacks])] : [])

/** A cover that shows nothing yet, set to try `input`. */
export function startCover(input: CoverInput): CoverShowing {
  return { chain: chainOf(input), attempt: 0, identity: input.identity, shown: null, srcset: true }
}

/** The source in the image now, or null: the Placeholder. */
export function coverNow(state: CoverShowing): string | null {
  return state.chain[state.attempt] ?? null
}

/** The cover is asked to show something else (`src`, `fallbacks` or `identity` changed). */
export function coverInputChanged(state: CoverShowing, input: CoverInput): CoverShowing {
  if (state.shown === null || input.identity !== state.identity) return startCover(input)
  const chain = chainOf(input)
  if (chain.length === state.chain.length && chain.every((url, index) => url === state.chain[index])) return state
  // Another size of what is in view: the same cover, swapped for the size once it has loaded.
  if (chain.length && artworkOf(chain[0]!) === artworkOf(state.shown)) return { ...state, chain, attempt: 0, srcset: true }
  // Another artwork, or none: the Book's cover is another now, here as everywhere else it shows.
  return startCover(input)
}

/** An image loaded and is not blank: `url` (the image's `currentSrc`) is in view. */
export function coverShown(state: CoverShowing, url: string): CoverShowing {
  return { ...state, shown: url }
}

/**
 * The image at `url` (its `currentSrc`) failed or came back blank. A size of
 * the artwork in view failing leaves that artwork in view, at the size that
 * loaded. The one in view failing, or one before any was, moves to the next
 * size of the same artwork, then the Placeholder.
 */
export function coverFailed(state: CoverShowing, url: string): CoverShowing {
  const shown = state.shown
  if (shown !== null && url !== shown && artworkOf(url) === artworkOf(shown)) {
    const rest = state.chain.slice(state.attempt + 1).filter((next) => next !== shown)
    return { ...state, chain: [shown, ...rest], attempt: 0, srcset: false }
  }
  const attempt = state.attempt + 1
  if (attempt < state.chain.length) return { ...state, attempt, shown: null, srcset: true }
  return { ...state, attempt, shown: null }
}
