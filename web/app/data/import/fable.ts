import type { BookSnapshot } from '../books'
import type { EntryStatus, SessionOutcome } from '../library'
import { plainText } from '../search'
import {
  applyOverrides,
  isbnLanguage,
  normalize,
  splitIsbn,
  splitSeriesTitle,
  surname,
  workTitle,
  type CorrectedBook,
  type OverrideReport,
  type Overrides,
  type ReadingTrackerBook,
  type ReadLanguage,
} from './readingTracker'

/**
 * The pure mapping step of the Fable import (issue #17): the reading-tracker
 * records (`reading list --json`) plus the owner's overrides → the Books,
 * Library entries and Reading sessions Libellus stores. No I/O: covers, the
 * Catalogue lookup and the writes come after (web/scripts/fable/).
 *
 * The rules, in order:
 * 1. The overrides apply first (readingTracker.ts `applyOverrides`).
 * 2. Editions of one title by one author merge into one entry; the most recent
 *    edition is kept as the Book (the one the owner pinned in the overrides
 *    first, then the latest publication year, then the latest record).
 * 3. One Reading session per Fable read, after the overrides: the `read` shelf
 *    → finished, `dnf` → abandoned (ending on its DNF date, else its latest
 *    known day); on any other shelf a read with a start and no finish or DNF
 *    date is open (Currently reading), and without one there is no session
 *    (Want to read). Two records of
 *    the same read (same days) are one session; an undated read next to a
 *    dated one of the same book fills its gaps rather than counting twice.
 * 4. Ratings are kept exactly, as integer quarters (4.75 stars → 19).
 *
 * Every entry and session carries the key of the Fable record it came from
 * (`fable:<tracker id>`), which the writer stores so a rerun finds it again.
 */

export const IMPORT_KEY_PREFIX = 'fable:'

export const importKey = (trackerId: string) => `${IMPORT_KEY_PREFIX}${trackerId}`

export interface ImportSession {
  /** `fable:<tracker id>` of the record whose read this is. */
  key: string
  startedOn: string | null
  endedOn: string | null
  /** Null for the open session of a book being read. */
  outcome: SessionOutcome | null
  /** Integer quarters 1–20, only on a finished read. */
  rating: number | null
  review: string | null
  abandonReason: string | null
}

export interface ImportEntry {
  /** `fable:<tracker id>` of the record kept for this entry. */
  key: string
  /** Every tracker record folded into this entry, the kept one first. */
  trackerIds: string[]
  /**
   * The Book as Fable and the overrides know it, `source: 'import'` and no
   * cover yet: the cover step fills in the cover, Apple or OpenLibrary ids and
   * the real source.
   */
  book: BookSnapshot
  /** Language it was read in: picks Apple's storefront and the German National Library. */
  readLanguage: ReadLanguage
  /** The owner's cover pick (overrides), tried before any lookup. */
  pinnedCoverUrl: string | null
  /** Fable's own cover URL, kept for the record only: Fable is going away. */
  fableCoverUrl: string | null
  /** The day it entered the Library: its earliest known day. */
  addedOn: string | null
  /** Oldest first. */
  sessions: ImportSession[]
  /** What the database will derive from the sessions. */
  status: EntryStatus
}

export interface ImportReport extends OverrideReport {
  /** Records folded into another entry as another edition of the same book. */
  merged: { id: string; title: string; into: string }[]
  /** Records or fields that could not be carried over as they were. */
  unmapped: { id: string; title: string; reason: string }[]
}

export interface ImportPlan {
  entries: ImportEntry[]
  report: ImportReport
}

const SHELF_OUTCOME: Record<string, SessionOutcome | null | undefined> = {
  'read': 'finished',
  'dnf': 'abandoned',
  'did-not-finish': 'abandoned',
  'currently-reading': null,
  'want-to-read': undefined,
}

const day = (value: string | null | undefined): string | null => {
  const match = value?.match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1]! : null
}

const year = (value: string | null | undefined): number | null => {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 2100 ? parsed : null
}

const text = (value: string | null | undefined): string | null => value?.trim() || null

