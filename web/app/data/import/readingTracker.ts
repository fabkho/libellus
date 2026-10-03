/**
 * The input of the Fable import (issue #17): the owner's Fable history as the
 * reading-tracker CLI prints it (`reading list --json`), and the owner's
 * private overrides file that corrects it. Pure and framework-free: reading the
 * files is the script's job (web/scripts/import-fable.ts).
 *
 * Provenance — ported, not reinvented:
 * - the JSON shape is `LibraryBookJson` from ~/code/reading-tracker-cli
 *   (src/services/LibraryExportService.ts), whose books come from Fable
 *   (src/clients/FableClient.ts); one book per Fable record, one session each;
 * - parsing, ISBN sorting and quarter ratings follow Regal's importer
 *   (~/code/regal shared/library/importReadingTracker.ts);
 * - the overrides file and how it applies (skips, merges that fill gaps, the
 *   owner's explicit fields) is Regal's `applyCorrections`
 *   (~/code/regal scripts/assets/corrections.ts), and title/author
 *   normalisation is Regal's (scripts/assets/goodreads.ts). The overrides file
 *   is the same one Regal reads: ~/.reading-tracker/regal-overrides.json.
 *   Regal's Goodreads second opinion (read dates from Goodreads exports) is not
 *   part of this port; the script says so when the file lists exports.
 */

// ---------------------------------------------------------------------- input

/** The reading-tracker CLI's shelf keys (src/constants: ShelfKey) plus Regal's aliases. */
export type TrackerShelf = 'read' | 'currently-reading' | 'want-to-read' | 'dnf' | 'did-not-finish'

/** The parts of `reading list --json` the import reads (LibraryBookJson in the CLI). */
export interface ReadingTrackerBook {
  /** The tracker's id for the Fable record (a UUID); the import's source key. */
  id: string
  title: string
  author: string | null
  /** Comma-separated. */
  additionalAuthors: string | null
  shelf: string | null
  /** Fable sometimes puts an ISBN-10 or its own id ("YlsoGKoxeN") here. */
  isbn: string | null
  isbn13: string | null
  description: string | null
  coverUrl: string | null
  pageCount: number | null
  yearPublished: string | null
  originalPublicationYear?: string | null
  publisher?: string | null
  /** When the tracker took the record over from Fable ("2026-03-28 00:54:14"). */
  createdAt: string | null
  session: {
    startedAt: string | null
    finishedAt: string | null
    /** Fable's stars, in quarter steps (4.75). Null or 0 is unrated. */
    rating: number | null
    review: string | null
    dnfAt?: string | null
    dnfReason?: string | null
  } | null
}

export class NotAReadingTrackerExportError extends Error {
  constructor(message = 'Not a reading-tracker export: expected `reading list --json` output with a "books" array') {
    super(message)
    this.name = 'NotAReadingTrackerExportError'
  }
}

/**
 * Parses `reading list --json` output (`{ books: [...] }` or a bare array).
 * Entries without an id or a title are skipped with a warning.
 * @throws {NotAReadingTrackerExportError} when it isn't that shape.
 */
export function parseReadingTracker(jsonText: string): { books: ReadingTrackerBook[]; warnings: string[] } {
  let data: unknown
  try {
    data = JSON.parse(jsonText.replace(/^\uFEFF/, ''))
  } catch {
    throw new NotAReadingTrackerExportError('Not valid JSON')
  }
  const entries = Array.isArray(data) ? data : (data as { books?: unknown })?.books
  if (!Array.isArray(entries)) throw new NotAReadingTrackerExportError()

  const books: ReadingTrackerBook[] = []
  const warnings: string[] = []
  for (const entry of entries as Partial<ReadingTrackerBook>[]) {
    if (!entry?.id || !entry.title?.trim()) {
      warnings.push(`Skipped an entry without id or title (${entry?.title ?? entry?.id ?? 'unknown'})`)
      continue
    }
    books.push({
      id: entry.id,
      title: entry.title,
      author: entry.author ?? null,
      additionalAuthors: entry.additionalAuthors ?? null,
      shelf: entry.shelf ?? null,
      isbn: entry.isbn ?? null,
      isbn13: entry.isbn13 ?? null,
      description: entry.description ?? null,
      coverUrl: entry.coverUrl ?? null,
      pageCount: entry.pageCount ?? null,
      yearPublished: entry.yearPublished ?? null,
      originalPublicationYear: entry.originalPublicationYear ?? null,
      publisher: entry.publisher ?? null,
      createdAt: entry.createdAt ?? null,
      session: entry.session ?? null,
    })
  }
  return { books, warnings }
}

