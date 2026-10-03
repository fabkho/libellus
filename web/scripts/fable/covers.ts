import type { BookSnapshot, CoverColors } from '../../app/data/books'
import { describeCover, type Pixels } from '../../app/data/covers'
import type { ImportEntry } from '../../app/data/import/fable'
import { isbnLanguage, toIsbn13 } from '../../app/data/import/readingTracker'
import { appleArtwork, COVER_LARGE, isbnFromArtwork, plainText } from '../../app/data/search'

/**
 * High-resolution Covers and the Catalogue ids for imported Books (issue #17).
 *
 * Ported from Regal's front resolver (~/code/regal scripts/assets/front.ts:
 * `findApple`, `resolveFront`, `titleScore`, the DNB and Open Library cover
 * URLs), adapted to what Libellus stores: one cover URL with its thumbhash and
 * two colours, exactly as `add_to_library` gets them (app/data/covers.ts
 * `describeCover`), and Apple's or OpenLibrary's id for the edition.
 *
 * The chain, per Book, in the language it was read in:
 *   1. the owner's pinned cover (overrides), taken at any size;
 *   2. Apple Books by ISBN, in that language's storefronts (the exact edition);
 *   3. Apple Books by title and author (German reads in the German store);
 *   4. Open Library by ISBN, then the work's cover by title.
 * The first image at least MIN_HEIGHT tall wins; otherwise the tallest real
 * one. Too small or one flat colour is no cover. Fable's own covers are never
 * used: Fable is going away.
 *
 * The German National Library (DNB/VLB) has the exact cover of most German
 * editions, but answers browsers with a bot page instead of the image, so its
 * URL cannot be a Book's cover: it is looked up for German editions and
 * recorded (`dnb`), never stored, until covers are rehosted (follow-up to #17).
 * Regal can use it because it downloads its fronts.
 *
 * Network and image decoding come in from outside (the script passes Node's
 * fetch and sharp; tests pass recordings), like the search repository's fetch.
 */

export const USER_AGENT = 'Libellus/0.1 (+https://github.com/fabkho/libellus)'

/** Height a cover should reach before the chain stops looking (Regal front.ts MIN_HEIGHT). */
export const MIN_HEIGHT = 800

/** An image as read: its own size and its pixels scaled to at most 100 × 100 (same shape as #12's ProbedImage). */
export type ProbedImage = { width: number; height: number; pixels: Pixels }

export interface CoverLookupDeps {
  /** JSON from a URL; null when there is none there (404, not JSON). Rejects when the source cannot be asked. */
  getJson: (url: string) => Promise<unknown>
  /** The image at a URL; null when there is none or it is no image. Rejects when the source cannot be asked. */
  probe: (url: string) => Promise<ProbedImage | null>
}

export type CoverSource = 'pinned' | 'apple' | 'openlibrary'

export interface FoundCover {
  url: string
  source: CoverSource
  width: number
  height: number
  thumbhash: string
  colors: CoverColors
}

/** What the lookups found for one edition; cached by the script, keyed by `lookupKey`. */
export interface EditionLookup {
  /** Apple's edition and how it was found: by its ISBN (the exact edition) or by title. */
  apple: { id: string; via: 'isbn' | 'search'; isbn13: string | null; description: string | null } | null
  openLibrary: { editionKey: string; workKey: string | null } | null
  cover: FoundCover | null
  /** The German National Library's cover of this exact German edition, when it has one: not embeddable, kept for rehosting. */
  dnb: { url: string; width: number; height: number } | null
}

interface AppleItem {
  kind?: string
  trackId?: number
  trackName?: string
  artistName?: string
  artworkUrl100?: string
  description?: string
  userRatingCount?: number
}

const comparable = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '')

/** Apple storefronts for a read language: German reads in the German store, English ones in the US, then the UK. */
export const storefronts = (language: string) => (language === 'de' ? ['de'] : ['us', 'gb'])

/** "Morning Star (Red Rising, #3)" → "Morning Star"; drops subtitles after ":". (Regal server/utils/covers.ts) */
export function cleanTitle(title: string): string {
  return title.trim().replace(/\s*\([^()]*\)\s*$/, '').split(':')[0]!.trim()
}

