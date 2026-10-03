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
  /** Days, a Rating or a review that do not belong to the Status (dates on Want to read, a Rating on Currently reading …). */
  | 'session_invalid'
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
  /** Abandon: a reason over 1,000 characters. */
  | 'reason_too_long'
  /** Read again: the entry has no read yet; its first read is Start reading. */
  | 'never_read'
  /** Edit or delete a read: no such read in the member's Library (gone, or never theirs). */
  | 'session_not_found'
  | 'not_signed_in'
  /** The device has no connection: nothing was sent (`WriteOptions`). */
  | 'offline'
  | 'unknown'

/** Every code the database raises by name, as `LibraryErrorCode`. */
const RAISED_CODES = [
  'already_in_library',
  'book_invalid',
  'session_invalid',
  'entry_not_found',
  'already_reading',
  'already_finished',
  'not_reading',
  'date_invalid',
  'date_in_future',
  'ended_before_started',
  'rating_invalid',
  'review_too_long',
  'reason_too_long',
  'never_read',
  'session_not_found',
  'not_signed_in',
] as const satisfies readonly LibraryErrorCode[]

/** The longest review a session keeps (the database's limit too). */
export const REVIEW_MAX_LENGTH = 10_000

/** The longest reason an abandoned read keeps (the database's limit too). */
export const ABANDON_REASON_MAX_LENGTH = 1000

/**
 * What the Edit sheet collects for one read (issue #11): days are `YYYY-MM-DD`
 * or '' (none); `rating` is quarters, 1–20, or null (unrated); the review and
 * the abandon reason are text, '' for none. Which of them count follows from the
 * read's outcome, which an edit never changes (`sessionEditOf`,
 * `checkSessionEdit`): an open read has its start only, a finished one the
 * dates, Rating and review, an abandoned one the dates and the reason.
 */
export type SessionEdit = {
  startedOn: string
  endedOn: string
  rating: number | null
  review: string
  abandonReason: string
}

/** A read as the Edit sheet starts from it. */
export function sessionEditOf(session: ReadingSession): SessionEdit {
  return {
    startedOn: session.startedOn ?? '',
    endedOn: session.endedOn ?? '',
    rating: session.rating,
    review: session.review ?? '',
    abandonReason: session.abandonReason ?? '',
  }
}

/**
 * What is wrong with an edit's days, before anything is sent: a malformed day,
 * one after `today` (the member's own), an end before the start, a closed read
 * losing the end day it has (a read logged without one may stay without; an
 * open read needs its start). The database refuses the same, and is the
 * authority.
 */
export function checkSessionEdit(session: ReadingSession, edit: SessionEdit, today: string): LibraryErrorCode | null {
  const isDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day)
  if (edit.startedOn && !isDay(edit.startedOn)) return 'date_invalid'
  if (edit.endedOn && !isDay(edit.endedOn)) return 'date_invalid'
  if (!session.outcome) {
    if (!edit.startedOn) return 'date_invalid'
    return edit.startedOn > today ? 'date_in_future' : null
  }
  if (!edit.endedOn && session.endedOn) return 'date_invalid'
  if (edit.startedOn > today || edit.endedOn > today) return 'date_in_future'
  if (edit.startedOn && edit.endedOn && edit.endedOn < edit.startedOn) return 'ended_before_started'
  return null
}

/** An edit as the trailing arguments of `update_session`: only what the read's outcome allows is sent. */
export function sessionEditArguments(session: ReadingSession, edit: SessionEdit) {
  return {
    p_started_on: edit.startedOn || null,
    p_ended_on: session.outcome ? edit.endedOn || null : null,
    p_rating: session.outcome === 'finished' ? edit.rating : null,
    p_review: session.outcome === 'finished' ? edit.review || null : null,
    p_abandon_reason: session.outcome === 'abandoned' ? edit.abandonReason || null : null,
  }
}

