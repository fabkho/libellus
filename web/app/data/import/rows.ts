import { isRatingOnlyReview, looksLikeRatingButIsNot, ratingFromReviewText } from '../../utils/ratingReview'
import { isValidIsbn10, isValidIsbn13, isbn10To13 } from '../books'
import type { EntryStatus } from '../library'
import { REVIEW_MAX_LENGTH } from '../library'
import type { Row } from './csv'
import { surname, workTitle } from './readingTracker'

/**
 * The normalised import row (issue #111): what any supported app's export says
 * about one book, in the words Libellus stores. Each app has an adapter
 * (goodreads.ts, hardcover.ts) that maps its rows to this; everything after —
 * the preview, the edition lookup (data/bookImport.ts), `import_books` — reads
 * only this model, so a new app is one more adapter and nothing else.
 *
 * Pure and framework-free, like everything under data/import/.
 */

/** The apps whose exports Libellus reads. */
export type ImportSource = 'goodreads' | 'hardcover'

/** An earlier read with its days, finished. */
export type ImportRead = { startedOn: string | null; endedOn: string | null }

export type ImportSession = {
  startedOn: string | null
  endedOn: string | null
  /** `finished` or `abandoned` (did not finish) for a closed read; null for the open read of one being read. */
  outcome: 'finished' | 'abandoned' | null
  /** Integer quarters (1 … 20), only on a finished read. */
  rating: number | null
  review: string | null
}

/**
 * Something about a row the member should know: it was carried over with a
 * change, or not at all (`skipped`). Codes are copy keys (`import.note.<code>`).
 */
export type ImportProblem =
  /** A status Libellus has none of (a custom Goodreads exclusive shelf like `wishlist`): added as Want to read. */
  | { code: 'otherShelf'; shelf: string }
  /** A rating or review on a book that is not finished: left out (only finished reads have them). */
  | { code: 'notFinishedRating' }
  /** A rating that is not ½–5 stars: left out. */
  | { code: 'ratingInvalid' }
  /** A day that is no day, later than today, or a finish before its start: left out. */
  | { code: 'dateInvalid' }
  /** A review over the length a session keeps: cut. */
  | { code: 'reviewTooLong' }
  /** A review that is only a number above 5 ("1984", "7"): no rating, so it stays a review. */
  | { code: 'ratingLikeReview' }
  /** A row with no title: skipped. */
  | { code: 'noTitle' }
  /** The same book twice in the file (same key): the second skipped. */
  | { code: 'duplicate' }
  /** An ISBN a spreadsheet turned into a number (`9.78055E+12`): its digits are lost, the book is found by title. */
  | { code: 'isbnMangled' }
  /** A rating on a book she did not finish: left out (only finished reads have one). */
  | { code: 'abandonedRating' }
  /** Earlier reads without dates (Goodreads' Read Count above 1). */
  | { code: 'extraReads'; count: number }
  /** Earlier reads with their dates (Hardcover's several Date Started / Date Finished). */
  | { code: 'earlierReads'; count: number }
  /** Paused on Hardcover: Libellus has no pause, it is added as Currently reading. */
  | { code: 'paused' }
  /** A row the app lists without a status (Hardcover's None, Ignored): skipped. */
  | { code: 'notShelved' }

/** One row of the file, mapped. */
export type ImportBook = {
  /** The app whose export it came from. */
  source: ImportSource
  /** `<source>:<the app's id>`; without one, the ISBN or the title and author. Stored on the entry and its reads. */
  key: string
  /** The app's own id of the book (Goodreads' Book Id, Hardcover's Book ID), when the file has one. */
  sourceId: string | null
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
  /** The edition's year, else the work's. */
  year: number | null
  /** The work's first year, when the file says it. */
  originalYear: number | null
  /** The edition's format as the app writes it (`Paperback`, `Kindle Edition`, `Ebook`, `Audiobook`), or null: ranks editions. */
  binding: string | null
  /** The edition's language (`en`, `de`) when the file says it: ranks editions. */
  language: string | null
  publisher: string | null
  /** The status as the file writes it (`read`, `Currently Reading`, a custom shelf). */
  shelf: string
  /** Her shelves, tags or lists that would make Collections: what the preview offers. */
  shelves: string[]
  /** What the database will derive from the session. */
  status: EntryStatus
  session: ImportSession | null
  /** Finished reads before this one, with their days, oldest first. */
  earlierReads: ImportRead[]
  /** Finished reads before this one without any day (Goodreads' Read Count − 1). */
  extraReads: number
  /** The keys of the file's other rows of the same work: other editions she shelved, never taken for this one. */
  otherKeys: string[]
  /** The day it entered her library in the app. */
  addedOn: string | null
  problems: ImportProblem[]
}

