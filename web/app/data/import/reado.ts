import type { BookSnapshot } from '../books'
import type { EntryStatus, SessionOutcome } from '../library'
import type { ImportEntry, ImportSession } from './fable'
import { isbnLanguage, toIsbn13, type ReadLanguage } from './readingTracker'

/**
 * The Reado import, stage 1: the app's own data export (Settings → the export
 * the owner found in the iOS app; `schemaVersion: 1`) → the Books, Library
 * entries, Reading sessions and Collections Libellus stores. Pure: no I/O.
 * Titles, covers and the writes come after (web/scripts/reado/,
 * web/scripts/import-reado.ts). Mirrors the Fable import (fable.ts).
 *
 * ## What the export is (verified against two real exports, 2026-10-11)
 *
 * It holds no title, author or cover anywhere. A book is either
 *   - an ISBN (`readingJournal`, 326 of the 375 books of the larger account;
 *     the others are Kindle ASINs, `B0…`), or
 *   - a 64-hex `p_id` (the shelves in `userObject.lists`, `newJournal`,
 *     `customBooks`, `posts`), which cannot be turned into an ISBN from the
 *     export alone.
 * Only the ISBN-keyed books can become Libellus Books in stage 1 (the title
 * comes from the ISBN lookup the app's search already has). A `p_id` is
 * attached to an ISBN only on hard evidence (`bridgePIds`): the ISBN printed
 * on the shelf item (`source.extra`), or a dated reading event that exists
 * both in `newJournal` (p_id) and `readingJournal` (ISBN), the same
 * millisecond and page, unique to one ISBN. Everything else is reported, loudly
 * (`report.unattachable`) and left for stage 2 (the p_id → ISBN bridge through
 * Reado's own API, which needs a credential the owner does not have yet).
 *
 * ## The rules, in order
 *
 * 1. Shelves (`userObject.lists`): `_read`, `_reading`, `_stack`, `_wishlist`,
 *    `_aborted` are Statuses; `_favorites` and every custom list (`2025`,
 *    `Ebook TBR`, …) are Collections. A book only on custom lists is Want to
 *    read. `updatedAt` on a shelf item is when it was added or re-sorted, never
 *    a reading date: it only decides the day the entry was added.
 * 2. Reads come from the typed events (`START`, `COMPLETE`, `ABORT`) of the
 *    ISBN-keyed journal and, for an attached `p_id`, of `newJournal` (which
 *    reaches to 2026; the journal ends 2024). Equal events are one. A `START`
 *    opens a read, `COMPLETE` closes it finished, `ABORT` closes it abandoned
 *    (DNF, ending on its day); a second `START` of an open read is the same read.
 *    The day is the day in the device's time zone when the event carries its
 *    offset, else its UTC day (the journal's noon-UTC stamps are dates).
 * 3. A book with a read but no finish: on `_reading` it is Currently reading;
 *    on `_read`, or with a rating, it is a finished read with the start day and
 *    no end; on `_stack`/`_wishlist` Want to read; with no shelf at all it is a
 *    `START` and nothing else, which the 2023 imports wrote for books never
 *    read — left out by default (`startedOnly: 'skip'`), reported, and
 *    `startedOnly: 'want'` makes them Want to read.
 * 4. A book on `_read` with no event at all is a finished read with no days;
 *    one on `_reading` without any start day cannot be Currently reading (a
 *    read needs a start) and is Want to read, reported.
 * 5. Ratings are Reado stars in half steps (1–5) → Libellus quarters, exactly:
 *    4.5 stars → 18 (the Fable import's rule, fable.ts `ratingQuarters`).
 *    Journal rating first, then the `customBooks` rating, then the review's.
 *    Only a finished read keeps one. A review (`posts.message`) of an attached
 *    `p_id` is the review of its last closed read.
 * 6. `_aborted` is empty in both exports; the `ABORT` events (`aborted: 'dnf'`
 *    by default, `'skip'` leaves them out) are the only DNFs.
 *
 * Every entry and session carries a key in its own space — `reado:isbn:<isbn13>`
 * for the entry and its first read (`#2`, `#3` for later reads) — which the
 * writer stores so a rerun finds it again. `reado:p:<p_id>` names a book in the
 * report only: a `p_id`-only book is no Book (no title), and when stage 2 maps
 * it to an ISBN its entry gets the ISBN key like any other.
 *
 * ## What is still missing
 *
 * `p_id`-only books (about two thirds of the larger account's shelves), their
 * finish dates and ratings, 3 400 of its 4 200 progress entries (`pages` per
 * day: Libellus has no per-day progress import), and its reviews, are reported
 * with their counts and left out. Kindle ASIN books cannot be looked up. Reading
 * goals, streaks, badges, followers, comments and notes are not read at all.
 */

