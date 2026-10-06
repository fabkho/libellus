import Papa from 'papaparse'
import { isValidIsbn10, isValidIsbn13, isbn10To13, type BookSnapshot } from '../books'
import type { EntryStatus } from '../library'
import { REVIEW_MAX_LENGTH } from '../library'
import { plainText } from '../apple'
import { normalize, splitSeriesTitle, surname, workTitle } from './readingTracker'

/**
 * The pure step of the Goodreads import (issue #40): a Goodreads library
 * export (CSV) → the Books, Library entries and Reading sessions it stands
 * for. Other apps that write Goodreads-compatible CSV are read the same way.
 * No I/O: the lookups that turn a row into a Catalogue Book and the writes
 * come after (data/goodreadsImport.ts).
 *
 * The file, as Goodreads writes it (verified against real exports, #111):
 * - header `Book Id, Title, Author, Author l-f, Additional Authors, ISBN,
 *   ISBN13, My Rating, Average Rating, Publisher, Binding, Number of Pages,
 *   Year Published, Original Publication Year, Date Read, Date Added,
 *   Bookshelves, Bookshelves with positions, Exclusive Shelf, My Review,
 *   Spoiler, Private Notes, Read Count, Owned Copies`; newer exports leave
 *   `Average Rating` out, and only Title, Author and Exclusive Shelf are needed;
 * - UTF-8, quoted fields with commas and line breaks (reviews), sometimes a
 *   BOM; a file saved again by a spreadsheet may be Windows-1252, use `;`, and
 *   turn ISBNs into numbers (`9.78055E+12`, digits lost);
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

/** Earlier reads a row may add (a Read Count past this is a typo, not a habit). */
export const MAX_EXTRA_READS = 20

/**
 * Another app's export, told by its header, so the screen can say which file
 * to choose instead of only "not a Goodreads export".
 */
export type OtherApp = 'storygraph' | 'librarything' | 'bookshelf' | null

export class NotAGoodreadsExportError extends Error {
  constructor(
    readonly missing: string[],
    readonly app: OtherApp = null,
  ) {
    super(`Not a Goodreads library export: no ${missing.join(', ')} column`)
    this.name = 'NotAGoodreadsExportError'
  }
}