/** German function words in a title: a German edition when its ISBN does not say. (Regal corrections.ts) */
const GERMAN_WORDS = /\b(?:und|der|die|das|des|dem|von)\b/i

/**
 * Fable's stars as integer quarters, exactly: 4.75 → 19. Null for unrated (0
 * or missing). Anything off the quarter grid or outside 0.25–5 is reported and
 * left out rather than guessed.
 */
export function ratingQuarters(stars: number | null | undefined): { quarters: number | null; problem: string | null } {
  if (stars == null || stars === 0) return { quarters: null, problem: null }
  const quarters = stars * 4
  if (!Number.isInteger(quarters) || quarters < 1 || quarters > 20) {
    return { quarters: null, problem: `rating ${stars} is not a quarter star between 0.25 and 5` }
  }
  return { quarters, problem: null }
}

/** One title by one author: the work's key, over editions, series notes and spellings of the name. */
export function workKey(book: Pick<ReadingTrackerBook, 'title' | 'author'>): string {
  return `${workTitle(book.title)}|${surname(book.author)}`
}

/**
 * The read one record stands for, or null when there is none. The overrides
 * have already applied; then the shelf decides how a read closed: `read` →
 * finished, `dnf` → abandoned. Any other shelf (`currently-reading`,
 * `want-to-read`, one the tracker invents later) holds an open read only when
 * the record has a start and neither a finish nor a DNF date: that is
 * Currently reading. The tracker itself has no Currently reading shelf.
 */
function readOf(record: CorrectedBook, report: ImportReport): ImportSession | null {
  const session = record.session
  const closes = SHELF_OUTCOME[record.shelf ?? '']
  const started = day(session?.startedAt)
  const open = !closes && Boolean(started) && !session?.finishedAt && !session?.dnfAt
  const outcome: SessionOutcome | null | undefined = closes ?? (open || record.shelf === 'currently-reading' ? null : undefined)
  if (outcome === undefined) {
    if (record.shelf !== 'want-to-read') {
      report.unmapped.push({ id: record.id, title: record.title, reason: `unknown shelf "${record.shelf}"; imported as Want to read` })
    } else if (session?.finishedAt || session?.dnfAt) {
      report.unmapped.push({ id: record.id, title: record.title, reason: 'an end date on a Want to read record; left out' })
    }
    return null
  }
  let startedOn = started
  let endedOn = day(session?.finishedAt)
  if (outcome === 'abandoned') {
    // An abandoned read needs the day it ended: the DNF date, else the latest
    // day the record knows (its finish, else its start). Ruin: on the DNF shelf
    // with only a start, so it ends the day it started.
    endedOn = day(session?.dnfAt) ?? day(session?.finishedAt) ?? startedOn
    if (!session?.dnfAt && endedOn) {
      report.unmapped.push({ id: record.id, title: record.title, reason: `DNF without a DNF date; ended on ${endedOn}, its latest known day` })
    }
  }
  if (outcome === null) {
    endedOn = null
    if (!startedOn) {
      startedOn = day(record.createdAt)
      report.unmapped.push({ id: record.id, title: record.title, reason: `currently reading without a start date; started on ${startedOn ?? '?'} (when the tracker got it)` })
    }
  }
  if (startedOn && endedOn && endedOn < startedOn) {
    report.unmapped.push({ id: record.id, title: record.title, reason: `ended ${endedOn} before it started ${startedOn}; start date left out` })
    startedOn = null
  }
  const { quarters, problem } = ratingQuarters(session?.rating)
  if (problem) report.unmapped.push({ id: record.id, title: record.title, reason: problem })
  if (quarters !== null && outcome !== 'finished') {
    report.unmapped.push({ id: record.id, title: record.title, reason: 'a rating on a read that did not finish; left out' })
  }
  const review = text(session?.review)
  if (review && outcome === null) {
    report.unmapped.push({ id: record.id, title: record.title, reason: 'a review on an open read; left out' })
  }
  return {
    key: importKey(record.id),
    startedOn,
    endedOn,
    outcome,
    rating: outcome === 'finished' ? quarters : null,
    review: outcome === null ? null : review,
    abandonReason: outcome === 'abandoned' ? text(session?.dnfReason) : null,
  }
}

