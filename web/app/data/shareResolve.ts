import type { SupabaseClient } from '@supabase/supabase-js'
import type { Book, BookSnapshot } from './books'
import type { Search } from './search'
import { namesTheBook, type SharedBook } from '../utils/shared'

/**
 * Where a share leads (issue #91): the Book it names, or a search to show the
 * member with the shared words in the query. Resolved through the search
 * repository (Catalogue, Apple Books and OpenLibrary, one merged list) and the
 * Goodreads cache; a failure anywhere is never an error screen, it is the
 * search overlay with the text, which always works.
 */
export type ShareOutcome = { kind: 'book'; book: Book | BookSnapshot } | { kind: 'search'; query: string }

/**
 * The ISBN-13 the shared Goodreads cache holds for a Goodreads book id (the
 * `goodreads_ratings` rows the book page's rating fills, readable by every
 * member). Null when no Book with this id has been looked at yet.
 */
export async function isbnOfGoodreadsId(client: SupabaseClient, goodreadsId: string): Promise<string | null> {
  const { data, error } = await client
    .from('goodreads_ratings')
    .select('isbn13')
    .eq('goodreads_id', goodreadsId)
    .eq('status', 'found')
    .limit(1)
    .returns<{ isbn13: string }[]>()
  if (error) return null
  return data[0]?.isbn13 ?? null
}

export async function resolveShare(
  shared: SharedBook,
  deps: { search: Search; client?: SupabaseClient | null; signal?: AbortSignal },
): Promise<ShareOutcome> {
  const fallback: ShareOutcome = { kind: 'search', query: shared.query || shared.isbn13 || '' }
  const { search, client, signal } = deps
  try {
    const isbn13 = shared.isbn13 ?? (client && shared.goodreadsId ? await isbnOfGoodreadsId(client, shared.goodreadsId) : null)
    if (isbn13) {
      const found = await search.search(isbn13, { signal })
      if (found.results[0]) return { kind: 'book', book: found.results[0].book }
    }
    // A Goodreads link names a Book: the hit that bears the shared title is it.
    // (A bare title never goes straight to a Book: editions and namesakes are her pick.)
    if (shared.goodreadsId && shared.titleHint && shared.query) {
      const found = await search.search(shared.query, { signal })
      const hit = found.results.find((result) => namesTheBook(shared.titleHint, result.book.title))
      if (hit) return { kind: 'book', book: hit.book }
    }
  } catch {
    // Offline, or no source answered: the search overlay is the way on.
  }
  return fallback
}
