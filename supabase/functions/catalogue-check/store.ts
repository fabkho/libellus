/**
 * The function's side of the database: the claim and what it stores, all service-role RPCs of
 * supabase/migrations/20261021020000_catalogue_check.sql. Nothing here takes a member's input.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CheckBook, CheckResult } from './check.ts'

export type Store = {
  /** Claims up to `limit` unchecked Catalogue Books (leased until they are stored or given back). */
  claim: (limit: number) => Promise<CheckBook[]>
  save: (bookId: string, result: CheckResult) => Promise<boolean>
  /** The source does not know the Book: failed, checked, no description. */
  miss: (bookId: string) => Promise<boolean>
  /** The source's answer is another Book than the row says: failed, checked, no description, its source keys cleared. */
  mismatch: (bookId: string) => Promise<boolean>
  /** The source could not be asked: back, later. */
  failed: (bookId: string, error: string) => Promise<void>
  /** Not tried (out of time): back at once. */
  release: (bookId: string) => Promise<void>
  status: () => Promise<Record<string, number>>
}

const COLUMNS = ['id', 'title', 'source', 'apple_id', 'isbn13', 'isbn10', 'openlibrary_edition_key', 'openlibrary_work_key'] as const

export function createSupabaseStore(supabase: SupabaseClient): Store {
  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await supabase.rpc(name, args)
    if (error) throw new Error(`${name}: ${error.message}`)
    return data as T
  }

  return {
    async claim(limit) {
      const rows = await rpc<Record<string, unknown>[]>('catalogue_check_claim', { p_limit: limit })
      // Only the columns the check reads: the title, authors and description of a row are the first member's, not for the lookups.
      return (rows ?? []).map((row) => Object.fromEntries(COLUMNS.map((column) => [column, row[column] ?? null])) as CheckBook)
    },
    save: (bookId, result) => rpc<boolean>('catalogue_check_save', { p_book: bookId, p_result: result }),
    miss: (bookId) => rpc<boolean>('catalogue_check_miss', { p_book: bookId }),
    mismatch: (bookId) => rpc<boolean>('catalogue_check_mismatch', { p_book: bookId }),
    async failed(bookId, error) {
      await rpc('catalogue_check_failed', { p_book: bookId, p_error: error })
    },
    async release(bookId) {
      await rpc('catalogue_check_release', { p_book: bookId })
    },
    status: () => rpc<Record<string, number>>('catalogue_check_status', {}),
  }
}
