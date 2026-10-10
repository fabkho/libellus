import type { EntryStatus } from '../library'
import { plainText } from '../apple'
import { readCsv, canonicalRows, type Row } from './csv'
import { normalize, splitSeriesTitle } from './readingTracker'
import {
  clipReview,
  collectionNames,
  field,
  importDay,
  importKey,
  importRating,
  isAbandonedShelf,
  isbnPair,
  isMangledIsbn,
  MAX_EXTRA_READS,
  mapRows,
  missingColumns,
  MissingColumnsError,
  positive,
  splitRatingReview,
  tidy,
  yearOf,
  type ImportAdapter,
  type ImportBook,
  type ImportFile,
  type ImportProblem,
  type ImportSession,
  type SkippedRow,
} from './rows'

/**
 * The Goodreads adapter of the import (issues #40, #111): one row of a
 * Goodreads library export (CSV) → the normalised import row (rows.ts). Other
 * apps that write Goodreads-compatible CSV are read the same way.
 *
 * The file, as Goodreads writes it (verified against real exports, #111):
 * - header `Book Id, Title, Author, Author l-f, Additional Authors, ISBN,
 *   ISBN13, My Rating, Average Rating, Publisher, Binding, Number of Pages,
 *   Year Published, Original Publication Year, Date Read, Date Added,
 *   Bookshelves, Bookshelves with positions, Exclusive Shelf, My Review,
 *   Spoiler, Private Notes, Read Count, Owned Copies`; newer exports leave
 *   `Average Rating` out, and only Title, Author and Exclusive Shelf are needed;
 * - ISBNs wrapped as `="9780553283686"`, often `=""` (ebooks especially);
 * - dates `YYYY/MM/DD`; `Date Read` often empty even on `read`;
 * - `Exclusive Shelf` `read`, `to-read`, `currently-reading` or a custom one;
 *   `Bookshelves` every shelf of the row, the exclusive one included;
 * - `My Rating` 0 (unrated) to 5 whole stars; `Read Count` 0 to n;
 * - titles carry their series: `Howling Dark (Sun Eater, #2)`;
 * - `My Review` is HTML (`<br/>`).
 *
 * The mapping:
 * - `read` → Finished, one finished session: ended on Date Read (or no day),
 *   no start; Rating = stars × 4 (quarter stars); review = My Review as text;
 *   a Read Count above 1 adds that many earlier finished reads, undated;
 * - a did-not-finish shelf (`dnf`, `abandoned`, …, #64) → Finished, one
 *   abandoned session ended on Date Read; no rating (only finished reads have one);
 * - `currently-reading` → Currently reading, an open session started on
 *   Date Added (today when it has none); earlier reads as for `read`;
 * - `to-read` and any other shelf → Want to read, no session;
 * - every shelf that is not one of these (`favourites`, `sci-fi`, a custom
 *   exclusive one like `wishlist`) → a Collection the preview offers;
 * - the Book: title without its series, authors, ISBN, pages, year,
 *   publisher, as a fallback for when no source knows the edition; the pages
 *   also become her own page count when the edition found has others (#111).
 *
 * Every entry and session carries the row's key (`goodreads:<Book Id>`), which
 * the database stores, so importing the same file again adds nothing.
 */

export const GOODREADS_KEY_PREFIX = 'goodreads:'

/** Columns without which a file is not a Goodreads export. */
export const REQUIRED_COLUMNS = ['Title', 'Author', 'Exclusive Shelf'] as const

/** The row's key: `goodreads:<Book Id>`; for exports without Book Ids, the ISBN or the title and author. */
export const goodreadsKey = (bookId: string, book: Pick<ImportBook, 'isbn13' | 'title' | 'authors'>) =>
  importKey('goodreads', bookId, book)

/** Goodreads' own shelves, which are Statuses, not Collections. */
const STATUS_SHELVES = new Set(['read', 'to-read', 'currently-reading'])

/** Her shelves of a row that would make Collections: neither a Status nor did-not-finish. */
function collectionShelves(bookshelves: string, exclusive: string): string[] {
  return collectionNames([...bookshelves.split(','), exclusive], (name) => STATUS_SHELVES.has(name.toLowerCase()) || isAbandonedShelf(name))
}

