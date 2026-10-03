import type { SupabaseClient } from '@supabase/supabase-js'
import { parseIsbn } from './books'
import { abortError } from './fetching'
import { bookFromRow, ENTRY_COLUMNS, entryFromRow, type BookRow, type EntryRow, type LibraryEntry } from './library'
import type { Found } from './merge'

/**
 * The own Catalogue as a search source (issue #1, Search), and the member's
 * Library as search needs it to mark what she already has. The matching
 * itself is the database's (`search_books`: word beginnings over title and
 * authors, accents ignored, the member's own Manual books included), so a
 * native client finds the same Books.
 */

/** How many Catalogue Books one query brings. */
export const CATALOGUE_LIMIT = 20

export type CatalogueSearch = {
  /** The Books matching a query (or an ISBN), best first. Rejects when the database cannot be asked. */
  search: (query: string, signal?: AbortSignal) => Promise<Found[]>
  /** Every entry of the member's Library with its Book. Rejects when it cannot be read. */
  libraryEntries: () => Promise<LibraryEntry[]>
}

export function createCatalogueSearch(client: SupabaseClient): CatalogueSearch {
  return {
    async search(query, signal) {
      const isbn = parseIsbn(query)
      let request = client.rpc('search_books', { p_query: isbn ?? query, p_limit: CATALOGUE_LIMIT })
      if (signal) request = request.abortSignal(signal)
      const { data, error } = await request.returns<BookRow[]>()
      if (signal?.aborted) throw abortError()
      if (error) throw new Error(error.message)
      return data.map((row) => ({ book: bookFromRow(row), source: 'catalogue' as const, popularity: 0 }))
    },

    async libraryEntries() {
      const { data, error } = await client.from('library_entries').select(ENTRY_COLUMNS).returns<EntryRow[]>()
      if (error) throw new Error(error.message)
      return data.map(entryFromRow)
    },
  }
}
