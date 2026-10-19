/**
 * What Goodreads says about one edition, read out of its two keyless JSON
 * endpoints, and how a title search result is matched to a Book (issue #69).
 * Pure: no I/O, no Deno APIs, so the tests run it on recorded responses
 * (fixtures/) and never reach Goodreads.
 *
 * - `book/review_counts.json?isbns=<isbn>` answers an ISBN Goodreads knows with
 *   the edition's book id and the work's counts (all editions together):
 *   `{ books: [{ id, isbn, isbn13, average_rating: "4.51", work_ratings_count,
 *   work_text_reviews_count, … }] }`, and an unknown one with 404 and the text
 *   "No books match those ISBNs.".
 * - `book/auto_complete?format=json&q=<title author>` answers a search with up
 *   to ~20 books: `[{ bookId, workId, title, bookTitleBare, author: { name },
 *   avgRating: "4.51", ratingsCount, … }]`. No review count.
 *
 * Only the rating, the two counts and the book id are kept; never review texts.
 */

import { fuzzyTitleMatch, normaliseTitle, sameBookKind } from '../../../web/app/data/titleMatch.ts'

export const GOODREADS_ORIGIN = 'https://www.goodreads.com'

/**
 * Goodreads is turning us away, as opposed to not knowing a book or failing once: what it answered
 * (`status`) and how it was wrong (`kind`). Never cached; the handler opens its breaker on it (handler.ts).
 *  - `status`: HTTP 403, 429 or 503
 *  - `empty`: a 202, or an empty body
 *  - `not_json`: a body that is not JSON (a challenge or login page)
 *  - `shape`: JSON that is not what the endpoint answers
 */
export type BlockedKind = 'status' | 'empty' | 'not_json' | 'shape'
export class GoodreadsBlocked extends Error {
  constructor(readonly status: number, readonly kind: BlockedKind) {
    super(`goodreads_blocked (${status}, ${kind})`)
  }
}

/** The JSON of an answer that must be one: throws `GoodreadsBlocked` for a block sign, else returns it. */
function readJson(status: number, body: string): unknown {
  if (status === 403 || status === 429 || status === 503) throw new GoodreadsBlocked(status, 'status')
  if (status === 202 || !body.trim()) throw new GoodreadsBlocked(status, 'empty')
  try {
    return JSON.parse(body)
  } catch {
    throw new GoodreadsBlocked(status, 'not_json')
  }
}

/** What the edge function stores and answers for an ISBN. */
export type GoodreadsFound = {
  status: 'found'
  matchedBy: 'isbn' | 'title'
  goodreadsId: string
  /** 0–5, two decimals: the work's average over all its editions. */
  rating: number
  ratingsCount: number
  /** Ratings with a written review; null when the title search found it (it does not say). */
  reviewsCount: number | null
  /**
   * The edition's cover address at Goodreads' CDN (`goodreadsCoverUrl`), only ever asked for by a `cover` request.
   * `undefined`: nobody asked yet; `null`: asked, Goodreads has none (a stand-in image counts as none).
   */
  coverUrl?: string | null
}
export type GoodreadsNotFound = { status: 'not_found' }
export type GoodreadsAnswer = GoodreadsFound | GoodreadsNotFound

/** The Book being looked up, as the page knows it. Without an ISBN it is found by title and author alone. */
export type LookupBook = { isbn13: string | null; title: string | null; authors: string[] }

// ---------------------------------------------------------------------- ISBN

/** True for 13 digits starting 978/979 whose check digit adds up. */
export function isValidIsbn13(value: string): boolean {
  if (!/^97[89]\d{10}$/.test(value)) return false
  const sum = [...value].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0)
  return sum % 10 === 0
}

/** An ISBN-13 as asked for (hyphens and spaces dropped), or null when it is not one. */
export function parseIsbn13(input: string | null | undefined): string | null {
  const compact = (input ?? '').replace(/[\s-]/g, '')
  return isValidIsbn13(compact) ? compact : null
}

// ------------------------------------------------------------------- numbers

function count(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value.replace(/,/g, '')) : value
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null
}

