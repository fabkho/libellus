import { describe, expect, it } from 'vitest'
import type { EntryStatus, LibraryEntry, ReadingSession, SessionOutcome } from '@/data/library'
import { FACETS, FINISHED_STATUSES, statusOptions } from '@/data/libraryView'
import { FINISHED_STATES, nextStatus, SEGMENTS, SHELF_STATES, statusOf, statusOrder, type StatusState } from '@/utils/bookStatus'

/**
 * The shelf's own words and order (utils/bookStatus.ts): the three Statuses the database has, plus *Not finished*,
 * which is a read outcome shown inside Finished and never a Status (CONTEXT.md, Abandoned; `isNotFinished`). The
 * point of the module is that the Library's segments and Finished's two-way filter come from the same table, which
 * the last block here asserts directly. Pure: plain entries, no database.
 */

let next = 0
function session(fields: Partial<ReadingSession> = {}): ReadingSession {
  return {
    id: `s${next++}`,
    startedOn: null,
    endedOn: null,
    outcome: null,
    rating: null,
    review: null,
    reviewSpoilers: false,
    abandonReason: null,
    progressPage: null,
    progressPercent: null,
    progressUpdatedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...fields,
  }
}

function entry(status: EntryStatus, latestSession: ReadingSession | null = null, fields: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    id: `e-${status}-${next++}`,
    status,
    addedAt: '2026-01-01T00:00:00Z',
    book: { id: 'b1', title: 'The Dispossessed', authors: ['Ursula K. Le Guin'], pageCount: 387 } as unknown as LibraryEntry['book'],
    pageCountOverride: null,
    latestSession,
    ...fields,
  }
}

const abandoned = () => session({ startedOn: '2026-02-01', endedOn: '2026-02-03', outcome: 'abandoned' })
const finished = () => session({ startedOn: '2026-02-01', endedOn: '2026-02-03', outcome: 'finished' })

describe('statusOf', () => {
  it('words a finished entry whose latest read was given up as Not finished, the read outcome, never its Status', () => {
    const view = statusOf(entry('finished', abandoned()), abandoned())
    expect(view.state).toBe('notFinished')
    expect(view.labelKey).toBe('status.notFinished')
  })

  it('reads the latest read it is handed, so a fresher one decides (the row and the tally say the same)', () => {
    // The entry says Finished, but the screen holds a newer read that ended abandoned.
    expect(statusOf(entry('finished', finished()), abandoned()).state).toBe('notFinished')
    // And the other way round: a read given up, then one finished, is a finished Book.
    expect(statusOf(entry('finished', abandoned()), finished()).state).toBe('finished')
  })

  it('words the three plain Statuses with the keys the message file already has', () => {
    expect(statusOf(entry('want_to_read'), null)).toEqual({ state: 'want_to_read', labelKey: 'status.want_to_read', order: 0 })
    expect(statusOf(entry('reading', session({ startedOn: '2026-02-01' })), session())).toEqual({ state: 'reading', labelKey: 'status.reading', order: 1 })
    expect(statusOf(entry('finished', finished()), finished())).toEqual({ state: 'finished', labelKey: 'status.finished', order: 2 })
  })

  it('is Never Not finished for a Manual book with no reads at all: it is simply Want to read', () => {
    const manual = entry('want_to_read', null, { book: { id: 'm1', title: 'My notebook', authors: [], pageCount: null, source: 'manual' } as unknown as LibraryEntry['book'] })
    expect(statusOf(manual, manual.latestSession)).toEqual({ state: 'want_to_read', labelKey: 'status.want_to_read', order: 0 })
  })
})

describe('the shelf order', () => {
  it('is the segments in the Library\'s tab order, with Not finished last, inside the finished family', () => {
    const table: [StatusState, number][] = [
      ['want_to_read', 0],
      ['reading', 1],
      ['finished', 2],
      ['notFinished', 3],
    ]
    for (const [state, order] of table) expect(statusOrder(state), state).toBe(order)
    expect(SHELF_STATES).toEqual(table.map(([state]) => state))
    // Not a tab of its own: the segments are the three Statuses, in the order the tabs list them.
    expect(SEGMENTS).toEqual(['want_to_read', 'reading', 'finished'])
  })
})

describe('nextStatus', () => {
  it('ends any read as Finished, whichever way it ended: the outcome is a read result, not a Status', () => {
    for (const state of SHELF_STATES) {
      expect(nextStatus(state, 'finished'), state).toBe('finished')
      expect(nextStatus(state, 'abandoned'), state).toBe('finished')
    }
  })

  it('answers a Status the database has, never Not finished', () => {
    const outcomes: SessionOutcome[] = ['finished', 'abandoned']
    for (const state of SHELF_STATES) for (const outcome of outcomes) expect(SEGMENTS).toContain(nextStatus(state, outcome))
  })
})

describe('one ordering, not two', () => {
  it('has Finished\'s status filter in the shelf\'s own order, and nothing the shelf does not know', () => {
    expect([...FINISHED_STATUSES]).toEqual(FINISHED_STATES)
    expect(FINISHED_STATES).toEqual(SHELF_STATES.filter((state) => state === 'finished' || state === 'notFinished'))
    // Every facet list is keyed by a segment: a fourth state would have to be one to be filterable.
    expect(Object.keys(FACETS).sort()).toEqual([...SEGMENTS].sort())
  })

  it('counts Finished\'s two ways with the same rule a row is worded by', () => {
    const shelf = [entry('finished', finished()), entry('finished', abandoned()), entry('finished', abandoned())]
    expect(statusOptions(shelf)).toEqual([
      { value: 'finished', count: 1 },
      { value: 'notFinished', count: 2 },
    ])
    // The tally is per entry, and each of them is the row's own word.
    const rows = shelf.map((e) => statusOf(e, e.latestSession).state)
    expect(rows).toEqual(['finished', 'notFinished', 'notFinished'])
  })
})
