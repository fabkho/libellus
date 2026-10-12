/**
 * Which cover wins when several sources have one for the same work: ONE rule,
 * for the import's cover fill and (later) the edition picker, the scan and the
 * catalogue check. Owner decision: the work's ebook is a first-class route (the
 * APIs know ebooks best, and the cover of a publisher's ebook is the print
 * cover in most cases), so a cover from the work's ebook edition beats another
 * print edition's.
 *
 *   exact       the very edition: its Apple artwork, Open Library's cover for its ISBN
 *   ebook       the same work's ebook edition (Apple Books, the row's storefront first, then the other)
 *   sameWork    another edition of the same work (an Open Library work's cover, a sibling print edition)
 *   goodreads   Goodreads' own cover for the row's title (a last resort, flagged: docs/covers.md)
 *   placeholder no image: the cloth cover UiCover draws (cover_url stays null so a better one can still come)
 *
 * A cover that is not `exact` is lent (`coverFrom`): the Book and the entry keep
 * their own edition facts, and a better cover replaces a lent one.
 * Framework-free; no I/O.
 */
export type CoverKind = 'exact' | 'ebook' | 'sameWork' | 'goodreads' | 'placeholder'

/** Best first. */
export const COVER_KINDS: readonly CoverKind[] = ['exact', 'ebook', 'sameWork', 'goodreads', 'placeholder']

/** Pixel height each source's cover has once asked for large (docs/covers.md): the tie-break inside one kind. */
export const COVER_HEIGHT = { apple: 900, openlibrary: 500, goodreads: 500, google: 128 } as const

export function coverRank(kind: CoverKind): number {
  return COVER_KINDS.indexOf(kind)
}

/** The better of two kinds (the first on a tie: a cover found stays). */
export function betterCover(a: CoverKind, b: CoverKind): CoverKind {
  return coverRank(b) < coverRank(a) ? b : a
}

/** What the fill's source says about the kind of cover it found. */
export function coverKindOf(source: 'sibling' | 'openlibrary' | 'work' | 'search' | 'goodreads', url: string): CoverKind {
  if (source === 'openlibrary') return 'exact'
  if (source === 'goodreads') return 'goodreads'
  // Apple's catalogue is ebooks: a sibling or a search hit there is the work's ebook.
  if (/mzstatic\.com\//.test(url)) return 'ebook'
  return 'sameWork'
}

/** Only an `exact` cover is the Book's own; any other is lent and open to replacement. */
export const isLent = (kind: CoverKind): boolean => kind !== 'exact' && kind !== 'placeholder'
