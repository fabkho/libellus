import type { SupabaseClient } from '@supabase/supabase-js'
import type { Book, BookSnapshot } from './books'

/**
 * The Library actions (issue #1, Library actions): the data-layer contract a
 * native client reimplements against the same database functions. Every
 * change is one RPC; the rules (one entry per Book, the Catalogue kept as first
 * added, who may read what) live in the database, not here.
 */

export type EntryStatus = 'want_to_read' | 'reading' | 'finished'

/** One Book in the member's Library. */
export type LibraryEntry = {
  id: string
  status: EntryStatus
  addedAt: string
  book: Book
}

/** Stable codes for what can go wrong; the copy lives under `library.error.<code>`. */
export type LibraryErrorCode =
  /** The member already has this Book. */
  | 'already_in_library'
  /** The snapshot cannot enter the Catalogue (no title, no ISBN or source id). */
  | 'book_invalid'
  /** A status this version cannot add with yet (#9). */
  | 'status_unsupported'
  | 'not_signed_in'
  | 'unknown'

export type Result<T> = { data: T; error: null } | { data: null; error: LibraryErrorCode }

/** The `books` row, as PostgREST returns it. */
export type BookRow = {
  id: string
  title: string
  authors: string[]
  isbn13: string | null
  isbn10: string | null
  page_count: number | null
  published_year: number | null
  language: string | null
  publisher: string | null
  description: string | null
  cover_url: string | null
  cover_thumbhash: string | null
  cover_dominant: string | null
  cover_secondary: string | null
  source: Book['source']
  apple_id: string | null
  openlibrary_edition_key: string | null
  openlibrary_work_key: string | null
  created_at: string
}

type EntryRow = { id: string; status: EntryStatus; added_at: string; book: BookRow }

const ENTRY_COLUMNS = 'id, status, added_at, book:books!inner(*)'

export function bookFromRow(row: BookRow): Book {
  return {
    id: row.id,
    createdAt: row.created_at,
    title: row.title,
    authors: row.authors ?? [],
    isbn13: row.isbn13,
    isbn10: row.isbn10,
    pageCount: row.page_count,
    year: row.published_year,
    language: row.language,
    publisher: row.publisher,
    description: row.description,
    coverUrl: row.cover_url,
    coverThumbhash: row.cover_thumbhash,
    coverColors:
      row.cover_dominant && row.cover_secondary ? { dominant: row.cover_dominant, secondary: row.cover_secondary } : null,
    source: row.source,
    appleId: row.apple_id,
    openLibraryEditionKey: row.openlibrary_edition_key,
    openLibraryWorkKey: row.openlibrary_work_key,
  }
}

/** A snapshot as the `p_book` argument of `add_to_library`: the `books` columns by name. */
export function bookToRow(book: BookSnapshot): Omit<BookRow, 'id' | 'created_at'> {
  return {
    title: book.title,
    authors: book.authors,
    isbn13: book.isbn13,
    isbn10: book.isbn10,
    page_count: book.pageCount,
    published_year: book.year,
    language: book.language,
    publisher: book.publisher,
    description: book.description,
    cover_url: book.coverUrl,
    cover_thumbhash: book.coverThumbhash,
    cover_dominant: book.coverColors?.dominant ?? null,
    cover_secondary: book.coverColors?.secondary ?? null,
    source: book.source,
    apple_id: book.appleId,
    openlibrary_edition_key: book.openLibraryEditionKey,
    openlibrary_work_key: book.openLibraryWorkKey,
  }
}

function entryFromRow(row: EntryRow): LibraryEntry {
  return { id: row.id, status: row.status, addedAt: row.added_at, book: bookFromRow(row.book) }
}

/** What the database said, as a code. The function raises its codes as the message. */
export function mapLibraryError(failure: { message?: string; code?: string }): LibraryErrorCode {
  const message = failure.message ?? ''
  for (const code of ['already_in_library', 'book_invalid', 'status_unsupported', 'not_signed_in'] as const) {
    if (message.includes(code)) return code
  }
  // A snapshot a table constraint refuses (an ISBN in the wrong shape, say).
  if (failure.code === '23514' || failure.code === '22P02') return 'book_invalid'
  return 'unknown'
}

