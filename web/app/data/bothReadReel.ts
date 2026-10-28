import { bookColour } from '../utils/bookColour'
import { coverSrc } from '../utils/cover'
import { shownBook } from '../utils/unverifiedBook'
import { LIBRARY_FILE_VERSION, type LibraryBook, type RegalLibraryFile } from './export/regalLibraryFile'
import type { BothRead } from './socialShapes'

/**
 * "You both read" as a Regal reel (docs/plans/shared-books-slideshow.md, F and H): the answer of `both_read`
 * turned into the in-memory library document `RegalBooksReel` takes, and nothing else.
 *
 * **What reaches Regal is a whitelist.** A friend's data crosses into the canvas only here, and only these keys:
 * a Book's `id`, `title`, `authors`, `status` (always `read`) and its `assets` (`front`, `pile.front`, `color`).
 * Never her rating, the day she finished, the caller's own read, a page count, a blurb or a review, even where
 * the answer carries them: the pills and the sheet's meta line are drawn by Libellus from its own `BothRead`
 * (by Book id) through the reel's slots. `tests/both-read-reel.test.ts` pins the keys, so a later change that
 * feeds more into the document fails there first.
 *
 * Her edition is the one shown (as the row did). A Book the check could not confirm (`unverified`) carries no
 * title, authors or cover: the one string `outside` stands in as the title, the Book gets its Placeholder's
 * colour and no image (`shownBook`). Pure and framework-free: a native port copies it.
 */

/** Books in the reel: the newest of hers; the text list shows all of them (the plan's G, question 6). */
export const BOTH_READ_REEL_LIMIT = 24

/** The keys a Book of the document may have: the privacy whitelist (tests/both-read-reel.test.ts). */
export const REEL_BOOK_KEYS = ['id', 'title', 'authors', 'status', 'assets'] as const
/** The keys of its `assets`. */
export const REEL_ASSET_KEYS = ['front', 'pile', 'color'] as const

export type BothReadReelOptions = {
  /** The one string an unverified Book shows as its title (i18n `book.outsideCatalogue`). */
  outside: string
  /** Only the newest this many; default `BOTH_READ_REEL_LIMIT`. */
  limit?: number
  /** `generatedAt`: default now. */
  generatedAt?: string
}

/** The Books the reel (and its poster) show: hers newest first, each Book once, the first `limit`. */
export function reelItems(items: readonly BothRead[], limit: number = BOTH_READ_REEL_LIMIT): BothRead[] {
  const seen = new Set<string>()
  const kept: BothRead[] = []
  for (const item of items) {
    if (seen.has(item.book.id)) continue
    seen.add(item.book.id)
    kept.push(item)
    if (kept.length >= limit) break
  }
  return kept
}

/** One Book of the document, from nothing but the Book `both_read` gives (and `outside` for an unverified one). */
export function reelBook(book: BothRead['book'], outside: string): LibraryBook {
  const shown = shownBook(book, outside)
  // The cover as the app stores it: the front at `xl` (the Book in front), a small copy for the rest.
  const front = coverSrc(shown.coverUrl, 'xl')
  const small = coverSrc(shown.coverUrl, 'md')
  return {
    id: book.id,
    title: shown.title,
    authors: [...shown.authors],
    status: 'read',
    assets: {
      ...(front ? { front } : {}),
      ...(front && small && small !== front ? { pile: { front: small } } : {}),
      color: bookColour(shown).colour,
    },
  }
}

/** `both_read`'s answer as the reel's library document. */
export function bothReadReelDocument(items: readonly BothRead[], options: BothReadReelOptions): RegalLibraryFile {
  return {
    version: LIBRARY_FILE_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    generator: 'libellus-both-read',
    books: reelItems(items, options.limit).map((item) => reelBook(item.book, options.outside)),
  }
}
