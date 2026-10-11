import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import {
  bridgePIds,
  collectionName,
  dayOf,
  isbnKey,
  mapReadoExport,
  NotAReadoExportError,
  parseReadoExport,
  pKey,
  ratingQuarters,
  sessionKey,
  summarizeReado,
  toImportEntry,
  type ReadoBook,
} from '@/data/import/reado'

/**
 * The pure mapping step of the Reado import (stage 1) on a synthetic export in
 * the shape the Reado app writes: invented books, invented ids, nothing of
 * anyone's real history. No stack, no network. The export itself holds no
 * titles, so the books here are the ISBNs `tests/fixtures/reado/export.json`
 * invents (b1 … b10, below).
 */

const fixture = readFileSync(new URL('./fixtures/reado/export.json', import.meta.url), 'utf8')
const parsed = parseReadoExport(fixture)
const plan = mapReadoExport(parsed)

const ISBN = {
  b1: '9783000000010', // finished 2025-01-10 → 2025-02-20, rated 4.5, review, on Read, 2025, Favourites
  b2: '9783000000027', // journal START + newJournal COMPLETE (23:30 UTC at UTC+1), attached by events alone
  b3: '9791000000039', // ABORT
  b4: '9791000000046', // a START and nothing else
  b5: '9791000000053', // START, on Currently reading
  b6: '9791000000060', // only on shelves: Want to read
  b7: '9791000000077', // rated, a START, no finish
  b8: '9791000000084', // on Read, no events at all, rated by a custom book
  b9: '9791000000091', // a START that two p_ids claim
  b10: '9791000000107', // read twice
}
const book = (isbn13: string): ReadoBook => {
  const found = plan.books.find((entry) => entry.isbn13 === isbn13)
  if (!found) throw new Error(`No book ${isbn13}`)
  return found
}

describe('parseReadoExport', () => {
  it('reads only the keys it needs, and counts what it drops', () => {
    expect(Object.keys(parsed).sort()).toEqual(['customBooks', 'deletedEvents', 'events', 'generatedAt', 'journal', 'lists', 'posts'])
    // JSON.parse puts integer-like names (the year lists) first, in the real export as here.
    expect(Object.keys(parsed.lists)).toEqual(['2025', '_read', '_reading', '_stack', '_wishlist', '_aborted', '_favorites', 'Ebook TBR'])
    // 11 records in two collections of the journal (b2 and b4 twice), 14 entries of newJournal, one deleted.
    expect(parsed.journal).toHaveLength(11)
    expect(parsed.events).toHaveLength(14)
    expect(parsed.deletedEvents).toBe(1)
    expect(parsed.lists._read![0]).toEqual({ pId: expect.stringMatching(/^[0-9a-f]{64}$/), isbn13: ISBN.b1, updatedAt: '2025-03-01T10:00:00.000Z' })
    expect(parsed.lists._read![1]!.isbn13).toBeNull()
    // Nothing from the keys it must not look at ends up anywhere in the parse.
    expect(JSON.stringify(parsed)).not.toContain('invented@example.invalid')
    expect(JSON.stringify(parsed)).not.toContain('invented notification')
  })

  it('refuses what is not a Reado export of schema version 1', () => {
    expect(() => parseReadoExport('not json')).toThrow(NotAReadoExportError)
    expect(() => parseReadoExport('[]')).toThrow(NotAReadoExportError)
    expect(() => parseReadoExport(JSON.stringify({ schemaVersion: 2, userObject: { lists: {} } }))).toThrow(/schema version 1/)
    expect(() => parseReadoExport(JSON.stringify({ schemaVersion: 1, userObject: {} }))).toThrow(NotAReadoExportError)
    expect(() => parseReadoExport(JSON.stringify({ schemaVersion: 1, userObject: { lists: {} } }))).not.toThrow()
  })
})

