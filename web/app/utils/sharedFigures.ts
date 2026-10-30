import type { BothRead, SocialBook } from '~/data/socialShapes'

/**
 * The figures line under "You both read" (plan E 1–3, docs/plans/shared-books-slideshow.md): built from the
 * `both_read` answer alone, so no new privacy surface. Pure: no Vue, no i18n. The screen words them.
 *
 * - `count`: the Books both finished.
 * - `agreement`: of the Books both rated, how many are within half a star (2 quarters, inclusive); null when
 *   no pair has both ratings (her Ratings off: `hers.rating` null).
 * - `disagreement`: the Book with the widest gap between the two ratings, only when that gap is more than half
 *   a star (otherwise there is nothing to link). Ties: the first in the answer's order (newest of hers first).
 * - `firstCount`: how many of the Books she finished before you (`hers.endedOn` before `mine.endedOn`, both
 *   known); null when no pair has both days. 0 is a real answer; the screen decides whether to show it.
 */

/** Half a star, in quarters. */
const HALF_STAR = 2

export type SharedFigures = {
  count: number
  agreement: { agree: number; of: number } | null
  disagreement: { book: SocialBook; hers: number; mine: number } | null
  firstCount: number | null
}

export function sharedFiguresOf(items: readonly BothRead[]): SharedFigures {
  let agree = 0
  let rated = 0
  let widest: { book: SocialBook; hers: number; mine: number; gap: number } | null = null
  let first = 0
  let dated = 0

  for (const item of items) {
    const { mine, hers } = item
    if (mine.rating != null && hers.rating != null) {
      rated++
      const gap = Math.abs(mine.rating - hers.rating)
      if (gap <= HALF_STAR) agree++
      if (!widest || gap > widest.gap) widest = { book: item.book, hers: hers.rating, mine: mine.rating, gap }
    }
    if (mine.endedOn && hers.endedOn) {
      dated++
      if (hers.endedOn < mine.endedOn) first++
    }
  }

  return {
    count: items.length,
    agreement: rated ? { agree, of: rated } : null,
    disagreement: widest && widest.gap > HALF_STAR ? { book: widest.book, hers: widest.hers, mine: widest.mine } : null,
    firstCount: dated ? first : null,
  }
}
