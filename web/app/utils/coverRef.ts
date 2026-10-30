import { APPLE_BOX, coverChain, coverSizes, coverSrc, coverSrcset, type CoverSize } from './cover'
import { coverFor, coverPixels, type CoverFor } from './coverSize'
import { isOwnCoverKey, ownCoverUrl, ownCoverWidths } from './ownCoverPath'

/**
 * The one place a Book's cover image is decided (docs/plans/owned-covers.md §1, §9 PR 4), whatever the screen:
 *
 * 1. **our own stored copy** (`/c/<cover_key>/<width>`, functions/c/[[path]].js) at the width that is sharp, when the
 *    Book has one (`coverKey` and `coverWidths`, from `books.cover_key` / `cover_widths`) and the switch is on
 *    (`NUXT_PUBLIC_OWN_COVERS`, `useCoverHosts()`);
 * 2. else **`/cover`**, our edge cache of the two cover hosts (`coverFor`, utils/coverSize.ts), when that is on too;
 * 3. else **the source's own address** (`coverUrl`, at the size).
 *
 * **One Book, one cover** (docs/plans/covers-consistency.md): every step is the same artwork. The stored copy is the
 * Book's `coverUrl` at several widths, so a copy that fails (a 404 for a copy not stored, the Function down) falls to
 * `/cover` and the source, never to another picture. A Book without a `coverUrl` has no image, whatever else it
 * carries: the database hands the key out exactly with the address (a hidden cover hides both), and a key beside no
 * address is not trusted.
 *
 * ```ts
 * const hosts = useCoverHosts()                                // { proxy, own }
 * const { src, srcset, sizes, fallbacks } = coverImage(book, 'sm', hosts)   // a token-sized cover (UiCover)
 * const texture = coverAt(book, { height: 300, dpr, origin, ...hosts })     // any other size (the reel)
 * ```
 *
 * Framework-free: the switch and the origin come in as arguments, like every utility here.
 */

/** What decides each step: `proxy` is `/cover` (`useCoverProxy`), `own` our stored copies (`useOwnCovers`). */
export type CoverHosts = { proxy?: boolean; own?: boolean }

/** The fields of a Book (or a social Book, a work's card) the image is decided by; each may be absent (an older copy, a search result). */
export type CoverBook = {
  coverUrl?: string | null
  coverKey?: string | null
  coverWidths?: readonly number[] | null
}

/** A cover to hand to `UiCover` (its `src`, `srcset`, `sizes` and `fallbacks` props, which win over `ui.cover.sources`). */
export type CoverImage = { src: string | null; srcset: string | null; sizes: string; fallbacks: string[] }

/** The stored copy of a Book, when it can be used: its key is a key, it has widths of the copy, and there is a cover to be a copy of. */
function stored(book: CoverBook, hosts: CoverHosts): { key: string; widths: number[] } | null {
  if (!hosts.own || !book.coverUrl || !isOwnCoverKey(book.coverKey)) return null
  const widths = ownCoverWidths(book.coverWidths)
  return widths.length ? { key: book.coverKey, widths } : null
}

/** The smallest stored width that is at least `pixels`; the widest when none is (nothing is upscaled, so nothing wider exists). */
export function ownWidthFor(widths: readonly number[], pixels: number): number {
  return widths.find((width) => width >= pixels) ?? widths[widths.length - 1]!
}

/**
 * The image of a Book's cover shown at a token size (`xs` … `xl`): `src`, the `srcset` of the stored widths up to the one
 * that size asks for (so the browser takes the narrowest that is sharp at its pixel ratio), the `sizes` of its token
 * width, and the `fallbacks` to try when `src` fails, in order: `/cover`, then the source's addresses (utils/cover.ts,
 * `coverChain`). With no stored copy, or with the switch off, this is exactly what `ui.cover.sources` makes of the
 * Book's `coverUrl` today. No cover: `src` null and nothing else.
 */
export function coverImage(book: CoverBook | null | undefined, size: CoverSize, hosts: CoverHosts = {}): CoverImage {
  const sizes = coverSizes(size)
  if (!book?.coverUrl) return { src: null, srcset: null, sizes, fallbacks: [] }
  // The source's own chain, asked through `/cover` first when that is on (`coverSrc` makes the address, `coverChain` the rest).
  const chain = coverChain(coverSrc(book.coverUrl, size, hosts.proxy), size)
  const own = stored(book, hosts)
  if (!own) return { src: chain[0] ?? null, srcset: coverSrcset(chain[0], size), sizes, fallbacks: chain.slice(1) }
  const width = ownWidthFor(own.widths, APPLE_BOX[size][0])
  const candidates = own.widths.filter((candidate) => candidate <= width)
  const src = ownCoverUrl(own.key, width)
  return {
    src,
    srcset: candidates.length > 1 ? candidates.map((candidate) => `${ownCoverUrl(own.key, candidate)} ${candidate}w`).join(', ') : null,
    sizes,
    fallbacks: chain,
  }
}

/**
 * The image of a Book's cover drawn at a size no token names (the "You both read" reel's cards, a texture): the smallest
 * that is still sharp for `width` / `height` (CSS pixels) at `dpr`. Our stored copy where there is one (`origin`: the page's,
 * for an address a canvas or a worker loads), else `coverFor` (`/cover` when `proxy`, else the source). One address, no
 * chain: what loads it cannot try another, so the copy is only handed out where the Book has one. Null without a cover.
 */
export function coverAt(book: CoverBook | null | undefined, options: CoverFor & CoverHosts): string | null {
  if (!book?.coverUrl) return null
  const { own, ...size } = options
  const copy = stored(book, { own })
  if (!copy) return coverFor(book.coverUrl, size)
  return ownCoverUrl(copy.key, ownWidthFor(copy.widths, coverPixels(size)), options.origin)
}
