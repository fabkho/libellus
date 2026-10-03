import { isValidIsbn13, parseIsbn, type BookSnapshot } from './books'

/**
 * Finding Books (issue #1, Search). This slice (#6) asks Apple Books through the
 * iTunes Search API; the own Catalogue and OpenLibrary join in #12 behind the
 * same `search` call. Framework-free, and `fetch` comes in from outside, so the
 * tests run on recorded Apple responses and never on the live API.
 */

/** Below this many characters nothing is asked: one letter matches everything. */
export const MIN_QUERY_LENGTH = 2

/** How long typing has to pause before a query goes out. */
export const SEARCH_DEBOUNCE_MS = 220

/** How many results each storefront is asked for. */
export const STOREFRONT_LIMIT = 20

/** The slice of `fetch` the repository uses; the browser's and Node's both fit. */
export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<unknown>
}>

/** What one query found. `failed`: no source answered, so the list says so instead of "nothing found". */
export type SearchOutcome = { results: BookSnapshot[]; failed: boolean }

export type Search = {
  /** Rejects with an AbortError when `signal` aborts; the caller drops the query. */
  search: (query: string, options?: { signal?: AbortSignal }) => Promise<SearchOutcome>
  /**
   * One Apple Book by its track id: a book page opened from a link or after a
   * reload. Null when no storefront has it; rejects when none answered.
   */
  lookupApple: (appleId: string, options?: { signal?: AbortSignal }) => Promise<BookSnapshot | null>
  /** One Apple Book by ISBN-13; null or a rejection as `lookupApple`. */
  lookupIsbn: (isbn13: string, options?: { signal?: AbortSignal }) => Promise<BookSnapshot | null>
}

// ------------------------------------------------------------------ storefronts

/**
 * Which Apple storefronts to ask, by the device's language: a German reader
 * holds German editions (and covers), so `de` first and `us` after; everyone
 * else `us`, then `gb`. Results from the first rank first.
 */
export function storefrontsFor(languages: readonly string[]): [string, string] {
  const primary = (languages[0] ?? '').toLowerCase()
  return primary === 'de' || primary.startsWith('de-') ? ['de', 'us'] : ['us', 'gb']
}

// ------------------------------------------------------------------- Apple data

/** The fields of an iTunes Search API ebook result the app reads. */
type AppleItem = {
  kind?: string
  trackId?: number
  trackName?: string
  artistName?: string
  description?: string
  releaseDate?: string
  artworkUrl100?: string
  artworkUrl60?: string
}

const ARTWORK_SIZE = /\/\d+x\d+bb\.(?:jpg|jpeg|png|webp)$/

/**
 * An Apple artwork URL at another size. Apple's CDN renders any bounding box
 * (`600x900bb` keeps the cover's own proportions inside 600 × 900), so the list
 * asks for a small one and the Catalogue keeps a large one.
 */
export function appleArtwork(url: string, width: number, height: number): string {
  return ARTWORK_SIZE.test(url) ? url.replace(ARTWORK_SIZE, `/${width}x${height}bb.jpg`) : url
}

/** The size a Book's cover is stored at (issue #6). */
export const COVER_LARGE = { width: 600, height: 900 } as const

/**
 * Apple names many artwork files after the edition's ISBN-13
 * (`…/9783641264864.jpg/100x100bb.jpg`). Only a valid one counts.
 */
export function isbnFromArtwork(url: string | undefined): string | null {
  const file = url?.replace(ARTWORK_SIZE, '').split('/').pop() ?? ''
  const match = /^(97[89]\d{10})(?:\D|$)/.exec(file)
  return match && isValidIsbn13(match[1]!) ? match[1]! : null
}

const NAME_SUFFIX = /^(?:Jr\.?|Sr\.?|II|III|IV|PhD)$/i

/** "Edward Gibbon, Gian Battista Piranesi & Daniel J. Boorstin" → three authors, in order. */
export function splitAuthors(artistName: string | undefined): string[] {
  const parts = (artistName ?? '')
    .split(/\s*,\s*|\s+&\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
  const authors: string[] = []
  for (const part of parts) {
    if (NAME_SUFFIX.test(part) && authors.length) authors[authors.length - 1] += `, ${part}`
    else authors.push(part)
  }
  return authors
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** Apple's HTML blurb as plain text: paragraphs kept, tags dropped, entities decoded. */
export function plainText(html: string | undefined): string | null {
  if (!html) return null
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h\d)>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
      if (name[0] === '#') {
        const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1))
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole
      }
      return ENTITIES[name.toLowerCase()] ?? whole
    })
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text || null
}