describe('keys, ratings, days', () => {
  it('keeps the key spaces apart and stable', () => {
    expect(isbnKey(ISBN.b1)).toBe(`reado:isbn:${ISBN.b1}`)
    expect(pKey('abc')).toBe('reado:p:abc')
    expect(sessionKey(isbnKey(ISBN.b1), 1)).toBe(isbnKey(ISBN.b1))
    expect(sessionKey(isbnKey(ISBN.b1), 2)).toBe(`${isbnKey(ISBN.b1)}#2`)
    expect(isbnKey(ISBN.b1)).toMatch(/^[a-z]+:\S+$/)
    expect(sessionKey(isbnKey(ISBN.b1), 3)).toMatch(/^[a-z]+:\S+$/)
  })

  it('turns stars into quarters exactly: half stars ×4, 5 stars is 20', () => {
    expect(ratingQuarters(5)).toEqual({ quarters: 20, problem: null })
    expect(ratingQuarters(4.5)).toEqual({ quarters: 18, problem: null })
    expect(ratingQuarters(2.5)).toEqual({ quarters: 10, problem: null })
    expect(ratingQuarters(1)).toEqual({ quarters: 4, problem: null })
    expect(ratingQuarters(0)).toEqual({ quarters: null, problem: null })
    expect(ratingQuarters(null)).toEqual({ quarters: null, problem: null })
    expect(ratingQuarters(5.5).quarters).toBeNull()
    expect(ratingQuarters(3.3)).toMatchObject({ quarters: null, problem: expect.stringContaining('3.3') })
  })

  it('reads a stamp as the day in the device\'s zone when it carries the offset, else in UTC', () => {
    expect(dayOf('2025-03-20T23:30:00.000Z')).toBe('2025-03-20')
    expect(dayOf('2025-03-20T23:30:00.000Z', -60)).toBe('2025-03-21')
    expect(dayOf('2025-03-21T00:30:00.000Z', 120)).toBe('2025-03-20')
    expect(dayOf('2025-01-10T12:00:00.000Z')).toBe('2025-01-10')
    expect(dayOf('not a date')).toBeNull()
  })

  it('makes Collections of favourites and custom lists, never of the Status shelves', () => {
    expect(collectionName('_favorites')).toBe('Favourites')
    expect(collectionName('2025')).toBe('2025')
    expect(collectionName('Sub Anfang des Jahres 26')).toBe('Sub Anfang des Jahres 26')
    for (const status of ['_read', '_reading', '_stack', '_wishlist', '_aborted']) expect(collectionName(status)).toBeNull()
  })
})

describe('bridgePIds', () => {
  const bridge = bridgePIds(parsed)
  const pId = (list: string, index: number) => parsed.lists[list]![index]!.pId

  it('attaches a p_id to the ISBN its shelf item carries', () => {
    expect(bridge.isbnOf.get(pId('_read', 0))).toBe(ISBN.b1)
    expect(bridge.isbnOf.get(pId('_reading', 0))).toBe(ISBN.b5)
    expect(bridge.via.get(pId('_read', 0))).toBe('list')
  })

  it('attaches a p_id whose dated events are the journal\'s, one ISBN only', () => {
    expect(bridge.isbnOf.get(pId('_read', 1))).toBe(ISBN.b2)
    expect(bridge.via.get(pId('_read', 1))).toBe('journal')
  })

  it('attaches neither of two p_ids that claim one ISBN by the journal alone, and nothing it cannot prove', () => {
    expect(bridge.ambiguous).toHaveLength(2)
    expect([...bridge.isbnOf.values()]).not.toContain(ISBN.b9)
    expect(bridge.isbnOf.has(pId('_read', 4))).toBe(false)
    expect(bridge.isbnOf.has(pId('_wishlist', 0))).toBe(false)
    expect(bridge.disagreements).toEqual([])
  })
})