/** Comparable cores of a title: brackets, ": subtitles", "A Novel" and a leading article dropped. (Regal front.ts) */
export function titleCores(title: string | undefined): string[] {
  const bare = (title ?? '').replace(/\s*[([][^()[\]]*[)\]]/g, ' ').replace(/[:–—-]\s*a novel\s*$/i, '').trim()
  const main = bare.split(/:|\s[–—]\s/)[0]!.trim()
  // Also what follows a colon, when it is a title of its own: Apple's "The Sandman Vol. 1: Preludes & Nocturnes".
  const subtitle = bare.includes(':') ? bare.slice(bare.indexOf(':') + 1).trim() : ''
  const cores = [bare, main, ...(comparable(subtitle).length >= 8 ? [subtitle] : [])].map(comparable)
  for (const core of [...cores]) {
    const bareArticle = core.replace(/^(the|a|an|der|die|das)(?=[a-z0-9]{3})/, '')
    if (bareArticle !== core) cores.push(bareArticle)
  }
  return [...new Set(cores.filter(Boolean))]
}

/** 2 = same title, 1 = theirs is ours plus a subtitle or series, 0 = different. (Regal front.ts) */
export function titleScore(found: string | undefined, wanted: string): number {
  const ours = titleCores(wanted)
  const theirs = titleCores(found)
  if (ours.some((core) => theirs.includes(core))) return 2
  return ours.some((core) => core.length >= 6 && theirs.some((other) => other.startsWith(core))) ? 1 : 0
}

/** Too small to be a cover, or Google's "image not available" card. (Regal front.ts `isPlaceholder`) */
export function tooSmall(width: number, height: number): boolean {
  return height <= 200 || width < 100 || (width === 128 && height === 184)
}

/** One flat colour: the blank a source sends when it has no cover. (as #12's `isPlaceholderImage`) */
export function flatColour(pixels: Pixels): boolean {
  const { data } = pixels
  let low = 255
  let high = 0
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3]! < 128) continue
    const luma = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!
    low = Math.min(low, luma)
    high = Math.max(high, luma)
  }
  return high - low < 12
}

/** Deutsche Nationalbibliothek / VLB cover of exactly this (German) edition, ~600 px. */
export const dnbCover = (isbn: string) => `https://portal.dnb.de/opac/mvb/cover?isbn=${isbn}`
export const openLibraryIsbnCover = (isbn: string) => `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`
export const openLibraryIdCover = (id: number) => `https://covers.openlibrary.org/b/id/${id}-L.jpg`

const bareKey = (key: unknown) => (typeof key === 'string' ? /(OL\d+[MW])$/.exec(key)?.[1] ?? null : null)

/** The input a lookup depends on; the cache key. */
export function lookupKey(entry: ImportEntry): string {
  const { book } = entry
  return [book.isbn13 ?? '', comparable(book.title), comparable(book.authors[0] ?? ''), entry.readLanguage, entry.pinnedCoverUrl ?? ''].join('|')
}

/**
 * Apple Books in the read language's storefronts: ISBN lookup (the exact
 * edition), then a title + author search, the closest title and the most-rated
 * edition first. (Regal front.ts `findApple`)
 */