export const READO_KEY_PREFIX = 'reado:'

/** An entry's key and its first read's. */
export const isbnKey = (isbn13: string) => `${READO_KEY_PREFIX}isbn:${isbn13}`

/** A book known only by its `p_id`, as the report names it. Never stored in stage 1. */
export const pKey = (pId: string) => `${READO_KEY_PREFIX}p:${pId}`

/** The `n`th read of one entry (1 = the entry's own key). */
export const sessionKey = (entryKey: string, n: number) => (n <= 1 ? entryKey : `${entryKey}#${n}`)

// ---------------------------------------------------------------- the export

export class NotAReadoExportError extends Error {
  constructor(message = 'Not a Reado export: expected the app\'s data export (schemaVersion 1, with userObject.lists)') {
    super(message)
    this.name = 'NotAReadoExportError'
  }
}

export type EventType = 'START' | 'COMPLETE' | 'ABORT'

export interface ReadoListItem {
  pId: string
  /** The ISBN-13 the item carries in `source.extra`, when it does. */
  isbn13: string | null
  /** When it was added or re-sorted: an added day, not a reading date. */
  updatedAt: string | null
}

export interface ReadoJournalEvent {
  at: string
  /** Null for a progress entry (pages read on a day), which stage 1 does not carry. */
  type: EventType | null
  pages: number | null
}

/** One book of the ISBN-keyed `readingJournal`; the same ISBN in several of its collections is merged by the mapping. */
export interface ReadoJournalBook {
  /** The key as the export has it: an ISBN-13, an ISBN-10, a Kindle ASIN. */
  id: string
  pageCount: number | null
  /** Stars, half steps. */
  rating: number | null
  events: ReadoJournalEvent[]
  updatedAt: string | null
}

/** One entry of `newJournal`, by `p_id`; deleted ones are dropped by the parser and counted. */
export interface ReadoEvent {
  pId: string
  at: string
  type: EventType | null
  pages: number | null
  /** Minutes as JS's `getTimezoneOffset` has them (-60 = UTC+1). */
  timezoneOffset: number | null
}

export interface ReadoCustomBook {
  /** Most records of the larger account carry none: they cannot be attached to anything. */
  pId: string | null
  rating: number | null
  updatedAt: string | null
}

export interface ReadoPost {
  pId: string
  rating: number | null
  message: string | null
  createdAt: string | null
}

/** The few keys of the export the import reads; the rest (notifications, followers, tokens, …) is never looked at. */
export interface ReadoExport {
  generatedAt: string | null
  /** In the export's order, which is the shelf's order. */
  lists: Record<string, ReadoListItem[]>
  journal: ReadoJournalBook[]
  events: ReadoEvent[]
  deletedEvents: number
  customBooks: ReadoCustomBook[]
  posts: ReadoPost[]
}

type Json = Record<string, unknown>

const record = (value: unknown): Json | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const string = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null)
const number = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const eventType = (value: unknown): EventType | null =>
  value === 'START' || value === 'COMPLETE' || value === 'ABORT' ? value : null

/**
 * Reads the export, taking only the keys the import needs. Refuses anything
 * that is not a Reado data export of schema version 1.
 */
