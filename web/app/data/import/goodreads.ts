import Papa from 'papaparse'
import { isValidIsbn10, isValidIsbn13, isbn10To13, type BookSnapshot } from '../books'
import type { EntryStatus } from '../library'
import { REVIEW_MAX_LENGTH } from '../library'
import { plainText } from '../apple'
import { normalize, splitSeriesTitle, surname, workTitle } from './readingTracker'

/**
 * The pure step of the Goodreads import (issue #40): a Goodreads library
 * export (CSV) → the Books, Library entries and Reading sessions it stands
 * for. One format covers Fable too: the browser extensions Fable members use
 * (ShelfBridge, Fable Xport) write Goodreads-compatible CSV. No I/O: the
 * lookups that turn a row into a Catalogue Book and the writes come after
 * (data/goodreadsImport.ts).
 *
 * The file, as Goodreads writes it (verified against real exports):
 * - header `Book Id, Title, Author, Author l-f, Additional Authors, ISBN,
 *   ISBN13, My Rating, Average Rating, Publisher, Binding, Number of Pages,
 *   Year Published, Original Publication Year, Date Read, Date Added,
 *   Bookshelves, Bookshelves with positions, Exclusive Shelf, My Review,
 *   Spoiler, Private Notes, Read Count, Owned Copies`; newer exports leave
 *   `Average Rating` out, and only Title, Author and Exclusive Shelf are needed;
 * - quoted fields with commas and line breaks (reviews), a BOM at the start;
 * - ISBNs wrapped as `="9780553283686"`, often `=""`;
 * - dates `YYYY/MM/DD`; `Date Read` often empty even on `read`;
 * - `Exclusive Shelf` `read`, `to-read`, `currently-reading` or a custom one;
 * - `My Rating` 0 (unrated) to 5 whole stars;
 * - titles carry their series: `Howling Dark (Sun Eater, #2)`;
 * - `My Review` is HTML (`<br/>`).
 *
 * The mapping:
 * - `read` → Finished, one finished session: ended on Date Read (or no day),
 *   no start; Rating = stars × 4 (quarter stars); review = My Review as text;
 * - `currently-reading` → Currently reading, an open session started on
 *   Date Added (today when it has none);
 * - `to-read` and any other shelf → Want to read, no session;
 * - the Book: title without its series, authors, ISBN, pages, year,
 *   publisher, as a fallback for when no source knows the edition.
 *
 * Every entry and session carries the row's key (`goodreads:<Book Id>`), which
 * the database stores, so importing the same file again adds nothing.
 */

export const GOODREADS_KEY_PREFIX = 'goodreads:'

/** Columns without which a file is not a Goodreads export. */
export const REQUIRED_COLUMNS = ['Title', 'Author', 'Exclusive Shelf'] as const

export class NotAGoodreadsExportError extends Error {
  constructor(readonly missing: string[]) {
    super(`Not a Goodreads library export: no ${missing.join(', ')} column`)
    this.name = 'NotAGoodreadsExportError'
  }
}

/**
 * Something about a row the member should know: it was carried over with a
 * change, or not at all (`skipped`). Codes are copy keys (`import.problem.<code>`).
 */
export type GoodreadsProblem =
  /** A custom exclusive shelf (`wishlist`): added as Want to read. */
  | { code: 'otherShelf'; shelf: string }
  /** A rating or review on a book that is not finished: left out (only finished reads have them). */
  | { code: 'notFinishedRating' }
  /** A rating that is not 0–5 whole stars: left out. */
  | { code: 'ratingInvalid' }
  /** A Date Read or Date Added that is no day, or later than today: left out. */
  | { code: 'dateInvalid' }
  /** A review over the length a session keeps: cut. */
  | { code: 'reviewTooLong' }
  /** A row with no title: skipped. */
  | { code: 'noTitle' }
  /** The same book twice in the file (same Book Id): the second skipped. */
  | { code: 'duplicate' }

export type GoodreadsSession = {
  startedOn: string | null
  endedOn: string | null
  /** `finished` for a read book; null for the open read of one being read. */
  outcome: 'finished' | null
  /** Integer quarters (4, 8, … 20), only on a finished read. */
  rating: number | null
  review: string | null
}

/** One row of the file, mapped. */
export type GoodreadsBook = {
  /** `goodreads:<Book Id>`; for exports without Book Ids, the ISBN or the title and author. */
  key: string
  /** Its place among the file's books, from 1. */
  row: number
  /** Without the series: "Howling Dark". */
  title: string
  /** "Sun Eater, #2", or null. */
  series: string | null
  authors: string[]
  isbn13: string | null
  isbn10: string | null
  pageCount: number | null
  year: number | null
  publisher: string | null
  /** The file's exclusive shelf, as written. */
  shelf: string
  /** What the database will derive from the session. */
  status: EntryStatus
  session: GoodreadsSession | null
  /** Date Added: the day it entered the Library. */
  addedOn: string | null
  problems: GoodreadsProblem[]
}