/** Maps one row. `today` (`YYYY-MM-DD`, the member's) bounds the dates. A skipped row when it cannot be a book. */
export function mapGoodreadsRow(row: Row, index: number, today: string): ImportBook | SkippedRow {
  const problems: ImportProblem[] = []
  const rawTitle = tidy(field(row, 'Title'))
  const number = index + 1
  if (!rawTitle) return { row: number, title: '', problem: { code: 'noTitle' } }

  const { title, seriesTitle } = splitSeriesTitle(rawTitle)
  const names = [field(row, 'Author'), ...field(row, 'Additional Authors').split(',')].map(tidy).filter(Boolean)
  const authors = [...new Map(names.map((name) => [normalize(name), name])).values()]
  const { isbn13, isbn10 } = isbnPair(field(row, 'ISBN13'), field(row, 'ISBN'))
  if (!isbn13 && (isMangledIsbn(field(row, 'ISBN13')) || isMangledIsbn(field(row, 'ISBN')))) problems.push({ code: 'isbnMangled' })

  const day = (name: string) => {
    const value = importDay(field(row, name), today)
    if (value === 'invalid') {
      if (!problems.some((problem) => problem.code === 'dateInvalid')) problems.push({ code: 'dateInvalid' })
      return null
    }
    return value
  }
  const addedOn = day('Date Added')
  const readOn = day('Date Read')

  let rating = importRating(field(row, 'My Rating'))
  if (rating === undefined) {
    problems.push({ code: 'ratingInvalid' })
    rating = null
  }
  // A review that is only a number is a rating written as text: it is the rating when there is none, not a review.
  const split = splitRatingReview(plainText(field(row, 'My Review') || undefined) ?? null, rating, problems)
  rating = split.rating
  const review = clipReview(split.review, problems)

  const shelf = field(row, 'Exclusive Shelf') || 'to-read'
  const shelfName = shelf.toLowerCase()
  // Read Count counts every read Goodreads knows, the current one included.
  const readCount = positive(field(row, 'Read Count')) ?? 0
  let status: EntryStatus
  let session: ImportSession | null = null
  let extraReads = 0
  if (shelfName === 'read') {
    status = 'finished'
    session = { startedOn: null, endedOn: readOn, outcome: 'finished', rating, review }
    extraReads = readCount - 1
  } else if (isAbandonedShelf(shelf)) {
    status = 'finished'
    if (rating !== null) problems.push({ code: 'abandonedRating' })
    session = { startedOn: null, endedOn: readOn, outcome: 'abandoned', rating: null, review }
    extraReads = readCount - 1
  } else {
    if (shelfName === 'currently-reading') {
      status = 'reading'
      session = { startedOn: addedOn ?? today, endedOn: null, outcome: null, rating: null, review: null }
      extraReads = readCount - 1
    } else {
      status = 'want_to_read'
      if (shelfName !== 'to-read') problems.push({ code: 'otherShelf', shelf })
    }
    if (rating !== null || review) problems.push({ code: 'notFinishedRating' })
  }
  extraReads = Math.min(MAX_EXTRA_READS, Math.max(0, extraReads))
  if (extraReads) problems.push({ code: 'extraReads', count: extraReads })

  const bindingText = tidy(field(row, 'Binding'))
  const book = {
    title: title.slice(0, 500),
    series: seriesTitle,
    authors,
    isbn13,
    isbn10,
    pageCount: positive(field(row, 'Number of Pages')),
    year: yearOf(field(row, 'Year Published')) ?? yearOf(field(row, 'Original Publication Year')),
    originalYear: yearOf(field(row, 'Original Publication Year')),
    binding: bindingText && bindingText !== 'Unknown Binding' ? bindingText : null,
    language: null,
    publisher: tidy(field(row, 'Publisher')) || null,
  }
  const bookId = field(row, 'Book Id')
  return {
    source: 'goodreads',
    key: goodreadsKey(bookId, book),
    sourceId: /^\d{1,12}$/.test(bookId) ? bookId : null,
    row: number,
    ...book,
    shelf,
    shelves: collectionShelves(field(row, 'Bookshelves'), shelf),
    status,
    session,
    earlierReads: [],
    extraReads,
    otherKeys: [],
    addedOn,
    problems,
  }
}

export const goodreadsAdapter: ImportAdapter = {
  source: 'goodreads',
  required: REQUIRED_COLUMNS,
  signature: {
    'Exclusive Shelf': 3,
    'Author l-f': 3,
    'Bookshelves with positions': 3,
    'My Rating': 2,
    'My Review': 2,
    'Owned Copies': 2,
    'Book Id': 1,
    Bookshelves: 1,
    'Date Read': 1,
    'Read Count': 1,
    'Additional Authors': 1,
    ISBN13: 1,
    'Number of Pages': 1,
    'Original Publication Year': 1,
    'Year Published': 1,
  },
  columns: [
    'Book Id', 'Title', 'Author', 'Author l-f', 'Additional Authors', 'ISBN', 'ISBN13', 'My Rating', 'Average Rating',
    'Publisher', 'Binding', 'Number of Pages', 'Year Published', 'Original Publication Year', 'Date Read', 'Date Added',
    'Bookshelves', 'Bookshelves with positions', 'Exclusive Shelf', 'My Review', 'Spoiler', 'Private Notes', 'Read Count',
    'Owned Copies',
  ],
  map: mapGoodreadsRow,
}

/**
 * A file read as a Goodreads export, whatever else its header says (detect.ts
 * decides which adapter a file gets). Throws MissingColumnsError without the
 * columns a Goodreads row needs.
 */
export function parseGoodreads(text: string, today: string): ImportFile {
  const { columns, rows } = readCsv(text)
  const missing = missingColumns(goodreadsAdapter, columns)
  if (missing.length) throw new MissingColumnsError('goodreads', missing)
  return mapRows(goodreadsAdapter, canonicalRows(rows, columns, goodreadsAdapter.columns), today)
}