export function parseReadoExport(jsonText: string): ReadoExport {
  let root: Json | null
  try {
    root = record(JSON.parse(jsonText))
  } catch {
    throw new NotAReadoExportError('Not a Reado export: the file is not JSON')
  }
  if (!root || root.schemaVersion !== 1) {
    throw new NotAReadoExportError(`Not a Reado export of schema version 1 (schemaVersion: ${JSON.stringify(root?.schemaVersion ?? null)})`)
  }
  const user = record(root.userObject)
  const rawLists = record(user?.lists)
  if (!rawLists) throw new NotAReadoExportError()

  const lists: Record<string, ReadoListItem[]> = {}
  for (const [name, items] of Object.entries(rawLists)) {
    lists[name] = list(items).flatMap((item) => {
      const fields = record(item)
      const pId = string(fields?.p_id)
      if (!fields || !pId) return []
      const extra = string(record(fields.source)?.extra)
      return [{ pId, isbn13: /^97[89]\d{10}$/.test(extra ?? '') ? extra : null, updatedAt: string(fields.updatedAt) }]
    })
  }

  // `readingJournal` is a list of collections, each `{ books: { <isbn>: { … } }, updatedAt }`.
  const journal = list(root.readingJournal).flatMap((collection) =>
    Object.entries(record(record(collection)?.books) ?? {}).flatMap(([id, value]) => {
      const book = record(value)
      if (!book) return []
      return [{
        id,
        pageCount: number(book.pageCount),
        rating: number(book.rating),
        updatedAt: string(book.updatedAt),
        events: list(book.events).flatMap((event) => {
          const fields = record(event)
          const at = string(fields?.at)
          return fields && at ? [{ at, type: eventType(fields.type), pages: number(fields.pages) }] : []
        }),
      }]
    }),
  )

  let deletedEvents = 0
  const events = list(root.newJournal).flatMap((entry) => {
    const fields = record(entry)
    const pId = string(fields?.p_id)
    const at = string(fields?.at)
    if (!fields || !pId || !at) return []
    if (fields.isDeleted === true) {
      deletedEvents++
      return []
    }
    return [{ pId, at, type: eventType(fields.type), pages: number(fields.pages), timezoneOffset: number(fields.timezoneOffset) }]
  })

  const customBooks = list(root.customBooks).flatMap((item) => {
    const fields = record(item)
    return fields ? [{ pId: string(fields.p_id), rating: number(fields.rating), updatedAt: string(fields.ratedAt) ?? string(fields.updatedAt) }] : []
  })

  const posts = list(root.posts).flatMap((item) => {
    const fields = record(item)
    const pId = string(fields?.p_id)
    if (!fields || !pId || fields.isDeleted === true) return []
    return [{ pId, rating: number(fields.rating), message: string(fields.message)?.trim() ?? null, createdAt: string(fields.createdAt) }]
  })

  return { generatedAt: string(root.generatedAt), lists, journal, events, deletedEvents, customBooks, posts }
}

// ------------------------------------------------------------------- helpers

/** Half-star Reado ratings as Libellus quarters, exactly: 4.5 → 18. Off the half-star grid or outside 1–5 is not guessed. */
export function ratingQuarters(stars: number | null | undefined): { quarters: number | null; problem: string | null } {
  if (stars == null || stars === 0) return { quarters: null, problem: null }
  const quarters = stars * 4
  if (!Number.isInteger(quarters) || quarters < 1 || quarters > 20) {
    return { quarters: null, problem: `rating ${stars} is not a star rating between 0.25 and 5` }
  }
  return { quarters, problem: null }
}

/** The calendar day of a stamp: in the device's time zone when it carries the offset, else UTC. */
export function dayOf(at: string, timezoneOffset: number | null = null): string | null {
  const time = Date.parse(at)
  if (Number.isNaN(time)) return null
  return new Date(time - (timezoneOffset ?? 0) * 60_000).toISOString().slice(0, 10)
}

/** A Kindle ASIN: no ISBN, so no lookup can name it. */
const isAsin = (id: string) => /^B[0-9A-Z]{9}$/.test(id)

const REVIEW_MAX = 10_000

// ------------------------------------------------------------- the p_id bridge

export interface Bridge {
  /** p_id → ISBN-13, only where the evidence is hard. */
  isbnOf: Map<string, string>
  /** What attached each one. */
  via: Map<string, 'list' | 'journal'>
  /** p_ids whose evidence names two ISBNs (not attached), and ISBNs two p_ids claim by the journal alone. */
  ambiguous: string[]
  /** A p_id whose shelf ISBN and journal events disagree: the shelf's ISBN stands, the journal's is dropped. */
  disagreements: string[]
}

/**
 * Attaches `p_id`s to ISBNs. Two kinds of evidence, nothing else:
 * - the ISBN-13 a shelf item carries (`source.extra`);
 * - a dated reading event of `newJournal` (`p_id`) and of `readingJournal`
 *   (ISBN) with the same stamp and page, where that stamp and page belong to
 *   one ISBN only. One p_id naming one ISBN through all its matches; an ISBN
 *   claimed this way by two p_ids is ambiguous and attached to neither.
 * Matching the customBooks by page count and rating is not evidence (it is a
 * guess among look-alikes) and is not done.
 */