function rating(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 5 ? Math.round(n * 100) / 100 : null
}

function bookId(value: unknown): string | null {
  const id = typeof value === 'number' ? String(value) : value
  return typeof id === 'string' && /^\d{1,20}$/.test(id) ? id : null
}

// ------------------------------------------------------------ review counts

export function reviewCountsUrl(isbn13: string): string {
  return `${GOODREADS_ORIGIN}/book/review_counts.json?isbns=${encodeURIComponent(isbn13)}`
}

/**
 * The answer to a review counts request for one ISBN-13. `status` and `body`
 * as the response had them: a 404 is "no such ISBN" (a miss), a 200 must name
 * the ISBN; anything else throws (an error, never stored); a sign that Goodreads
 * is turning us away (`GoodreadsBlocked`) throws too.
 */
export function parseReviewCounts(isbn13: string, status: number, body: string): GoodreadsAnswer {
  if (status === 404) return { status: 'not_found' }
  if (status !== 200 && ![202, 403, 429, 503].includes(status)) throw new Error(`review_counts answered ${status}`)
  const json = readJson(status, body)
  const books = (json as { books?: unknown } | null)?.books
  if (!Array.isArray(books)) throw new GoodreadsBlocked(status, 'shape')
  const book = books.find(
    (b) => b && typeof b === 'object' && ((b as Record<string, unknown>).isbn13 === isbn13 || books.length === 1),
  ) as Record<string, unknown> | undefined
  if (!book) return { status: 'not_found' }
  const id = bookId(book.id)
  const average = rating(book.average_rating)
  const ratings = count(book.work_ratings_count) ?? count(book.ratings_count)
  const reviews = count(book.work_text_reviews_count) ?? count(book.text_reviews_count)
  if (!id || average === null || ratings === null) throw new Error('review_counts answered a book without its figures')
  // Goodreads keeps stubs for ISBNs nobody rated (placeholders, ISMNs): not a rating to show.
  if (ratings === 0) return { status: 'not_found' }
  return { status: 'found', matchedBy: 'isbn', goodreadsId: id, rating: average, ratingsCount: ratings, reviewsCount: reviews }
}

// ------------------------------------------------------------ title search

export type AutoCompleteBook = {
  bookId: string
  title: string
  bookTitleBare: string
  author: string
  rating: number
  ratingsCount: number
  /** The cover's address without a size token (`goodreadsCoverUrl`); null when it has none. */
  coverUrl: string | null
}

/** The only host a cover address may name: Goodreads' image CDN. */
export const GOODREADS_IMAGE_HOST = 'i.gr-assets.com'

/**
 * The full-size cover address for an `imageUrl` of an auto_complete hit, or null when it is none: the
 * size token (`._SY75_`, `._SX50_`, …) before the extension is stripped (the bare address is the ~332x500
 * original), only https at exactly `i.gr-assets.com` is taken (no port, no credentials), query and
 * fragment are dropped, and Goodreads' stand-in (`nophoto`) is no cover. What it returns is only linked,
 * never copied (docs/covers.md, "Goodreads, the last resort").
 */
export function goodreadsCoverUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 500) return null
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.hostname !== GOODREADS_IMAGE_HOST || url.port || url.username || url.password) {
    return null
  }
  if (/nophoto/i.test(url.pathname) || !/\.(jpe?g|png|webp)$/i.test(url.pathname)) return null
  const path = url.pathname.replace(/(?:\._[A-Z]{1,3}\d+_)+(?=\.[A-Za-z]+$)/, '')
  return `https://${GOODREADS_IMAGE_HOST}${path}`
}

/** The result Goodreads gave for exactly this book id (the very edition: no title check), if it gave it. */
export function pickByBookId(results: AutoCompleteBook[], id: string | null): AutoCompleteBook | null {
  return (id && results.find((result) => result.bookId === id)) || null
}

export function autoCompleteUrl(query: string): string {
  return `${GOODREADS_ORIGIN}/book/auto_complete?format=json&q=${encodeURIComponent(query)}`
}

