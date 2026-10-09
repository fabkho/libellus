import type { Book, BookSnapshot } from './books'
import { isbn10To13 } from './books'

/**
 * Goodreads' community rating of a Book (issue #69): the average over all the
 * work's editions, how many rated it, how many wrote a review, and the book's
 * Goodreads id for the link. Never review texts.
 *
 * Asked on demand by the book page, for any Book with an ISBN or, failing that,
 * a title and an author (in the Library or not), from the `goodreads-rating` edge function: it answers from the
 * shared cache (`goodreads_ratings`, or `goodreads_title_ratings` for a Book without an
 * ISBN; a found rating is refreshed after 30 days, a miss after 7) or asks Goodreads
 * once, server-side. The browser never talks to Goodreads. A Catalogue Book
 * also carries the cached rating in its row (`books.goodreads`, the
 * `goodreads_rating` computed relationship), so a Library loaded once shows it
 * offline too. Framework-free: the store hands in the Supabase client (only
 * its `functions`), the tests a stand-in.
 */

export type GoodreadsRating = {
  goodreadsId: string
  /** 0–5, two decimals. */
  rating: number
  ratingsCount: number
  /** Null when Goodreads found the book by title (it does not say then). */
  reviewsCount: number | null
}

/** A `goodreads_ratings` row, as PostgREST returns it (embedded as `goodreads` in a `books` row). */
export type GoodreadsRow = {
  isbn13: string
  status: 'found' | 'not_found'
  goodreads_id: string | null
  rating: number | string | null
  ratings_count: number | null
  reviews_count: number | null
  checked_at: string
}

export const GOODREADS_FUNCTION = 'goodreads-rating'

/** The Book's page on Goodreads, opened at its ratings and reviews. */
export function goodreadsUrl(goodreadsId: string): string {
  return `https://www.goodreads.com/book/show/${encodeURIComponent(goodreadsId)}#CommunityReviews`
}

/** The ISBN-13 a Book is looked up by: its own, or its ISBN-10 converted. Null without either. */
export function goodreadsIsbn(book: Pick<BookSnapshot, 'isbn13' | 'isbn10'>): string | null {
  return book.isbn13 ?? (book.isbn10 ? isbn10To13(book.isbn10) : null)
}

/**
 * What the app remembers a Book's answer by this run: its ISBN-13, or, without
 * one, its title and first author (the function looks it up by those). Null when
 * there is nothing to ask with: no ISBN and no author (a title alone never
 * matches, so the function would refuse it).
 */
export function goodreadsKey(book: Pick<BookSnapshot, 'isbn13' | 'isbn10' | 'title' | 'authors'>): string | null {
  const isbn13 = goodreadsIsbn(book)
  if (isbn13) return isbn13
  const author = book.authors.find((a) => a.trim())
  const title = book.title.trim()
  return title && author ? `title:${title.toLowerCase()}|${author.trim().toLowerCase()}` : null
}

/** A rating worth a line: one somebody gave. */
export function showsRating(rating: GoodreadsRating | null | undefined): rating is GoodreadsRating {
  return Boolean(rating && rating.ratingsCount > 0)
}

export function ratingFromRow(row: GoodreadsRow | null | undefined): GoodreadsRating | null {
  if (!row || row.status !== 'found' || !row.goodreads_id || row.rating === null || row.ratings_count === null) return null
  return {
    goodreadsId: row.goodreads_id,
    rating: Number(row.rating),
    ratingsCount: row.ratings_count,
    reviewsCount: row.reviews_count,
  }
}

/** What the function answers (supabase/functions/goodreads-rating/handler.ts). */
type Answer =
  | { status: 'found'; goodreadsId: string; rating: number; ratingsCount: number; reviewsCount: number | null }
  | { status: 'not_found' }

/** The part of the Supabase client this needs: `functions.invoke`. */
export type FunctionsClient = {
  functions: {
    invoke: (name: string, options: { body: unknown }) => Promise<{ data: unknown; error: unknown }>
  }
}

export type GoodreadsResult =
  | { data: GoodreadsRating | null; error: null }
  | { data: null; error: 'offline' | 'unavailable' }

export type Goodreads = {
  /** The Book's rating; `data: null` when Goodreads does not know it. Nothing is asked without an ISBN or an author. */
  rating: (book: Book | BookSnapshot) => Promise<GoodreadsResult>
}

export function createGoodreads(client: FunctionsClient, { online = () => true }: { online?: () => boolean } = {}): Goodreads {
  return {
    async rating(book) {
      if (!goodreadsKey(book)) return { data: null, error: null }
      if (!online()) return { data: null, error: 'offline' }
      // Without an ISBN the function looks the Book up by its title and authors alone.
      const isbn13 = goodreadsIsbn(book)
      try {
        const { data, error } = await client.functions.invoke(GOODREADS_FUNCTION, {
          body: { ...(isbn13 ? { isbn13 } : {}), title: book.title, authors: book.authors },
        })
        const answer = data as Answer | null
        if (error || !answer || (answer.status !== 'found' && answer.status !== 'not_found'))
          return { data: null, error: 'unavailable' }
        if (answer.status === 'not_found') return { data: null, error: null }
        return {
          data: {
            goodreadsId: String(answer.goodreadsId),
            rating: Number(answer.rating),
            ratingsCount: Number(answer.ratingsCount),
            reviewsCount: answer.reviewsCount ?? null,
          },
          error: null,
        }
      } catch {
        return { data: null, error: 'unavailable' }
      }
    },
  }
}