export async function findApple(entry: ImportEntry, deps: CoverLookupDeps): Promise<(AppleItem & { via: 'isbn' | 'search' }) | null> {
  const { book } = entry
  const countries = storefronts(entry.readLanguage)
  const isbns = [...new Set([book.isbn13, book.isbn10].filter((isbn): isbn is string => Boolean(isbn)))]
  for (const isbn of isbns) {
    for (const country of countries) {
      const result = (await deps.getJson(`https://itunes.apple.com/lookup?isbn=${isbn}&country=${country}`)) as { results?: AppleItem[] } | null
      const item = result?.results?.find((found) => found.trackId && found.artworkUrl100)
      if (item) return { ...item, via: 'isbn' }
    }
  }
  const surnames = book.authors.map((name) => comparable(name.split(/\s+/).at(-1) ?? '')).filter(Boolean)
  const terms = [...new Set([cleanTitle(book.title), book.title.split(':')[0]!.trim()])]
  for (const country of countries) {
    for (const term of terms) {
      const params = new URLSearchParams({ term: `${term} ${book.authors[0] ?? ''}`.trim(), entity: 'ebook', country, limit: '10' })
      const result = (await deps.getJson(`https://itunes.apple.com/search?${params}`)) as { results?: AppleItem[] } | null
      const scored = (result?.results ?? [])
        .filter((item) => item.trackId && item.artworkUrl100 && (!surnames.length || surnames.some((name) => comparable(item.artistName ?? '').includes(name))))
        .map((item) => ({ item, score: titleScore(item.trackName, book.title) }))
        .filter((hit) => hit.score > 0)
      // The closest title; among equals the edition most readers rated (a classic has dozens of bare reprints).
      const best = scored.sort((a, b) => b.score - a.score || (b.item.userRatingCount ?? 0) - (a.item.userRatingCount ?? 0))[0]
      if (best) return { ...best.item, via: 'search' }
    }
  }
  return null
}

/** Open Library's edition (and work) for an ISBN, with the edition's cover id. */
async function openLibraryEdition(isbn: string, deps: CoverLookupDeps) {
  const edition = (await deps.getJson(`https://openlibrary.org/isbn/${isbn}.json`)) as
    | { key?: string; works?: { key?: string }[]; covers?: number[] }
    | null
  const editionKey = bareKey(edition?.key)
  if (!editionKey) return null
  return {
    editionKey,
    workKey: bareKey(edition?.works?.[0]?.key),
    coverId: edition?.covers?.find((id) => id > 0) ?? null,
  }
}

/**
 * The work on Open Library by title and author, with the edition it shows its
 * cover from: the Book's id there when Fable knew it without an ISBN, and the
 * last place to look for a cover. (Regal front.ts `openLibraryWorkCover`)
 */
async function openLibrarySearch(book: BookSnapshot, deps: CoverLookupDeps) {
  const params = new URLSearchParams({ title: cleanTitle(book.title), fields: 'key,title,cover_i,cover_edition_key', limit: '5' })
  if (book.authors[0]) params.set('author', book.authors[0])
  const result = (await deps.getJson(`https://openlibrary.org/search.json?${params}`)) as
    | { docs?: { key?: string; title?: string; cover_i?: number; cover_edition_key?: string }[] }
    | null
  const doc = result?.docs?.find((item) => item.cover_i && titleScore(item.title, book.title) === 2)
  if (!doc) return null
  return { editionKey: bareKey(doc.cover_edition_key), workKey: bareKey(doc.key), coverId: doc.cover_i ?? null }
}

interface Candidate {
  source: CoverSource
  url: string
  minHeight?: number
}

