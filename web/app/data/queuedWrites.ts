import { sourceKeys, type Book } from './books'
import type { CollectionSummary } from './collections'
import { sortEntries, type EntryStatus, type LibraryEntry, type LibraryErrorCode, type ReadingSession } from './library'

/**
 * Save offline, sync later (issue #93): which writes may wait on the device, and
 * what each one does to the device's Library until it is sent.
 *
 * A write made without a connection (or while earlier ones still wait, so they
 * stay in order) is not refused any more: the repository puts it in the outbox
 * (`outbox.ts`) as the database call it would have made, by name and with its
 * arguments by name (`QueuedWrite`), and answers at once with the entry as it
 * will be (`applyWrite`). The stores show that answer exactly as they show the
 * database's, and keep it in the device's copy of the Library, so a reload
 * offline still shows it. When the connection is back the outbox sends the
 * writes in order through `sync_write` (the same database functions, at most
 * once each) and the Library is read again: what the database has is what stays.
 *
 * Only writes that name rows the member already has can wait: the database
 * function needs nothing the device does not hold. The list, and why the others
 * stay online-only, is in docs/parity.md (Save offline and sync later).
 *
 * Framework-free like every repository; a native client copies it 1:1.
 */

/** The database functions a queued write may call, in `sync_write`'s words. */
export const QUEUED_ACTIONS = [
  'add_to_library',
  'start_reading',
  'read_again',
  'finish_reading',
  'abandon_reading',
  'update_progress',
  'update_session',
  'remove_from_library',
  // Hide a Book from her followers (social v1): one flag on her own entry.
  'set_entry_hidden',
  'add_to_collection',
  'remove_from_collection',
  'reorder_collection',
  'rename_collection',
  'delete_collection',
  // The reader's highlights (#131): one row per call, last write wins, so they wait offline too.
  'save_reader_highlight',
] as const

export type QueuedAction = (typeof QUEUED_ACTIONS)[number]

/** The writes that change Collections (their refusals are worded by `collections.error.*`). */
export const COLLECTION_ACTIONS: ReadonlySet<QueuedAction> = new Set([
  'add_to_collection',
  'remove_from_collection',
  'reorder_collection',
  'rename_collection',
  'delete_collection',
])

/**
 * The reader's own writes (data/readerHighlights.ts): they name no Library entry
 * to show, so the Library neither lays them over its lists nor reads again when
 * they sync.
 */
export const READER_ACTIONS: ReadonlySet<QueuedAction> = new Set(['save_reader_highlight'])

/**
 * One write as it waits. `args` are exactly the arguments of the online call
 * (`p_entry_id`, `p_started_on`, …); everything else stays on the device.
 */
export type QueuedWrite = {
  action: QueuedAction
  args: Record<string, unknown>
  /** What the member knows it by: the Book's title, or the Collection's name. */
  about: string
  /** When it was made (ISO): the local read's `createdAt`, the progress's `progressUpdatedAt`. */
  queuedAt: string
  /** The Library entry it changes (or makes), so the device can show it before it syncs. */
  entryId?: string
  /**
   * The rows it makes, under the device's own ids (`localId`) until it syncs: the
   * database answers with its ids under the same names, and the writes queued
   * behind it are rewritten to them (`outbox.ts`).
   */
  creates?: { entry_id?: string; session_id?: string }
  /**
   * The Book an add puts in the Library (the device shows it; the call sends its snapshot). A
   * search result that is not in the Catalogue yet is shown as a Book whose `id` is its page key
   * (`bookKey`: `apple-…`, `ol-…`, `isbn-…`), so every link to it opens its page until the
   * database answers with the Catalogue's own id.
   */
  book?: Book
  /**
   * An add whose snapshot still has to get its Cover (a search result, optimistic): the outbox
   * resolves it just before the send (`createOutbox`, `prepare`), so the tap never waits for it.
   */
  coverPending?: boolean
}

/**
 * What a repository needs from the outbox (`WriteOptions.queue` in library.ts):
 * whether writes wait now, the device's copy to answer from, and the line itself.
 */
