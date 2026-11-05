import { toIsbn13 } from './dnbRecord.ts'
import { type GenreId, googleGenres } from './enrich/genres.ts'
import { GOOGLE_COVER_HOST } from './googleCover.ts'

/**
 * The Google Books API's volumes read as editions (`GET https://www.googleapis.com/books/v1/volumes`).
 * Asked server-side by the `google-books` edge function (supabase/functions/google-books), which imports
 * this file: it imports only other pure files, so Deno, Node and the browser read it alike. Pure; the tests
 * answer from recordings.
 *
 * What is kept of a volume is what the app uses and nothing more: the facts of the edition (title, authors,
 * ISBN-13/-10, pages, year, language, publisher), the app's own genres mapped from Google's `categories`
 * (`googleGenres`, data/enrich/genres.ts: the raw categories are dropped) and the address of the cover image,
 * which is linked and never copied. **No description**: it is the publisher's text, and Google's terms allow no
 * permanent copy of it (docs/THIRD-PARTY.md; `STORABLE_DESCRIPTION`, data/mergeBook.ts), so it is neither
 * asked for (`GOOGLE_FIELDS`) nor kept.
 */

export const GOOGLE_BOOKS_VOLUMES = 'https://www.googleapis.com/books/v1/volumes'

/** The only parts of a volume the request asks for (Google's partial response): no description, no preview or sale data. */
export const GOOGLE_FIELDS =
  'items(id,volumeInfo(title,authors,publisher,publishedDate,industryIdentifiers,pageCount,categories,language,imageLinks/thumbnail))'

/** Volumes one answer holds at most (the API's page is 10 by default, 40 at most). */
export const GOOGLE_RESULTS = 10

/** One edition as the edge function answers it and the app reads it. */
export type GoogleVolume = {
  /** Google's volume id: only ever used to tell two volumes apart. */
  id: string
  title: string
  authors: string[]
  isbn13: string | null
  isbn10: string | null
  pageCount: number | null
  year: number | null
  /** ISO 639-1, lower case (`de`); null when Google says it is undetermined. */
  language: string | null
  publisher: string | null
  /** The app's own genres, mapped from the volume's `categories`; at most three, none when nothing maps. */
  genres: GenreId[]
  /** The cover's address at Google (`https://books.google.com/books/content?…`), linked and never copied; null when there is none. */
  coverUrl: string | null
}

type Raw = {
  items?: {
    id?: unknown
    volumeInfo?: {
      title?: unknown
      authors?: unknown
      publisher?: unknown
      publishedDate?: unknown
      industryIdentifiers?: unknown
      pageCount?: unknown
      categories?: unknown
      language?: unknown
      imageLinks?: { thumbnail?: unknown }
    }
  }[]
}

const text = (value: unknown, max = 300): string | null => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null)

/** The cover's address as the app links it: https, the front cover at the small size, no page-curl effect. Null for any other host. */
export function coverUrlOf(value: unknown): string | null {
  const raw = text(value, 500)
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw.replace(/^http:\/\//i, 'https://'))
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.hostname !== GOOGLE_COVER_HOST || !url.pathname.startsWith('/books/content')) return null
  const id = url.searchParams.get('id')
  if (!id || !/^[\w-]{4,40}$/.test(id)) return null
  return `https://${GOOGLE_COVER_HOST}/books/content?id=${id}&printsec=frontcover&img=1&zoom=1&source=gbs_api`
}

/** The ISBN-13 a volume is known by: its ISBN_13, else its ISBN_10 converted; both kept apart. */
function isbnsOf(identifiers: unknown): { isbn13: string | null; isbn10: string | null } {
  let isbn13: string | null = null
  let isbn10: string | null = null
  if (Array.isArray(identifiers)) {
    for (const identifier of identifiers as { type?: unknown; identifier?: unknown }[]) {
      const value = text(identifier?.identifier, 20)
      if (!value) continue
      const converted = toIsbn13(value)
      if (!converted) continue
      if (identifier.type === 'ISBN_13') isbn13 ??= converted
      else if (identifier.type === 'ISBN_10') {
        isbn10 ??= value.replace(/[\s-]/g, '').toUpperCase()
        isbn13 ??= converted
      }
    }
  }
  return { isbn13, isbn10 }
}

/**
 * The volumes of a `volumes` answer, one per ISBN-13 (Google lists an edition several times; the first stays),
 * in the order Google ranked them. A volume without a title is dropped; one without an ISBN stays (`isbn13: null`:
 * the app cannot add it, the function's caller decides). Never throws: anything else is no volume.
 */
export function parseVolumes(body: unknown): GoogleVolume[] {
  const items = (body as Raw | null)?.items
  if (!Array.isArray(items)) return []
  const out: GoogleVolume[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const info = item?.volumeInfo
    const id = text(item?.id, 40)
    const title = text(info?.title)
    if (!info || !id || !title) continue
    const { isbn13, isbn10 } = isbnsOf(info.industryIdentifiers)
    if (isbn13) {
      if (seen.has(isbn13)) continue
      seen.add(isbn13)
    }
    const authors = Array.isArray(info.authors) ? info.authors.map((name) => text(name, 200)).filter((name): name is string => Boolean(name)).slice(0, 8) : []
    const pages = typeof info.pageCount === 'number' && Number.isInteger(info.pageCount) && info.pageCount >= 1 && info.pageCount <= 10_000 ? info.pageCount : null
    const year = /^(\d{4})/.exec(text(info.publishedDate, 20) ?? '')?.[1]
    const language = /^[a-z]{2}$/i.test(String(info.language ?? '')) ? String(info.language).toLowerCase() : null
    out.push({
      id,
      title,
      authors,
      isbn13,
      isbn10,
      pageCount: pages,
      year: year && Number(year) >= 1400 ? Number(year) : null,
      language,
      publisher: text(info.publisher, 200),
      genres: googleGenres(Array.isArray(info.categories) ? info.categories.filter((c): c is string => typeof c === 'string') : []),
      coverUrl: coverUrlOf(info.imageLinks?.thumbnail),
    })
  }
  return out
}

// -------------------------------------------------------------------- queries

/** A phrase safe inside a `q` operator: no quotes or operators of its own. */
const phrase = (value: string) => value.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim()

/** `q` for one ISBN-13. */
export const isbnQuery = (isbn13: string) => `isbn:${isbn13}`

/** `q` for a title and a first author (`intitle:` and `inauthor:`): what the import and the edition picker know. Null without a title. */
export function titleQuery(title: string, author = ''): string | null {
  const main = phrase(title)
  if (!main) return null
  const who = phrase(author)
  return `intitle:"${main}"${who ? ` inauthor:"${who}"` : ''}`
}

/** The request address of one question. `langRestrict` only for one language (the API takes one); `key` is added by the function, never here. */
export function volumesUrl(q: string, language: string | null = null): string {
  const params = new URLSearchParams({ q, maxResults: String(GOOGLE_RESULTS), printType: 'books', fields: GOOGLE_FIELDS })
  if (language) params.set('langRestrict', language)
  return `${GOOGLE_BOOKS_VOLUMES}?${params}`
}
