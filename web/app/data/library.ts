import type { SupabaseClient } from '@supabase/supabase-js'
import { bookKey, type Book, type BookFormat, type BookSnapshot } from './books'
import type { ReadAs } from './readAs'
import { ratingFromRow, type GoodreadsRow } from './goodreads'
import { NO_PROGRESS, type ProgressValue } from './progress'
import { dayFromRow, type ProgressDay, type ProgressDayRow } from './progressDays'
import { isNoAnswer } from './network'
import { applyWrite, localId, type QueuedAction, type QueuedWrite, type WriteQueue } from './queuedWrites'

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
 * unrated. The progress is the latest value only (issue #39): a page or a percent,
 * never both, null while none is set (`progress.ts` words and checks it); a
 * closed read keeps the last one it had.
 */
export type ReadingSession = {
  id: string
  startedOn: string | null
  endedOn: string | null
  outcome: SessionOutcome | null
  rating: number | null
  review: string | null
  /** The review gives the story away (social v2a): members who have not finished the Book see it folded. */
  reviewSpoilers: boolean
  abandonReason: string | null
  progressPage: number | null
  progressPercent: number | null
  progressUpdatedAt: string | null
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
  /**
   * The member's own total pages for this entry (issue #60: an ebook's differ from the
   * edition's), null = the edition's `book.pageCount`. Kept across every read of the entry;
   * `pageCountOf` (`progress.ts`) is the page count that counts.
   */
  pageCountOverride: number | null
  /**
   * The member's own word on her edition's format (hardcover, paperback, ebook,
   * audiobook), null = the Book's (`formatOf` in books.ts gives the one that
   * counts). Absent on a copy from before it existed.
   */
  formatOverride?: BookFormat | null
  /**
   * How the member read it (issue #169): physical, ebook or audiobook, null = not said
   * (`readAsOf` in `readAs.ts` gives the one that counts: the edition's format is the
   * default). Absent on a copy from before it existed.
   */
  readAs?: ReadAs | null
  /**
   * Kept from her followers (social v1): a hidden entry is gone for everyone but her. Absent on a
   * copy from before it existed, which reads as `false`; every read from the database has it.
   */
  hidden?: boolean
  latestSession: ReadingSession | null
}

/** Stable codes for what can go wrong; the copy lives under `library.error.<code>`. */
export type LibraryErrorCode =
  /** The member already has this Book. */
  | 'already_in_library'
  /** Change edition: the member has that edition already, as another entry. */
  | 'edition_in_library'
  /** The snapshot cannot enter the Catalogue (no title, no ISBN or source id), or her own edition cannot be stored. */
  | 'book_invalid'
  /** Her own edition: an ISBN whose check digit does not add up. */
  | 'isbn_invalid'
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
  /** Update progress: not exactly one of page and percent, a page outside 0…the page count, a percent outside 0–100. */
  | 'progress_invalid'
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
  /** Read as: a word other than physical, ebook or audiobook. */
  | 'read_as_invalid'
  /** Edit or delete a read: no such read in the member's Library (gone, or never theirs). */
  | 'session_not_found'
  | 'not_signed_in'
  /** The device has no connection: nothing was sent (`WriteOptions`). */
  | 'offline'
  | 'unknown'

/** Every code the database raises by name, as `LibraryErrorCode`. */
const RAISED_CODES = [
  'already_in_library',
  'edition_in_library',
  'book_invalid',
  'isbn_invalid',
  'session_invalid',
  'entry_not_found',
  'already_reading',
  'already_finished',
  'not_reading',
  'progress_invalid',
  'date_invalid',
  'date_in_future',
  'ended_before_started',
  'rating_invalid',
  'review_too_long',
  'reason_too_long',
  'never_read',
  'read_as_invalid',
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
  /** "Contains spoilers", with the review (a blank review has none). */
  reviewSpoilers: boolean
  abandonReason: string
}

/** A read as the Edit sheet starts from it. */
export function sessionEditOf(session: ReadingSession): SessionEdit {
  return {
    startedOn: session.startedOn ?? '',
    endedOn: session.endedOn ?? '',
    rating: session.rating,
    review: session.review ?? '',
    reviewSpoilers: Boolean(session.reviewSpoilers),
    abandonReason: session.abandonReason ?? '',
  }
}

/**
 * The spoiler flag as the arguments carry it: only when set, and only with a review (a blank review has
 * none), so a call without a flag is the call as it was before version 2a. The database defaults to false.
 */
export function spoilerArguments(review: string | null | undefined, reviewSpoilers: boolean | null | undefined) {
  return review?.trim() && reviewSpoilers ? { p_review_spoilers: true } : {}
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
    ...(session.outcome === 'finished' ? spoilerArguments(edit.review, edit.reviewSpoilers) : {}),
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
  /** The review contains spoilers (social v2a); only with a review. */
  reviewSpoilers?: boolean
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
  reviewSpoilers: boolean
}

/** A new draft: Want to read, nothing else chosen. */
export function newAddDraft(): AddDraft {
  return { status: 'want_to_read', startedOn: '', endedOn: '', rating: null, review: '', reviewSpoilers: false }
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
      reviewSpoilers: draft.reviewSpoilers,
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
export function addWithArguments({ status = 'want_to_read', startedOn, endedOn, rating, review, reviewSpoilers }: AddWith) {
  return {
    p_status: status,
    p_started_on: startedOn || null,
    p_ended_on: endedOn || null,
    p_rating: rating ?? null,
    p_review: review || null,
    ...spoilerArguments(review, reviewSpoilers),
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
  /** Absent on a row from before formats existed (a cached Library). */
  format?: BookFormat | null
  created_at: string
  /** The cached Goodreads rating (`goodreads_rating`), when asked for with BOOK_COLUMNS. */
  goodreads?: GoodreadsRow | null
}

/** A `books` row with its cached Goodreads rating (issue #69), so a Library kept for offline has it. */
export const BOOK_COLUMNS = '*, goodreads:goodreads_rating(*)'

/** The `reading_sessions` row, as PostgREST returns it. */
export type SessionRow = {
  id: string
  entry_id: string
  started_on: string | null
  ended_on: string | null
  outcome: SessionOutcome | null
  rating: number | null
  review: string | null
  /** Absent on a row from before spoiler flags existed (a cached Library). */
  review_spoilers?: boolean | null
  abandon_reason: string | null
  progress_page: number | null
  progress_percent: number | null
  progress_updated_at: string | null
  created_at: string
}

export type EntryRow = {
  id: string
  status: EntryStatus
  added_at: string
  page_count_override: number | null
  format_override?: BookFormat | null
  /** Absent on a row from before Read as existed (a cached Library). */
  read_as?: ReadAs | null
  /** Absent on a row from before hiding existed (a cached Library). */
  hidden?: boolean
  book: BookRow
  latest: SessionRow | null
}

/** An entry with its Book and its latest session (`latest_session`, a to-one computed relationship). */
export const ENTRY_COLUMNS = `id, status, added_at, page_count_override, format_override, read_as, hidden, book:books!inner(${BOOK_COLUMNS}), latest:latest_session(*)`

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
    format: row.format ?? null,
    // Undefined rather than null without one, so a Book reads the same as before it existed.
    goodreads: ratingFromRow(row.goodreads) ?? undefined,
  }
}

/** A snapshot as the `p_book` argument of `add_to_library`: the `books` columns by name. */
export function bookToRow(book: BookSnapshot): Omit<BookRow, 'id' | 'created_at' | 'goodreads'> {
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
    format: book.format ?? null,
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
    reviewSpoilers: row.review_spoilers ?? false,
    abandonReason: row.abandon_reason,
    // `?? null`: a row from before progress existed (a cached Library) has none.
    progressPage: row.progress_page ?? null,
    progressPercent: row.progress_percent ?? null,
    progressUpdatedAt: row.progress_updated_at ?? null,
    createdAt: row.created_at,
  }
}

