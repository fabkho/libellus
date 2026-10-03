/**
 * The Regal library file, version 2: its types and its validator, vendored from
 * Regal (fabkho/regal, `shared/types/libraryFile.ts` and
 * `shared/library/libraryFile.ts` at commit e1842aa9445481f2572d438e94491c3e21a6ae40,
 * "Merge pull request #44: Regal assets"). The format is Regal's
 * (docs/library-file.md there); Libellus only produces it (`regal.ts`).
 *
 * A port, not an import: Libellus' CI has no Regal checkout. Only the parts a
 * producer needs are here (the types, `validateLibraryFile`, `parseLibraryFile`,
 * `formatLibraryFileErrors`); Regal's mapping onto its own Book is left out.
 * The checks and their messages are Regal's, line for line, so Regal's
 * fixtures give the same results (tests/regal-library-file.test.ts, which
 * also runs Regal's own validator when `REGAL_DIR` points at a checkout).
 * When Regal changes the format, port the change and name the new commit.
 *
 * Framework-free and dependency-free.
 */

export const LIBRARY_FILE_VERSION = 2

export type RegalLibraryFile = {
  version: typeof LIBRARY_FILE_VERSION
  /** When the producer wrote the file: ISO 8601 date-time with offset or Z. */
  generatedAt: string
  /** Whose Library this is, as shown to visitors ("Fabian"). */
  owner?: string | null
  /** Which Pipeline wrote the file; informational, never shown. */
  generator?: string | null
  books: LibraryBook[]
}

/** Known Reading status values; any other non-empty string is a custom one. */
export type KnownReadingStatus = 'read' | 'currently-reading' | 'to-read' | 'dnf'

export type LibraryBook = {
  /** Stable, unique within the file. The display keys picks and assets on it. */
  id: string
  /** Without the series part: "Golden Son", not "Golden Son (Red Rising, #2)". */
  title: string
  /** Series and number as shown: "Red Rising, #2". */
  seriesTitle?: string | null
  /** In credit order, first = main author. May be empty. */
  authors: string[]
  /** 13 digits, no hyphens, 978/979 prefix. */
  isbn13?: string | null
  /** 9 digits plus a digit or X, no hyphens. */
  isbn10?: string | null
  /** Page count, a positive integer: the Book's thickness. */
  pages?: number | null
  /** Paperback, Hardcover, Kindle Edition, Audiobook…: the Book's height. */
  binding?: string | null
  /** Year this edition was published. */
  yearPublished?: number | null
  /** Year the work was first published. */
  originalYear?: number | null
  /** Reading status: read | currently-reading | to-read | dnf | a custom exclusive shelf. */
  status: KnownReadingStatus | (string & {})
  /** Finished reading, YYYY-MM-DD. */
  dateRead?: string | null
  /** Started reading, YYYY-MM-DD. */
  dateStarted?: string | null
  /** Added to the Library, YYYY-MM-DD. */
  dateAdded?: string | null
  /** Quarter stars from 0 to 5; 0 (or absent) = unrated. */
  rating?: number | null
  review?: string | null
  /** The review gives the plot away: hidden behind a click. Default false. */
  reviewHasSpoiler?: boolean | null
  /** How often it was finished. Default 0. */
  readCount?: number | null
  /** Blurb for the details panel and the drawn back cover; plain text. */
  description?: string | null
  /** Publisher imprint, printed at the foot of a drawn back cover. */
  publisher?: string | null
  /** Shelf category for a drawn back cover: "SCIENCE FICTION". */
  genre?: string | null
  /** Up to two lines of praise for a drawn back cover. */
  quotes?: LibraryQuote[] | null
  assets?: LibraryBookAssets | null
}

export type LibraryQuote = {
  text: string
  /** Who said it: "Max Gladstone, author of Three Parts Dead". */
  source: string
}

export type LibraryBookFace = 'front' | 'spine' | 'back'

/**
 * The Book's resolved images and colours. Image references are absolute URLs
 * (`https://…`) or relative to the library file's own URL. A missing face is
 * drawn by Regal.
 */