export type WriteQueue = {
  /** Whether there is a line to write into (somebody is signed in): an optimistic write needs one, even while nothing waits. */
  open: () => boolean
  /** Whether a write waits now: offline, or while earlier ones still wait (so they keep their order). */
  holds: () => boolean
  /** One of the member's entries, as the device shows it now. */
  entry: (entryId: string) => LibraryEntry | null
  /** The member's entry for a Book, as the device shows it now. */
  entryForBook: (bookId: string) => LibraryEntry | null
  /** One of the member's Collections, as the device shows it now. */
  collection: (collectionId: string) => CollectionSummary | null
  /** Puts the write at the end of the line (and keeps it on the device). */
  add: (write: QueuedWrite) => Promise<unknown>
}

/** Ids the device makes for rows that do not exist yet. Never sent as they are: an id that is still local when its write syncs is rewritten first. */
export const LOCAL_ID_PREFIX = 'local-'

/** A v4 UUID from the platform's random source (plain `getRandomValues`: an insecure context, the phone on a LAN address, has no `randomUUID`). */
export function uuid(random: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes)): string {
  const bytes = random(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function localId(): string {
  return `${LOCAL_ID_PREFIX}${uuid()}`
}

export function isLocalId(id: string | null | undefined): boolean {
  return Boolean(id?.startsWith(LOCAL_ID_PREFIX))
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const number = (value: unknown): number | null => (typeof value === 'number' ? value : null)
/** Trimmed; blank is none (as the database stores a review or a reason). */
const trimmed = (value: unknown): string | null => text(value)?.trim() || null

function newSession(id: string, createdAt: string, fields: Partial<ReadingSession> = {}): ReadingSession {
  return {
    id,
    startedOn: null,
    endedOn: null,
    outcome: null,
    rating: null,
    review: null,
    abandonReason: null,
    progressPage: null,
    progressPercent: null,
    progressUpdatedAt: null,
    createdAt,
    ...fields,
  }
}

function openSession(entry: LibraryEntry): ReadingSession | null {
  const session = entry.latestSession
  return entry.status === 'reading' && session && !session.outcome ? session : null
}

/** A read with `update_session`'s arguments applied (the outcome stays; what it does not allow is kept as it was). */
export function editedSession(session: ReadingSession, args: Record<string, unknown>): ReadingSession {
  return {
    ...session,
    startedOn: text(args.p_started_on),
    endedOn: session.outcome ? text(args.p_ended_on) : null,
    rating: session.outcome === 'finished' ? number(args.p_rating) : session.rating,
    review: session.outcome === 'finished' ? trimmed(args.p_review) : session.review,
    abandonReason: session.outcome === 'abandoned' ? trimmed(args.p_abandon_reason) : session.abandonReason,
  }
}

/**
 * What a write does to the entry, as the database would do it: the entry as it
 * will be, null when it leaves the Library, or the code the database would
 * refuse it with (the member hears it at once, nothing waits). `entry` is the
 * device's copy (null for an add: there is none yet). Writes that do not change
 * the entry (the Collections' own) answer with it unchanged.
 */
export function applyWrite(entry: LibraryEntry | null, write: QueuedWrite): LibraryEntry | null | LibraryErrorCode {
  const { args, queuedAt } = write
  if (write.action === 'add_to_library') {
    if (entry) return 'already_in_library'
    if (!write.book || !write.creates?.entry_id) return 'book_invalid'
    const status = (text(args.p_status) ?? 'want_to_read') as EntryStatus
    const sessionId = write.creates.session_id ?? `${write.creates.entry_id}-read`
    const latestSession =
      status === 'reading'
        ? newSession(sessionId, queuedAt, { startedOn: text(args.p_started_on) })
        : status === 'finished'
          ? newSession(sessionId, queuedAt, {
              startedOn: text(args.p_started_on),
              endedOn: text(args.p_ended_on),
              outcome: 'finished',
              rating: number(args.p_rating),
              review: trimmed(args.p_review),
            })
          : null
    return { id: write.creates.entry_id, status, addedAt: queuedAt, book: write.book, pageCountOverride: null, readAs: null, hidden: false, latestSession }
  }
  if (!entry) return 'entry_not_found'

  switch (write.action) {
    case 'start_reading':
    case 'read_again': {
      if (entry.status === 'reading') return 'already_reading'
      if (write.action === 'start_reading' && entry.status === 'finished') return 'already_finished'
      if (write.action === 'read_again' && entry.status === 'want_to_read') return 'never_read'
      const id = write.creates?.session_id ?? `${entry.id}-${queuedAt}`
      return { ...entry, status: 'reading', latestSession: newSession(id, queuedAt, { startedOn: text(args.p_started_on) }) }
    }
    case 'finish_reading':
    case 'abandon_reading': {
      const session = openSession(entry)
      if (!session) return 'not_reading'
      const endedOn = text(args.p_ended_on)
      if (endedOn && session.startedOn && endedOn < session.startedOn) return 'ended_before_started'
      const closed: ReadingSession =
        write.action === 'finish_reading'
          ? { ...session, endedOn, outcome: 'finished', rating: number(args.p_rating), review: trimmed(args.p_review) }
          : { ...session, endedOn, outcome: 'abandoned', abandonReason: trimmed(args.p_reason) }
      return { ...entry, status: 'finished', latestSession: closed }
    }
    case 'update_progress': {
      const session = openSession(entry)
      if (!session) return 'not_reading'
      let pageCountOverride = entry.pageCountOverride
      let next: ReadingSession = { ...session }
      if (args.p_set_page_count) {
        const total = number(args.p_page_count)
        // A total that only repeats the edition's is no override (as the database has it).
        pageCountOverride = total === entry.book.pageCount ? null : total
        const count = pageCountOverride ?? entry.book.pageCount
        if (count != null && next.progressPage != null && next.progressPage > count) next.progressPage = count
      }
      const page = number(args.p_page)
      const percent = number(args.p_percent)
      if (args.p_clear === true) {
        // Back to no progress (Undo of a first save, #104): the value and its stamp go.
        if (page !== null || percent !== null) return 'progress_invalid'
        next = { ...next, progressPage: null, progressPercent: null, progressUpdatedAt: null }
      } else if (page !== null || percent !== null) {
        const count = pageCountOverride ?? entry.book.pageCount
        if (page !== null && count != null && page > count) return 'progress_invalid'
        next = { ...next, progressPage: page, progressPercent: percent, progressUpdatedAt: queuedAt }
      }
      return { ...entry, pageCountOverride, latestSession: next }
    }
    case 'update_session': {
      const session = entry.latestSession
      // Another read than the latest: the entry shows nothing of it.
      if (!session || session.id !== args.p_session_id) return entry
      return { ...entry, latestSession: editedSession(session, args) }
    }
    case 'remove_from_library':
      return null
    case 'set_entry_hidden':
      // A null leaves it as it is (the database's `coalesce`).
      return { ...entry, hidden: typeof args.p_hidden === 'boolean' ? args.p_hidden : (entry.hidden ?? false) }
    default:
      return entry
  }
}

/**
 * Whether the entry is for the Book an add names: the same Catalogue id, or (a search result
 * added before the database answered is a Book under its page key) one of the source ids
 * and the ISBN the entry's Book carries, so a read that already has the added entry does not get it twice.
 */
export function holdsBook(entry: LibraryEntry, book: Book | undefined): boolean {
  if (!book) return false
  return entry.book.id === book.id || sourceKeys(entry.book).includes(book.id)
}

/**
 * The writes still waiting, laid over a Library (the database's, just read, or
 * the device's copy): each entry as it will be once they sync. A write that does
 * not fit any more (its entry is gone, or the copy shows it done already) is
 * skipped here; sending it will tell. Returns new lists, each in its order.
 */
export function applyWrites(
  lists: Record<EntryStatus, LibraryEntry[]>,
  writes: readonly QueuedWrite[],
): Record<EntryStatus, LibraryEntry[]> {
  const entries = new Map<string, LibraryEntry>()
  for (const entry of [...lists.want_to_read, ...lists.reading, ...lists.finished]) entries.set(entry.id, entry)
  let changed = false
  for (const write of writes) {
    if (!write.entryId) continue
    const before =
      write.action === 'add_to_library'
        ? ([...entries.values()].find((entry) => holdsBook(entry, write.book)) ?? null)
        : (entries.get(write.entryId) ?? null)
    const after = applyWrite(before, write)
    if (typeof after === 'string') continue
    changed = true
    if (before) entries.delete(before.id)
    if (after) entries.set(after.id, after)
  }
  if (!changed) return lists
  const next: Record<EntryStatus, LibraryEntry[]> = { want_to_read: [], reading: [], finished: [] }
  for (const entry of entries.values()) next[entry.status].push(entry)
  return { want_to_read: sortEntries(next.want_to_read), reading: sortEntries(next.reading), finished: sortEntries(next.finished) }
}