/** A file that is no text table at all: a spreadsheet, a zip, an image. */
export class NotACsvFileError extends Error {
  constructor() {
    super('Not a CSV file')
    this.name = 'NotACsvFileError'
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
  /** An ISBN a spreadsheet turned into a number (`9.78055E+12`): its digits are lost, the book is found by title. */
  | { code: 'isbnMangled' }
  /** A rating on a book she did not finish: left out (only finished reads have one). */
  | { code: 'abandonedRating' }
  /** A Read Count above 1: the earlier reads are added without dates. */
  | { code: 'extraReads'; count: number }

export type GoodreadsSession = {
  startedOn: string | null
  endedOn: string | null
  /** `finished` or `abandoned` (a did-not-finish shelf) for a closed read; null for the open read of one being read. */
  outcome: 'finished' | 'abandoned' | null
  /** Integer quarters (4, 8, … 20), only on a finished read. */
  rating: number | null
  review: string | null
}

/** One row of the file, mapped. */
export type GoodreadsBook = {
  /** `goodreads:<Book Id>`; for exports without Book Ids, the ISBN or the title and author. */
  key: string
  /** Goodreads' id of the exact edition (`Book Id`), when the file has one: what Goodreads knows about it can be asked. */
  goodreadsId: string | null
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
  /** The edition's year (Year Published), else the work's. */
  year: number | null
  /** The work's first year (Original Publication Year). */
  originalYear: number | null
  /** Goodreads' Binding (`Paperback`, `Kindle Edition`, …), or null. */
  binding: string | null
  publisher: string | null
  /** The file's exclusive shelf, as written. */
  shelf: string
  /** Her other shelves (and a custom exclusive one): what the preview offers as Collections. */
  shelves: string[]
  /** What the database will derive from the session. */
  status: EntryStatus
  session: GoodreadsSession | null
  /** Finished reads before this one (Read Count − 1), added without dates. */
  extraReads: number
  /** The keys of the file's other rows of the same work: other editions she shelved, never taken for this one. */
  otherKeys: string[]
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
 * A day from the file (`2024/03/09`, also `2024-03-09`, and `09.03.2024` as a
 * German spreadsheet writes it back) as `YYYY-MM-DD`; null for an empty field.
 * `invalid` for a value that is no calendar day or lies after `today`. The
 * file's days are her calendar days: no time zone is applied.
 */
export function goodreadsDay(value: string, today: string): string | null | 'invalid' {
  const text = value.trim()
  if (!text) return null
  const iso = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(text)
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

/** `="9780553283686"`, `="0553283685"`, `=""` → the ISBN-13 (an ISBN-10 converted) and the ISBN-10. Bad check digits are no ISBN. */
export function goodreadsIsbn(isbn13Field: string, isbnField: string): { isbn13: string | null; isbn10: string | null } {
  const digits = (value: string) => (isMangledIsbn(value) ? '' : value.replace(/[^0-9Xx]/g, '').toUpperCase())
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
  // Whole stars from Goodreads; halves and decimals (`3.5`, `3,75`) from other apps, to the nearest quarter.
  const stars = Number(text.replace(',', '.'))
  return Number.isFinite(stars) && stars > 0 && stars <= 5 ? Math.max(1, Math.round(stars * 4)) : undefined
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

/**
 * The file's bytes as text: UTF-8 as Goodreads writes it, else Windows-1252 (a
 * file a spreadsheet saved again on Windows), so umlauts survive either way.
 * Throws NotACsvFileError for something that is no text at all (an `.xlsx`, a
 * zip, an image: NUL bytes or a zip's `PK` signature).
 */
export function decodeExport(bytes: Uint8Array): string {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) throw new NotACsvFileError()
  if (bytes.subarray(0, 4096).includes(0)) throw new NotACsvFileError()
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

/** Which other app wrote a CSV, by its header; null when none we know. */
export function otherAppOf(columns: readonly string[]): OtherApp {
  const has = (name: string) => columns.some((column) => column.toLowerCase() === name.toLowerCase())
  if (has('Read Status') && (has('Star Rating') || has('Authors'))) return 'storygraph'
  if (has('Primary Author') || (has('Book Id') && has('Collections') && has('Entry Date'))) return 'librarything'
  if (has('Name') && has('Status') && has('Finished')) return 'bookshelf'
  return null
}

/**
 * Reads the file into rows. Throws NotAGoodreadsExportError when the columns it
 * needs are missing (naming the app that wrote it, when it can tell). The
 * delimiter is found from the header, so a file saved with `;` reads too.
 */
export function readGoodreadsCsv(text: string): Row[] {
  const parsed = Papa.parse<Row>(text.replace(/^\uFEFF/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    delimitersToGuess: [',', ';', '\t'],
    transformHeader: (name) => name.replace(/^\uFEFF/, '').trim(),
  })
  const columns = parsed.meta.fields ?? []
  const missing = REQUIRED_COLUMNS.filter((name) => !columns.includes(name))
  if (missing.length) throw new NotAGoodreadsExportError(missing, otherAppOf(columns))
  return parsed.data
}

/** Goodreads' own shelves, which are Statuses, not Collections. */
const STATUS_SHELVES = new Set(['read', 'to-read', 'currently-reading'])

/** A did-not-finish shelf, as people name theirs (#64). */
export const isAbandonedShelf = (shelf: string) =>
  /^(dnf|did-?not-?finish(ed)?|abandoned|gave-?up|not-?finished|unfinished|dropped|stopped-?reading|nicht-?beendet|abgebrochen)$/i.test(
    shelf.replace(/[\s_]+/g, '-'),
  )

/** Her shelves of a row that would make Collections: neither a Status nor did-not-finish. */
function collectionShelves(bookshelves: string, exclusive: string): string[] {
  const names = [...bookshelves.split(','), exclusive].map(tidy).filter(Boolean)
  const seen = new Map<string, string>()
  for (const name of names) {
    if (STATUS_SHELVES.has(name.toLowerCase()) || isAbandonedShelf(name) || name.length > 80) continue
    if (!seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name)
  }
  return [...seen.values()]
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
  if (!isbn13 && (isMangledIsbn(field(row, 'ISBN13')) || isMangledIsbn(field(row, 'ISBN')))) problems.push({ code: 'isbnMangled' })

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
  const shelfName = shelf.toLowerCase()
  // Read Count counts every read Goodreads knows, the current one included.
  const readCount = positive(field(row, 'Read Count')) ?? 0
  let status: EntryStatus
  let session: GoodreadsSession | null = null
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
    publisher: tidy(field(row, 'Publisher')) || null,
  }
  const bookId = field(row, 'Book Id')
  return {
    key: goodreadsKey(bookId, book),
    goodreadsId: /^\d{1,12}$/.test(bookId) ? bookId : null,
    row: number,
    ...book,
    shelf,
    shelves: collectionShelves(field(row, 'Bookshelves'), shelf),
    status,
    session,
    extraReads,
    otherKeys: [],
    addedOn,
    problems,
  }
}

/**
 * Reads and maps a whole export. Pure: the same text and day always give the
 * same books. A book listed twice (same key) is taken once; rows of the same
 * work (title without series and subtitle, first author's surname) under
 * different keys know each other's keys (`otherKeys`): an English and a
 * German read of one novel are two books on her shelves.
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
  const byWork = new Map<string, GoodreadsBook[]>()
  for (const book of books) {
    const work = `${workTitle(book.title)}|${surname(book.authors[0])}`
    byWork.set(work, [...(byWork.get(work) ?? []), book])
  }
  for (const rows of byWork.values()) {
    if (rows.length < 2) continue
    for (const book of rows) book.otherKeys = rows.filter((other) => other !== book).map((other) => other.key)
  }
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
  const isbn13 = book.isbn13
  return {
    title: book.title,
    authors: book.authors,
    isbn13,
    isbn10: book.isbn10,
    pageCount: book.pageCount,
    year: book.year,
    language: null,
    publisher: book.publisher,
    description: null,
    coverUrl: null,
    coverThumbhash: null,
    coverColors: null,
    source: isbn13 ? 'import' : 'manual',
    appleId: null,
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

/** `en`, `eng`, `English`, `de-DE`, `ger`, `deu` → `en` / `de`: languages as the sources write them, comparable. */
export function languageCode(value: string | null | undefined): string | null {
  const text = (value ?? '').trim().toLowerCase()
  if (!text) return null
  const named: Record<string, string> = {
    english: 'en', eng: 'en', german: 'de', deutsch: 'de', ger: 'de', deu: 'de', french: 'fr', fre: 'fr', fra: 'fr',
    spanish: 'es', spa: 'es', italian: 'it', ita: 'it', dutch: 'nl', dut: 'nl', nld: 'nl', portuguese: 'pt', por: 'pt',
  }
  if (named[text]) return named[text]
  const short = /^([a-z]{2})(?:[-_][a-z]+)?$/.exec(text)
  return short ? short[1]! : null
}

/**
 * The language a title is most likely in, from its little words (`der`, `und`,
 * `the`, `of`) and its letters (`ä`, `ß`): `de`, `en`, or null when it does not
 * say (`Circe`, `Neuromancer`). Only a hint for ranking editions of a work
 * whose row says no language.
 */
export function titleLanguage(title: string): string | null {
  const words = title.toLowerCase().split(/[^\p{L}]+/u)
  const german = /[äöüß]/i.test(title) || words.some((word) => GERMAN_WORDS.has(word))
  const english = words.some((word) => ENGLISH_WORDS.has(word))
  return german === english ? null : german ? 'de' : 'en'
}
const GERMAN_WORDS = new Set(['der', 'die', 'das', 'und', 'von', 'des', 'dem', 'den', 'ein', 'eine', 'einer', 'im', 'mit', 'zum', 'zur', 'auf', 'aus', 'nicht'])
const ENGLISH_WORDS = new Set(['the', 'of', 'and', 'a', 'an', 'to', 'with', 'from', 'for', 'is', 'my'])

/** A Binding or format that is an ebook (`Kindle Edition`, `ebook`, `Nook`): an Apple Books edition is the closest there is. */
export const isEbookBinding = (value: string | null | undefined) => /kindle|e-?book|nook|epub/i.test(value ?? '')

/**
 * How well an edition found by title fits the row's: the same language (when
 * both are known: told from the titles) counts most, then
 * an ebook for a Kindle row, then about the same page count and the same year.
 * Only to rank editions of the same work against each other; ties keep the
 * search's order.
 */
export function editionFit(
  row: Pick<GoodreadsBook, 'title' | 'pageCount' | 'year' | 'binding'>,
  found: Pick<BookSnapshot, 'title' | 'language' | 'pageCount' | 'year' | 'source'>,
): number {
  let fit = 0
  const wanted = titleLanguage(row.title)
  const theirs = languageCode(found.language) ?? titleLanguage(found.title)
  if (wanted && theirs) fit += wanted === theirs ? 4 : -4
  const pages = row.pageCount
  if (pages && found.pageCount) {
    const off = Math.abs(pages - found.pageCount) / pages
    fit += off <= 0.05 ? 2 : off <= 0.15 ? 1 : 0
  }
  // Apple Books sells ebooks: the closest to a Kindle edition there is. Worth
  // more than a print edition's page count, which an ebook never has to match.
  if (isEbookBinding(row.binding) && found.source === 'apple') fit += 3
  const year = row.year
  if (year && found.year === year) fit += 1
  return fit
}

/** Of the search's results, the same work's edition that fits the row best (`editionFit`); null when none is the same work. */
export function pickEdition<T extends { book: Pick<BookSnapshot, 'title' | 'authors' | 'language' | 'pageCount' | 'year' | 'source'> }>(
  row: Pick<GoodreadsBook, 'title' | 'authors' | 'pageCount' | 'year' | 'binding'>,
  results: readonly T[],
): T | null {
  let best: T | null = null
  let bestFit = -Infinity
  for (const result of results) {
    if (!isSameWork(row, result.book)) continue
    const fit = editionFit(row, result.book)
    if (fit > bestFit) {
      best = result
      bestFit = fit
    }
  }
  return best
}

/** What a title search asks: the title (no series) and the first author. */
export function titleQuery(book: Pick<GoodreadsBook, 'title' | 'authors'>): string {
  return [book.title, book.authors[0] ?? ''].join(' ').trim()
}

/**
 * Whether a search result is the row's book (another edition is fine): the
 * same title once brackets and subtitles are dropped, and the first author's
 * surname among the result's authors. A title search only takes a result
 * this says yes to. A title in another script whose brackets name the work
 * (`Θνητοί Θεοί (Altered Carbon)`) is a translation, not the same book.
 */
export function isSameWork(
  row: Pick<GoodreadsBook, 'title' | 'authors'>,
  found: Pick<BookSnapshot, 'title' | 'authors'>,
): boolean {
  const ours = workTitle(row.title)
  const bare = splitSeriesTitle(found.title).title.replace(/\s*[([][^()[\]]*[)\]]/g, ' ')
  if (/\p{L}/u.test(bare) && !normalize(bare)) return false
  const theirs = workTitle(splitSeriesTitle(found.title).title)
  if (!ours || ours !== theirs) return false
  const wanted = surname(row.authors[0])
  if (!wanted) return true
  return found.authors.some((name) => surname(name) === wanted)
}
