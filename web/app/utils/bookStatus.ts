import type { EntryStatus, LibraryEntry, ReadingSession, SessionOutcome } from '../data/library'

/**
 * What a shelf row is, in one word and one order (docs/parity.md, Library and Search): the three Statuses the
 * database has (`EntryStatus`, data/library.ts) plus *Not finished*, which is no Status of its own but a read
 * outcome shown inside the Finished family (CONTEXT.md, Abandoned; `isNotFinished`, data/library.ts).
 *
 * One table holds the order, so a state cannot be added to the Library's segments without the Finished filter
 * learning about it (or the other way round): `SEGMENTS` and `FINISHED_STATES` are the two sides of
 * `SHELF_STATES`, and `tests/book-status.test.ts` pins that they still add up to it. The words are the message
 * file's (`status.*`), never a string built here. Framework-free: a native port copies it 1:1.
 */

/** Every state a row can be in: a Status, or the read outcome the Finished family shows. */
export type StatusState = EntryStatus | 'notFinished'

/** How a row is worded and where it sits: the i18n key, never the word itself. */
export type StatusView = {
  state: StatusState
  /** The i18n key to word it, never the word itself (`status.want_to_read`, `status.notFinished`). */
  labelKey: string
  /** Which "on the shelf" grouping it belongs to, in display order. */
  order: number
}

/**
 * The Library's segments, in the order its tabs list them (pages/library.vue): the three Statuses, and only
 * them — *Not finished* is a filter inside Finished, not a fourth tab.
 */
export const SEGMENTS: readonly EntryStatus[] = ['want_to_read', 'reading', 'finished']

/**
 * The read outcomes shown inside Finished, in the order the Library's Finished filter lists them
 * (`FINISHED_STATUSES`, data/libraryView.ts): the reads that ended finished, and the ones given up.
 */
export const FINISHED_STATES = ['finished', 'notFinished'] as const satisfies readonly StatusState[]

/** Every shelf state in display order: the segments, then *Not finished* inside the finished family. */
export const SHELF_STATES: readonly StatusState[] = [...SEGMENTS, ...FINISHED_STATES.filter((state) => state !== 'finished')]

/** Where a state sits on the shelf, in display order: `want_to_read`, `reading`, `finished`, `notFinished`. */
export function statusOrder(state: StatusState): number {
  return SHELF_STATES.indexOf(state)
}

/**
 * How an entry is worded and where it sits. An entry that is Finished whose last read was given up is *Not
 * finished* (`isNotFinished`, data/library.ts: the latest session decides, in the database as here); every
 * other entry is its Status. `latestRead` is the entry's `latestSession` — a screen that holds a fresher read
 * of it passes that one instead.
 */
export function statusOf(entry: LibraryEntry, latestRead: ReadingSession | null): StatusView {
  const state: StatusState = entry.status === 'finished' && latestRead?.outcome === 'abandoned' ? 'notFinished' : entry.status
  return { state, labelKey: `status.${state}`, order: statusOrder(state) }
}

/**
 * The Status a shelf state has once its open read ends — `finish` and `abandon` (data/library.ts), which are
 * the same move as far as the shelf goes: the entry becomes Finished, whichever way the read ended. The
 * outcome is not a Status but a read result (*Not finished* is its wording inside Finished, `statusOf`), and
 * the state it came from is no input: only a Currently reading entry has an open read to end. What a *start*
 * makes of the shelf is not here: `startReading` and `readAgain` make the entry Currently reading.
 */
export function nextStatus(state: StatusState, session: SessionOutcome): EntryStatus {
  // Both endings leave the entry Finished: whether the read was finished or given up is an outcome of the
  // read (`isNotFinished`), never a fourth Status (`public.entry_status`).
  if (session === 'finished' || session === 'abandoned') return 'finished'
  return state === 'notFinished' ? 'finished' : state
}