export type SkippedRow = { row: number; title: string; problem: ImportProblem }

export type ImportFile = { source: ImportSource; books: ImportBook[]; skipped: SkippedRow[] }

/**
 * One app's export, read: which columns it needs, which columns tell its file
 * from another app's (and how strongly), and how a row maps. detect.ts scores
 * a header against every adapter's `signature`.
 */
export type ImportAdapter = {
  source: ImportSource
  /** Columns without which a row cannot be mapped. */
  required: readonly string[]
  /** Columns that point to this app, each with its weight (3: only this app writes it). */
  signature: Readonly<Record<string, number>>
  /** Every column the adapter reads (its canonical spelling). */
  columns: readonly string[]
  map: (row: Row, index: number, today: string) => ImportBook | SkippedRow
}

/** Earlier reads a row may add (more is a typo, not a habit; the database allows as many). */
export const MAX_EXTRA_READS = 20

/** The adapter's required columns the header lacks (any case). */
export function missingColumns(adapter: Pick<ImportAdapter, 'required'>, columns: readonly string[]): string[] {
  const have = new Set(columns.map((column) => column.toLowerCase()))
  return adapter.required.filter((name) => !have.has(name.toLowerCase()))
}

/** A file that looks like one app's export but lacks columns its rows need (`missing`, as that app names them). */
export class MissingColumnsError extends Error {
  constructor(
    readonly source: ImportSource,
    readonly missing: string[],
  ) {
    super(`A ${source} export without ${missing.join(', ')}`)
    this.name = 'MissingColumnsError'
  }
}

/**
 * Another app's export Libellus does not read yet, told by its header
 * (`storygraph`, `librarything`, `bookshelf`), so the screen can name it.
 */
export type OtherApp = 'storygraph' | 'librarything' | 'bookshelf'

/** A CSV no supported app wrote: `app` names the one that did, when the header tells. */
export class UnknownExportError extends Error {
  constructor(readonly app: OtherApp | null = null) {
    super(app ? `A ${app} export, which is not supported` : 'Not an export of a supported app')
    this.name = 'UnknownExportError'
  }
}

// ------------------------------------------------------------------ values

export const field = (row: Row, name: string): string => (row[name] ?? '').trim()

/** Names as people write them: one space between words ("Robert   Harris" → "Robert Harris"). */
export const tidy = (value: string) => value.replace(/\s+/g, ' ').trim()

/**
 * A day from a file (`2024/03/09`, `2024-03-09`, `2024-03-09T17:21:40Z`, and
 * `09.03.2024` as a German spreadsheet writes it back) as `YYYY-MM-DD`; null
 * for an empty field. `invalid` for a value that is no calendar day or lies
 * after `today`. The file's days are her calendar days: no time zone is applied.
 */
export function importDay(value: string, today: string): string | null | 'invalid' {
  const text = value.trim()
  if (!text) return null
  const iso = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(text)
  const german = iso ? null : /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text)
  if (!iso && !german) return 'invalid'
  const [year, month, dayOfMonth] = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : [Number(german![3]), Number(german![2]), Number(german![1])]
  const date = new Date(Date.UTC(year, month - 1, dayOfMonth))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== dayOfMonth) return 'invalid'
  const day = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`
  return day > today ? 'invalid' : day
}

/** `9.78055E+12`, `9,78E+12`: a number a spreadsheet made of an ISBN, its last digits gone. */
export const isMangledIsbn = (value: string) => /^=?"?\d[.,]\d*E\+?\d+"?$/i.test(value.trim())

/**
 * An ISBN-13 and an ISBN-10 field (`="9780553283686"`, `978-0-553-28368-6`,
 * `=""`) → the ISBN-13 (an ISBN-10 converted) and the ISBN-10. Bad check digits
 * and spreadsheet numbers are no ISBN.
 */
export function isbnPair(isbn13Field: string, isbn10Field: string): { isbn13: string | null; isbn10: string | null } {
  const digits = (value: string) => (isMangledIsbn(value) ? '' : value.replace(/[^0-9Xx]/g, '').toUpperCase())
  const thirteen = digits(isbn13Field)
  const ten = digits(isbn10Field)
  const isbn10 = isValidIsbn10(ten) ? ten : null
  const isbn13 = isValidIsbn13(thirteen) ? thirteen : isbn10 ? isbn10To13(isbn10) : isValidIsbn13(ten) ? ten : null
  return { isbn13, isbn10 }
}

/** Stars as integer quarters (`4` → 16, `3.5` → 14, `3,75` → 15); 0 or empty is unrated. Undefined for anything else. */
export function importRating(value: string): number | null | undefined {
  const text = value.trim()
  if (!text || /^0+([.,]0*)?$/.test(text)) return null
  const stars = Number(text.replace(',', '.'))
  return Number.isFinite(stars) && stars > 0 && stars <= 5 ? Math.max(1, Math.round(stars * 4)) : undefined
}

export const positive = (value: string): number | null => {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export const yearOf = (value: string): number | null => {
  const parsed = positive(value)
  return parsed && parsed <= 2100 ? parsed : null
}

/** What an import key may hold: no spaces (the database checks `^[a-z]+:\S+$`). */
const keyPart = (value: string) => value.replace(/\s+/g, '-')

/**
 * The row's key: `<source>:<the app's id>`. A file without ids (a CSV another
 * tool wrote in the app's shape) falls back to the ISBN, else the title and
 * author, so the same file still finds its rows again.
 */