export type Library = {
  /**
   * Puts a Book into the member's Library: finds or adds the Catalogue Book and
   * creates the entry, in one call. Fails with `already_in_library` the second time.
   */
  addToLibrary: (book: BookSnapshot, options?: { status?: EntryStatus }) => Promise<Result<LibraryEntry>>
  /** The member's entries with one status, newest first. */
  entries: (status: EntryStatus) => Promise<Result<LibraryEntry[]>>
  /** The member's entry for a Book, or null when it is not in the Library. */
  entryForBook: (bookId: string) => Promise<Result<LibraryEntry | null>>
  /** A Book the member can see (the Catalogue, or their own Manual book). */
  book: (id: string) => Promise<Result<Book | null>>
  /** The Catalogue Book for a source id or ISBN-13, if a member has added it before. */
  catalogueBook: (key: { appleId?: string; isbn13?: string }) => Promise<Result<Book | null>>
  /** The member's statuses for a set of Apple ids, for search results. */
  statusesByAppleId: (appleIds: readonly string[]) => Promise<Result<Map<string, LibraryEntry>>>
  /** The Catalogue Books among a set of Apple ids (their stored cover, for search results). */
  catalogueByAppleId: (appleIds: readonly string[]) => Promise<Result<Map<string, Book>>>
}

export function createLibrary(client: SupabaseClient): Library {
  async function addToLibrary(book: BookSnapshot, { status = 'want_to_read' }: { status?: EntryStatus } = {}) {
    const added = await client.rpc('add_to_library', { p_book: bookToRow(book), p_status: status })
    if (added.error) return { data: null, error: mapLibraryError(added.error) }
    // The function returns the entry; the Book comes with it in a second read
    // (as the Catalogue holds it, which may be an earlier snapshot than ours).
    const entry = await client
      .from('library_entries')
      .select(ENTRY_COLUMNS)
      .eq('id', (added.data as { id: string }).id)
      .single<EntryRow>()
    if (entry.error) return { data: null, error: mapLibraryError(entry.error) }
    return { data: entryFromRow(entry.data), error: null }
  }

  return {
    addToLibrary,

    async entries(status) {
      const { data, error } = await client
        .from('library_entries')
        .select(ENTRY_COLUMNS)
        .eq('status', status)
        .order('added_at', { ascending: false })
        .returns<EntryRow[]>()
      if (error) return { data: null, error: mapLibraryError(error) }
      return { data: data.map(entryFromRow), error: null }
    },

    async entryForBook(bookId) {
      const { data, error } = await client
        .from('library_entries')
        .select(ENTRY_COLUMNS)
        .eq('book_id', bookId)
        .maybeSingle<EntryRow>()
      if (error) return { data: null, error: mapLibraryError(error) }
      return { data: data ? entryFromRow(data) : null, error: null }
    },

    async book(id) {
      const { data, error } = await client.from('books').select('*').eq('id', id).maybeSingle<BookRow>()
      if (error) return { data: null, error: mapLibraryError(error) }
      return { data: data ? bookFromRow(data) : null, error: null }
    },

    async catalogueBook({ appleId, isbn13 }) {
      // In the order add_to_library matches: an ISBN-13 first, then the source id.
      for (const [column, value] of [['isbn13', isbn13], ['apple_id', appleId]] as const) {
        if (!value) continue
        const { data, error } = await client
          .from('books')
          .select('*')
          .is('owner_id', null)
          .eq(column, value)
          .maybeSingle<BookRow>()
        if (error) return { data: null, error: mapLibraryError(error) }
        if (data) return { data: bookFromRow(data), error: null }
      }
      return { data: null, error: null }
    },

    async statusesByAppleId(appleIds) {
      const found = new Map<string, LibraryEntry>()
      if (!appleIds.length) return { data: found, error: null }
      const { data, error } = await client
        .from('library_entries')
        .select(ENTRY_COLUMNS)
        .in('book.apple_id', [...appleIds])
        .returns<EntryRow[]>()
      if (error) return { data: null, error: mapLibraryError(error) }
      for (const row of data) if (row.book.apple_id) found.set(row.book.apple_id, entryFromRow(row))
      return { data: found, error: null }
    },

    async catalogueByAppleId(appleIds) {
      const found = new Map<string, Book>()
      if (!appleIds.length) return { data: found, error: null }
      const { data, error } = await client
        .from('books')
        .select('*')
        .is('owner_id', null)
        .in('apple_id', [...appleIds])
        .returns<BookRow[]>()
      if (error) return { data: null, error: mapLibraryError(error) }
      for (const row of data) if (row.apple_id) found.set(row.apple_id, bookFromRow(row))
      return { data: found, error: null }
    },
  }
}