export function bridgePIds(exp: ReadoExport): Bridge {
  const isbnOf = new Map<string, string>()
  const via = new Map<string, 'list' | 'journal'>()
  const ambiguous = new Set<string>()
  const disagreements = new Set<string>()

  const fromList = new Map<string, Set<string>>()
  for (const items of Object.values(exp.lists)) {
    for (const item of items) {
      if (!item.isbn13) continue
      fromList.set(item.pId, (fromList.get(item.pId) ?? new Set()).add(item.isbn13))
    }
  }

  const at = new Map<string, Set<string>>()
  for (const book of exp.journal) {
    const isbn13 = toIsbn13(isAsin(book.id) ? null : book.id)
    if (!isbn13) continue
    for (const event of book.events) {
      const key = `${event.at}|${event.pages ?? ''}`
      at.set(key, (at.get(key) ?? new Set()).add(isbn13))
    }
  }
  const fromJournal = new Map<string, Set<string>>()
  for (const event of exp.events) {
    const isbns = at.get(`${event.at}|${event.pages ?? ''}`)
    if (isbns?.size !== 1) continue
    fromJournal.set(event.pId, (fromJournal.get(event.pId) ?? new Set()).add([...isbns][0]!))
  }

  const claimed = new Map<string, string[]>()
  for (const [pId, isbns] of fromList) {
    if (isbns.size > 1) {
      ambiguous.add(pId)
      continue
    }
    const [isbn13] = isbns
    isbnOf.set(pId, isbn13!)
    via.set(pId, 'list')
    const other = fromJournal.get(pId)
    if (other && ![...other].every((value) => value === isbn13)) disagreements.add(pId)
  }
  for (const [pId, isbns] of fromJournal) {
    if (isbnOf.has(pId) || ambiguous.has(pId)) continue
    if (isbns.size > 1) {
      ambiguous.add(pId)
      continue
    }
    const [isbn13] = isbns
    claimed.set(isbn13!, [...(claimed.get(isbn13!) ?? []), pId])
  }
  for (const [isbn13, pIds] of claimed) {
    // A shelf item that names the ISBN settles it; two journal-only p_ids do not.
    const settled = [...isbnOf.values()].includes(isbn13)
    if (pIds.length > 1 && !settled) {
      for (const pId of pIds) ambiguous.add(pId)
      continue
    }
    for (const pId of pIds) {
      isbnOf.set(pId, isbn13)
      via.set(pId, 'journal')
    }
  }
  return { isbnOf, via, ambiguous: [...ambiguous], disagreements: [...disagreements] }
}

// ------------------------------------------------------------------ the plan

export interface ReadoOptions {
  /** A `START` and nothing else, on no shelf: left out, or Want to read. */
  startedOnly?: 'skip' | 'want'
  /** An `ABORT` event: a DNF session, or left out (the book is then Want to read). */
  aborted?: 'dnf' | 'skip'
  /** Custom lists and `_favorites` become Collections. */
  collections?: boolean
}

/** What a book is, before its title is known: the plan of one ISBN-keyed entry. */
export interface ReadoBook {
  /** `reado:isbn:<isbn13>`. */
  key: string
  isbn13: string
  /** The journal's page count (hers), for the Book when the lookup has none. */
  pageCount: number | null
  /** The `p_id`s attached to this ISBN. */
  pIds: string[]
  /** Statuses it is on: `read`, `reading`, `stack`, `wishlist`, `aborted`. */
  shelves: string[]
  /** The Collections it is on, by name. */
  collections: string[]
  /** The day it entered the Library: its earliest known day. */
  addedOn: string | null
  /** Oldest first. */
  sessions: ImportSession[]
  status: EntryStatus
}

export interface ReadoCollection {
  name: string
  /** The list it comes from. */
  list: string
  /** Entry keys, in the list's order. */
  keys: string[]
}

export interface UnattachedPId {
  pId: string
  lists: string[]
  finishedOn: string | null
  startedOn: string | null
  rating: number | null
  review: boolean
  progressEntries: number
}

export interface ReadoReport {
  generatedAt: string | null
  lists: Record<string, { items: number; attached: number; unattached: number }>
  journal: { records: number; books: number; isbn13: number; asin: number; unreadable: string[] }
  bridge: { pIds: number; viaList: number; viaJournal: number; ambiguous: number; disagreements: number; unattached: number }
  /** Journal books with a Kindle ASIN or an id that is no ISBN: no lookup can name them. */
  noIsbn: { id: string; finished: boolean; rated: boolean }[]
  /** Books left out by an option. */
  skipped: { key: string; reason: string }[]
  /** Fields of attached books that could not be carried over as they were. */
  notes: { key: string; note: string }[]
  /** Everything keyed by a `p_id` that no hard evidence attaches to an ISBN. Stage 2's work. */
  unattachable: {
    pIds: number
    shelfItems: number
    byList: Record<string, number>
    finished: number
    started: number
    rated: number
    reviewed: number
    progressEntries: number
    newJournalEntries: number
    customBooks: { total: number; withoutPId: number; unattached: number; ratedWithoutPId: number; ratedUnattached: number }
    posts: { total: number; unattached: number; ratedUnattached: number }
    deletedEvents: number
    details: UnattachedPId[]
  }
}