export function importKey(
  source: ImportSource,
  id: string,
  book: Pick<ImportBook, 'isbn13' | 'title' | 'authors'>,
): string {
  if (/^\d+$/.test(id)) return `${source}:${id}`
  if (book.isbn13) return `${source}:isbn-${book.isbn13}`
  return `${source}:t-${keyPart(`${workTitle(book.title)}|${surname(book.authors[0])}`)}`
}

/**
 * A review that is only a rating ("4.6", "5/5", "4.5/5": utils/ratingReview.ts) is the rating, not a review: it is
 * not kept as a review, and its number, rounded down to the quarter steps, is the read's rating, over the row's own
 * (the apps store whole or half stars; the number the reader wrote is the real rating). A number above 5 with no
 * `/10` is no rating: it stays a review, reported.
 */
export function splitRatingReview(
  review: string | null,
  rating: number | null,
  problems: ImportProblem[],
): { review: string | null; rating: number | null } {
  if (isRatingOnlyReview(review)) return { review: null, rating: ratingFromReviewText(review) ?? rating }
  if (looksLikeRatingButIsNot(review)) problems.push({ code: 'ratingLikeReview' })
  return { review, rating }
}

/** A review cut to the length a session keeps, with the problem when it was. */
export function clipReview(review: string | null, problems: ImportProblem[]): string | null {
  if (!review || review.length <= REVIEW_MAX_LENGTH) return review || null
  problems.push({ code: 'reviewTooLong' })
  return review.slice(0, REVIEW_MAX_LENGTH).trimEnd()
}

/** A did-not-finish shelf or status, as people and apps name it (#64): `dnf`, `Did Not Finish`, `abandoned` … */
export const isAbandonedShelf = (shelf: string) =>
  /^(dnf|did-?not-?finish(ed)?|abandoned|gave-?up|not-?finished|unfinished|dropped|stopped|stopped-?reading|nicht-?beendet|abgebrochen)$/i.test(
    shelf.trim().replace(/[\s_]+/g, '-'),
  )

/** Names that would make Collections, once each (any case), none empty or over 80 characters. */
export function collectionNames(names: readonly string[], skip: (name: string) => boolean = () => false): string[] {
  const seen = new Map<string, string>()
  for (const name of names.map(tidy)) {
    if (!name || name.length > 80 || skip(name)) continue
    if (!seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name)
  }
  return [...seen.values()]
}

/** How many books go to each Status. */
export function countByStatus(books: readonly Pick<ImportBook, 'status'>[]): Record<EntryStatus, number> {
  const counts: Record<EntryStatus, number> = { want_to_read: 0, reading: 0, finished: 0 }
  for (const book of books) counts[book.status]++
  return counts
}

/**
 * Maps a whole file's rows with one adapter. Pure: the same rows and day always
 * give the same books. A book listed twice (same key) is taken once; rows of
 * the same work (title without series and subtitle, first author's surname)
 * under different keys know each other's keys (`otherKeys`): an English and a
 * German read of one novel are two books on her shelves.
 */
export function mapRows(adapter: ImportAdapter, rows: readonly Row[], today: string): ImportFile {
  const books: ImportBook[] = []
  const skipped: SkippedRow[] = []
  const keys = new Set<string>()
  rows.forEach((row, index) => {
    const mapped = adapter.map(row, index, today)
    if (!('key' in mapped)) {
      skipped.push(mapped)
    } else if (keys.has(mapped.key)) {
      skipped.push({ row: mapped.row, title: mapped.title, problem: { code: 'duplicate' } })
    } else {
      keys.add(mapped.key)
      books.push(mapped)
    }
  })
  const byWork = new Map<string, ImportBook[]>()
  for (const book of books) {
    const work = `${workTitle(book.title)}|${surname(book.authors[0])}`
    byWork.set(work, [...(byWork.get(work) ?? []), book])
  }
  for (const rows of byWork.values()) {
    if (rows.length < 2) continue
    for (const book of rows) book.otherKeys = rows.filter((other) => other !== book).map((other) => other.key)
  }
  return { source: adapter.source, books, skipped }
}
