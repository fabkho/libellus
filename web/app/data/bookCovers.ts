import type { Book, BookSnapshot } from './books.ts'
import { resolveBookCover, resolveOwnCover, verifyCover, type ProbeImage, type ResolvedCover } from './covers.ts'

/**
 * A Book's Cover, the whole chain behind one door. The order and the rules
 * live in `covers.ts` (Apple artwork → Apple by ISBN → OpenLibrary by cover id
 * → OpenLibrary by ISBN → the Placeholder cover; a low-resolution image kept
 * as the fallback; an own cover kept whatever it is); this is what a caller
 * hands them — the probe, the Apple lookup and the time the chain has — so no
 * screen or store assembles the same three pieces by hand and drifts from the
 * next one that does (issue #1, Covers).
 */

/** Apple's edition with this ISBN-13: what `CoverSources.lookupAppleIsbn` asks for. */
export type AppleIsbnLookup = (isbn13: string) => Promise<BookSnapshot | null>

export type BookCoversDeps = {
  /** Reads an image's pixels: the browser's, in the app. */
  probe: ProbeImage
  /** Apple's edition by ISBN; optional, so a probe-only caller (an import) still resolves the artwork and OpenLibrary. */
  lookupAppleIsbn?: AppleIsbnLookup
  /** How long a Cover may take before the Book goes in with what it has; 6000 ms when not said. */
  budgetMs?: number
}

export type BookCovers = {
  /** The Cover of a Book entering the Catalogue, by the chain. A Book already in it (`id`) keeps its own. */
  resolveCatalogue(book: BookSnapshot | Book): Promise<ResolvedCover>
  /** The Cover of the member's own edition ("My edition isn't listed"): her image if she gave one, else the chain. */
  resolveOwn(book: BookSnapshot): Promise<ResolvedCover>
  /** Whether one address will do as a Cover (a low-resolution one does), with its thumbhash and colours. */
  verifyAddress(url: string, budgetMs?: number): Promise<ResolvedCover | null>
}

export function createBookCovers(deps: BookCoversDeps): BookCovers {
  const sources = {
    probe: deps.probe,
    ...(deps.lookupAppleIsbn ? { lookupAppleIsbn: deps.lookupAppleIsbn } : {}),
    ...(deps.budgetMs === undefined ? {} : { budgetMs: deps.budgetMs }),
  }

  return {
    async resolveCatalogue(book) {
      // The Catalogue keeps its first snapshot: a Book that is already in it has its Cover.
      if ('id' in book) return { coverUrl: book.coverUrl, coverThumbhash: book.coverThumbhash, coverColors: book.coverColors }
      return resolveBookCover(book, sources)
    },
    resolveOwn: (book) => resolveOwnCover(book, sources),
    verifyAddress: (url, budgetMs) => verifyCover(url, { probe: sources.probe, ...(budgetMs === undefined ? {} : { budgetMs }) }),
  }
}