export interface ReadoPlan {
  books: ReadoBook[]
  collections: ReadoCollection[]
  report: ReadoReport
}

/** Status shelves; any other list is a Collection. */
const STATUS_LISTS: Record<string, string> = {
  _read: 'read',
  _reading: 'reading',
  _stack: 'stack',
  _wishlist: 'wishlist',
  _aborted: 'aborted',
}

/** What a Reado list is called as a Collection: its own name, `_favorites` Favourites. Null for a Status shelf. */
export function collectionName(listName: string): string | null {
  if (listName in STATUS_LISTS) return null
  if (listName === '_favorites') return 'Favourites'
  return listName.replace(/^_+/, '').trim().slice(0, 80) || null
}

interface Stamped {
  type: EventType
  at: string
  day: string | null
}

/** The typed events of one book, equal ones merged, oldest first (a START before a COMPLETE of the same stamp). */
function typedEvents(journal: ReadoJournalBook[], events: ReadoEvent[]): Stamped[] {
  const found = new Map<string, Stamped & { zoned: boolean }>()
  const add = (type: EventType, at: string, offset: number | null) => {
    const key = `${type}|${at}`
    const zoned = offset !== null
    if (found.has(key) && (found.get(key)!.zoned || !zoned)) return
    found.set(key, { type, at, day: dayOf(at, offset), zoned })
  }
  for (const book of journal) for (const event of book.events) if (event.type) add(event.type, event.at, null)
  for (const event of events) if (event.type) add(event.type, event.at, event.timezoneOffset)
  const order = { START: 0, COMPLETE: 1, ABORT: 1 }
  return [...found.values()]
    .sort((a, b) => a.at.localeCompare(b.at) || order[a.type] - order[b.type])
    .map(({ type, at, day }) => ({ type, at, day }))
}

interface Read {
  startedOn: string | null
  endedOn: string | null
  outcome: SessionOutcome | null
}

/** START opens a read, COMPLETE and ABORT close it; a START of an open read is the same read. */
function readsOf(events: readonly Stamped[]): Read[] {
  const reads: Read[] = []
  let open: Read | null = null
  for (const event of events) {
    if (event.type === 'START') {
      if (!open) {
        open = { startedOn: event.day, endedOn: null, outcome: null }
        reads.push(open)
      }
      continue
    }
    const outcome: SessionOutcome = event.type === 'COMPLETE' ? 'finished' : 'abandoned'
    if (open) {
      open.endedOn = event.day
      open.outcome = outcome
      open = null
    } else {
      reads.push({ startedOn: null, endedOn: event.day, outcome })
    }
  }
  return reads
}

const lastIndex = <T>(items: readonly T[], test: (item: T) => boolean) => {
  for (let index = items.length - 1; index >= 0; index--) if (test(items[index]!)) return index
  return -1
}

const statusOf = (sessions: readonly ImportSession[]): EntryStatus =>
  sessions.length === 0 ? 'want_to_read' : sessions.some((session) => session.outcome === null) ? 'reading' : 'finished'

/**
 * Maps a parsed export to what Libellus stores, and reports what it could not
 * attach. Pure: the same export always gives the same plan.
 */