export type SkippedRow = { row: number; title: string; problem: GoodreadsProblem }

export type GoodreadsFile = { books: GoodreadsBook[]; skipped: SkippedRow[] }

type Row = Record<string, string | undefined>

const field = (row: Row, name: string): string => (row[name] ?? '').trim()

/** Names as people write them: one space between words ("Robert   Harris" → "Robert Harris"). */
const tidy = (value: string) => value.replace(/\s+/g, ' ').trim()

/**
 * A day from the file (`2024/03/09`, also `2024-03-09`) as `YYYY-MM-DD`; null
 * for an empty field. `invalid` for a value that is no calendar day or lies
 * after `today`.
 */
export function goodreadsDay(value: string, today: string): string | null | 'invalid' {
  const text = value.trim()
  if (!text) return null
  const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(text)
  if (!match) return 'invalid'
  const [year, month, dayOfMonth] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, dayOfMonth))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== dayOfMonth) return 'invalid'
  const day = `${match[1]}-${String(month).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`
  return day > today ? 'invalid' : day
}

/** `="9780553283686"`, `="0553283685"`, `=""` → the ISBN-13 (an ISBN-10 converted) and the ISBN-10. Bad check digits are no ISBN. */
export function goodreadsIsbn(isbn13Field: string, isbnField: string): { isbn13: string | null; isbn10: string | null } {
  const digits = (value: string) => value.replace(/[^0-9Xx]/g, '').toUpperCase()
  const thirteen = digits(isbn13Field)
  const ten = digits(isbnField)
  const isbn10 = isValidIsbn10(ten) ? ten : null
  const isbn13 = isValidIsbn13(thirteen) ? thirteen : isbn10 ? isbn10To13(isbn10) : null
  return { isbn13, isbn10 }
}

/** Stars 1–5 as integer quarters; 0 or empty is unrated. Undefined for anything else. */
export function goodreadsRating(value: string): number | null | undefined {
  const text = value.trim()
  if (!text || text === '0') return null
  const stars = Number(text)
  return Number.isInteger(stars) && stars >= 1 && stars <= 5 ? stars * 4 : undefined
}