export function entryFromRow(row: EntryRow): LibraryEntry {
  return {
    id: row.id,
    status: row.status,
    addedAt: row.added_at,
    book: bookFromRow(row.book),
    pageCountOverride: row.page_count_override ?? null,
    formatOverride: row.format_override ?? null,
    readAs: row.read_as ?? null,
    hidden: row.hidden ?? false,
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

/**
 * How an add is made. `optimistic`: the answer is the entry as it will be, at
 * once, and the call itself waits in the outbox like an offline write (and is
 * sent right away when the device is online): the same line, order, retries and
 * refusal handling, so the member never waits for the network to see her Book on
 * the shelf. What the database refuses afterwards (already in the Library, an
 * invalid Book) is a failure of the outbox, not an answer here. A search result
 * that is not in the Catalogue yet can wait this way too: its Cover is resolved
 * just before it is sent (`QueuedWrite.coverPending`). Left out, an add that
 * is not held by the line (the device is online and nothing waits) asks the
 * database and answers with what it said.
 */
export type AddHow = { optimistic?: boolean }

export type Library = {
  /**
   * Puts a Book into the member's Library: finds or adds the Catalogue Book and
   * creates the entry with its Status and first read (`AddWith`), in one call.
   * Fails with `already_in_library` the second time.
   */
  addToLibrary: (book: BookSnapshot, options?: AddWith, how?: AddHow) => Promise<Result<LibraryEntry>>
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
    finished: { endedOn: string; rating?: number | null; review?: string | null; reviewSpoilers?: boolean },
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
  /**
   * Records how far the member is in the open read: a page or a percent,
   * exactly one (`ProgressValue`); the latest value replaces the one before.
   * Returns the entry as it is now. Refused with `not_reading` (no open read)
   * and `progress_invalid` (a page past the page count, a percent over 100).
   * `total` is the member's own page count (issue #60), sent in the same call so the page
   * is checked against it: `{ pageCount: 520 }` sets it, `{ pageCount: null }` goes back to
   * the edition's, leaving `total` out does not touch it. With a total the value may be
   * `null`: only the total changes and the read keeps its progress. `NO_PROGRESS` takes the
   * read back to no progress at all (Undo of a first save, #104; a total may go with it).
   * `day` is the member's own calendar day (`YYYY-MM-DD`, the store sends `isoDay()`): the
   * value is booked on it in the read's progress by day (issue #68), in the same call.
   * Left out, the database uses its UTC date; one outside a day of it is `date_invalid`.
   */
  updateProgress: (
    entryId: string,
    progress: ProgressValue | typeof NO_PROGRESS | null,
    total?: { pageCount: number | null },
    day?: string,
  ) => Promise<Result<LibraryEntry>>
  /**
   * Progress by day (issue #68) of these reads: for each session id, its days oldest
   * first (a read without any has an empty list). Only the member's own reads answer.
   */
  progressDays: (sessionIds: readonly string[]) => Promise<Result<Record<string, ProgressDay[]>>>
  /**
   * Points the entry at another edition (issue #41): the Book is found in the
   * Catalogue or added with this snapshot, as `addToLibrary` does it (resolve
   * a new Book's Cover first, like an add), and the entry keeps its reads,
   * Ratings, reviews and places on Collections; a progress page past the new
   * edition's last page becomes its last page (the member's own total, when she has set one,
   * counts instead of the edition's, and stays with the entry). Returns the entry with its new
   * Book. Refused with `edition_in_library` when the member has that edition
   * as another entry. Picking the edition it already has changes nothing.
   * `format`: the member's own word on the new edition's format (left out:
   * the Book's own); her word on the old edition goes with the old edition.
   */
  changeEdition: (entryId: string, book: BookSnapshot, format?: BookFormat | null) => Promise<Result<LibraryEntry>>
  /**
   * The member's own word on the format of the edition her entry has (null:
   * the Book's own). Only hers: the shared Book keeps what its source said.
   * Needs the connection, like Change edition. Returns the entry.
   */
  setFormat: (entryId: string, format: BookFormat | null) => Promise<Result<LibraryEntry>>
  /**
   * "My edition isn't listed" with no source knowing it: makes her own edition
   * from the snapshot (a Manual book, private to her; title and authors blank
   * take the entry's Book's; `format` is required) and moves the entry to it
   * as `changeEdition` does. Refused with `book_invalid` (no format, a value
   * that cannot be stored) or `isbn_invalid`. Returns the entry with its new Book.
   */
  useOwnEdition: (entryId: string, book: BookSnapshot) => Promise<Result<LibraryEntry>>
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
   * Sets how the member read the entry (issue #169): physical, ebook or audiobook; null takes
   * her word back (the edition's format is the default again, `readAsOf`). Needs the
   * connection, like Change edition. Returns the entry. Refused with `read_as_invalid`.
   */
  setReadAs: (entryId: string, readAs: ReadAs | null) => Promise<Result<LibraryEntry>>
  /**
   * Hides the entry from her followers, or shows it again (social v1): a hidden Book is gone for
   * everyone but her. Can wait offline like the other writes (`set_entry_hidden` in the outbox);
   * returns the entry as it will be. Refused `entry_not_found` for an entry that is not hers.
   */
  setHidden: (entryId: string, hidden: boolean) => Promise<Result<LibraryEntry>>
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
 * when it was not. Left out, the device counts as online (the tests).
 *
 * `queue` (issue #93): the outbox. A write that can wait (`queuedWrites.ts`)
 * goes into it instead whenever it holds writes (offline, or earlier ones not
 * synced yet), and the answer is the entry as it will be, from the device's
 * copy; no page or store tells the two apart. A write that cannot wait is still
 * refused offline. Left out, nothing waits.
 */
export type WriteOptions = { online?: () => boolean; queue?: WriteQueue }

const OFFLINE = { data: null, error: 'offline' } as const

export function createLibrary(client: SupabaseClient, { online = () => true, queue }: WriteOptions = {}): Library {
  /**
   * The write into the outbox, if it waits now (`WriteOptions.queue`): the entry
   * as the database will have it, or the database's refusal at once. Null: it
   * does not wait, and goes to the database as before.
   */
  async function queued(
    action: QueuedAction,
    args: Record<string, unknown>,
    entryId: string,
    creates?: QueuedWrite['creates'],
    /** The call to the database got no answer: it waits whether or not the device knew. */
    unanswered = false,
  ): Promise<Result<LibraryEntry | null> | null> {
    if (!queue || !(unanswered || queue.holds())) return null
    const known = queue.entry(entryId)
    // An entry the device does not hold (never loaded here): nothing to show it with.
    if (!known) return OFFLINE
    const write: QueuedWrite = { action, args, about: known.book.title, queuedAt: new Date().toISOString(), entryId, creates }
    const after = applyWrite(known, write)
    if (typeof after === 'string') return { data: null, error: after }
    await queue.add(write)
    return { data: after, error: null }
  }

  /** `queued` for the writes that answer with the entry. */
  async function queuedEntry(...input: Parameters<typeof queued>): Promise<Result<LibraryEntry> | null> {
    const result = await queued(...input)
    if (!result || result.error) return result as Result<LibraryEntry> | null
    return result.data ? { data: result.data, error: null } : { data: null, error: 'entry_not_found' }
  }

  /**
   * A call that got no answer (a timeout, a network error: data/network.ts) is
   * not an error to show: the write waits in the outbox, as if the device had
   * known it was offline. A write that cannot wait is refused as `offline`.
   */
  async function unansweredEntry(...input: [QueuedAction, Record<string, unknown>, string, QueuedWrite['creates']?]) {
    const waiting = await queued(input[0], input[1], input[2], input[3], true)
    if (!waiting) return OFFLINE
    if (waiting.error) return { data: null, error: waiting.error } as const
    return waiting.data ? { data: waiting.data, error: null } : ({ data: null, error: 'entry_not_found' } as const)
  }

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

  async function addToLibrary(book: BookSnapshot, options: AddWith = {}, { optimistic = false }: AddHow = {}): Promise<Result<LibraryEntry>> {
    // A Catalogue Book can wait: the call needs nothing the device does not hold.
    // A search result (its Cover still to resolve) or a Manual book cannot, unless
    // the add is optimistic: then the search result waits too, its Cover resolved when it is sent.
    if (queue?.holds() || (optimistic && queue?.open())) {
      const waiting = await queueAdd(book, options, optimistic)
      if (waiting) return waiting
    }
    if (!online()) return OFFLINE
    const added = await client.rpc('add_to_library', { p_book: bookToRow(book), ...addWithArguments(options) })
    if (isNoAnswer(added)) return (await queueAdd(book, options)) ?? OFFLINE
    if (added.error) return { data: null, error: mapLibraryError(added.error) }
    // The function returns the entry; the Book comes with it in a second read
    // (as the Catalogue holds it, which may be an earlier snapshot than ours).
    return reread((added.data as { id: string }).id)
  }

  /**
   * An add that waits in the outbox, if it can (a Catalogue Book; a search result
   * when `optimistic`): the entry as it will be. Null: it cannot wait.
   */
  async function queueAdd(book: BookSnapshot, options: AddWith, optimistic = false): Promise<Result<LibraryEntry> | null> {
    if (!queue || book.source === 'manual') return null
    // A search result is shown as a Book under its page key until the database gives it its id.
    const provisional = !('id' in book)
    if (provisional && !optimistic) return null
    let known: Book
    if (provisional) {
      // Nothing to name it by (no source id, no ISBN): the database says what is wrong with it.
      try {
        known = { ...book, id: bookKey(book), createdAt: new Date().toISOString() }
      } catch {
        return null
      }
    } else {
      known = book as Book
    }
    if (queue.entryForBook(known.id)) return { data: null, error: 'already_in_library' }
    const write: QueuedWrite = {
      action: 'add_to_library',
      args: { p_book: bookToRow(known), ...addWithArguments(options) },
      about: known.title,
      queuedAt: new Date().toISOString(),
      book: known,
      creates: { entry_id: localId(), session_id: localId() },
      ...(provisional ? { coverPending: true } : {}),
    }
    write.entryId = write.creates!.entry_id
    const after = applyWrite(null, write)
    if (typeof after === 'string') return { data: null, error: after }
    if (!after) return { data: null, error: 'unknown' }
    await queue.add(write)
    return { data: after, error: null }
  }

  return {
    addToLibrary,
    entry,

    async startReading(entryId, startedOn) {
      const waiting = await queuedEntry('start_reading', { p_entry_id: entryId, p_started_on: startedOn }, entryId, {
        session_id: localId(),
      })
      if (waiting) return waiting
      if (!online()) return OFFLINE
      const started = await client.rpc('start_reading', { p_entry_id: entryId, p_started_on: startedOn })
      if (isNoAnswer(started)) {
        return unansweredEntry('start_reading', { p_entry_id: entryId, p_started_on: startedOn }, entryId, { session_id: localId() })
      }
      if (started.error) return { data: null, error: mapLibraryError(started.error) }
      return reread(entryId)
    },

    async finish(entryId, { endedOn, rating = null, review = null, reviewSpoilers = false }) {
      const args = {
        p_entry_id: entryId,
        p_ended_on: endedOn,
        p_rating: rating,
        p_review: review,
        ...spoilerArguments(review, reviewSpoilers),
      }
      const waiting = await queuedEntry('finish_reading', args, entryId)
      if (waiting) return waiting
      if (!online()) return OFFLINE
      const finished = await client.rpc('finish_reading', args)
      if (isNoAnswer(finished)) return unansweredEntry('finish_reading', args, entryId)
      if (finished.error) return { data: null, error: mapLibraryError(finished.error) }
      return reread(entryId)
    },

    async abandon(entryId, { endedOn, reason = null }) {
      const waiting = await queuedEntry('abandon_reading', { p_entry_id: entryId, p_ended_on: endedOn, p_reason: reason }, entryId)
      if (waiting) return waiting
      if (!online()) return OFFLINE
      const abandoned = await client.rpc('abandon_reading', { p_entry_id: entryId, p_ended_on: endedOn, p_reason: reason })
      if (isNoAnswer(abandoned)) {
        return unansweredEntry('abandon_reading', { p_entry_id: entryId, p_ended_on: endedOn, p_reason: reason }, entryId)
      }
      if (abandoned.error) return { data: null, error: mapLibraryError(abandoned.error) }
      return reread(entryId)
    },

    async updateProgress(entryId, progress, total, day) {
      const args = {
        p_entry_id: entryId,
        p_page: progress && progress !== NO_PROGRESS && 'page' in progress ? progress.page : null,
        p_percent: progress && progress !== NO_PROGRESS && 'percent' in progress ? progress.percent : null,
        p_set_page_count: total !== undefined,
        p_page_count: total?.pageCount ?? null,
        ...(day ? { p_day: day } : {}),
        ...(progress === NO_PROGRESS ? { p_clear: true } : {}),
      }
      const waiting = await queuedEntry('update_progress', args, entryId)
      if (waiting) return waiting
      if (!online()) return OFFLINE
      const updated = await client.rpc('update_progress', args)
      if (isNoAnswer(updated)) return unansweredEntry('update_progress', args, entryId)
      if (updated.error) return { data: null, error: mapLibraryError(updated.error) }
      return reread(entryId)
    },

    async progressDays(sessionIds) {
      const days: Record<string, ProgressDay[]> = Object.fromEntries(sessionIds.map((id) => [id, []]))
      if (!sessionIds.length) return { data: days, error: null }
      const { data, error } = await client
        .from('reading_progress_days')
        .select('session_id, day, start_page, start_percent, end_page, end_percent')
        .in('session_id', [...sessionIds])
        .order('day')
        .returns<ProgressDayRow[]>()
      if (error) return { data: null, error: mapLibraryError(error) }
      for (const row of data) days[row.session_id]?.push(dayFromRow(row))
      return { data: days, error: null }
    },

    async changeEdition(entryId, book, format) {
      if (!online()) return OFFLINE
      const changed = await client.rpc('change_edition', {
        p_entry_id: entryId,
        p_book: bookToRow(book),
        ...(format ? { p_format: format } : {}),
      })
      if (isNoAnswer(changed)) return OFFLINE
      if (changed.error) return { data: null, error: mapLibraryError(changed.error) }
      return reread(entryId)
    },

    async setFormat(entryId, format) {
      if (!online()) return OFFLINE
      const set = await client.rpc('set_entry_format', { p_entry_id: entryId, p_format: format })
      if (isNoAnswer(set)) return OFFLINE
      if (set.error) return { data: null, error: mapLibraryError(set.error) }
      return reread(entryId)
    },

    async useOwnEdition(entryId, book) {
      if (!online()) return OFFLINE
      const used = await client.rpc('use_own_edition', { p_entry_id: entryId, p_book: bookToRow(book) })
      if (isNoAnswer(used)) return OFFLINE
      if (used.error) return { data: null, error: mapLibraryError(used.error) }
      return reread(entryId)
    },

    async sessions(entryId) {
      const { data, error } = await client.from('reading_sessions').select('*').eq('entry_id', entryId).returns<SessionRow[]>()
      if (error) return { data: null, error: mapLibraryError(error) }
      return { data: sortSessions(data.map(sessionFromRow)), error: null }
    },

    async updateSession(entryId, session, edit) {
      const args = { p_session_id: session.id, ...sessionEditArguments(session, edit) }
      const waiting = await queuedEntry('update_session', args, entryId)
      if (waiting) return waiting
      if (!online()) return OFFLINE
      const updated = await client.rpc('update_session', args)
      if (isNoAnswer(updated)) return unansweredEntry('update_session', args, entryId)
      if (updated.error) return { data: null, error: mapLibraryError(updated.error) }
      return reread(entryId)
    },

    async deleteSession(entryId, sessionId) {
      if (!online()) return OFFLINE
      const deleted = await client.rpc('delete_session', { p_session_id: sessionId })
      if (isNoAnswer(deleted)) return OFFLINE
      if (deleted.error) return { data: null, error: mapLibraryError(deleted.error) }
      return reread(entryId)
    },

    async setReadAs(entryId, readAs) {
      if (!online()) return OFFLINE
      const set = await client.rpc('set_read_as', { p_entry_id: entryId, p_read_as: readAs })
      if (isNoAnswer(set)) return OFFLINE
      if (set.error) return { data: null, error: mapLibraryError(set.error) }
      return reread(entryId)
    },

    async setHidden(entryId, hidden) {
      const args = { p_entry: entryId, p_hidden: hidden }
      const waiting = await queuedEntry('set_entry_hidden', args, entryId)
      if (waiting) return waiting
      if (!online()) return OFFLINE
      const set = await client.rpc('set_entry_hidden', args)
      if (isNoAnswer(set)) return unansweredEntry('set_entry_hidden', args, entryId)
      if (set.error) return { data: null, error: mapLibraryError(set.error) }
      return reread(entryId)
    },

    async removeFromLibrary(entryId) {
      const waiting = await queued('remove_from_library', { p_entry_id: entryId }, entryId)
      if (waiting) return waiting.error ? waiting : { data: null as null, error: null }
      if (!online()) return OFFLINE
      const removed = await client.rpc('remove_from_library', { p_entry_id: entryId })
      if (isNoAnswer(removed)) {
        const waiting = await queued('remove_from_library', { p_entry_id: entryId }, entryId, undefined, true)
        if (!waiting) return OFFLINE
        return waiting.error ? waiting : { data: null as null, error: null }
      }
      if (removed.error) return { data: null, error: mapLibraryError(removed.error) }
      return { data: null as null, error: null }
    },

    async readAgain(entryId, startedOn) {
      const waiting = await queuedEntry('read_again', { p_entry_id: entryId, p_started_on: startedOn }, entryId, {
        session_id: localId(),
      })
      if (waiting) return waiting
      if (!online()) return OFFLINE
      const again = await client.rpc('read_again', { p_entry_id: entryId, p_started_on: startedOn })
      if (isNoAnswer(again)) {
        return unansweredEntry('read_again', { p_entry_id: entryId, p_started_on: startedOn }, entryId, { session_id: localId() })
      }
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
      const { data, error } = await client.from('books').select(BOOK_COLUMNS).eq('id', id).maybeSingle<BookRow>()
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
          .select(BOOK_COLUMNS)
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
