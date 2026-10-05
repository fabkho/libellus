import { isValidIsbn13, type BookSnapshot } from './books'
import { decodeEntities } from './entities'
import { abortError, getJson, type FetchLike } from './fetching'
import type { Found } from './merge'

/**
 * Apple Books, one of the three sources behind search (issue #1, Search): the
 * iTunes Search API, ebooks only, asked in two storefronts at once. Turns
 * Apple's answers into Book snapshots and knows Apple's artwork URLs.
 * Framework-free; `fetch` comes in from outside.
 */

/** How many results each storefront is asked for. */
export const STOREFRONT_LIMIT = 20

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

/**
 * The fields of an iTunes Search API ebook result the app reads. There is no
 * language among them because there is none to read: an ebook result (search
 * and lookup alike, checked in #104) carries `artistName`, `genres`, `price`,
 * `releaseDate`, the artwork and the like, but no `language`/`languageCodesISO2A`
 * (software results have one, ebooks do not), and a storefront says where a book
 * is sold, not what it is written in. An Apple edition's `language` stays null
 * unless OpenLibrary knows the same edition (`representative` in editions.ts),
 * and then the Change edition row shows no language at all, not a placeholder.
 */
export type AppleItem = {
  kind?: string
  trackId?: number
  trackName?: string
  artistName?: string
  description?: string
  releaseDate?: string
  artworkUrl100?: string
  artworkUrl60?: string
  userRatingCount?: number
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

/** Apple's HTML blurb as plain text: paragraphs kept, tags dropped, entities decoded. */
export function plainText(html: string | undefined): string | null {
  if (!html) return null
  const text = decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|li|h\d)>/gi, '\n\n')
      .replace(/<[^>]*>/g, ''),
  )
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
  const title = decodeEntities(item.trackName ?? '').trim()
  if (!item.trackId || !title) return null
  const artwork = item.artworkUrl100 ?? item.artworkUrl60
  const year = Number(item.releaseDate?.slice(0, 4))
  return {
    title,
    authors: splitAuthors(decodeEntities(item.artistName ?? '')),
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

// ------------------------------------------------------------------ the client

const API = 'https://itunes.apple.com'

export type AppleSource = {
  /** Free text, every storefront at once, the first storefront's answers first. */
  search: (text: string, signal?: AbortSignal) => Promise<Found[]>
  /** The editions with this ISBN-13 (each carries it). Rejects when no storefront answered. */
  lookupIsbn: (isbn13: string, signal?: AbortSignal) => Promise<Found[]>
  /** One edition by its track id; null when no storefront sells it. Rejects when none answered. */
  lookupId: (appleId: string, signal?: AbortSignal) => Promise<BookSnapshot | null>
}

export function createApple(options: { fetch: FetchLike; languages: readonly string[] }): AppleSource {
  const storefronts = storefrontsFor(options.languages)

  async function ask(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<AppleItem[]> {
    const body = (await getJson(options.fetch, `${API}/${path}?${new URLSearchParams(params)}`, signal)) as {
      results?: AppleItem[]
    }
    return Array.isArray(body.results) ? body.results : []
  }

  /**
   * Every storefront at once; their answers in storefront order. A storefront
   * that fails is left out; it rejects only when none answered.
   */
  async function everywhere(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<Found[]> {
    const answers = await Promise.allSettled(storefronts.map((country) => ask(path, { ...params, country }, signal)))
    if (signal?.aborted) throw abortError()
    if (answers.every((answer) => answer.status === 'rejected')) throw new Error('No storefront answered')
    return answers.flatMap((answer) =>
      answer.status === 'fulfilled'
        ? answer.value.flatMap((item) => {
            const book = snapshotFromApple(item)
            return book ? [{ book, source: 'apple' as const, popularity: item.userRatingCount ?? 0 }] : []
          })
        : [],
    )
  }

  return {
    search: (text, signal) =>
      everywhere('search', { term: text, media: 'ebook', entity: 'ebook', limit: String(STOREFRONT_LIMIT) }, signal),

    async lookupIsbn(isbn13, signal) {
      return (await everywhere('lookup', { isbn: isbn13 }, signal)).map((found) => ({
        ...found,
        book: { ...found.book, isbn13 },
      }))
    },

    async lookupId(appleId, signal) {
      // Track ids are global, but a storefront only knows the editions it sells.
      return (await everywhere('lookup', { id: appleId }, signal)).find((found) => found.book.appleId === appleId)?.book ?? null
    },
  }
}