const positive = (value: string): number | null => {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

const yearOf = (value: string): number | null => {
  const parsed = positive(value)
  return parsed && parsed <= 2100 ? parsed : null
}

/** What an import key may hold: no spaces (the database checks `^[a-z]+:\S+$`). */
const keyPart = (value: string) => value.replace(/\s+/g, '-')

/**
 * The row's key: `goodreads:<Book Id>`. Exports made by other apps leave the
 * Book Id empty; then the ISBN, else the title and author, so the same file
 * still finds its rows again.
 */
export function goodreadsKey(bookId: string, book: Pick<GoodreadsBook, 'isbn13' | 'title' | 'authors'>): string {
  if (/^\d+$/.test(bookId)) return `${GOODREADS_KEY_PREFIX}${bookId}`
  if (book.isbn13) return `${GOODREADS_KEY_PREFIX}isbn-${book.isbn13}`
  return `${GOODREADS_KEY_PREFIX}t-${keyPart(`${workTitle(book.title)}|${surname(book.authors[0])}`)}`
}

/** Reads the file into rows. Throws NotAGoodreadsExportError when the columns it needs are missing. */
export function readGoodreadsCsv(text: string): Row[] {
  const parsed = Papa.parse<Row>(text.replace(/^\uFEFF/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (name) => name.replace(/^\uFEFF/, '').trim(),
  })
  const columns = parsed.meta.fields ?? []
  const missing = REQUIRED_COLUMNS.filter((name) => !columns.includes(name))
  if (missing.length) throw new NotAGoodreadsExportError(missing)
  return parsed.data
}

/** Maps one row. `today` (`YYYY-MM-DD`, the member's) bounds the dates. Null with a problem when the row cannot be a book. */
export function mapGoodreadsRow(row: Row, index: number, today: string): GoodreadsBook | SkippedRow {
  const problems: GoodreadsProblem[] = []
  const rawTitle = tidy(field(row, 'Title'))
  const number = index + 1
  if (!rawTitle) return { row: number, title: '', problem: { code: 'noTitle' } }

  const { title, seriesTitle } = splitSeriesTitle(rawTitle)
  const names = [field(row, 'Author'), ...field(row, 'Additional Authors').split(',')].map(tidy).filter(Boolean)
  const authors = [...new Map(names.map((name) => [normalize(name), name])).values()]
  const { isbn13, isbn10 } = goodreadsIsbn(field(row, 'ISBN13'), field(row, 'ISBN'))

  const day = (name: string) => {
    const value = goodreadsDay(field(row, name), today)
    if (value === 'invalid') {
      if (!problems.some((problem) => problem.code === 'dateInvalid')) problems.push({ code: 'dateInvalid' })
      return null
    }
    return value
  }
  const addedOn = day('Date Added')
  const readOn = day('Date Read')

  let rating = goodreadsRating(field(row, 'My Rating'))
  if (rating === undefined) {
    problems.push({ code: 'ratingInvalid' })
    rating = null
  }
  let review = plainText(field(row, 'My Review') || undefined)
  if (review && review.length > REVIEW_MAX_LENGTH) {
    problems.push({ code: 'reviewTooLong' })
    review = review.slice(0, REVIEW_MAX_LENGTH).trimEnd()
  }

  const shelf = field(row, 'Exclusive Shelf') || 'to-read'
  let status: EntryStatus
  let session: GoodreadsSession | null = null
  if (shelf === 'read') {
    status = 'finished'
    session = { startedOn: null, endedOn: readOn, outcome: 'finished', rating, review }
  } else {
    if (shelf === 'currently-reading') {
      status = 'reading'
      session = { startedOn: addedOn ?? today, endedOn: null, outcome: null, rating: null, review: null }
    } else {
      status = 'want_to_read'
      if (shelf !== 'to-read') problems.push({ code: 'otherShelf', shelf })
    }
    if (rating !== null || review) problems.push({ code: 'notFinishedRating' })
  }

  const book = {
    title: title.slice(0, 500),
    series: seriesTitle,
    authors,
    isbn13,
    isbn10,
    pageCount: positive(field(row, 'Number of Pages')),
    year: yearOf(field(row, 'Year Published')) ?? yearOf(field(row, 'Original Publication Year')),
    publisher: tidy(field(row, 'Publisher')) || null,
  }
  return {
    key: goodreadsKey(field(row, 'Book Id'), book),
    row: number,
    ...book,
    shelf,
    status,
    session,
    addedOn,
    problems,
  }
}

/**
 * Reads and maps a whole export. Pure: the same text and day always give the
 * same books. A book listed twice (same key) is taken once.
 */
export function parseGoodreads(text: string, today: string): GoodreadsFile {
  const books: GoodreadsBook[] = []
  const skipped: SkippedRow[] = []
  const keys = new Set<string>()
  readGoodreadsCsv(text).forEach((row, index) => {
    const mapped = mapGoodreadsRow(row, index, today)
    if (!('key' in mapped)) {
      skipped.push(mapped)
    } else if (keys.has(mapped.key)) {
      skipped.push({ row: mapped.row, title: mapped.title, problem: { code: 'duplicate' } })
    } else {
      keys.add(mapped.key)
      books.push(mapped)
    }
  })
  return { books, skipped }
}

/** How many books go to each Status. */
export function countByStatus(books: readonly Pick<GoodreadsBook, 'status'>[]): Record<EntryStatus, number> {
  const counts: Record<EntryStatus, number> = { want_to_read: 0, reading: 0, finished: 0 }
  for (const book of books) counts[book.status]++
  return counts
}

/**
 * The Book a row stands for when no source knows its edition: an `import`
 * Catalogue Book when it has an ISBN (the Catalogue's key), else the member's
 * own Manual book. Its cover is resolved later, if there is one to find.
 */
export function bookFromRow(book: GoodreadsBook): BookSnapshot {
  return {
    title: book.title,
    authors: book.authors,
    isbn13: book.isbn13,
    isbn10: book.isbn10,
    pageCount: book.pageCount,
    year: book.year,
    language: null,
    publisher: book.publisher,
    description: null,
    coverUrl: null,
    coverThumbhash: null,
    coverColors: null,
    source: book.isbn13 ? 'import' : 'manual',
    appleId: null,
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

/** What a title search asks: the title (no series) and the first author. */
export function titleQuery(book: Pick<GoodreadsBook, 'title' | 'authors'>): string {
  return [book.title, book.authors[0] ?? ''].join(' ').trim()
}

/**
 * Whether a search result is the row's book (another edition is fine): the
 * same title once brackets and subtitles are dropped, and the first author's
 * surname among the result's authors. A title search only takes a result
 * this says yes to.
 */
export function isSameWork(
  row: Pick<GoodreadsBook, 'title' | 'authors'>,
  found: Pick<BookSnapshot, 'title' | 'authors'>,
): boolean {
  const ours = workTitle(row.title)
  const theirs = workTitle(splitSeriesTitle(found.title).title)
  if (!ours || ours !== theirs) return false
  const wanted = surname(row.authors[0])
  if (!wanted) return true
  return found.authors.some((name) => surname(name) === wanted)
}
