/**
 * Pick my next book (PROTOTYPE, #259): a candidate as the deal draws it. The shape is Regal's
 * `DealBook` (RegalBooksDeal, fabkho/regal prototype/pick-next), which the Libellus-only 2D deal
 * (components/pick/Deal2d.vue) reads too. Pure.
 */
import { formatOf, type BookFormat } from '../data/books'
import type { PickCandidate } from '../data/pick'
import { coverSrc } from './cover'

export type DealBook = {
  id: string
  title: string
  author: string | null
  seriesTitle: string | null
  pages: number | null
  binding: string | null
  coverUrl: string | null
  color: string | null
}

/** The rect the winner's cover rests at when the deal ends, in viewport px: where the flight to its page starts. */
export type DealRect = { left: number; top: number; width: number; height: number }
export type DealPicked = { index: number; id: string; rect: DealRect }

/** Regal's binding words (they set a Book's height). */
const BINDING: Record<BookFormat, string> = {
  hardcover: 'Hardcover',
  paperback: 'Paperback',
  ebook: 'Kindle Edition',
  audiobook: 'Audiobook',
}

export function dealBookOf(candidate: PickCandidate): DealBook {
  const book = candidate.book
  const format = formatOf(book)
  return {
    id: candidate.key,
    title: book.title,
    author: book.authors[0] ?? null,
    seriesTitle: null,
    pages: book.pageCount,
    binding: format ? BINDING[format] : null,
    coverUrl: coverSrc(book.coverUrl, 'xl'),
    color: book.coverColors?.dominant ?? null,
  }
}
