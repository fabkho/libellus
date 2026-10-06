/**
 * What Goodreads knows about one edition, read out of its book page (issue
 * #111). A Goodreads export names every row by its Book Id but often has no
 * ISBN (`=""`, a Kindle row), so the importer asks about the edition by that
 * id instead, and gets the ISBNs, the language and the shape of the book back.
 *
 * `book/show/<id>` is a 600 KB HTML page, but everything the page renders also
 * sits in it as JSON: `<script id="__NEXT_DATA__">`, whose
 * `props.pageProps.apolloState` is Apollo's cache keyed by node
 * (`Book:kca://…`). Several `Book:` entries are in it — the book's other
 * editions and recommendations as stubs — so the edition is the one whose
 * `legacyId` is the id that was asked for.
 *
 * Pure: no I/O, no Deno APIs, so the tests run it on a recorded page
 * (fixtures/book-page-small-gods.json) and never reach Goodreads.
 */
import { GOODREADS_ORIGIN, isValidIsbn13 } from './goodreads.ts'

/** What the edge function stores and answers for a Goodreads Book Id. */
export type EditionFound = {
  status: 'found'
  goodreadsId: string
  title: string | null
  isbn13: string | null
  isbn10: string | null
  /** Amazon's id, the only identifier a Kindle edition has. */
  asin: string | null
  /** ISO 639-1, from Goodreads' language name; null when it names one we do not map. */
  language: string | null
  pageCount: number | null
  /** Goodreads' own words: "Kindle Edition", "Paperback", "Hardcover", … */
  format: string | null
  publisher: string | null
  /** The year this edition was published (UTC). */
  year: number | null
}
export type EditionNotFound = { status: 'not_found' }
export type EditionAnswer = EditionFound | EditionNotFound

/** Goodreads' ids are short numbers; anything else was never one of theirs. */
export const GOODREADS_ID_PATTERN = /^\d{1,12}$/

/** A Goodreads Book Id as asked for (spaces dropped), or null when it is not one. */
export function parseGoodreadsId(input: string | null | undefined): string | null {
  const compact = (input ?? '').trim()
  return GOODREADS_ID_PATTERN.test(compact) ? compact : null
}

/** The edition's page. Goodreads redirects it to the same page with a slug. */
export function bookPageUrl(goodreadsId: string): string {
  return `${GOODREADS_ORIGIN}/book/show/${goodreadsId}`
}

/**
 * Goodreads names a language, the app keeps a code (the Catalogue's
 * `language`). Only the languages its members read are mapped; anything else
 * stays unknown rather than guessed.
 */
const LANGUAGES: Record<string, string> = {
  english: 'en',
  german: 'de',
  french: 'fr',
  spanish: 'es',
  italian: 'it',
  dutch: 'nl',
  portuguese: 'pt',
  swedish: 'sv',
  danish: 'da',
  norwegian: 'no',
  polish: 'pl',
  russian: 'ru',
  japanese: 'ja',
  chinese: 'zh',
  finnish: 'fi',
  czech: 'cs',
  turkish: 'tr',
}

/** The ISO 639-1 code for a Goodreads language name, or null for one we do not map. */
export function languageCode(name: unknown): string | null {
  if (typeof name !== 'string') return null
  return LANGUAGES[name.trim().toLowerCase()] ?? null
}

/** True for nine digits and a check digit (a digit or X) that adds up mod 11. */
export function isValidIsbn10(value: string): boolean {
  if (!/^[0-9]{9}[0-9X]$/.test(value)) return false
  const sum = [...value].reduce(
    (total, char, index) => total + (char === 'X' ? 10 : Number(char)) * (10 - index),
    0,
  )
  return sum % 11 === 0
}

/** An ISBN-10 as its ISBN-13 (978, the nine digits, a new check digit). */
export function isbn10To13(isbn10: string): string {
  const body = `978${isbn10.slice(0, 9)}`
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0)
  return `${body}${(10 - (sum % 10)) % 10}`
}

function text(value: unknown): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  // A long one is a page that changed shape, not a title: keep the answer small.
  return trimmed ? trimmed.slice(0, 500) : null
}

function positiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

/** The year `publicationTime` (milliseconds since the epoch) falls in, in UTC. */
function year(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const date = new Date(value)
  const published = date.getUTCFullYear()
  return published >= 1000 && published <= 2999 ? published : null
}

/** The script Next.js leaves in every page, with the state it rendered from. */
function nextData(html: string): unknown {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  if (!match) throw new Error('the book page has no __NEXT_DATA__')
  try {
    return JSON.parse(match[1]!)
  } catch {
    throw new Error('the book page has a __NEXT_DATA__ that is not JSON')
  }
}

/** The `Book:` entry of the edition that was asked for, or null when the page holds none. */
function bookEntry(state: Record<string, unknown>, goodreadsId: string): Record<string, unknown> | null {
  let stub: Record<string, unknown> | null = null
  for (const [key, value] of Object.entries(state)) {
    if (!key.startsWith('Book:') || !value || typeof value !== 'object') continue
    const book = value as Record<string, unknown>
    // A number in the JSON; the id was asked for as text. The entry with the
    // details wins over a stub of the same edition.
    if (String(book.legacyId ?? '') !== goodreadsId) continue
    if (book.details) return book
    stub ??= book
  }
  return stub
}

/**
 * What the edition's page says about it. A 404, and a page that renders
 * something else than this edition, are misses (stored, so the same id is not
 * asked about again); a page we cannot read at all throws, so a Goodreads
 * that is down or redesigned is never stored as a miss.
 */
export function parseEdition(goodreadsId: string, status: number, body: string): EditionAnswer {
  if (status === 404) return { status: 'not_found' }
  if (status !== 200) throw new Error(`book/show answered ${status}`)
  const data = nextData(body)
  const state = (data as { props?: { pageProps?: { apolloState?: unknown } } })?.props?.pageProps?.apolloState
  if (!state || typeof state !== 'object') throw new Error('the book page has no apolloState')
  const book = bookEntry(state as Record<string, unknown>, goodreadsId)
  if (!book) return { status: 'not_found' }

  const details = (book.details ?? {}) as Record<string, unknown>
  const given13 = text(details.isbn13)
  const given10 = text(details.isbn)?.toUpperCase() ?? null
  const asin = text(details.asin)
  // A printed book's ASIN is its ISBN-10: Goodreads often has only that.
  const isbn10 = given10 && isValidIsbn10(given10) ? given10 : asin && isValidIsbn10(asin.toUpperCase()) ? asin.toUpperCase() : null
  const isbn13 = given13 && isValidIsbn13(given13) ? given13 : isbn10 ? isbn10To13(isbn10) : null
  return {
    status: 'found',
    goodreadsId,
    // The plain title, not `titleComplete`: the series ("(Discworld, #13)")
    // belongs to the work, not to what the importer matches on.
    title: text(book.title) ?? text(book.titleComplete),
    isbn13,
    isbn10,
    asin,
    language: languageCode((details.language as { name?: unknown } | undefined)?.name),
    pageCount: positiveInt(details.numPages),
    format: text(details.format),
    publisher: text(details.publisher),
    year: year(details.publicationTime),
  }
}