// --------------------------------------------------------- shared helpers

/** ISBN-10 → ISBN-13 (978 prefix); ISBN-13s pass through; anything else is null. (Regal goodreads.ts) */
export function toIsbn13(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/[^0-9X]/gi, '').toUpperCase()
  if (/^97[89]\d{10}$/.test(digits)) return digits
  if (!/^\d{9}[\dX]$/.test(digits)) return null
  const body = `978${digits.slice(0, 9)}`
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0)
  return `${body}${(10 - (sum % 10)) % 10}`
}

/**
 * The record's real ISBNs: an ISBN-13 (an ISBN-10 converted) and the ISBN-10
 * when there was one. Fable's own ids in the ISBN fields are no ISBN.
 * (Regal importReadingTracker.ts `splitIsbn`.)
 */
export function splitIsbn(...values: (string | null | undefined)[]): { isbn10: string | null; isbn13: string | null } {
  let isbn10: string | null = null
  let isbn13: string | null = null
  for (const value of values) {
    const digits = (value ?? '').replace(/[^0-9X]/gi, '').toUpperCase()
    if (!isbn13 && /^97[89]\d{10}$/.test(digits)) isbn13 = digits
    else if (!isbn10 && /^\d{9}[\dX]$/.test(digits)) isbn10 = digits
  }
  return { isbn10, isbn13: isbn13 ?? toIsbn13(isbn10) }
}

/** The language an ISBN-13's registration group stands for, where it is one language. (Regal descriptions.ts) */
export function isbnLanguage(isbn13: string | null | undefined): string | null {
  const isbn = (isbn13 ?? '').replace(/[^0-9X]/gi, '')
  if (/^97[89][01]/.test(isbn)) return 'en'
  if (/^9783/.test(isbn)) return 'de'
  if (/^9782/.test(isbn)) return 'fr'
  if (/^97884/.test(isbn)) return 'es'
  if (/^97888/.test(isbn)) return 'it'
  return null
}

const ascii = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036F]/g, '').toLowerCase()