describe('mapReadoExport: the finished pile', () => {
  it('maps a finished book with its real days, its rating in quarters and its review', () => {
    const b1 = book(ISBN.b1)
    expect(b1).toMatchObject({ key: isbnKey(ISBN.b1), status: 'finished', shelves: ['read'], collections: ['2025', 'Favourites'], pageCount: 320 })
    expect(b1.sessions).toEqual([{
      key: isbnKey(ISBN.b1),
      startedOn: '2025-01-10',
      endedOn: '2025-02-20',
      outcome: 'finished',
      // The journal's 4.5 stars, not the review's 5.
      rating: 18,
      review: 'A review of an invented book.\n\nSecond paragraph.',
      abandonReason: null,
    }])
    // Added on the earliest day it is known: here the day it was put on her 2025 list.
    expect(b1.addedOn).toBe('2025-01-02')
  })

  it('takes the finish from newJournal (which reaches past the journal), in the zone the device was in', () => {
    const b2 = book(ISBN.b2)
    expect(b2.sessions).toEqual([expect.objectContaining({ startedOn: '2025-03-05', endedOn: '2025-03-21', outcome: 'finished', rating: 12, review: null })])
    // The deleted COMPLETE (2025-03-22) is not a read, and the journal's second collection (b2 again, no events) adds none.
    expect(b2.sessions).toHaveLength(1)
  })

  it('is two sessions for a book read twice, the later one carrying the rating, keyed apart', () => {
    const b10 = book(ISBN.b10)
    expect(b10.sessions.map((session) => [session.key, session.startedOn, session.endedOn, session.rating])).toEqual([
      [isbnKey(ISBN.b10), '2022-03-01', '2022-03-15', null],
      [`${isbnKey(ISBN.b10)}#2`, '2024-01-05', '2024-02-01', 20],
    ])
  })

  it('takes the rating of a custom book when the journal has none, and a finished read with no days when the shelf says Read', () => {
    expect(book(ISBN.b8)).toMatchObject({ status: 'finished', shelves: ['read'] })
    expect(book(ISBN.b8).sessions).toEqual([expect.objectContaining({ startedOn: null, endedOn: null, outcome: 'finished', rating: 14 })])
    expect(plan.report.notes).toContainEqual({ key: isbnKey(ISBN.b8), note: 'on Read with no finish day in the export; finished without dates' })
  })

  it('counts a rating as a finished read when nothing else says it was read', () => {
    expect(book(ISBN.b7).sessions).toEqual([expect.objectContaining({ startedOn: '2023-08-01', endedOn: null, outcome: 'finished', rating: 16 })])
    expect(plan.report.notes).toContainEqual({ key: isbnKey(ISBN.b7), note: 'rated, so finished; no finish day in the export' })
  })
})

describe('mapReadoExport: the other statuses', () => {
  it('maps an ABORT to an abandoned session ending on its day, with no rating', () => {
    expect(book(ISBN.b3).sessions).toEqual([expect.objectContaining({ startedOn: '2024-05-01', endedOn: '2024-05-09', outcome: 'abandoned', rating: null })])
    // As for any entry, the database derives the Status; an abandoned read is a closed one.
    expect(book(ISBN.b3).status).toBe('finished')
  })

  it('leaves an ABORT out when asked: the book is not a read', () => {
    const skipped = mapReadoExport(parsed, { aborted: 'skip' })
    expect(skipped.books.find((entry) => entry.isbn13 === ISBN.b3)).toBeUndefined()
    expect(skipped.report.skipped.map((item) => item.key)).toContain(isbnKey(ISBN.b3))
  })

  it('makes a book on Currently reading with a start an open session', () => {
    expect(book(ISBN.b5)).toMatchObject({ status: 'reading', shelves: ['reading'] })
    expect(book(ISBN.b5).sessions).toEqual([expect.objectContaining({ startedOn: '2026-09-01', endedOn: null, outcome: null, rating: null })])
  })

  it('makes a book that is only on shelves Want to read, with no session, and no reading day from the shelf\'s updatedAt', () => {
    const b6 = book(ISBN.b6)
    expect(b6).toMatchObject({ status: 'want_to_read', shelves: ['stack'], collections: ['Ebook TBR'], sessions: [] })
    // Its earliest known day is when it was first put on a list.
    expect(b6.addedOn).toBe('2026-01-10')
  })

  it('leaves out a lone START that no shelf explains, reports it, and keeps it as Want to read when asked', () => {
    expect(plan.books.map((entry) => entry.isbn13)).not.toContain(ISBN.b4)
    expect(plan.books.map((entry) => entry.isbn13)).not.toContain(ISBN.b9)
    expect(plan.report.skipped.map((item) => item.key)).toEqual([isbnKey(ISBN.b4), isbnKey(ISBN.b9)])
    const kept = mapReadoExport(parsed, { startedOnly: 'want' })
    expect(kept.books.find((entry) => entry.isbn13 === ISBN.b4)).toMatchObject({ status: 'want_to_read', sessions: [] })
    expect(kept.report.skipped).toEqual([])
  })
})