export type LibraryBookAssets = {
  front?: string | null
  spine?: string | null
  back?: string | null
  /** Small copies for the Stack, loaded before the full faces. */
  pile?: { front?: string | null; spine?: string | null } | null
  /** Spine colours, `#rrggbb`: used to draw the Spine before (or without) its art. */
  palette?: LibraryPalette | null
  /** Average colour of the Spine art, `#rrggbb`. */
  spineColor?: string | null
  /** Faces that are photos of the owner's copy: drawn as they are. */
  photoFaces?: LibraryBookFace[] | null
  /** How the faces were made; informational. */
  source?: 'photo' | 'ai' | null
}

export type LibraryPalette = {
  background: string
  text: string
  accent: string
}

export type LibraryFileError = {
  /** Where: `books[3].assets.palette.text`; '' for the file itself. */
  path: string
  reason: string
}

export type LibraryFileResult = { ok: true; library: RegalLibraryFile } | { ok: false; errors: LibraryFileError[] }

// ----------------------------------------------------------------- validator

/** More errors than this are summed up in one last entry. */
const MAX_ERRORS = 100

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const DATE_TIME = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i
const HEX_COLOUR = /^#[\da-f]{6}$/i
const ISBN13 = /^97[89]\d{10}$/
const ISBN10 = /^\d{9}[\dX]$/
const URL_SCHEME = /^([a-z][\d+.a-z-]*):/i
const FACES = ['front', 'spine', 'back']
const SOURCES = ['photo', 'ai']

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const kind = (value: unknown) =>
  value === null ? 'null' : Array.isArray(value) ? 'an array' : typeof value === 'object' ? 'an object' : typeof value
const shown = (value: unknown) =>
  typeof value === 'string'
    ? JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value)
    : kind(value) === 'number' || typeof value === 'boolean'
      ? String(value)
      : kind(value)