/**
 * A book's reads, newest first: the open one (it is always the latest), then
 * by the day they ended, then started, then made; reads without a day last.
 * The order of `latest_session` in the database, for the whole history.
 */
export function sortSessions(sessions: readonly ReadingSession[]): ReadingSession[] {
  return [...sessions].sort((a, b) => {
    if (!a.outcome !== !b.outcome) return a.outcome ? 1 : -1
    const byDay = (x: string | null, y: string | null) => (x && y ? y.localeCompare(x) : x ? -1 : y ? 1 : 0)
    return byDay(a.endedOn, b.endedOn) || byDay(a.startedOn, b.startedOn) || b.createdAt.localeCompare(a.createdAt)
  })
}
/**
 * What an entry is added with (issue #9): its Status and the first read that
 * goes with it. Currently reading needs `startedOn`; Finished needs `endedOn`
 * (and may have `startedOn`, `rating` in quarters 1–20 and a `review`); Want to
 * read has none of them. The database refuses what does not fit, with the
 * codes of start and finish.
 */
export type AddWith = {
  status?: EntryStatus
  startedOn?: string | null
  endedOn?: string | null
  rating?: number | null
  review?: string | null
}

/**
 * What the Add sheets collect before anything is sent: the Status and the
 * choices that go with it. Days are `YYYY-MM-DD` or '' (not chosen); `rating`
 * is quarters, 1–20, or null (unrated).
 */
export type AddDraft = {
  status: EntryStatus
  startedOn: string
  endedOn: string
  rating: number | null
  review: string
}

/** A new draft: Want to read, nothing else chosen. */
export function newAddDraft(): AddDraft {
  return { status: 'want_to_read', startedOn: '', endedOn: '', rating: null, review: '' }
}

/**
 * Chooses a Status on a draft and gives it the days that Status starts with:
 * Currently reading started `today`; Finished ended `today`, with no start
 * (a past read often has none). The Rating and review stay, so a second
 * thought does not lose them.
 */
export function chooseAddStatus(draft: AddDraft, status: EntryStatus, today: string): void {
  if (draft.status === status) return
  draft.status = status
  draft.startedOn = status === 'reading' ? today : ''
  draft.endedOn = status === 'finished' ? today : ''
}

/** What the draft adds the Book with: only the choices that belong to its Status. */
export function addWithFromDraft(draft: AddDraft): AddWith {
  if (draft.status === 'reading') return { status: 'reading', startedOn: draft.startedOn }
  if (draft.status === 'finished') {
    return {
      status: 'finished',
      startedOn: draft.startedOn,
      endedOn: draft.endedOn,
      rating: draft.rating,
      review: draft.review,
    }
  }
  return { status: 'want_to_read' }
}

/**
 * What is wrong with the draft's days, before anything is sent: a missing or
 * malformed day, one after `today` (the member's own), an end before the
 * start. The database refuses the same, and is the authority.
 */
export function checkAddDraft(draft: AddDraft, today: string): LibraryErrorCode | null {
  const isDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day)
  if (draft.status === 'reading') {
    if (!isDay(draft.startedOn)) return 'date_invalid'
    return draft.startedOn > today ? 'date_in_future' : null
  }
  if (draft.status === 'finished') {
    if (!isDay(draft.endedOn) || (draft.startedOn && !isDay(draft.startedOn))) return 'date_invalid'
    if (draft.endedOn > today || draft.startedOn > today) return 'date_in_future'
    if (draft.startedOn && draft.endedOn < draft.startedOn) return 'ended_before_started'
  }
  return null
}

/** `AddWith` as the trailing arguments of `add_to_library` and `add_manual_book`. */
export function addWithArguments({ status = 'want_to_read', startedOn, endedOn, rating, review }: AddWith) {
  return {
    p_status: status,
    p_started_on: startedOn || null,
    p_ended_on: endedOn || null,
    p_rating: rating ?? null,
    p_review: review || null,
  }
}

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
 * Whether an entry belongs under *Not finished*: it is Finished (nothing is open)
 * and its latest session was abandoned. A read that was abandoned and then
 * finished, or started again, is not: the latest session decides. The database
 * has the same question in `latest_session(e).outcome`.
 */