/** Looks an edition up: Apple's and Open Library's ids for it, and its best cover. */
export async function lookupEdition(entry: ImportEntry, deps: CoverLookupDeps): Promise<EditionLookup> {
  const { book } = entry
  const apple = await findApple(entry, deps)
  const known = [...new Set([book.isbn13, toIsbn13(book.isbn10)].filter((isbn): isbn is string => Boolean(isbn)))]
  // Open Library only when Apple does not know the exact edition: it is the
  // Book's id there, and its cover is the fallback. Without an ISBN (and no
  // Apple edition either), the work's cover edition found by title stands in.
  let openLibrary: { editionKey: string | null; workKey: string | null; coverId: number | null } | null =
    apple?.via === 'isbn' ? null : known[0] ? await openLibraryEdition(known[0], deps) : null
  if (!known.length && !apple) openLibrary = await openLibrarySearch(book, deps)

  const candidates: Candidate[] = []
  if (entry.pinnedCoverUrl) candidates.push({ source: 'pinned', url: entry.pinnedCoverUrl, minHeight: 0 })
  const appleCover = apple?.artworkUrl100 ? appleArtwork(apple.artworkUrl100, COVER_LARGE.width, COVER_LARGE.height) : null
  if (apple?.via === 'isbn' && appleCover) candidates.push({ source: 'apple', url: appleCover })
  if (apple?.via === 'search' && appleCover) candidates.push({ source: 'apple', url: appleCover })
  if (openLibrary?.coverId) candidates.push({ source: 'openlibrary', url: openLibraryIdCover(openLibrary.coverId) })
  for (const isbn of known) candidates.push({ source: 'openlibrary', url: openLibraryIsbnCover(isbn) })

  let best: FoundCover | null = null
  const tried = new Set<string>()
  const consider = async (candidate: Candidate) => {
    if (tried.has(candidate.url)) return false
    tried.add(candidate.url)
    const image = await deps.probe(candidate.url)
    if (!image || tooSmall(image.width, image.height) || flatColour(image.pixels)) return false
    if (!best || image.height > best.height) {
      const { thumbhash, colors } = describeCover(image.pixels)
      // Open Library's "?default=false" only matters while looking; the kept URL is plain.
      best = { url: candidate.url.replace('?default=false', ''), source: candidate.source, width: image.width, height: image.height, thumbhash, colors }
    }
    return image.height >= (candidate.minHeight ?? MIN_HEIGHT)
  }
  let done = false
  for (const candidate of candidates) {
    if (await consider(candidate)) {
      done = true
      break
    }
  }
  // Nothing anywhere by ISBN (an out-of-print omnibus): the work's cover on Open Library.
  if (!done && !best && known.length) {
    const work = await openLibrarySearch(book, deps)
    if (work?.coverId) await consider({ source: 'openlibrary', url: openLibraryIdCover(work.coverId) })
  }

  // The DNB's cover of the exact German edition: recorded, never the Book's cover (see the top of this file).
  let dnb: EditionLookup['dnb'] = null
  if (entry.readLanguage === 'de') {
    for (const isbn of known.filter((isbn) => isbnLanguage(isbn) === 'de')) {
      const image = await deps.probe(dnbCover(isbn))
      if (image && !tooSmall(image.width, image.height) && !flatColour(image.pixels)) {
        dnb = { url: dnbCover(isbn), width: image.width, height: image.height }
        break
      }
    }
  }

  return {
    apple: apple?.trackId
      ? {
          id: String(apple.trackId),
          via: apple.via,
          isbn13: isbnFromArtwork(apple.artworkUrl100),
          description: plainText(apple.description),
        }
      : null,
    openLibrary: openLibrary?.editionKey ? { editionKey: openLibrary.editionKey, workKey: openLibrary.workKey } : null,
    cover: best,
    dnb,
  }
}

/**
 * The Book the import writes: the mapped snapshot with its cover, and its real
 * source. An edition Apple has by its ISBN is an Apple Book (with Apple's id),
 * one only Open Library has an OpenLibrary Book, so a member who later finds it
 * in search adds the same Catalogue Book. A Book Fable knew without an ISBN
 * takes Apple's edition found by title, ISBN included. Only what neither knows
 * as this edition stays `import` (an Apple hit by title for a Book with its own
 * ISBN is another edition, so it lends a cover, not its id); add_to_library
 * accepts those as the Catalogue rows they are (20261003114100).
 */
export function withLookup(entry: ImportEntry, lookup: EditionLookup | null): ImportEntry {
  const book: BookSnapshot = { ...entry.book }
  if (lookup?.cover) {
    book.coverUrl = lookup.cover.url
    book.coverThumbhash = lookup.cover.thumbhash
    book.coverColors = lookup.cover.colors
  }
  const apple = lookup?.apple
  if (apple && (apple.via === 'isbn' || !book.isbn13)) {
    book.source = 'apple'
    book.appleId = apple.id
    if (!book.isbn13 && apple.isbn13) book.isbn13 = apple.isbn13
  } else if (lookup?.openLibrary) {
    book.source = 'openlibrary'
    book.openLibraryEditionKey = lookup.openLibrary.editionKey
    book.openLibraryWorkKey = lookup.openLibrary.workKey
  }
  book.description ??= apple?.description ?? null
  return { ...entry, book }
}
