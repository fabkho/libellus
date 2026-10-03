import type { SupabaseClient } from '@supabase/supabase-js'
import type { Book, BookSnapshot } from './books'

/**
 * The Library actions (issue #1, Library actions): the data-layer contract a
 * native client reimplements against the same database functions. Every
 * change is one RPC; the rules (one entry per Book, the Catalogue kept as first
 * added, who may read what) live in the database, not here.
 */

export type EntryStatus = 'want_to_read' | 'reading' | 'finished'

export type SessionOutcome = 'finished' | 'abandoned'

/**
 * One read of a Library entry (CONTEXT.md: Reading session). Dates are
 * calendar days, `YYYY-MM-DD`, as the member picked them. An open session has
 * no outcome. `rating` is quarter stars, 1–20 (utils/rating.ts), null when
 * unrated.
 */
export type ReadingSession = {
  id: string
  startedOn: string | null
  endedOn: string | null
  outcome: SessionOutcome | null
  rating: number | null
  review: string | null
  abandonReason: string | null
  createdAt: string
}

/**
 * One Book in the member's Library. The Status is the database's, derived
 * from the sessions; `latestSession` is the one that decides it (the open one,
 * or the one that ended last), null on Want to read.
 */
export type LibraryEntry = {
  id: string
  status: EntryStatus
  addedAt: string
  book: Book
  latestSession: ReadingSession | null
}

/** Stable codes for what can go wrong; the copy lives under `library.error.<code>`. */
export type LibraryErrorCode =
  /** The member already has this Book. */
  | 'already_in_library'
  /** The snapshot cannot enter the Catalogue (no title, no ISBN or source id). */
  | 'book_invalid'
  /** A status this version cannot add with yet (#9). */
  | 'status_unsupported'
  /** No such entry in the member's Library (gone, or never theirs). */
  | 'entry_not_found'
  /** Start: the entry is being read already. */
  | 'already_reading'
  /** Start: the entry was read before; Read again (#10) starts the next read. */
  | 'already_finished'
  /** Finish: there is no open read to end. */
  | 'not_reading'
  /** A date the action needs is missing. */
  | 'date_invalid'
  /** A date after today. */
  | 'date_in_future'
  /** An end date before the read's start date. */
  | 'ended_before_started'
  /** A Rating outside 1–20 quarters. */
  | 'rating_invalid'
  /** A review over 10,000 characters. */
  | 'review_too_long'
  | 'not_signed_in'
  | 'unknown'

/** Every code the database raises by name, as `LibraryErrorCode`. */
const RAISED_CODES = [
  'already_in_library',
  'book_invalid',
  'status_unsupported',
  'entry_not_found',
  'already_reading',
  'already_finished',
  'not_reading',
  'date_invalid',
  'date_in_future',
  'ended_before_started',
  'rating_invalid',
  'review_too_long',
  'not_signed_in',
] as const satisfies readonly LibraryErrorCode[]

/** The longest review a session keeps (the database's limit too). */
export const REVIEW_MAX_LENGTH = 10_000

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

/** The `reading_sessions` row, as PostgREST returns it. */
export type SessionRow = {
  id: string
  entry_id: string
  started_on: string | null
  ended_on: string | null
  outcome: SessionOutcome | null
  rating: number | null
  review: string | null
  abandon_reason: string | null
  created_at: string
}

export type EntryRow = { id: string; status: EntryStatus; added_at: string; book: BookRow; latest: SessionRow | null }

/** An entry with its Book and its latest session (`latest_session`, a to-one computed relationship). */
export const ENTRY_COLUMNS = 'id, status, added_at, book:books!inner(*), latest:latest_session(*)'

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

export function sessionFromRow(row: SessionRow): ReadingSession {
  return {
    id: row.id,
    startedOn: row.started_on,
    endedOn: row.ended_on,
    outcome: row.outcome,
    rating: row.rating,
    review: row.review,
    abandonReason: row.abandon_reason,
    createdAt: row.created_at,
  }
}

export function entryFromRow(row: EntryRow): LibraryEntry {
  return {
    id: row.id,
    status: row.status,
    addedAt: row.added_at,
    book: bookFromRow(row.book),
    latestSession: row.latest ? sessionFromRow(row.latest) : null,
  }
}

/**
 * The day an entry's list sorts it by: when it was added (Want to read), when
 * its read started (Currently reading) or ended (Finished). `YYYY-MM-DD` and
 * ISO times compare as strings.
 */
function sortDay(entry: LibraryEntry): string {
  if (entry.status === 'reading') return entry.latestSession?.startedOn ?? ''
  if (entry.status === 'finished') return entry.latestSession?.endedOn ?? ''
  return entry.addedAt
}

/**
 * A status list in the order the database returns it (`entries`), for lists
 * that change on the device: newest first by the list's day, then by when the
 * entry was added. Entries without that day (a read logged with no end date)
 * go last.
 */