/** The books a title search found, in Goodreads' order. Throws when the answer is not one. */
export function parseAutoComplete(status: number, body: string): AutoCompleteBook[] {
  if (status !== 200 && ![202, 403, 429, 503].includes(status)) throw new Error(`auto_complete answered ${status}`)
  const json = readJson(status, body)
  if (!Array.isArray(json)) throw new GoodreadsBlocked(status, 'shape')
  const books: AutoCompleteBook[] = []
  for (const item of json) {
    if (!item || typeof item !== 'object') continue
    const b = item as Record<string, unknown>
    const id = bookId(b.bookId)
    const average = rating(b.avgRating)
    const ratings = count(b.ratingsCount)
    const author = (b.author as { name?: unknown } | undefined)?.name
    const title = typeof b.title === 'string' ? b.title : ''
    const bare = typeof b.bookTitleBare === 'string' ? b.bookTitleBare : title
    if (!id || average === null || ratings === null || typeof author !== 'string' || !bare) continue
    books.push({
      bookId: id,
      title: title || bare,
      bookTitleBare: bare,
      author,
      rating: average,
      ratingsCount: ratings,
      coverUrl: goodreadsCoverUrl(b.imageUrl),
    })
  }
  return books
}

// ------------------------------------------------------------------ matching

/** Lower case, accents and punctuation gone, `&` as "and", spaces collapsed (data/titleMatch.ts, shared with the app). */
export const normalise = normaliseTitle

/**
 * The forms a title is known by: as given, without a parenthesis (Goodreads'
 * "(The Stormlight Archive, #1)", an edition's "(We Are Bob)"), and its main
 * title before a subtitle (": An Ambiguous Utopia"), each normalised. Two
 * titles are the same book's when any of their forms are equal.
 */
export function titleForms(title: string): Set<string> {
  const forms = new Set<string>()
  const withoutParens = title.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
  for (const candidate of [title, withoutParens, withoutParens.split(/[:–—]| - /)[0] ?? '']) {
    const form = normalise(candidate)
    if (form) forms.add(form)
  }
  return forms
}

/**
 * An author's family name as written: the last word of "Susanna Clarke" or of
 * "Ursula K. Le Guin" ("Guin"), the part before the comma of "Clarke, Susanna".
 * Null for a name without letters.
 */
function familyName(name: string): string | null {
  const comma = name.indexOf(',')
  const family = comma > 0 ? name.slice(0, comma) : name
  const words = family.split(/\s+/).map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean)
  if (!words.length) return null
  // "Jr", "Sr", "III" are not a family name.
  return words.length > 1 && /^(jr|sr|ii|iii|iv)$/i.test(words.at(-1)!) ? words.at(-2)! : words.at(-1)!
}

/** An author's surname, normalised for comparing ("Le Guin" → "guin"). */
export function surname(name: string): string | null {
  const family = familyName(name)
  return family ? normalise(family) || null : null
}

/** The title search for a Book: its main title and its first author's surname. */
export function titleQuery(book: LookupBook): string | null {
  const title = book.title?.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').split(/[:–—]| - /)[0]?.replace(/\s+/g, ' ').trim()
  if (!title) return null
  const author = book.authors.map(familyName).find(Boolean)
  return author ? `${title} ${author}` : title
}

/**
 * The search result that is this Book: the same title (any of its forms) by
 * an author with one of the Book's authors' surnames, with ratings. A Book without authors
 * never matches: a title alone is too weak. Goodreads' order decides between
 * several matches (the first is its most popular edition).
 */
