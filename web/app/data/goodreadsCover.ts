import { GOODREADS_FUNCTION, type FunctionsClient } from './goodreads'

/**
 * A book's Goodreads cover, the last-resort cover source (docs/covers.md, "Goodreads, the last resort"; the flag
 * is `GOODREADS_COVERS`, data/coverRank.ts). The browser never talks to Goodreads: it asks the `goodreads-rating`
 * function with `cover: true` as the signed-in member (the rating line's way, data/goodreads.ts), which searches
 * Goodreads' keyless search (the ISBN-13 first, then the whole title with the author, then the main title with the
 * surname: the first accepted hit ends it) and answers the address of the cover at `i.gr-assets.com`. The address is
 * only linked, never copied. Framework-free; the Supabase client comes in from outside.
 */

/** The only address a Goodreads cover may have (the function checks it too, and so does the Catalogue's allow-list). */
const GOODREADS_COVER_ADDRESS = /^https:\/\/i\.gr-assets\.com\/[^\s?#]+$/

/**
 * What is asked: the Book's title and authors, its ISBN-13 when the row has one (the search's first and most exact
 * query), and the id of the Goodreads file's own row when the row came from one.
 */
export type GoodreadsCoverQuery = { title: string; authors: string[]; isbn13?: string | null; goodreadsBookId?: string | null }

/**
 * `{ coverUrl }` once Goodreads answered (`coverUrl: null`: it has no cover for this book), `'blocked'` when the
 * function says Goodreads is turning it away (`status: 'blocked'`, its 10-minute breaker; a miss is not that),
 * `'later'` when every search of it answered an empty list (`status: 'unsure'`): Goodreads either does not know the
 * book or is throttling softly, and the function cannot tell which, so it says neither; the caller may ask again
 * later (data/coverFill.ts asks once more, after the others), and it is no failure, no "none",
 * `null` when it could not be asked: offline, refused, over the member's limit, unreachable. Never throws.
 */
export type GoodreadsCoverResult = { coverUrl: string | null } | 'blocked' | 'later' | null

export type GoodreadsCover = {
  find: (query: GoodreadsCoverQuery) => Promise<GoodreadsCoverResult>
}

export function createGoodreadsCover(client: FunctionsClient, { online = () => true }: { online?: () => boolean } = {}): GoodreadsCover {
  return {
    async find({ title, authors, isbn13, goodreadsBookId }) {
      if (!title.trim() || !authors.length || !online()) return null
      try {
        const { data, error } = await client.functions.invoke(GOODREADS_FUNCTION, {
          body: { title, authors, cover: true, ...(isbn13 ? { isbn13 } : {}), ...(goodreadsBookId ? { goodreadsBookId } : {}) },
        })
        const answer = data as { status?: unknown; coverUrl?: unknown } | null
        if (!error && answer?.status === 'blocked') return 'blocked'
        if (!error && answer?.status === 'unsure') return 'later'
        if (error || !answer || (answer.status !== 'found' && answer.status !== 'not_found')) return null
        const coverUrl = typeof answer.coverUrl === 'string' && GOODREADS_COVER_ADDRESS.test(answer.coverUrl) ? answer.coverUrl : null
        return { coverUrl }
      } catch {
        return null
      }
    },
  }
}