/** The most recent edition among records of one book: the owner's pinned one first. */
function newestEdition(records: CorrectedBook[], pinned: Set<string>): CorrectedBook {
  return [...records].sort((a, b) =>
    Number(pinned.has(b.id)) - Number(pinned.has(a.id))
    || (year(b.yearPublished) ?? 0) - (year(a.yearPublished) ?? 0)
    || (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
    || a.id.localeCompare(b.id),
  )[0]!
}

const sameDays = (a: ImportSession, b: ImportSession) =>
  a.outcome === b.outcome && a.startedOn === b.startedOn && a.endedOn === b.endedOn

const undated = (session: ImportSession) => !session.startedOn && !session.endedOn

/** Copies what `into` lacks from another record of the same read. */
function fillSession(into: ImportSession, from: ImportSession) {
  into.rating ??= from.rating
  into.review ??= from.review
  into.abandonReason ??= from.abandonReason
}

/** The reads of one entry, deduplicated: one session per read, oldest first. */
function sessionsOf(group: CorrectedBook[], kept: CorrectedBook, report: ImportReport): ImportSession[] {
  // The kept record's read leads, so its rating wins a tie between two records of one read.
  const ordered = [kept, ...group.filter((record) => record !== kept)]
  const reads = ordered.map((record) => readOf(record, report)).filter((read): read is ImportSession => read !== null)
  const sessions: ImportSession[] = []
  for (const read of reads) {
    const twin = sessions.find((session) => sameDays(session, read))
      ?? (undated(read) && read.outcome !== null ? sessions.find((session) => session.outcome === read.outcome) : undefined)
    if (twin) {
      fillSession(twin, read)
      continue
    }
    // An undated read already in the list gives way to a dated read of the same book.
    const undatedTwin = read.outcome !== null && !undated(read)
      ? sessions.find((session) => undated(session) && session.outcome === read.outcome)
      : undefined
    if (undatedTwin) {
      fillSession(read, undatedTwin)
      sessions.splice(sessions.indexOf(undatedTwin), 1, read)
      continue
    }
    sessions.push(read)
  }

  // At most one open read per entry: the latest start stays open.
  const open = sessions.filter((session) => session.outcome === null)
  if (open.length > 1) {
    open.sort((a, b) => (b.startedOn ?? '').localeCompare(a.startedOn ?? ''))
    for (const extra of open.slice(1)) {
      sessions.splice(sessions.indexOf(extra), 1)
      report.unmapped.push({ id: extra.key.slice(IMPORT_KEY_PREFIX.length), title: kept.title, reason: 'a second edition being read at the same time; left out' })
    }
  }

  // Oldest first; undated finished reads first, the open read last.
  const at = (session: ImportSession) => (session.outcome === null ? '9999' : session.endedOn ?? session.startedOn ?? '')
  return sessions.sort((a, b) => at(a).localeCompare(at(b)))
}

function statusOf(sessions: ImportSession[]): EntryStatus {
  if (sessions.length === 0) return 'want_to_read'
  return sessions.some((session) => session.outcome === null) ? 'reading' : 'finished'
}

function authorsOf(record: CorrectedBook): string[] {
  const names = [record.author, ...(record.additionalAuthors ?? '').split(',')]
    .map((name) => name?.trim())
    .filter((name): name is string => Boolean(name))
  return [...new Map(names.map((name) => [normalize(name), name])).values()]
}

function bookOf(record: CorrectedBook, group: CorrectedBook[], readLanguage: ReadLanguage): BookSnapshot {
  const { isbn10, isbn13 } = splitIsbn(record.isbn13, record.isbn)
  const pageCount = record.pageCount && record.pageCount > 0 ? record.pageCount : null
  return {
    title: splitSeriesTitle(record.title.trim()).title.slice(0, 500),
    authors: authorsOf(record),
    isbn13,
    isbn10,
    pageCount: pageCount ?? group.find((other) => other.pageCount && other.pageCount > 0)?.pageCount ?? null,
    year: year(record.yearPublished),
    language: isbnLanguage(isbn13) ?? readLanguage,
    publisher: text(record.publisher),
    // Fable's blurbs carry the odd tag and entity ("&#8212;"): plain text, as Apple's are.
    description: [record, ...group].map((other) => plainText(other.description ?? undefined)).find(Boolean) ?? null,
    coverUrl: null,
    coverThumbhash: null,
    coverColors: null,
    source: 'import',
    appleId: null,
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

/** The read language: the owner's word, else the edition's, else German words in the title, else English. */
function readLanguageOf(record: CorrectedBook): ReadLanguage {
  if (record.language) return record.language
  const edition = isbnLanguage(splitIsbn(record.isbn13, record.isbn).isbn13)
  if (edition === 'de' || edition === 'en') return edition
  return GERMAN_WORDS.test(record.title) && !edition ? 'de' : 'en'
}

/**
 * Maps the reading-tracker records and the overrides to what Libellus stores.
 * Pure: the same input always gives the same plan.
 */
export function mapFableLibrary(raw: readonly ReadingTrackerBook[], overrides: Overrides = {}): ImportPlan {
  const corrected = applyOverrides(raw, overrides)
  const report: ImportReport = { ...corrected.report, merged: [], unmapped: [] }
  const pinned = new Set(
    Object.entries(overrides.books ?? {})
      .filter(([, override]) => override.isbn13 || override.coverUrl || override.lang)
      .flatMap(([key]) => corrected.books.filter((book) => book.id === key || (key.length >= 8 && book.id.startsWith(key))).map((book) => book.id)),
  )

  // Editions of one book, in the order they first appear.
  const groups = new Map<string, CorrectedBook[]>()
  for (const record of corrected.books) {
    const key = workKey(record)
    groups.set(key, [...(groups.get(key) ?? []), record])
  }

  const entries: ImportEntry[] = []
  for (const group of groups.values()) {
    const kept = newestEdition(group, pinned)
    for (const other of group) {
      if (other !== kept) report.merged.push({ id: other.id, title: other.title, into: kept.id })
    }
    const readLanguage = readLanguageOf(kept)
    const book = bookOf(kept, group, readLanguage)
    const editionLanguage = isbnLanguage(book.isbn13)
    if (editionLanguage && (editionLanguage === 'de' || editionLanguage === 'en') && editionLanguage !== readLanguage) {
      report.warnings.push(`"${book.title}" was read in ${readLanguage} but its edition (${book.isbn13}) is ${editionLanguage}; set isbn13 in the overrides.`)
    }
    const sessions = sessionsOf(group, kept, report)
    const days = [
      ...group.map((record) => day(record.createdAt)),
      ...sessions.flatMap((session) => [session.startedOn, session.endedOn]),
    ].filter((value): value is string => Boolean(value)).sort()
    entries.push({
      key: importKey(kept.id),
      trackerIds: [kept.id, ...kept.mergedIds, ...group.filter((record) => record !== kept).flatMap((record) => [record.id, ...record.mergedIds])],
      book,
      readLanguage,
      pinnedCoverUrl: kept.pinnedCoverUrl,
      fableCoverUrl: kept.coverUrl,
      addedOn: days[0] ?? null,
      sessions,
      status: statusOf(sessions),
    })
  }

  return { entries, report }
}

/** Counts for the report: entries by status, sessions by outcome. */
export function summarizePlan(plan: ImportPlan) {
  const entries = { want_to_read: 0, reading: 0, finished: 0 } as Record<EntryStatus, number>
  const sessions = { finished: 0, abandoned: 0, open: 0 }
  let rated = 0
  for (const entry of plan.entries) {
    entries[entry.status]++
    for (const session of entry.sessions) {
      sessions[session.outcome ?? 'open']++
      if (session.rating !== null) rated++
    }
  }
  return {
    entries: plan.entries.length,
    byStatus: entries,
    sessions: sessions.finished + sessions.abandoned + sessions.open,
    byOutcome: sessions,
    rated,
  }
}
