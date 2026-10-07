/**
 * What the two public functions of the reading page migration
 * (supabase/migrations/20261011030000_reading_pages.sql) hand out, as types,
 * plus the few pure things both images read out of it. No I/O here, so the
 * tests can build a page or a card by hand.
 */

/** A Book as a visitor sees it: `private.reading_page_book_json`. */
export type PublicBook = {
  id: string
  title: string
  authors: string[]
  published_year: number | null
  cover_url: string | null
  cover_thumbhash: string | null
  cover_dominant: string | null
  cover_secondary: string | null
}

export type PublicReadingPage = {
  name: string | null
  sections: { reading: boolean; year: boolean; favourites: boolean; finished: boolean; shelf: boolean }
  reading?: { book: PublicBook; started_on: string | null }[]
  year?: {
    year: number
    books: number
    pages: number
    pages_missing: number
    rated: number
    unrated: number
    average: number | null
    median_days: number | null
    rereads: number
    months: number[]
  }
  favourites?: { book: PublicBook; rating: number | null }[]
  finished?: { book: PublicBook; ended_on: string | null; rating: number | null; review: string | null }[]
  shelf?: { kind: 'regal' } | { kind: 'covers'; books: PublicBook[] }
}

export type PublicBookCard = {
  name: string | null
  book: PublicBook
  status: 'want_to_read' | 'reading' | 'finished'
  ended_on: string | null
  rating: number | null
  review: string | null
}

/** The address' token: 128 random bits as 22 base64url characters. */
export const TOKEN = /^[A-Za-z0-9_-]{22}$/

/** A Book id, as the card address carries it. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Her name on the image, or the page without one. "Ada's reading". */
export function pageTitle(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim()
  return trimmed ? `${trimmed}’s reading` : 'A reading page'
}

/**
 * The covers the page image shows, in the order the page itself reads: what she
 * is reading now first, then the Books the other sections hold, each Book once.
 */
export function pageCovers(page: PublicReadingPage, limit: number): PublicBook[] {
  const shelf = page.shelf && page.shelf.kind === 'covers' ? page.shelf.books : []
  const all = [
    ...(page.reading ?? []).map((r) => r.book),
    ...(page.finished ?? []).map((f) => f.book),
    ...(page.favourites ?? []).map((f) => f.book),
    ...shelf,
  ]
  const seen = new Set<string>()
  const covers: PublicBook[] = []
  for (const book of all) {
    if (seen.has(book.id)) continue
    seen.add(book.id)
    covers.push(book)
    if (covers.length === limit) break
  }
  return covers
}

/**
 * The line under the title: what she is reading, her year and how much she
 * finished — only the parts her page actually shows. Mono on the image, so it
 * stays short.
 */
export function pageSummary(page: PublicReadingPage): string {
  const parts: string[] = []
  const reading = page.reading?.[0]
  if (reading) parts.push(`Reading ${reading.book.title}`)
  if (page.year && page.year.books > 0) parts.push(`${page.year.books} ${plural(page.year.books, 'book')} in ${page.year.year}`)
  const finished = page.finished?.length ?? 0
  if (!parts.length && finished) parts.push(`${finished} ${plural(finished, 'book')} finished`)
  if (!parts.length) parts.push('A shelf to look at')
  return parts.join(' · ')
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`
}

/** The first author, the only one an image has room for. */
export function firstAuthor(book: PublicBook): string | null {
  return book.authors?.find((author) => author && author.trim()) ?? null
}

/**
 * What the card says instead of stars when there is no Rating: where the Book
 * stands in her Library.
 */
export function statusLine(card: PublicBookCard): string {
  if (card.status === 'reading') return 'Reading now'
  if (card.status === 'want_to_read') return 'Wants to read'
  return 'Finished'
}

/** A Rating in stars, 1–20 quarters. `null` when she did not rate the read. */
export function ratingValue(quarters: number | null | undefined): string | null {
  if (typeof quarters !== 'number' || !Number.isFinite(quarters) || quarters < 1 || quarters > 20) return null
  const stars = quarters / 4
  return Number.isInteger(stars) ? String(stars) : stars.toFixed(2).replace(/0$/, '')
}

/**
 * Cuts text to a length an image can hold without the last word breaking in
 * half, and marks it with an ellipsis when something was left out.
 */
export function clamp(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}
