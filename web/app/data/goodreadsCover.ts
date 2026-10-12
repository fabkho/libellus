import { GOODREADS_FUNCTION, type FunctionsClient } from './goodreads'

/**
 * A book's Goodreads cover, the last-resort cover source (docs/covers.md, "Goodreads, the last resort"; the flag
 * is `GOODREADS_COVERS`, data/coverRank.ts). The browser never talks to Goodreads: it asks the `goodreads-rating`
 * function with `cover: true` as the signed-in member (the rating line's way, data/goodreads.ts), which searches
 * Goodreads' keyless title search once and answers the address of the cover at `i.gr-assets.com`. The address is
 * only linked, never copied. Framework-free; the Supabase client comes in from outside.
 */

/** The only address a Goodreads cover may have (the function checks it too, and so does the Catalogue's allow-list). */
const GOODREADS_COVER_ADDRESS = /^https:\/\/i\.gr-assets\.com\/[^\s?#]+$/

/** What is asked: the Book's title and authors, and the id of the Goodreads file's own row when the row came from one. */
export type GoodreadsCoverQuery = { title: string; authors: string[]; goodreadsBookId?: string | null }

/**
 * `{ coverUrl }` once Goodreads answered (`coverUrl: null`: it has no cover for this book), `null` when it could
 * not be asked: offline, refused, over the member's limit, unreachable. Never throws.
 */
export type GoodreadsCoverResult = { coverUrl: string | null } | null

export type GoodreadsCover = {
  find: (query: GoodreadsCoverQuery) => Promise<GoodreadsCoverResult>
}

export function createGoodreadsCover(client: FunctionsClient, { online = () => true }: { online?: () => boolean } = {}): GoodreadsCover {
  return {
    async find({ title, authors, goodreadsBookId }) {
      if (!title.trim() || !authors.length || !online()) return null
      try {
        const { data, error } = await client.functions.invoke(GOODREADS_FUNCTION, {
          body: { title, authors, cover: true, ...(goodreadsBookId ? { goodreadsBookId } : {}) },
        })
        const answer = data as { status?: unknown; coverUrl?: unknown } | null
        if (error || !answer || (answer.status !== 'found' && answer.status !== 'not_found')) return null
        const coverUrl = typeof answer.coverUrl === 'string' && GOODREADS_COVER_ADDRESS.test(answer.coverUrl) ? answer.coverUrl : null
        return { coverUrl }
      } catch {
        return null
      }
    },
  }
}