export function mapReadoExport(exp: ReadoExport, options: ReadoOptions = {}): ReadoPlan {
  const { startedOnly = 'skip', aborted = 'dnf', collections: withCollections = true } = options
  const bridge = bridgePIds(exp)

  // ---- the ISBN-keyed journal, its collections merged
  const unreadable: string[] = []
  const noIsbn: ReadoReport['noIsbn'] = []
  const journalOf = new Map<string, ReadoJournalBook[]>()
  const noIsbnIds = new Map<string, ReadoJournalBook[]>()
  for (const book of exp.journal) {
    const isbn13 = isAsin(book.id) ? null : toIsbn13(book.id)
    if (!isbn13) {
      noIsbnIds.set(book.id, [...(noIsbnIds.get(book.id) ?? []), book])
      continue
    }
    journalOf.set(isbn13, [...(journalOf.get(isbn13) ?? []), book])
  }
  for (const [id, books] of noIsbnIds) {
    if (!isAsin(id)) unreadable.push(id)
    const typed = typedEvents(books, [])
    noIsbn.push({ id, finished: typed.some((event) => event.type === 'COMPLETE'), rated: books.some((book) => book.rating !== null) })
  }

  // ---- what each p_id knows
  const eventsOf = new Map<string, ReadoEvent[]>()
  for (const event of exp.events) eventsOf.set(event.pId, [...(eventsOf.get(event.pId) ?? []), event])
  const customOf = new Map<string, ReadoCustomBook[]>()
  for (const custom of exp.customBooks) if (custom.pId) customOf.set(custom.pId, [...(customOf.get(custom.pId) ?? []), custom])
  const postOf = new Map<string, ReadoPost[]>()
  for (const post of exp.posts) postOf.set(post.pId, [...(postOf.get(post.pId) ?? []), post])

  const pIdsOf = new Map<string, string[]>()
  for (const [pId, isbn13] of bridge.isbnOf) pIdsOf.set(isbn13, [...(pIdsOf.get(isbn13) ?? []), pId])

  // ---- shelves of the attached books
  const shelvesOf = new Map<string, Set<string>>()
  const listsOf = new Map<string, Set<string>>()
  const addedDays = new Map<string, string[]>()
  const shelf = <T>(map: Map<string, Set<T>>, isbn13: string, value: T) => map.set(isbn13, (map.get(isbn13) ?? new Set<T>()).add(value))
  const lists: ReadoReport['lists'] = {}
  for (const [name, items] of Object.entries(exp.lists)) {
    lists[name] = { items: items.length, attached: 0, unattached: 0 }
    for (const item of items) {
      const isbn13 = bridge.isbnOf.get(item.pId)
      if (!isbn13) {
        lists[name]!.unattached++
        continue
      }
      lists[name]!.attached++
      if (name in STATUS_LISTS) shelf(shelvesOf, isbn13, STATUS_LISTS[name]!)
      shelf(listsOf, isbn13, name)
      const added = item.updatedAt ? dayOf(item.updatedAt) : null
      if (added) addedDays.set(isbn13, [...(addedDays.get(isbn13) ?? []), added])
    }
  }

  // ---- one book per ISBN the journal or an attached shelf item names
  const isbns = new Set<string>([...journalOf.keys(), ...listsOf.keys()])
  const notes: ReadoReport['notes'] = []
  const skipped: ReadoReport['skipped'] = []
  const books: ReadoBook[] = []

  for (const isbn13 of [...isbns].sort()) {
    const key = isbnKey(isbn13)
    const note = (text: string) => notes.push({ key, note: text })
    const journal = journalOf.get(isbn13) ?? []
    const pIds = (pIdsOf.get(isbn13) ?? []).sort()
    const shelves = shelvesOf.get(isbn13) ?? new Set<string>()
    const typed = typedEvents(journal, pIds.flatMap((pId) => eventsOf.get(pId) ?? []))
    const reads = readsOf(typed)

    // Rating: the journal's latest, then the custom book's, then a review's.
    const stars = [...journal].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')).find((book) => book.rating !== null)?.rating
      ?? [...pIds.flatMap((pId) => customOf.get(pId) ?? [])].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')).find((custom) => custom.rating !== null)?.rating
      ?? pIds.flatMap((pId) => postOf.get(pId) ?? []).find((post) => post.rating !== null)?.rating
      ?? null
    const rated = ratingQuarters(stars)
    if (rated.problem) note(rated.problem)
    const review = pIds.flatMap((pId) => postOf.get(pId) ?? []).map((post) => post.message).find(Boolean) ?? null

    // ---- decide the book's reads
    let closed = reads.filter((read) => read.outcome !== null)
    let droppedAborts = 0
    if (aborted === 'skip') {
      droppedAborts = closed.filter((read) => read.outcome === 'abandoned').length
      closed = closed.filter((read) => read.outcome !== 'abandoned')
    }
    const open = reads.filter((read) => read.outcome === null).at(-1) ?? null
    const planned: Read[] = [...closed]

    if (planned.length === 0) {
      if (shelves.has('reading')) {
        if (open?.startedOn) planned.push(open)
        else note('on Currently reading without a start day (a read needs one); Want to read')
      } else if (shelves.has('read') || (rated.quarters !== null && !shelves.has('stack') && !shelves.has('wishlist'))) {
        // Finished: on the shelf, or rated, without a finish day (the journal never wrote its COMPLETE).
        planned.push({ startedOn: open?.startedOn ?? null, endedOn: null, outcome: 'finished' })
        note(shelves.has('read') ? 'on Read with no finish day in the export; finished without dates' : 'rated, so finished; no finish day in the export')
      } else if (droppedAborts && !open && !listsOf.has(isbn13)) {
        skipped.push({ key, reason: 'only an ABORT, on no shelf (aborted: skip)' })
        continue
      } else if (open && !listsOf.has(isbn13)) {
        // A START and nothing that says it was read or wanted: on no shelf, on no list.
        if (startedOnly === 'skip') {
          skipped.push({ key, reason: `a start (${open.startedOn ?? '?'}) and nothing else: not known to be read, on no shelf (startedOnly: skip)` })
          continue
        }
        note(`a start (${open.startedOn ?? '?'}) and nothing else; Want to read (startedOnly: want)`)
      }
    } else if (open && shelves.has('reading')) {
      // Read before, being read again.
      if (open.startedOn && (!closed.at(-1)?.endedOn || open.startedOn >= closed.at(-1)!.endedOn!)) planned.push(open)
    }

    const sessions: ImportSession[] = planned.map((read, index) => {
      let { startedOn, endedOn } = read
      if (startedOn && endedOn && endedOn < startedOn) {
        note(`ended ${endedOn} before it started ${startedOn}; start day left out`)
        startedOn = null
      }
      const lastFinished = read.outcome === 'finished' && lastIndex(planned, (other) => other.outcome === 'finished') === index
      const lastClosed = read.outcome !== null && lastIndex(planned, (other) => other.outcome !== null) === index
      return {
        key: sessionKey(key, index + 1),
        startedOn,
        endedOn: read.outcome === null ? null : endedOn,
        outcome: read.outcome,
        rating: lastFinished ? rated.quarters : null,
        review: lastClosed ? review?.slice(0, REVIEW_MAX) ?? null : null,
        abandonReason: null,
      }
    })
    if (droppedAborts) note(`${droppedAborts} ABORT left out (aborted: skip)`)
    if (rated.quarters !== null && !sessions.some((session) => session.rating !== null)) {
      note(`rating ${stars} stars left out: no finished read`)
    }
    if (review && !sessions.some((session) => session.review)) note('a review left out: no closed read')

    const days = [
      ...(addedDays.get(isbn13) ?? []),
      ...sessions.flatMap((session) => [session.startedOn, session.endedOn]),
    ].filter((value): value is string => Boolean(value)).sort()

    const collections = withCollections
      ? [...(listsOf.get(isbn13) ?? [])].flatMap((name) => collectionName(name) ?? [])
      : []
    books.push({
      key,
      isbn13,
      pageCount: journal.map((book) => book.pageCount).find((pages): pages is number => pages !== null && pages > 0) ?? null,
      pIds,
      shelves: [...shelves].sort(),
      collections,
      addedOn: days[0] ?? null,
      sessions,
      status: statusOf(sessions),
    })
  }

  // ---- the Collections, in the lists' order
  const keyOf = new Set(books.map((book) => book.key))
  const collections: ReadoCollection[] = []
  if (withCollections) {
    for (const [name, items] of Object.entries(exp.lists)) {
      const display = collectionName(name)
      if (!display) continue
      const keys = [...new Set(items.flatMap((item) => {
        const isbn13 = bridge.isbnOf.get(item.pId)
        return isbn13 && keyOf.has(isbnKey(isbn13)) ? [isbnKey(isbn13)] : []
      }))]
      if (keys.length) collections.push({ name: display, list: name, keys })
    }
  }

  // ---- everything a p_id keys that stays unattached: stage 2's work
  const unattached = new Map<string, UnattachedPId>()
  const detail = (pId: string) => {
    let found = unattached.get(pId)
    if (!found) unattached.set(pId, found = { pId, lists: [], finishedOn: null, startedOn: null, rating: null, review: false, progressEntries: 0 })
    return found
  }
  const byList: Record<string, number> = {}
  let shelfItems = 0
  for (const [name, items] of Object.entries(exp.lists)) {
    for (const item of items) {
      if (bridge.isbnOf.has(item.pId)) continue
      shelfItems++
      byList[name] = (byList[name] ?? 0) + 1
      detail(item.pId).lists.push(name)
    }
  }
  let newJournalEntries = 0
  let progressEntries = 0
  for (const event of exp.events) {
    if (bridge.isbnOf.has(event.pId)) continue
    newJournalEntries++
    const found = detail(event.pId)
    const day = dayOf(event.at, event.timezoneOffset)
    if (event.type === 'COMPLETE') found.finishedOn = [found.finishedOn, day].filter(Boolean).sort().at(-1) ?? null
    else if (event.type === 'START') found.startedOn = [found.startedOn, day].filter(Boolean).sort()[0] ?? null
    else if (!event.type) {
      progressEntries++
      found.progressEntries++
    }
  }
  const customTotals = { total: exp.customBooks.length, withoutPId: 0, unattached: 0, ratedWithoutPId: 0, ratedUnattached: 0 }
  for (const custom of exp.customBooks) {
    if (!custom.pId) {
      customTotals.withoutPId++
      if (custom.rating !== null) customTotals.ratedWithoutPId++
    } else if (!bridge.isbnOf.has(custom.pId)) {
      customTotals.unattached++
      if (custom.rating !== null) {
        customTotals.ratedUnattached++
        detail(custom.pId).rating = custom.rating
      }
    }
  }
  const postTotals = { total: exp.posts.length, unattached: 0, ratedUnattached: 0 }
  for (const post of exp.posts) {
    if (bridge.isbnOf.has(post.pId)) continue
    postTotals.unattached++
    if (post.rating !== null) postTotals.ratedUnattached++
    const found = detail(post.pId)
    found.rating ??= post.rating
    found.review ||= Boolean(post.message)
  }
  const details = [...unattached.values()].sort((a, b) => a.pId.localeCompare(b.pId))

  return {
    books,
    collections,
    report: {
      generatedAt: exp.generatedAt,
      lists,
      journal: {
        records: exp.journal.length,
        books: journalOf.size + noIsbnIds.size,
        isbn13: journalOf.size,
        asin: noIsbn.filter((book) => isAsin(book.id)).length,
        unreadable,
      },
      bridge: {
        pIds: bridge.isbnOf.size,
        viaList: [...bridge.via.values()].filter((how) => how === 'list').length,
        viaJournal: [...bridge.via.values()].filter((how) => how === 'journal').length,
        ambiguous: bridge.ambiguous.length,
        disagreements: bridge.disagreements.length,
        unattached: details.length,
      },
      noIsbn,
      skipped,
      notes,
      unattachable: {
        pIds: details.length,
        shelfItems,
        byList,
        finished: details.filter((found) => found.finishedOn).length,
        started: details.filter((found) => found.startedOn).length,
        rated: details.filter((found) => found.rating !== null).length,
        reviewed: details.filter((found) => found.review).length,
        progressEntries,
        newJournalEntries,
        customBooks: customTotals,
        posts: postTotals,
        deletedEvents: exp.deletedEvents,
        details,
      },
    },
  }
}