describe('mapReadoExport: collections', () => {
  it('keeps the lists\' order and only the books it can attach', () => {
    expect(plan.collections).toEqual([
      { name: '2025', list: '2025', keys: [isbnKey(ISBN.b1), isbnKey(ISBN.b2)] },
      { name: 'Favourites', list: '_favorites', keys: [isbnKey(ISBN.b1)] },
      { name: 'Ebook TBR', list: 'Ebook TBR', keys: [isbnKey(ISBN.b6)] },
    ])
  })

  it('makes none when asked not to', () => {
    const without = mapReadoExport(parsed, { collections: false })
    expect(without.collections).toEqual([])
    expect(without.books.every((entry) => entry.collections.length === 0)).toBe(true)
  })
})

describe('mapReadoExport: the report', () => {
  const { details, ...unattachable } = plan.report.unattachable

  it('counts every shelf item attached and not', () => {
    expect(plan.report.lists._read).toEqual({ items: 5, attached: 4, unattached: 1 })
    expect(plan.report.lists._wishlist).toEqual({ items: 1, attached: 0, unattached: 1 })
    expect(plan.report.lists._aborted).toEqual({ items: 0, attached: 0, unattached: 0 })
    expect(plan.report.bridge).toMatchObject({ pIds: 6, viaList: 5, viaJournal: 1, ambiguous: 2, unattached: 5 })
  })

  it('names the Kindle books no lookup can find', () => {
    expect(plan.report.journal).toMatchObject({ records: 11, books: 9, isbn13: 8, asin: 1 })
    expect(plan.report.noIsbn).toEqual([{ id: 'B0ABCDEFGH', finished: true, rated: true }])
  })

  it('reports everything keyed by a p_id it could not attach, by reason', () => {
    expect(unattachable).toMatchObject({
      pIds: 5,
      shelfItems: 5,
      byList: { '2025': 1, _read: 1, _stack: 1, _wishlist: 1, _favorites: 1 },
      finished: 1,
      rated: 1,
      reviewed: 1,
      progressEntries: 2,
      // Both claimants of b9 and the one p_id of the finished unattached book carry events.
      newJournalEntries: 6,
      customBooks: { total: 4, withoutPId: 2, unattached: 1, ratedWithoutPId: 1, ratedUnattached: 1 },
      posts: { total: 2, unattached: 1, ratedUnattached: 1 },
      deletedEvents: 1,
    })
    const finished = details.find((found) => found.finishedOn)!
    expect(finished).toMatchObject({ finishedOn: '2025-06-01', startedOn: '2025-05-01', rating: 4, review: true, progressEntries: 2, lists: expect.arrayContaining(['_read', '_favorites', '2025']) })
  })

  it('counts what the run will write', () => {
    expect(summarizeReado(plan)).toEqual({
      entries: 8,
      byStatus: { want_to_read: 1, reading: 1, finished: 6 },
      sessions: 8,
      byOutcome: { finished: 6, abandoned: 1, open: 1 },
      rated: 5,
      reviewed: 1,
      undatedReads: 1,
      collections: 3,
      collectionEntries: 4,
    })
  })

  it('is the same plan every time', () => {
    expect(mapReadoExport(parseReadoExport(fixture))).toEqual(plan)
  })
})

describe('toImportEntry', () => {
  const edition: BookSnapshot = {
    title: 'An Invented Title', authors: ['Ada Example'], isbn13: null, isbn10: null, pageCount: null, year: 2020, language: null,
    publisher: null, description: null, coverUrl: null, coverThumbhash: null, coverColors: null, source: 'apple',
    appleId: '1', openLibraryEditionKey: null, openLibraryWorkKey: null,
  }

  it('gives the lookup\'s Book the export\'s key, ISBN, page count and reads', () => {
    const entry = toImportEntry(book(ISBN.b1), edition)
    expect(entry).toMatchObject({
      key: isbnKey(ISBN.b1),
      trackerIds: book(ISBN.b1).pIds,
      readLanguage: 'de',
      pinnedCoverUrl: null,
      addedOn: '2025-01-02',
      status: 'finished',
      book: { title: 'An Invented Title', isbn13: ISBN.b1, pageCount: 320, source: 'apple' },
    })
    expect(entry.sessions).toEqual(book(ISBN.b1).sessions)
  })

  it('keeps the edition\'s page count and reads English unless the ISBN is German', () => {
    expect(toImportEntry(book(ISBN.b1), { ...edition, pageCount: 333 }).book.pageCount).toBe(333)
    expect(toImportEntry(book(ISBN.b3), edition).readLanguage).toBe('en')
  })
})
