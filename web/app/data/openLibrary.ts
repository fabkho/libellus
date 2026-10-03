import { isbn10To13, isValidIsbn10, isValidIsbn13, type BookSnapshot } from './books'
import { getJson, type FetchLike } from './fetching'
import type { Found } from './merge'

/**
 * OpenLibrary, one of the three sources behind search (issue #1, Search): its
 * search API with a reduced field list. OpenLibrary answers with works; asking
 * for `editions.*` brings the one edition that best fits the query (and the
 * device language) along, and that edition is the Book. Framework-free;
 * `fetch` comes in from outside.
 */

const API = 'https://openlibrary.org'
const COVERS = 'https://covers.openlibrary.org'

/** How many works OpenLibrary is asked for. */
export const OPENLIBRARY_LIMIT = 20

/** Only what a Book snapshot and the ranking read; the full documents are large. */
export const OPENLIBRARY_FIELDS = [
  'key',
  'title',
  'author_name',
  'first_publish_year',
  'cover_i',
  'cover_edition_key',
  'ratings_count',
  'readinglog_count',
  'editions',
  'editions.key',
  'editions.title',
  'editions.isbn',
  'editions.cover_i',
  'editions.language',
  'editions.publish_date',
  'editions.publisher',
].join(',')

type OpenLibraryEdition = {
  key?: string
  title?: string
  isbn?: string[]
  cover_i?: number
  language?: string[]
  publish_date?: string[]
  publisher?: string[]
}

/** One work of an OpenLibrary search answer, with its best edition. */
export type OpenLibraryDoc = {
  key?: string
  title?: string
  author_name?: string[]
  first_publish_year?: number
  cover_i?: number
  cover_edition_key?: string
  ratings_count?: number
  readinglog_count?: number
  editions?: { docs?: OpenLibraryEdition[] }
}

export type OpenLibraryCoverSize = 'S' | 'M' | 'L'

/** A cover by OpenLibrary's cover id. */
export function openLibraryCover(coverId: number, size: OpenLibraryCoverSize = 'L'): string {
  return `${COVERS}/b/id/${coverId}-${size}.jpg`
}

/**
 * A cover by ISBN. `default=false` makes a missing cover a 404 instead of
 * OpenLibrary's 1 × 1 placeholder.
 */
export function openLibraryIsbnCover(isbn13: string, size: OpenLibraryCoverSize = 'L'): string {
  return `${COVERS}/b/isbn/${isbn13}-${size}.jpg?default=false`
}

const COVER_SIZE = /-[SML]\.jpg(?=\?|$)/

/** An OpenLibrary cover URL at another of its sizes (S, M, L); other URLs as they are. */
export function openLibraryCoverAt(url: string, size: OpenLibraryCoverSize): string {
  return /^https:\/\/covers\.openlibrary\.org\//.test(url) ? url.replace(COVER_SIZE, `-${size}.jpg`) : url
}

/** `/books/OL61022665M` → `OL61022665M`. */
function bareKey(key: string | undefined): string | null {
  const match = /(OL\d+[MW])$/.exec(key ?? '')
  return match ? match[1]! : null
}

/** Library-catalogue punctuation at the end of a title ("Piranesi.", "Emma /") goes. */
export function cleanTitle(title: string): string {
  return title.replace(/[\s/:;,.]+$/, '').trim()
}

function yearOf(dates: string[] | undefined): number | null {
  for (const date of dates ?? []) {
    const match = /\b(1\d{3}|20\d{2})\b/.exec(date)
    if (match) return Number(match[1])
  }
  return null
}

/** The edition's ISBN-13 (an ISBN-10 converted) and ISBN-10, valid ones only. */
function isbnsOf(list: string[] | undefined): { isbn13: string | null; isbn10: string | null } {
  const compact = (list ?? []).map((isbn) => isbn.replace(/[\s-]/g, '').toUpperCase())
  const isbn10 = compact.find(isValidIsbn10) ?? null
  const isbn13 = compact.find(isValidIsbn13) ?? (isbn10 ? isbn10To13(isbn10) : null)
  return { isbn13, isbn10 }
}

/**
 * One OpenLibrary work as the snapshot of its best edition. Null without a
 * title or without an edition to name it by (it could not be added).
 */
export function snapshotFromOpenLibrary(doc: OpenLibraryDoc, isbn13?: string): BookSnapshot | null {
  const edition = doc.editions?.docs?.[0]
  const editionKey = bareKey(edition?.key) ?? bareKey(doc.cover_edition_key)
  const title = cleanTitle(edition?.title ?? doc.title ?? '')
  if (!title || !editionKey) return null
  const isbns = isbnsOf(edition?.isbn)
  const coverId = edition?.cover_i ?? doc.cover_i
  return {
    title,
    authors: (doc.author_name ?? []).map((name) => name.trim()).filter(Boolean),
    isbn13: isbn13 ?? isbns.isbn13,
    isbn10: isbns.isbn10,
    pageCount: null,
    year: yearOf(edition?.publish_date) ?? doc.first_publish_year ?? null,
    language: edition?.language?.[0] ?? null,
    publisher: edition?.publisher?.[0]?.trim() || null,
    description: null,
    coverUrl: coverId && coverId > 0 ? openLibraryCover(coverId) : null,
    coverThumbhash: null,
    coverColors: null,
    source: 'openlibrary',
    appleId: null,
    openLibraryEditionKey: editionKey,
    openLibraryWorkKey: bareKey(doc.key),
  }
}

/** OpenLibrary's language parameter: the device's first language, two letters. */
export function openLibraryLanguage(languages: readonly string[]): string | null {
  const primary = /^[a-z]{2}/i.exec(languages[0] ?? '')
  return primary ? primary[0].toLowerCase() : null
}

export type OpenLibrarySource = {
  search: (text: string, signal?: AbortSignal) => Promise<Found[]>
  /** The edition with this ISBN-13 (carrying it), if OpenLibrary knows it. */
  lookupIsbn: (isbn13: string, signal?: AbortSignal) => Promise<Found[]>
  /** One edition by its key (`OL61022665M`); null when OpenLibrary does not know it. */
  lookupEdition: (editionKey: string, signal?: AbortSignal) => Promise<BookSnapshot | null>
}

export function createOpenLibrary(options: { fetch: FetchLike; languages: readonly string[] }): OpenLibrarySource {
  const lang = openLibraryLanguage(options.languages)

  async function ask(params: Record<string, string>, signal?: AbortSignal, isbn13?: string): Promise<Found[]> {
    const query = new URLSearchParams({ ...params, fields: OPENLIBRARY_FIELDS, ...(lang ? { lang } : {}) })
    const body = (await getJson(options.fetch, `${API}/search.json?${query}`, signal)) as { docs?: OpenLibraryDoc[] }
    return (Array.isArray(body.docs) ? body.docs : []).flatMap((doc) => {
      const book = snapshotFromOpenLibrary(doc, isbn13)
      return book
        ? [{ book, source: 'openlibrary' as const, popularity: (doc.readinglog_count ?? 0) + (doc.ratings_count ?? 0) }]
        : []
    })
  }

  return {
    search: (text, signal) => ask({ q: text, limit: String(OPENLIBRARY_LIMIT) }, signal),
    lookupIsbn: (isbn13, signal) => ask({ isbn: isbn13, limit: '1' }, signal, isbn13),
    async lookupEdition(editionKey, signal) {
      const found = await ask({ q: `edition_key:${editionKey}`, limit: '1' }, signal)
      const book = found[0]?.book
      return book?.openLibraryEditionKey === editionKey ? book : null
    },
  }
}