/** Lower-case ASCII words, '&' as 'and'. (Regal goodreads.ts) */
export function normalize(value: string): string {
  return ascii(value.replace(/&/g, ' and ')).replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * The comparable name of the work behind a title: brackets (series, edition
 * notes) dropped, and the part before a colon. (Regal goodreads.ts
 * `workTitles`, its first key.)
 */
export function workTitle(title: string): string {
  const bare = title.replace(/\s*[([][^()[\]]*[)\]]/g, ' ').replace(/\s+/g, ' ').trim()
  return normalize(bare.split(':')[0]!) || normalize(title)
}

/** The last word of an author's name, normalised: "H. G. Wells" and "H.G. Wells" agree. */
export function surname(name: string | null | undefined): string {
  return normalize(name ?? '').split(' ').at(-1) ?? ''
}

/** "Morning Star (Red Rising, #3)" → title "Morning Star", series "Red Rising, #3". (Regal importReadingTracker.ts) */
export function splitSeriesTitle(rawTitle: string): { title: string; seriesTitle: string | null } {
  const match = rawTitle.match(/^(.*)\s\(([^()]*#[^()]*)\)\s*$/)
  if (!match) return { title: rawTitle, seriesTitle: null }
  return { title: match[1]!.trim(), seriesTitle: match[2]!.trim() }
}

// ----------------------------------------------------------------- overrides

/** Language a Book was read in; picks the edition's storefront and cover. */
export type ReadLanguage = 'en' | 'de'

/** Per-record corrections, keyed by tracker id (or an unambiguous id prefix of 8+ characters). (Regal corrections.ts) */
export interface BookOverride {
  /** Leave the record out (an omnibus next to its volumes, a collection next to the story). */
  skip?: boolean
  /** Same read as that record: leave this one out; its rating, review and dates fill gaps there. */
  mergeInto?: string
  /** Finish date, YYYY-MM-DD. */
  dateRead?: string
  /** Start date, YYYY-MM-DD. */
  dateStarted?: string
  /** The edition read; drops Fable's cover of its own edition. */
  isbn13?: string
  title?: string
  author?: string
  /** Read in this language (default: the edition's, else English). */
  lang?: ReadLanguage
  /** A cover image to use before any lookup. */
  coverUrl?: string
  /** Regal only (Goodreads aliases); ignored here. */
  goodreads?: string[]
  /** Free text for the owner; ignored. */
  note?: string
}

export interface Overrides {
  /** Goodreads Library exports Regal reads as a second opinion; not applied by this import. */
  goodreads?: string[]
  books?: Record<string, BookOverride>
}

/** A record after the overrides: the read language and the owner's cover pick ride along. */
export type CorrectedBook = ReadingTrackerBook & {
  language: ReadLanguage | null
  pinnedCoverUrl: string | null
  /** The records folded into this one (mergeInto), with their tracker ids. */
  mergedIds: string[]
}

export interface OverrideReport {
  dropped: { id: string; title: string; reason: string }[]
  changes: { id: string; title: string; change: string }[]
  warnings: string[]
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const toTimestamp = (date: string) => `${date}T00:00:00.000Z`

/** Resolves override keys (full ids or 8+ character prefixes) to tracker ids. (Regal corrections.ts) */
function resolveIds(books: ReadingTrackerBook[], overrides: Overrides, warnings: string[]): Map<string, BookOverride> {
  const resolved = new Map<string, BookOverride>()
  const find = (key: string) => {
    const hits = books.filter((book) => book.id === key || (key.length >= 8 && book.id.startsWith(key)))
    if (hits.length !== 1) warnings.push(`Override "${key}" matches ${hits.length} tracker records; ignored.`)
    return hits.length === 1 ? hits[0]!.id : null
  }
  for (const [key, override] of Object.entries(overrides.books ?? {})) {
    const id = find(key)
    if (!id) continue
    const mergeInto = override.mergeInto ? find(override.mergeInto) : undefined
    resolved.set(id, { ...override, mergeInto: mergeInto ?? undefined })
  }
  return resolved
}

function session(book: ReadingTrackerBook): NonNullable<ReadingTrackerBook['session']> {
  book.session ??= { startedAt: null, finishedAt: null, rating: null, review: null }
  return book.session
}

/** Copies what `into` lacks (rating, review, dates, pages, blurb) from a record of the same read. (Regal `fillGaps`) */
export function fillGaps(into: ReadingTrackerBook, from: ReadingTrackerBook): void {
  const target = session(into)
  if (!target.rating) target.rating = from.session?.rating || null
  target.review ??= from.session?.review ?? null
  if (!target.finishedAt && from.session?.finishedAt) {
    target.finishedAt = from.session.finishedAt
    target.startedAt ??= from.session.startedAt
  }
  into.pageCount ??= from.pageCount
  into.description ??= from.description
}

/**
 * Applies the owner's overrides, before anything else is decided: skips and
 * merges first (a merged record fills the gaps of the one it is the same read
 * as), then the explicit fields (dates, the edition read, title, author,
 * language, a pinned cover). Pure; the input is not changed.
 */
export function applyOverrides(
  raw: readonly ReadingTrackerBook[],
  overrides: Overrides = {},
): { books: CorrectedBook[]; report: OverrideReport } {
  const report: OverrideReport = { dropped: [], changes: [], warnings: [] }
  const books: CorrectedBook[] = raw.map((book) => ({
    ...structuredClone(book),
    language: null,
    pinnedCoverUrl: null,
    mergedIds: [],
  }))
  const resolved = resolveIds(books, overrides, report.warnings)
  const byId = new Map(books.map((book) => [book.id, book]))

  // 1. Skips and merges the owner decided. A merge into a record that is itself
  // merged or skipped follows the chain to the record that stays.
  const drop = new Set<string>()
  const targetOf = (id: string, seen = new Set<string>()): string | null => {
    const override = resolved.get(id)
    if (override?.skip) return null
    if (!override?.mergeInto || override.mergeInto === id) return id
    if (seen.has(id)) return null
    seen.add(id)
    return targetOf(override.mergeInto, seen)
  }
  for (const [id, override] of resolved) {
    const book = byId.get(id)!
    if (override.mergeInto && override.mergeInto !== id) {
      const target = targetOf(id)
      if (!target) {
        drop.add(id)
        report.dropped.push({ id, title: book.title, reason: 'merged into a record that is skipped or merges back' })
        continue
      }
      const into = byId.get(target)!
      fillGaps(into, book)
      into.mergedIds.push(id)
      drop.add(id)
      report.dropped.push({ id, title: book.title, reason: `same read as ${target} "${into.title}" (override)` })
    } else if (override.skip) {
      drop.add(id)
      report.dropped.push({ id, title: book.title, reason: override.note ? `skipped: ${override.note}` : 'skipped (override)' })
    }
  }
  const kept = books.filter((book) => !drop.has(book.id))

  // 2. The owner's explicit fields.
  for (const book of kept) {
    const override = resolved.get(book.id)
    if (!override) continue
    const change = (text: string) => report.changes.push({ id: book.id, title: book.title, change: text })
    if (override.dateRead) {
      if (DATE.test(override.dateRead)) {
        change(`finished ${book.session?.finishedAt?.slice(0, 10) ?? 'undated'} → ${override.dateRead}`)
        session(book).finishedAt = toTimestamp(override.dateRead)
      } else report.warnings.push(`Override dateRead "${override.dateRead}" for "${book.title}" is not YYYY-MM-DD; ignored.`)
    }
    if (override.dateStarted) {
      if (DATE.test(override.dateStarted)) {
        change(`started ${book.session?.startedAt?.slice(0, 10) ?? 'undated'} → ${override.dateStarted}`)
        session(book).startedAt = toTimestamp(override.dateStarted)
      } else report.warnings.push(`Override dateStarted "${override.dateStarted}" for "${book.title}" is not YYYY-MM-DD; ignored.`)
    }
    if (override.isbn13) {
      const isbn = toIsbn13(override.isbn13)
      if (isbn) {
        const before = toIsbn13(book.isbn13) ?? toIsbn13(book.isbn)
        change(`edition ${before ?? '—'} → ${isbn}`)
        book.isbn13 = isbn
        book.isbn = null
        // Fable's cover belongs to the edition it had, not the one read.
        book.coverUrl = null
        // And so does its blurb when that edition is in another language (Fable's
        // records are English unless their ISBN says otherwise). (Regal's languageChanged)
        if ((isbnLanguage(before) ?? 'en') !== (isbnLanguage(isbn) ?? override.lang ?? 'en')) book.description = null
      } else report.warnings.push(`Override isbn13 "${override.isbn13}" for "${book.title}" is no ISBN; ignored.`)
    }
    if (override.title) {
      change(`title → "${override.title}"`)
      book.title = override.title
    }
    if (override.author) {
      change(`author → ${override.author}`)
      book.author = override.author
    }
    if (override.lang) book.language = override.lang
    if (override.coverUrl) book.pinnedCoverUrl = override.coverUrl
  }

  return { books: kept, report }
}
