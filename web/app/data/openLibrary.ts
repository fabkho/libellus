import { isbn10To13, isValidIsbn10, isValidIsbn13, type BookFormat, type BookSnapshot } from './books'
import { abortError, getJson, type FetchLike } from './fetching'
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

/**
 * OpenLibrary's `physical_format` (free text, in any language, mostly empty) as
 * one of the four formats; null for anything else (a CD-ROM, "Unknown binding").
 */
export function formatFromPhysical(physical: string | null | undefined): BookFormat | null {
  const text = (physical ?? '').trim().toLowerCase()
  if (!text) return null
  if (/audio|mp3|cassette|hörbuch|livre audio/.test(text)) return 'audiobook'
  if (/e-?book|electronic|kindle|epub|digital|e-text/.test(text)) return 'ebook'
  if (/hard ?(cover|back|bound)|library binding|gebunden|cartonn|relié|cartoné|tapa dura|rilegato/.test(text)) return 'hardcover'
  if (/paper ?back|soft ?(cover|back)|mass market|trade|pocket|taschenbuch|broschiert|brossura|broché|tapa blanda|rústica|poche|kartoniert/.test(text))
    return 'paperback'
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

/** One edition of OpenLibrary's work editions list (`/works/<key>/editions.json`). */
export type OpenLibraryWorkEdition = {
  key?: string
  title?: string
  covers?: number[]
  isbn_13?: string[]
  isbn_10?: string[]
  number_of_pages?: number
  publish_date?: string
  publishers?: string[]
  languages?: { key?: string }[]
  physical_format?: string
}

/**
 * How many editions of a work are asked for in one call (issue #41), and how
 * many at most over several: a popular work has hundreds, and an edition past
 * the first page (the owner's 2022 Gollancz *I Am Legend*, 53rd of 55) was
 * never listed when only the first 50 were asked for.
 */
export const WORK_EDITIONS_PAGE = 100
export const WORK_EDITIONS_LIMIT = 300

/**
 * One edition of a work's editions list as a Book snapshot (issue #41). The
 * list names no authors, only their keys: the work's are handed in. Null
 * without a title or an edition key.
 */
export function snapshotFromWorkEdition(
  edition: OpenLibraryWorkEdition,
  work: { key: string; authors: readonly string[] },
): BookSnapshot | null {
  const editionKey = bareKey(edition.key)
  const title = cleanTitle(edition.title ?? '')
  if (!title || !editionKey) return null
  const isbns = isbnsOf([...(edition.isbn_13 ?? []), ...(edition.isbn_10 ?? [])])
  const coverId = edition.covers?.find((id) => id > 0)
  const pages = edition.number_of_pages
  return {
    title,
    authors: [...work.authors],
    isbn13: isbns.isbn13,
    isbn10: isbns.isbn10,
    pageCount: pages && Number.isInteger(pages) && pages > 0 ? pages : null,
    year: yearOf(edition.publish_date ? [edition.publish_date] : undefined),
    // `/languages/ger` → `ger`, the code search's editions carry too.
    language: /\/languages\/([a-z]{3})$/.exec(edition.languages?.[0]?.key ?? '')?.[1] ?? null,
    publisher: edition.publishers?.[0]?.trim() || null,
    description: null,
    coverUrl: coverId ? openLibraryCover(coverId) : null,
    coverThumbhash: null,
    coverColors: null,
    source: 'openlibrary',
    appleId: null,
    openLibraryEditionKey: editionKey,
    openLibraryWorkKey: bareKey(work.key),
    format: formatFromPhysical(edition.physical_format),
  }
}

/** One edition as OpenLibrary keeps it (`/isbn/<isbn>.json`, `/books/<key>.json`): a work edition with its work. */
export type OpenLibraryEditionRecord = OpenLibraryWorkEdition & { works?: { key?: string }[]; pagination?: string }

/**
 * An edition record as a Book snapshot. The record names its authors only by
 * their keys: their names come from the search's answer for the same ISBN
 * (`lookupIsbnRecord`), or are left empty for the caller to fill. Its page
 * count is `number_of_pages`, else the first number of `pagination` ("176 p.").
 */
export function snapshotFromEditionRecord(record: OpenLibraryEditionRecord, authors: readonly string[] = []): BookSnapshot | null {
  const work = bareKey(record.works?.[0]?.key) ?? ''
  const book = snapshotFromWorkEdition(record, { key: work, authors })
  if (!book) return null
  const paginated = Number(/\d+/.exec(record.pagination ?? '')?.[0])
  return {
    ...book,
    openLibraryWorkKey: work || null,
    pageCount: book.pageCount ?? (Number.isInteger(paginated) && paginated > 0 && paginated < 100000 ? paginated : null),
  }
}

export type OpenLibrarySource = {
  search: (text: string, signal?: AbortSignal) => Promise<Found[]>
  /** The edition with this ISBN-13 (carrying it), if OpenLibrary knows it. */
  lookupIsbn: (isbn13: string, signal?: AbortSignal) => Promise<Found[]>
  /** One edition by its key (`OL61022665M`); null when OpenLibrary does not know it. */
  lookupEdition: (editionKey: string, signal?: AbortSignal) => Promise<BookSnapshot | null>
  /**
   * The edition with this ISBN-13 as OpenLibrary keeps it (`/isbn/<isbn>.json`:
   * its page count and format, which the search does not give), with the
   * authors and work the search names for it. Null when OpenLibrary does not
   * know the ISBN.
   */
  lookupIsbnRecord: (isbn13: string, signal?: AbortSignal) => Promise<BookSnapshot | null>
  /** The editions of a work (`OL45883W`), page by page up to `WORK_EDITIONS_LIMIT`, with the work's authors (issue #41). */
  workEditions: (work: { key: string; authors: readonly string[] }, signal?: AbortSignal) => Promise<BookSnapshot[]>
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
    async lookupIsbnRecord(isbn13, signal) {
      const [record, found] = await Promise.allSettled([
        options.fetch(`${API}/isbn/${isbn13}.json`, { signal }).then(async (response) => {
          // Not found is an answer: OpenLibrary does not know the ISBN.
          if (response.status === 404) return null
          if (!response.ok) throw new Error(`openlibrary.org answered ${response.status}`)
          return (await response.json()) as OpenLibraryEditionRecord
        }),
        ask({ isbn: isbn13, limit: '1' }, signal, isbn13),
      ])
      if (signal?.aborted) throw abortError()
      if (record.status === 'rejected') throw record.reason
      const named = found.status === 'fulfilled' ? found.value[0]?.book : undefined
      const book = record.value ? snapshotFromEditionRecord(record.value, named?.authors ?? []) : null
      if (!book) return null
      return {
        ...book,
        isbn13,
        openLibraryWorkKey: book.openLibraryWorkKey ?? named?.openLibraryWorkKey ?? null,
        language: book.language ?? named?.language ?? null,
        coverUrl: book.coverUrl ?? named?.coverUrl ?? null,
      }
    },
    async workEditions(work, signal) {
      const key = bareKey(work.key)
      if (!key) return []
      const books: BookSnapshot[] = []
      for (let offset = 0; offset < WORK_EDITIONS_LIMIT; offset += WORK_EDITIONS_PAGE) {
        const query = new URLSearchParams({ limit: String(WORK_EDITIONS_PAGE), ...(offset ? { offset: String(offset) } : {}) })
        const body = (await getJson(options.fetch, `${API}/works/${key}/editions.json?${query}`, signal)) as {
          entries?: OpenLibraryWorkEdition[]
          size?: number
        }
        const entries = Array.isArray(body.entries) ? body.entries : []
        for (const edition of entries) {
          const book = snapshotFromWorkEdition(edition, { key, authors: work.authors })
          if (book) books.push(book)
        }
        // The last page: fewer than asked for, or as many as the work has.
        if (entries.length < WORK_EDITIONS_PAGE || (typeof body.size === 'number' && offset + entries.length >= body.size)) break
      }
      return books
    },
  }
}