export function isNotFinished(entry: LibraryEntry): boolean {
  return entry.status === 'finished' && entry.latestSession?.outcome === 'abandoned'
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
  // A snapshot a `books` constraint refuses (an ISBN in the wrong shape, say).
  // Other tables' checks are the functions' to word; reaching one is a bug.
  if (failure.code === '23514') return message.includes('"books_') ? 'book_invalid' : 'unknown'
  // A day that is no day ("2026-02-30").
  if (failure.code === '22007' || failure.code === '22008') return 'date_invalid'
  // An entry id that is no id: there is no such entry.
  if (failure.code === '22P02') return message.includes('uuid') ? 'entry_not_found' : 'book_invalid'
  return 'unknown'
}

export type Library = {
  /**
   * Puts a Book into the member's Library: finds or adds the Catalogue Book and
   * creates the entry with its Status and first read (`AddWith`), in one call.
   * Fails with `already_in_library` the second time.
   */
  addToLibrary: (book: BookSnapshot, options?: AddWith) => Promise<Result<LibraryEntry>>
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
   * Ends the open read as abandoned on a day, with an optional reason (trimmed;
   * blank is none). Returns the entry, now Finished, its latest session
   * abandoned: it is under *Not finished* (`isNotFinished`).
   */
  abandon: (entryId: string, abandoned: { endedOn: string; reason?: string | null }) => Promise<Result<LibraryEntry>>
  /**
   * Starts the next read of an entry whose latest session is closed: "Read
   * again" after a finished read, "Start again" after an abandoned one. The
   * earlier sessions stay. Returns the entry, now Currently reading.
   */
  readAgain: (entryId: string, startedOn: string) => Promise<Result<LibraryEntry>>
  /** Every read of an entry, newest first (`sortSessions`). */
  sessions: (entryId: string) => Promise<Result<ReadingSession[]>>
  /**
   * Fixes one read (issue #11): its days and, by its outcome, the Rating and
   * review (finished) or the reason (abandoned), with the rules of creating it.
   * The edit is the whole read as the sheet shows it (`SessionEdit`); what the
   * outcome does not allow is left out. Returns the entry as it is now.
   */
  updateSession: (entryId: string, session: ReadingSession, edit: SessionEdit) => Promise<Result<LibraryEntry>>
  /**
   * Deletes one read. The entry follows what is left: the only read gone
   * returns it to Want to read. Returns the entry as it is now.
   */
  deleteSession: (entryId: string, sessionId: string) => Promise<Result<LibraryEntry>>
  /**
   * Removes the entry from the Library with its reads and its places on
   * Collections (the Collections and the Book stay).
   */
  removeFromLibrary: (entryId: string) => Promise<Result<null>>
  /**
   * The member's entries with one status and their latest sessions, newest
   * first: Want to read by when it was added, Currently reading by the start
   * date, Finished by the end date (`sortEntries` is the same order).
   */
  entries: (status: EntryStatus) => Promise<Result<LibraryEntry[]>>
  /**
   * "Read in <year>" (Home): how many of the member's sessions finished with an
   * end date in that calendar year. Re-reads count each time; abandoned and
   * open reads, and finished reads logged without a date, do not. One call.
   */
  readInYear: (year: number) => Promise<Result<number>>
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

/** The first and last day of a calendar year, as the days sessions store (`YYYY-MM-DD`). */
export function yearBounds(year: number): { from: string; to: string } {
  const y = String(year).padStart(4, '0')
  return { from: `${y}-01-01`, to: `${y}-12-31` }
}

/**
 * What every repository that writes is set up with (issue #15). `online` says
 * whether the device has a connection right now; a write while it has none is
 * refused with `offline` before anything is sent, so nothing ever looks saved
 * when it was not. This is where an offline queue goes later (SPEC.md, Later):
 * it would hold the write here instead of refusing it, and no page or store
 * would change. Left out, the device counts as online (the tests).
 */
export type WriteOptions = { online?: () => boolean }

const OFFLINE = { data: null, error: 'offline' } as const

export function createLibrary(client: SupabaseClient, { online = () => true }: WriteOptions = {}): Library {
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

  async function addToLibrary(book: BookSnapshot, options: AddWith = {}): Promise<Result<LibraryEntry>> {
    if (!online()) return OFFLINE
    const added = await client.rpc('add_to_library', { p_book: bookToRow(book), ...addWithArguments(options) })
    if (added.error) return { data: null, error: mapLibraryError(added.error) }
    // The function returns the entry; the Book comes with it in a second read
    // (as the Catalogue holds it, which may be an earlier snapshot than ours).
    return reread((added.data as { id: string }).id)
  }

  return {
    addToLibrary,
    entry,

    async startReading(entryId, startedOn) {
      if (!online()) return OFFLINE
      const started = await client.rpc('start_reading', { p_entry_id: entryId, p_started_on: startedOn })
      if (started.error) return { data: null, error: mapLibraryError(started.error) }
      return reread(entryId)
    },

    async finish(entryId, { endedOn, rating = null, review = null }) {
      if (!online()) return OFFLINE
      const finished = await client.rpc('finish_reading', {
        p_entry_id: entryId,
        p_ended_on: endedOn,
        p_rating: rating,
        p_review: review,
      })
      if (finished.error) return { data: null, error: mapLibraryError(finished.error) }
      return reread(entryId)
    },

    async abandon(entryId, { endedOn, reason = null }) {
      if (!online()) return OFFLINE
      const abandoned = await client.rpc('abandon_reading', {
        p_entry_id: entryId,
        p_ended_on: endedOn,
        p_reason: reason,
      })
      if (abandoned.error) return { data: null, error: mapLibraryError(abandoned.error) }
      return reread(entryId)
    },

    async sessions(entryId) {
      const { data, error } = await client.from('reading_sessions').select('*').eq('entry_id', entryId).returns<SessionRow[]>()
      if (error) return { data: null, error: mapLibraryError(error) }
      return { data: sortSessions(data.map(sessionFromRow)), error: null }
    },

    async updateSession(entryId, session, edit) {
      if (!online()) return OFFLINE
      const updated = await client.rpc('update_session', { p_session_id: session.id, ...sessionEditArguments(session, edit) })
      if (updated.error) return { data: null, error: mapLibraryError(updated.error) }
      return reread(entryId)
    },

    async deleteSession(entryId, sessionId) {
      if (!online()) return OFFLINE
      const deleted = await client.rpc('delete_session', { p_session_id: sessionId })
      if (deleted.error) return { data: null, error: mapLibraryError(deleted.error) }
      return reread(entryId)
    },

    async removeFromLibrary(entryId) {
      if (!online()) return OFFLINE
      const removed = await client.rpc('remove_from_library', { p_entry_id: entryId })
      if (removed.error) return { data: null, error: mapLibraryError(removed.error) }
      return { data: null as null, error: null }
    },

    async readAgain(entryId, startedOn) {
      if (!online()) return OFFLINE
      const again = await client.rpc('read_again', { p_entry_id: entryId, p_started_on: startedOn })
      if (again.error) return { data: null, error: mapLibraryError(again.error) }
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

    async readInYear(year) {
      const { from, to } = yearBounds(year)
      // RLS shows the member their own sessions only. `head`: the count, no rows.
      const { count, error } = await client
        .from('reading_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('outcome', 'finished')
        .gte('ended_on', from)
        .lte('ended_on', to)
      if (error) return { data: null, error: mapLibraryError(error) }
      return { data: count ?? 0, error: null }
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