/** A real calendar day as YYYY-MM-DD (no 2026-02-30). */
function isCalendarDate(value: string): boolean {
  const match = DATE.exec(value)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

class Checker {
  readonly errors: LibraryFileError[] = []
  private dropped = 0

  fail(path: string, reason: string) {
    if (this.errors.length < MAX_ERRORS) this.errors.push({ path, reason })
    else this.dropped++
  }

  finish(): LibraryFileError[] {
    if (this.dropped) this.errors.push({ path: '', reason: `…and ${this.dropped} more error(s)` })
    return this.errors
  }

  /** Required string with something in it. */
  text(value: unknown, path: string) {
    if (typeof value !== 'string') this.fail(path, `must be a string, got ${kind(value)}`)
    else if (!value.trim()) this.fail(path, 'must not be empty')
  }

  /** Optional string: absent, null or a string. */
  optionalText(value: unknown, path: string) {
    if (value != null && typeof value !== 'string') this.fail(path, `must be a string or null, got ${kind(value)}`)
  }

  optionalPattern(value: unknown, path: string, pattern: RegExp, what: string) {
    if (value == null) return
    if (typeof value !== 'string') this.fail(path, `must be ${what} or null, got ${kind(value)}`)
    else if (!pattern.test(value)) this.fail(path, `must be ${what}, got ${shown(value)}`)
  }

  optionalDate(value: unknown, path: string) {
    if (value == null) return
    if (typeof value !== 'string' || !isCalendarDate(value)) {
      this.fail(path, `must be a date as YYYY-MM-DD or null, got ${shown(value)}`)
    }
  }

  optionalInteger(value: unknown, path: string, minimum: number | null, what: string) {
    if (value == null) return
    if (typeof value !== 'number' || !Number.isInteger(value) || (minimum !== null && value < minimum)) {
      this.fail(path, `must be ${what} or null, got ${shown(value)}`)
    }
  }

  optionalBoolean(value: unknown, path: string) {
    if (value != null && typeof value !== 'boolean') this.fail(path, `must be true, false or null, got ${shown(value)}`)
  }

  /** Image reference: an http(s) URL or a URL relative to the library file. */
  optionalImage(value: unknown, path: string) {
    if (value == null) return
    if (typeof value !== 'string') return this.fail(path, `must be a URL or null, got ${kind(value)}`)
    if (!value.trim() || /\s/.test(value)) return this.fail(path, `must be a URL without spaces, got ${shown(value)}`)
    const scheme = URL_SCHEME.exec(value)?.[1]?.toLowerCase()
    if (scheme && scheme !== 'http' && scheme !== 'https') {
      this.fail(path, `must be an http(s) URL or a relative path, got a ${scheme}: URL`)
    }
  }

  optionalColour(value: unknown, path: string) {
    this.optionalPattern(value, path, HEX_COLOUR, 'a colour as #rrggbb')
  }
}

function checkAssets(check: Checker, assets: unknown, path: string) {
  if (assets == null) return
  if (!isObject(assets)) return check.fail(path, `must be an object or null, got ${kind(assets)}`)
  for (const face of FACES) check.optionalImage(assets[face], `${path}.${face}`)

  const pile = assets.pile
  if (pile != null) {
    if (!isObject(pile)) check.fail(`${path}.pile`, `must be an object or null, got ${kind(pile)}`)
    else for (const face of ['front', 'spine']) check.optionalImage(pile[face], `${path}.pile.${face}`)
  }

  const palette = assets.palette
  if (palette != null) {
    if (!isObject(palette)) check.fail(`${path}.palette`, `must be an object or null, got ${kind(palette)}`)
    else {
      for (const key of ['background', 'text', 'accent']) {
        if (palette[key] == null) check.fail(`${path}.palette.${key}`, 'is required in a palette (a colour as #rrggbb)')
        else check.optionalColour(palette[key], `${path}.palette.${key}`)
      }
    }
  }
  check.optionalColour(assets.spineColor, `${path}.spineColor`)

  const photoFaces = assets.photoFaces
  if (photoFaces != null) {
    if (!Array.isArray(photoFaces)) check.fail(`${path}.photoFaces`, `must be an array or null, got ${kind(photoFaces)}`)
    else {
      photoFaces.forEach((face, index) => {
        if (!FACES.includes(face as string)) {
          check.fail(`${path}.photoFaces[${index}]`, `must be one of ${FACES.join(', ')}, got ${shown(face)}`)
        }
      })
    }
  }
  if (assets.source != null && !SOURCES.includes(assets.source as string)) {
    check.fail(`${path}.source`, `must be one of ${SOURCES.join(', ')} or null, got ${shown(assets.source)}`)
  }
}

function checkBook(check: Checker, book: unknown, path: string) {
  if (!isObject(book)) return check.fail(path, `must be an object, got ${kind(book)}`)

  check.text(book.id, `${path}.id`)
  check.text(book.title, `${path}.title`)
  check.optionalText(book.seriesTitle, `${path}.seriesTitle`)
  if (!Array.isArray(book.authors)) {
    check.fail(`${path}.authors`, `must be an array of names (may be empty), got ${kind(book.authors)}`)
  } else book.authors.forEach((name, index) => check.text(name, `${path}.authors[${index}]`))

  check.optionalPattern(book.isbn13, `${path}.isbn13`, ISBN13, 'an ISBN-13 (13 digits starting 978 or 979, no hyphens)')
  check.optionalPattern(book.isbn10, `${path}.isbn10`, ISBN10, 'an ISBN-10 (9 digits and a digit or X, no hyphens)')
  check.optionalInteger(book.pages, `${path}.pages`, 1, 'a positive whole number of pages')
  check.optionalText(book.binding, `${path}.binding`)
  check.optionalInteger(book.yearPublished, `${path}.yearPublished`, null, 'a whole year')
  check.optionalInteger(book.originalYear, `${path}.originalYear`, null, 'a whole year')

  check.text(book.status, `${path}.status`)
  check.optionalDate(book.dateRead, `${path}.dateRead`)
  check.optionalDate(book.dateStarted, `${path}.dateStarted`)
  check.optionalDate(book.dateAdded, `${path}.dateAdded`)

  const rating = book.rating
  if (rating != null && (typeof rating !== 'number' || rating < 0 || rating > 5 || !Number.isInteger(rating * 4))) {
    check.fail(`${path}.rating`, `must be quarter stars from 0 to 5 (0, 0.25 … 5) or null, got ${shown(rating)}`)
  }
  check.optionalText(book.review, `${path}.review`)
  check.optionalBoolean(book.reviewHasSpoiler, `${path}.reviewHasSpoiler`)
  check.optionalInteger(book.readCount, `${path}.readCount`, 0, 'a whole number ≥ 0')

  check.optionalText(book.description, `${path}.description`)
  check.optionalText(book.publisher, `${path}.publisher`)
  check.optionalText(book.genre, `${path}.genre`)
  const quotes = book.quotes
  if (quotes != null) {
    if (!Array.isArray(quotes)) check.fail(`${path}.quotes`, `must be an array or null, got ${kind(quotes)}`)
    else {
      quotes.forEach((quote, index) => {
        const at = `${path}.quotes[${index}]`
        if (!isObject(quote)) return check.fail(at, `must be an object { text, source }, got ${kind(quote)}`)
        check.text(quote.text, `${at}.text`)
        if (typeof quote.source !== 'string') check.fail(`${at}.source`, `must be a string, got ${kind(quote.source)}`)
      })
    }
  }

  checkAssets(check, book.assets, `${path}.assets`)
}

/**
 * Checks a parsed Regal library file. Unknown fields are allowed and ignored,
 * so a producer can add its own without breaking the display.
 */
export function validateLibraryFile(data: unknown): LibraryFileResult {
  const check = new Checker()
  if (!isObject(data)) return { ok: false, errors: [{ path: '', reason: `must be a JSON object, got ${kind(data)}` }] }

  if (data.version !== LIBRARY_FILE_VERSION) {
    const legacy = data.version === undefined && Array.isArray(data.books)
    const reason = legacy
      ? 'is missing: this looks like a reading-tracker export, not a Regal library file (convert it with `pnpm library:convert`)'
      : `must be ${LIBRARY_FILE_VERSION}, got ${shown(data.version)}`
    return { ok: false, errors: [{ path: 'version', reason }] }
  }

  if (
    typeof data.generatedAt !== 'string' ||
    !DATE_TIME.test(data.generatedAt) ||
    !isCalendarDate(DATE_TIME.exec(data.generatedAt)![1]!)
  ) {
    check.fail(
      'generatedAt',
      `must be an ISO 8601 date-time with Z or an offset (2026-05-01T06:00:00Z), got ${shown(data.generatedAt)}`,
    )
  }
  check.optionalText(data.owner, 'owner')
  check.optionalText(data.generator, 'generator')

  if (!Array.isArray(data.books)) {
    check.fail('books', `must be an array, got ${kind(data.books)}`)
  } else {
    const seen = new Map<string, number>()
    data.books.forEach((book, index) => {
      checkBook(check, book, `books[${index}]`)
      const id = isObject(book) ? book.id : undefined
      if (typeof id !== 'string' || !id.trim()) return
      const first = seen.get(id)
      if (first === undefined) seen.set(id, index)
      else check.fail(`books[${index}].id`, `must be unique, ${shown(id)} is also books[${first}].id`)
    })
  }

  const errors = check.finish()
  return errors.length ? { ok: false, errors } : { ok: true, library: data as unknown as RegalLibraryFile }
}

/** Parses and validates the text of a Regal library file. */
export function parseLibraryFile(text: string): LibraryFileResult {
  let data: unknown
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch (error) {
    return {
      ok: false,
      errors: [{ path: '', reason: `is not valid JSON (${error instanceof Error ? error.message : String(error)})` }],
    }
  }
  return validateLibraryFile(data)
}

/** Errors as lines for logs and error messages: `books[2].rating: must be …`. */
export const formatLibraryFileErrors = (errors: LibraryFileError[]): string[] =>
  errors.map(({ path, reason }) => `${path || '(file)'}: ${reason}`)
