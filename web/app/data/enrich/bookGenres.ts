import type { SupabaseClient } from '@supabase/supabase-js'
import { isNoAnswer } from '../network'
import { type GenreId, isGenreId, MAX_GENRES } from './genres'
import { type EnrichResult, mapError, OFFLINE } from './result'

/**
 * A Book's genres for the member (issue #168): her own choice for her entry of
 * it where she made one, else the ones computed from every source (at most
 * three, canonical ids of `genres.ts`). Reading goes through `book_genres` and
 * `library_genres`; her choice through `set_entry_genres` / `reset_entry_genres`,
 * keyed by her Library entry (it follows the entry through Change edition).
 *
 * Writes are refused offline before anything is sent (web/AGENTS.md).
 * Framework-free: the client and the online check come in from outside.
 */

export type BookGenres = {
  genres: GenreId[]
  /** True when these are her own, not the computed ones. */
  overridden: boolean
}

export type EntryGenres = BookGenres & { entryId: string; bookId: string }

export type BookGenresRepository = {
  /** A Book's genres for her (any Catalogue Book, in her Library or not). */
  forBook: (bookId: string) => Promise<EnrichResult<BookGenres>>
  /** Every entry of her Library with its genres: what the genre filter and the figures read. */
  library: () => Promise<EnrichResult<EntryGenres[]>>
  /** Her own genres for an entry (0–3; duplicates and order as she gave them). Answers the genres now. */
  set: (entryId: string, genres: readonly GenreId[]) => Promise<EnrichResult<GenreId[]>>
  /** Back to the computed genres. Answers them. */
  reset: (entryId: string) => Promise<EnrichResult<GenreId[]>>
}

const known = (ids: unknown): GenreId[] => (Array.isArray(ids) ? ids.filter(isGenreId) : [])

export function createBookGenres(
  client: SupabaseClient,
  { online = () => true }: { online?: () => boolean } = {},
): BookGenresRepository {
  async function write(name: string, args: Record<string, unknown>): Promise<EnrichResult<GenreId[]>> {
    if (!online()) return OFFLINE
    const result = await client.rpc(name, args)
    if (isNoAnswer(result)) return OFFLINE
    if (result.error) return { data: null, error: mapError(result.error) }
    return { data: known(result.data), error: null }
  }

  return {
    async forBook(bookId) {
      const { data, error } = await client.rpc('book_genres', { p_book: bookId })
      if (error) return { data: null, error: mapError(error) }
      const rows = (data ?? []) as { genre_id: string; overridden: boolean }[]
      return { data: { genres: known(rows.map((r) => r.genre_id)), overridden: rows.some((r) => r.overridden) }, error: null }
    },

    async library() {
      const { data, error } = await client.rpc('library_genres')
      if (error) return { data: null, error: mapError(error) }
      const rows = (data ?? []) as { entry_id: string; book_id: string; genre_ids: string[]; overridden: boolean }[]
      return {
        data: rows.map((r) => ({ entryId: r.entry_id, bookId: r.book_id, genres: known(r.genre_ids), overridden: r.overridden })),
        error: null,
      }
    },

    async set(entryId, genres) {
      const unique = [...new Set(genres)]
      if (unique.length > MAX_GENRES || !unique.every(isGenreId)) return { data: null, error: 'invalid' }
      return write('set_entry_genres', { p_entry: entryId, p_genres: unique })
    },

    reset: (entryId) => write('reset_entry_genres', { p_entry: entryId }),
  }
}