/** Counts for the run's output: entries by status, sessions by outcome, ratings, Collections. */
export function summarizeReado(plan: ReadoPlan) {
  const byStatus = { want_to_read: 0, reading: 0, finished: 0 } as Record<EntryStatus, number>
  const byOutcome = { finished: 0, abandoned: 0, open: 0 }
  let rated = 0
  let reviewed = 0
  let undated = 0
  for (const book of plan.books) {
    byStatus[book.status]++
    for (const session of book.sessions) {
      byOutcome[session.outcome ?? 'open']++
      if (session.rating !== null) rated++
      if (session.review) reviewed++
      if (!session.startedOn && !session.endedOn) undated++
    }
  }
  return {
    entries: plan.books.length,
    byStatus,
    sessions: byOutcome.finished + byOutcome.abandoned + byOutcome.open,
    byOutcome,
    rated,
    reviewed,
    undatedReads: undated,
    collections: plan.collections.length,
    collectionEntries: plan.collections.reduce((total, collection) => total + collection.keys.length, 0),
  }
}

// ------------------------------------------------- from a plan to an entry

/** The language read: the edition's, German or English (Apple's storefront and the covers it picks follow it). */
export function readLanguageOf(isbn13: string, edition: Pick<BookSnapshot, 'language'> | null = null): ReadLanguage {
  const language = isbnLanguage(isbn13) ?? edition?.language ?? null
  return language === 'de' ? 'de' : 'en'
}

/**
 * The entry the writer takes: a planned book with the edition the ISBN lookup
 * found (title, authors, … — the export has none). The Book keeps the ISBN of
 * the export, and her page count only where the edition has none.
 */
export function toImportEntry(book: ReadoBook, edition: BookSnapshot): ImportEntry {
  return {
    key: book.key,
    trackerIds: book.pIds,
    book: {
      ...edition,
      isbn13: edition.isbn13 ?? book.isbn13,
      pageCount: edition.pageCount ?? book.pageCount,
    },
    readLanguage: readLanguageOf(book.isbn13, edition),
    pinnedCoverUrl: null,
    fableCoverUrl: null,
    addedOn: book.addedOn,
    sessions: book.sessions,
    status: book.status,
  }
}