export function matchTitle(book: LookupBook, results: AutoCompleteBook[]): AutoCompleteBook | null {
  if (!book.title) return null
  const surnames = new Set(book.authors.map(surname).filter((s): s is string => Boolean(s)))
  if (!surnames.size) return null
  const forms = titleForms(book.title)
  for (const result of results) {
    const theirs = surname(result.author)
    if (!theirs || !surnames.has(theirs) || result.ratingsCount === 0) continue
    // The title's forms drop a dash part ("Blood & Roses - Buch 3" is also "Blood & Roses"): another volume, or a
    // summary, is not the book whatever its forms say.
    if (!sameBookKind(book.title, result.bookTitleBare) && !sameBookKind(book.title, result.title)) continue
    const resultForms = new Set([...titleForms(result.bookTitleBare), ...titleForms(result.title)])
    for (const form of forms) if (resultForms.has(form)) return result
  }
  // Else the title worded a little differently, with the author (data/titleMatch.ts: a credit after it, a word more or
  // less; never another volume, a summary or a book that merely begins like it).
  for (const result of results) {
    const theirs = surname(result.author)
    if (!theirs || !surnames.has(theirs) || result.ratingsCount === 0) continue
    if (fuzzyTitleMatch(book.title, result.bookTitleBare, true) || fuzzyTitleMatch(book.title, result.title, true)) return result
  }
  return null
}

/**
 * The result of an ISBN-13 search that is this Book: the first one by an author with one of the Book's surnames.
 * The title is not compared: the ISBN names the edition, and a translation or a re-titled edition wears another
 * title. The author is, so a stray number match never passes. A Book without authors never matches.
 */
export function matchIsbnResult(book: LookupBook, results: AutoCompleteBook[]): AutoCompleteBook | null {
  const surnames = new Set(book.authors.map(surname).filter((s): s is string => Boolean(s)))
  if (!surnames.size) return null
  return results.find((result) => surnames.has(surname(result.author) ?? '')) ?? null
}

/** Where a cover search query comes from: the ISBN-13, the whole title with the first author, or the main title with the surname. */
export type CoverQuery = { kind: 'isbn' | 'title' | 'short'; q: string }

/** "Callie Hart", or "Hart, Callie" read in order. */
function authorName(name: string): string {
  const comma = /^([^,]+),\s*([^,]+)$/.exec(name.trim())
  return (comma && !/^(jr|sr|ii|iii|iv)\.?$/i.test(comma[2]!.trim()) ? `${comma[2]} ${comma[1]}` : name).replace(/\s+/g, ' ').trim()
}

/**
 * The searches for a Book's cover, most exact first: its ISBN-13; its whole title (the series aside dropped, a
 * volume mark kept: "… - Buch 2") with its first author's name; its main title (`titleQuery`: before a subtitle
 * or series dash) with the surname. A form that asks what an earlier one asked is left out.
 */
export function coverQueries(book: LookupBook): CoverQuery[] {
  const queries: CoverQuery[] = []
  if (book.isbn13) queries.push({ kind: 'isbn', q: book.isbn13 })
  const whole = book.title?.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim()
  const first = book.authors.find((name) => name.trim())
  if (whole && first) queries.push({ kind: 'title', q: `${whole} ${authorName(first)}` })
  const short = titleQuery(book)
  if (short && !queries.some((query) => query.kind !== 'isbn' && normalise(query.q) === normalise(short))) queries.push({ kind: 'short', q: short })
  return queries
}

/** A title search result as what the function stores; its cover only when it was asked for (`cover`). */
export function foundByTitle(result: AutoCompleteBook, cover = false): GoodreadsFound {
  return {
    status: 'found',
    matchedBy: 'title',
    goodreadsId: result.bookId,
    rating: result.rating,
    ratingsCount: result.ratingsCount,
    reviewsCount: null,
    ...(cover ? { coverUrl: result.coverUrl } : {}),
  }
}

/**
 * What a Book without an ISBN is cached by: its normalised title and its
 * authors' normalised surnames, sorted ("something wicked this way comes|bradbury").
 * Derived from exactly what the title search is asked with, so two Books that
 * would ask the same thing (the same title twice in the Catalogue) share one
 * answer. Null when there is not enough to ask: no title, or no author (a title
 * alone never matches, `matchTitle`).
 */
export function titleKey(book: Pick<LookupBook, 'title' | 'authors'>): string | null {
  const title = book.title ? normalise(book.title) : ''
  const surnames = [...new Set(book.authors.map(surname).filter((s): s is string => Boolean(s)))].sort()
  if (!title || !surnames.length) return null
  return `${title}|${surnames.join(',')}`
}
