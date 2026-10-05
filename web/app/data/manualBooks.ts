import type { SupabaseClient } from '@supabase/supabase-js'
import { parseIsbn } from './books'
import { isNoAnswer } from './network'
import {
  addWithArguments,
  createLibrary,
  mapLibraryError,
  type AddWith,
  type LibraryEntry,
  type LibraryErrorCode,
  type WriteOptions,
} from './library'

/**
 * Manual books (issue #1, Manual books): a Book a member typed in by hand. It
 * is private to her (the database gives it an owner and shows it to nobody
 * else), never part of the Catalogue, and it enters her Library in the same
 * call that makes it. The rules (what is required, the ISBN's check digit, who
 * may read it) live in `add_manual_book` and RLS; the checks here only let a
 * form say what is wrong before the call goes out.
 */

export type ManualBookErrorCode = LibraryErrorCode | 'isbn_invalid'

export type ManualBookResult = { data: LibraryEntry; error: null } | { data: null; error: ManualBookErrorCode }

/** What the form collects. Everything is text as typed; the page count is digits. */
export type ManualBookInput = {
  title: string
  /** One name as typed. */
  author: string
  isbn?: string
  pageCount?: string
}

/** The fields a form can mark wrong. */
export type ManualBookField = 'title' | 'author' | 'isbn' | 'pageCount'

/**
 * What is wrong with the input, by field, before anything is sent. Mirrors the
 * database: title and author required, an ISBN-10 or ISBN-13 whose check digit
 * adds up, a whole, positive page count.
 */
export function validateManualBook(input: ManualBookInput): Partial<Record<ManualBookField, true>> {
  const wrong: Partial<Record<ManualBookField, true>> = {}
  if (!input.title.trim()) wrong.title = true
  if (!input.author.trim()) wrong.author = true
  if (input.isbn?.trim() && !parseIsbn(input.isbn)) wrong.isbn = true
  const pages = input.pageCount?.trim()
  if (pages && !(/^\d{1,5}$/.test(pages) && Number(pages) > 0)) wrong.pageCount = true
  return wrong
}

export type ManualBooks = {
  /**
   * Makes a Manual book owned by the member and puts it into her Library, in
   * one call, with the Status and first read she chose (`AddWith`; Want to read
   * without). Returns the entry.
   */
  addManualBook: (input: ManualBookInput, options?: AddWith) => Promise<ManualBookResult>
}

export function createManualBooks(client: SupabaseClient, { online = () => true }: WriteOptions = {}): ManualBooks {
  return {
    async addManualBook(input, options = {}) {
      // Offline: refused before anything is sent (WriteOptions, data/library.ts).
      if (!online()) return { data: null, error: 'offline' }
      const pages = input.pageCount?.trim()
      const added = await client.rpc('add_manual_book', {
        p_title: input.title,
        p_authors: [input.author],
        p_isbn: input.isbn?.trim() || null,
        p_page_count: pages ? Number(pages) : null,
        ...addWithArguments(options),
      })
      // No answer at all (data/network.ts): the member is offline as far as writes go.
      if (isNoAnswer(added)) return { data: null, error: 'offline' }
      if (added.error) {
        if (added.error.message?.includes('isbn_invalid')) return { data: null, error: 'isbn_invalid' }
        return { data: null, error: mapLibraryError(added.error) }
      }
      // The function returns the entry; the Book comes with it in a second read.
      const entry = await createLibrary(client).entryForBook((added.data as { book_id: string }).book_id)
      if (entry.error) return { data: null, error: entry.error }
      if (!entry.data) return { data: null, error: 'unknown' }
      return { data: entry.data, error: null }
    },
  }
}