/** One Apple result as a Book snapshot; null for anything that is not a usable ebook. */
export function snapshotFromApple(item: AppleItem): BookSnapshot | null {
  if (item.kind && item.kind !== 'ebook') return null
  const title = item.trackName?.trim()
  if (!item.trackId || !title) return null
  const artwork = item.artworkUrl100 ?? item.artworkUrl60
  const year = Number(item.releaseDate?.slice(0, 4))
  return {
    title,
    authors: splitAuthors(item.artistName),
    isbn13: isbnFromArtwork(artwork),
    isbn10: null,
    pageCount: null,
    year: Number.isInteger(year) && year > 0 ? year : null,
    language: null,
    publisher: null,
    description: plainText(item.description),
    coverUrl: artwork ? appleArtwork(artwork, COVER_LARGE.width, COVER_LARGE.height) : null,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: String(item.trackId),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

/** Same edition twice (the two storefronts often overlap): by Apple id, then by ISBN-13. */
export function dedupe(books: readonly BookSnapshot[]): BookSnapshot[] {
  const seen = new Set<string>()
  const unique: BookSnapshot[] = []
  for (const book of books) {
    const keys = [book.appleId && `apple:${book.appleId}`, book.isbn13 && `isbn:${book.isbn13}`].filter(Boolean) as string[]
    if (keys.some((key) => seen.has(key))) continue
    keys.forEach((key) => seen.add(key))
    unique.push(book)
  }
  return unique
}

// ------------------------------------------------------------------ the client

const API = 'https://itunes.apple.com'

function abortError(): Error {
  const error = new Error('The search was replaced by a newer one')
  error.name = 'AbortError'
  return error
}

/** True for the rejection a superseded query ends in. */
export function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export function createSearch(options: { fetch: FetchLike; languages: readonly string[] }): Search {
  const storefronts = storefrontsFor(options.languages)

  async function ask(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<AppleItem[]> {
    const url = `${API}/${path}?${new URLSearchParams(params)}`
    const response = await options.fetch(url, { signal })
    if (!response.ok) throw new Error(`Apple answered ${response.status}`)
    const body = (await response.json()) as { results?: AppleItem[] }
    return Array.isArray(body.results) ? body.results : []
  }

  /**
   * Every storefront at once; their answers in storefront order. A storefront
   * that fails is left out; `failed` only when none answered.
   */
  async function everywhere(
    path: string,
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<{ items: AppleItem[][]; failed: boolean }> {
    const answers = await Promise.allSettled(storefronts.map((country) => ask(path, { ...params, country }, signal)))
    if (signal?.aborted) throw abortError()
    const items = answers.map((answer) => (answer.status === 'fulfilled' ? answer.value : []))
    return { items, failed: answers.every((answer) => answer.status === 'rejected') }
  }

  function books(items: AppleItem[][]): BookSnapshot[] {
    return dedupe(items.flat().map(snapshotFromApple).filter((book): book is BookSnapshot => book !== null))
  }

  /** A lookup that cannot tell "not there" from "nobody answered" must not say "not there". */
  async function lookup(params: Record<string, string>, signal?: AbortSignal): Promise<BookSnapshot[]> {
    const { items, failed } = await everywhere('lookup', params, signal)
    if (failed) throw new Error('No storefront answered')
    return books(items)
  }

  async function lookupIsbn(isbn13: string, { signal }: { signal?: AbortSignal } = {}) {
    const found = (await lookup({ isbn: isbn13 }, signal))[0]
    return found ? { ...found, isbn13 } : null
  }

  return {
    async search(query, { signal } = {}) {
      const text = query.trim()
      if (text.length < MIN_QUERY_LENGTH) return { results: [], failed: false }

      // An ISBN is a lookup, not a word to match.
      const isbn = parseIsbn(text)
      if (isbn) {
        const { items, failed } = await everywhere('lookup', { isbn }, signal)
        return { results: books(items).map((book) => ({ ...book, isbn13: isbn })), failed }
      }

      const { items, failed } = await everywhere(
        'search',
        { term: text, media: 'ebook', entity: 'ebook', limit: String(STOREFRONT_LIMIT) },
        signal,
      )
      return { results: books(items), failed }
    },

    async lookupApple(appleId, { signal } = {}) {
      // Track ids are global, but a storefront only knows the editions it sells.
      return (await lookup({ id: appleId }, signal)).find((book) => book.appleId === appleId) ?? null
    },

    lookupIsbn,
  }
}