export function sortEntries(entries: readonly LibraryEntry[]): LibraryEntry[] {
  return [...entries].sort((a, b) => {
    const day = sortDay(b).localeCompare(sortDay(a))
    return day || b.addedAt.localeCompare(a.addedAt)
  })
}

/** What the database said, as a code. The function raises its codes as the message. */
export function mapLibraryError(failure: { message?: string; code?: string }): LibraryErrorCode {
  const message = failure.message ?? ''
  const raised = RAISED_CODES.find((code) => message === code)
  if (raised) return raised
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
  /**
   * Starts the first read of a Want to read entry on a day (`YYYY-MM-DD`, the
   * member's today by default in the caller). Returns the entry, now
   * Currently reading.
   */
  startReading: (entryId: string, startedOn: string) => Promise<Result<LibraryEntry>>
  /**
   * Ends the open read as finished on a day, with an optional Rating (quarters
   * 1–20) and review. Returns the entry, now Finished.
   */
  finish: (
    entryId: string,
    finished: { endedOn: string; rating?: number | null; review?: string | null },
  ) => Promise<Result<LibraryEntry>>
  /**
   * The member's entries with one status and their latest sessions, newest
   * first: Want to read by when it was added, Currently reading by the start
   * date, Finished by the end date (`sortEntries` is the same order).
   */
  entries: (status: EntryStatus) => Promise<Result<LibraryEntry[]>>
  /** One of the member's entries, as it is now. */
  entry: (entryId: string) => Promise<Result<LibraryEntry | null>>
  /** The member's entry for a Book, or null when it is not in the Library. */
  entryForBook: (bookId: string) => Promise<Result<LibraryEntry | null>>
  /** A Book the member can see (the Catalogue, or their own Manual book). */
  book: (id: string) => Promise<Result<Book | null>>
  /** The Catalogue Book for a source id or ISBN-13, if a member has added it before. */
  catalogueBook: (key: { appleId?: string; isbn13?: string; openLibraryEditionKey?: string }) => Promise<Result<Book | null>>
  /** The member's statuses for a set of Apple ids, for search results. */
  statusesByAppleId: (appleIds: readonly string[]) => Promise<Result<Map<string, LibraryEntry>>>
  /** The Catalogue Books among a set of Apple ids (their stored cover, for search results). */
  catalogueByAppleId: (appleIds: readonly string[]) => Promise<Result<Map<string, Book>>>
}

export function createLibrary(client: SupabaseClient): Library {
  async function entry(entryId: string): Promise<Result<LibraryEntry | null>> {
    const { data, error } = await client
      .from('library_entries')
      .select(ENTRY_COLUMNS)
      .eq('id', entryId)
      .maybeSingle<EntryRow>()
    if (error) return { data: null, error: mapLibraryError(error) }
    return { data: data ? entryFromRow(data) : null, error: null }
  }

  /** After an action: the entry as the database now has it (its Book, its derived Status). */
  async function reread(entryId: string): Promise<Result<LibraryEntry>> {
    const read = await entry(entryId)
    if (read.error) return read
    return read.data ? { data: read.data, error: null } : { data: null, error: 'entry_not_found' }
  }

  async function addToLibrary(book: BookSnapshot, { status = 'want_to_read' }: { status?: EntryStatus } = {}) {
    const added = await client.rpc('add_to_library', { p_book: bookToRow(book), p_status: status })
    if (added.error) return { data: null, error: mapLibraryError(added.error) }
    // The function returns the entry; the Book comes with it in a second read
    // (as the Catalogue holds it, which may be an earlier snapshot than ours).
    return reread((added.data as { id: string }).id)
  }

  return {
    addToLibrary,
    entry,

    async startReading(entryId, startedOn) {
      const started = await client.rpc('start_reading', { p_entry_id: entryId, p_started_on: startedOn })
      if (started.error) return { data: null, error: mapLibraryError(started.error) }
      return reread(entryId)
    },

    async finish(entryId, { endedOn, rating = null, review = null }) {
      const finished = await client.rpc('finish_reading', {
        p_entry_id: entryId,
        p_ended_on: endedOn,
        p_rating: rating,
        p_review: review,
      })
      if (finished.error) return { data: null, error: mapLibraryError(finished.error) }
      return reread(entryId)
    },

    async entries(status) {
      let query = client.from('library_entries').select(ENTRY_COLUMNS).eq('status', status)
      // Ordered by the latest session's day through the to-one relationship.
      if (status === 'reading') query = query.order('latest(started_on)', { ascending: false, nullsFirst: false })
      if (status === 'finished') query = query.order('latest(ended_on)', { ascending: false, nullsFirst: false })
      const { data, error } = await query.order('added_at', { ascending: false }).returns<EntryRow[]>()
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

    async catalogueBook({ appleId, isbn13, openLibraryEditionKey }) {
      // In the order add_to_library matches: an ISBN-13 first, then the source ids.
      for (const [column, value] of [
        ['isbn13', isbn13],
        ['apple_id', appleId],
        ['openlibrary_edition_key', openLibraryEditionKey],
      ] as const) {
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
