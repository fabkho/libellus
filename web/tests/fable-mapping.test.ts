import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { importKey, mapFableLibrary, ratingQuarters, summarizePlan, workKey, type ImportEntry } from '@/data/import/fable'
import {
  applyOverrides,
  NotAReadingTrackerExportError,
  parseReadingTracker,
  splitIsbn,
  toIsbn13,
  type Overrides,
} from '@/data/import/readingTracker'

/**
 * The pure mapping step of the Fable import (issue #17) on synthetic fixture
 * JSON in the shape `reading list --json` prints: invented books, invented
 * ids, nothing of anyone's real history. No stack, no network.
 */

const fixture = (name: string) => readFileSync(new URL(`./fixtures/fable/${name}`, import.meta.url), 'utf8')
const { books: records } = parseReadingTracker(fixture('reading-list.json'))
const overrides = JSON.parse(fixture('overrides.json')) as Overrides
const id = (n: number) => `1111${String(n).padStart(4, '0')}-aaaa-4000-8000-${String(n).padStart(12, '0')}`

const plan = mapFableLibrary(records, overrides)
const entryFor = (n: number): ImportEntry => {
  const found = plan.entries.find((entry) => entry.trackerIds.includes(id(n)))
  if (!found) throw new Error(`No entry holds record ${n}`)
  return found
}

describe('parseReadingTracker', () => {
  it('reads `{ books }` and a bare array, and skips records without an id or title', () => {
    expect(parseReadingTracker(fixture('reading-list.json')).books).toHaveLength(12)
    const bare = parseReadingTracker(JSON.stringify([{ id: 'a', title: 'Kept' }, { id: 'b', title: '  ' }, { title: 'No id' }]))
    expect(bare.books.map((book) => book.id)).toEqual(['a'])
    expect(bare.warnings).toHaveLength(2)
  })

  it('refuses what is not a reading-tracker export', () => {
    expect(() => parseReadingTracker('not json')).toThrow(NotAReadingTrackerExportError)
    expect(() => parseReadingTracker('{"items":[]}')).toThrow(NotAReadingTrackerExportError)
  })
})

describe('ISBNs and ratings', () => {
  it('turns an ISBN-10 into its ISBN-13 and ignores Fable ids in the ISBN fields', () => {
    expect(toIsbn13('0000000086')).toBe('9780000000088')
    expect(splitIsbn('0000000086', null)).toEqual({ isbn10: '0000000086', isbn13: '9780000000088' })
    expect(splitIsbn('XqT9ab12Cd', null)).toEqual({ isbn10: null, isbn13: null })
    expect(splitIsbn('978-0-00-000001-9', null).isbn13).toBe('9780000000019')
  })

  it('keeps quarter stars exactly as integer quarters and refuses anything off the grid', () => {
    expect(ratingQuarters(4.75)).toEqual({ quarters: 19, problem: null })
    expect(ratingQuarters(0.25)).toEqual({ quarters: 1, problem: null })
    expect(ratingQuarters(5)).toEqual({ quarters: 20, problem: null })
    expect(ratingQuarters(0)).toEqual({ quarters: null, problem: null })
    expect(ratingQuarters(null)).toEqual({ quarters: null, problem: null })
    expect(ratingQuarters(3.3).quarters).toBeNull()
    expect(ratingQuarters(3.3).problem).toMatch(/3.3/)
    expect(ratingQuarters(8).quarters).toBeNull()
  })
})

describe('applyOverrides', () => {
  it('runs before the mapping: skips, merges into the read that stays, then the explicit fields', () => {
    const { books, report } = applyOverrides(records, overrides)
    const ids = books.map((book) => book.id)
    expect(ids).not.toContain(id(10)) // merged into 9 (keys given as id prefixes)
    expect(ids).not.toContain(id(11)) // skipped
    expect(report.dropped.map((item) => item.id).sort()).toEqual([id(10), id(11)])
    expect(report.warnings).toEqual(['Override "deadbeef" matches 0 tracker records; ignored.'])

    const fox = books.find((book) => book.id === id(9))!
    // Read in German: Fable's English cover and blurb belonged to the other edition.
    expect(fox).toMatchObject({ title: 'Der Fuchs im Schnee', isbn13: '9783000000010', isbn: null, coverUrl: null, description: null, language: 'de', mergedIds: [id(10)] })
    // The merged record's review fills the gap; its missing dates take nothing away.
    expect(fox.session).toMatchObject({ startedAt: '2022-12-01T00:00:00.000Z', finishedAt: '2022-12-20T00:00:00.000Z', rating: 4, review: 'Loved it.' })

    const classic = books.find((book) => book.id === id(12))!
    expect(classic).toMatchObject({ author: 'Gus Specimen', pinnedCoverUrl: 'https://example.com/pinned.jpg' })
    expect(classic.session).toMatchObject({ startedAt: '2020-04-01T00:00:00.000Z', finishedAt: '2020-05-05T00:00:00.000Z' })
  })

  it('leaves its input alone', () => {
    const before = JSON.stringify(records)
    applyOverrides(records, overrides)
    expect(JSON.stringify(records)).toBe(before)
  })
})

