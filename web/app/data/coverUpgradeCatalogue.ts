import type { SupabaseClient } from '@supabase/supabase-js'
import { upgradable, type UpgradeRow, type UpgradeWrite } from './coverUpgrade'

/**
 * The cover upgrade's side of the database (data/coverUpgrade.ts): which Catalogue Books an import added, what covers the
 * Catalogue has for them now, and handing a larger cover to a Book (`fill_book_covers`, with `replaces`:
 * supabase/migrations/20261101010000_fill_book_covers_upgrade.sql). Every call is one the member's own session may make; a failure
 * is "could not", never an error shown: the list stays for the next start.
 */

/** Rows per `in (...)` read. */
const READ_CHUNK = 100
/** How many covers one `fill_book_covers` call takes. */
const WRITE_CHUNK = 200

type BookRow = {
  id: string
  owner_id: string | null
  source: string
  isbn13: string | null
  title: string
  authors: string[]
  language: string | null
  page_count: number | null
  published_year: number | null
  cover_url: string | null
}

export type UpgradeCatalogue = {
  /**
   * The Books of the import's own new entries (`added` rows only: never one she held, added or picked herself) that the upgrade
   * may touch: a Catalogue Book (not a Manual book, not hers alone) whose cover is not Apple's already. Null: could not be read.
   */
  rowsForEntries: (entryIds: readonly string[]) => Promise<UpgradeRow[] | null>
  currentCovers: (bookIds: string[]) => Promise<Map<string, string | null> | null>
  write: (covers: UpgradeWrite[]) => Promise<boolean>
}

export function createUpgradeCatalogue(client: SupabaseClient): UpgradeCatalogue {
  return {
    async rowsForEntries(entryIds) {
      const rows: UpgradeRow[] = []
      for (let from = 0; from < entryIds.length; from += READ_CHUNK) {
        try {
          const { data, error } = await client
            .from('library_entries')
            .select('id, book:books(id, owner_id, source, isbn13, title, authors, language, page_count, published_year, cover_url)')
            .in('id', entryIds.slice(from, from + READ_CHUNK))
            .returns<{ id: string; book: BookRow | null }[]>()
          if (error || !data) return null
          for (const { book } of data) {
            if (!book || book.owner_id !== null || book.source === 'manual' || !upgradable(book.cover_url)) continue
            rows.push({
              bookId: book.id,
              isbn13: book.isbn13,
              title: book.title,
              authors: book.authors,
              language: book.language,
              pageCount: book.page_count,
              year: book.published_year,
              cover: book.cover_url,
            })
          }
        } catch {
          return null
        }
      }
      return rows
    },

    async currentCovers(bookIds) {
      const covers = new Map<string, string | null>()
      try {
        for (let from = 0; from < bookIds.length; from += READ_CHUNK) {
          const { data, error } = await client
            .from('books')
            .select('id, cover_url')
            .in('id', bookIds.slice(from, from + READ_CHUNK))
            .returns<{ id: string; cover_url: string | null }[]>()
          if (error || !data) return null
          for (const row of data) covers.set(row.id, row.cover_url)
        }
      } catch {
        return null
      }
      return covers
    },

    async write(covers) {
      try {
        for (let from = 0; from < covers.length; from += WRITE_CHUNK) {
          const { error } = await client.rpc('fill_book_covers', { p_covers: covers.slice(from, from + WRITE_CHUNK) })
          if (error) return false
        }
        return true
      } catch {
        return false
      }
    },
  }
}