describe('mapFableLibrary', () => {
  it('merges editions of one title by one author into one entry, keeping the most recent edition as the Book', () => {
    expect(workKey({ title: 'The Glass Orchard (Orchard Cycle, #1)', author: 'Ada Example' }))
      .toBe(workKey({ title: 'The Glass Orchard: A Novel', author: 'A. Example' }))

    const orchard = entryFor(1)
    expect(entryFor(2)).toBe(orchard)
    expect(entryFor(3)).toBe(orchard)
    expect(orchard.key).toBe(importKey(id(2)))
    expect(orchard.trackerIds).toEqual([id(2), id(1), id(3)])
    expect(orchard.book).toMatchObject({
      title: 'The Glass Orchard: A Novel',
      isbn13: '9780000000026',
      year: 2019,
      // The kept edition has no page count; another edition of the same book does.
      pageCount: 410,
      source: 'import',
      coverUrl: null,
    })
    expect(plan.report.merged.map((item) => item.id).sort()).toEqual([id(1), id(3)])
  })

  it('makes one session per read: the same days twice are one read, other days a re-read', () => {
    const orchard = entryFor(1)
    expect(orchard.sessions).toEqual([
      // Records 1 and 2 are one read in two editions; the kept edition's rating wins.
      { key: importKey(id(2)), startedOn: '2021-03-01', endedOn: '2021-03-20', outcome: 'finished', rating: 19, review: null, abandonReason: null },
      { key: importKey(id(3)), startedOn: '2023-06-01', endedOn: '2023-06-10', outcome: 'finished', rating: 20, review: 'Better the second time.', abandonReason: null },
    ])
    expect(orchard.status).toBe('finished')
    expect(orchard.addedOn).toBe('2021-03-01')
  })

  it('maps every shelf to its sessions: finished, abandoned, open, and none for Want to read', () => {
    expect(entryFor(4)).toMatchObject({ status: 'want_to_read', sessions: [] })
    expect(entryFor(5)).toMatchObject({
      status: 'reading',
      sessions: [{ key: importKey(id(5)), startedOn: '2026-09-01', endedOn: null, outcome: null, rating: null, review: null }],
    })
    expect(entryFor(6)).toMatchObject({
      status: 'finished',
      sessions: [{ startedOn: '2025-01-05', endedOn: '2025-02-01', outcome: 'abandoned', rating: null, abandonReason: 'Too slow' }],
    })
    // A finished read without any dates is still a finished read.
    expect(entryFor(7).sessions).toEqual([
      { key: importKey(id(7)), startedOn: null, endedOn: null, outcome: 'finished', rating: 1, review: null, abandonReason: null },
    ])
  })

  it('reports what it cannot carry over as it was, instead of guessing', () => {
    expect(entryFor(8).sessions[0]!.rating).toBeNull()
    expect(entryFor(6).sessions[0]!.rating).toBeNull()
    const reasons = Object.fromEntries(plan.report.unmapped.map((item) => [item.id, item.reason]))
    expect(reasons[id(8)]).toMatch(/rating 3.3/)
    expect(reasons[id(6)]).toMatch(/did not finish/)
  })

  it('applies the overrides first: the edition read, its language, merged reads and pinned covers', () => {
    const fox = entryFor(9)
    expect(entryFor(10)).toBe(fox)
    expect(fox).toMatchObject({
      key: importKey(id(9)),
      readLanguage: 'de',
      fableCoverUrl: null,
      book: { title: 'Der Fuchs im Schnee', isbn13: '9783000000010', language: 'de' },
      sessions: [{ startedOn: '2022-12-01', endedOn: '2022-12-20', rating: 16, review: 'Loved it.' }],
    })
    expect(plan.entries.some((entry) => entry.trackerIds.includes(id(11)))).toBe(false)

    const classic = entryFor(12)
    expect(classic).toMatchObject({
      pinnedCoverUrl: 'https://example.com/pinned.jpg',
      book: { authors: ['Gus Specimen'], isbn13: null },
      sessions: [{ startedOn: '2020-04-01', endedOn: '2020-05-05', outcome: 'finished', rating: 12 }],
    })
  })

  it('cleans the Book up the way the Catalogue keeps it: no series note, plain-text blurb, every author once', () => {
    expect(entryFor(4).book).toMatchObject({
      title: 'Lanterns of Hollow Vale',
      authors: ['Ben Sample', 'Bea Sample'],
      isbn13: '9780000000088',
      isbn10: '0000000086',
      description: 'A tale — of lanterns & vales.',
      language: 'en',
    })
    expect(mapFableLibrary([{ ...records[0]!, title: 'Morning Rime (Rime Saga, #3)' }]).entries[0]!.book.title).toBe('Morning Rime')
  })

  it('keys every entry and session by the Fable record it came from, the same on every run', () => {
    expect(new Set(plan.entries.map((entry) => entry.key)).size).toBe(plan.entries.length)
    for (const entry of plan.entries) {
      expect(entry.key).toBe(importKey(entry.trackerIds[0]!))
      for (const session of entry.sessions) expect(entry.trackerIds.map(importKey)).toContain(session.key)
    }
    expect(mapFableLibrary(records, overrides)).toEqual(plan)
  })

  it('counts what it would write', () => {
    expect(summarizePlan(plan)).toEqual({
      entries: 8,
      byStatus: { want_to_read: 1, reading: 1, finished: 6 },
      sessions: 8,
      byOutcome: { finished: 6, abandoned: 1, open: 1 },
      rated: 5,
    })
  })
})
