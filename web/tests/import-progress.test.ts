import { describe, expect, it } from 'vitest'
import { hasSeen, isLive, jobOf, languagesOf, markSeen, SEEN_JOBS_KEY, TELL_FINISHED_DAYS, worthShowing, deviceOf, type ImportJob } from '@/data/importJob'
import { uploadRow } from '@/data/importUpload'
import type { ImportBook } from '@/data/import/rows'
import { ambientFraction, importAmbient } from '@/utils/importProgress'

/**
 * The import job as the app shows it (data/importJob.ts, utils/importProgress.ts): the server's row as the app's job, what the pill
 * and the import page say in each state, which finished job is told once, and what the device uploads of a row. Fakes only.
 */

const row = (over: Record<string, unknown> = {}) => ({
  id: 'job-1',
  state: 'running',
  total: 100,
  done: 0,
  added: 0,
  kept: 0,
  failed: 0,
  already: 0,
  cover_edition: 0,
  cover_lent: 0,
  cover_hardcover: 0,
  cover_openlibrary: 0,
  cover_goodreads: 0,
  cover_none: 0,
  error: null,
  finished_at: null,
  ...over,
})
const job = (over: Record<string, unknown> = {}): ImportJob => jobOf(row(over))!

describe('the server row as the app\'s job', () => {
  it('counts the phases: rows matched, rows with a cover decision (every source), rows written', () => {
    const now = job({ done: 100, cover_edition: 40, cover_lent: 5, cover_hardcover: 4, cover_openlibrary: 20, cover_goodreads: 3, cover_none: 7, added: 50, kept: 10, failed: 1 })
    expect(now).toMatchObject({ total: 100, matched: 100, covered: 79, written: 61, added: 50, failed: 1 })
  })

  it('kept is the books that were there already, with the rows the device did not even upload', () => {
    expect(job({ state: 'done', kept: 4, already: 6 }).kept).toBe(10)
  })

  it('is nothing for what is not a job (a change without a state, an unknown state)', () => {
    expect(jobOf(null)).toBeNull()
    expect(jobOf({ id: 'x' })).toBeNull()
    expect(jobOf(row({ state: 'sleeping' }))).toBeNull()
  })

  it('is live while it queues, runs or is paused', () => {
    for (const state of ['queued', 'running', 'paused']) expect(isLive(job({ state }))).toBe(true)
    for (const state of ['done', 'failed', 'cancelled']) expect(isLive(job({ state }))).toBe(false)
    expect(isLive(null)).toBe(false)
  })
})

describe('what the app says about the import', () => {
  it('says nothing without a job, or for a cancelled one', () => {
    expect(importAmbient(null)).toBeNull()
    expect(importAmbient(job({ state: 'cancelled' }))).toBeNull()
  })

  it('waiting in line: how many are ahead (and no count of books)', () => {
    expect(importAmbient(job({ state: 'queued' }), 2)).toEqual({ kind: 'queued', ahead: 2 })
    expect(importAmbient(job({ state: 'queued' }))).toEqual({ kind: 'queued', ahead: 0 })
  })

  it('a paused job says so (it goes on by itself)', () => {
    expect(importAmbient(job({ state: 'paused', done: 10 }))).toEqual({ kind: 'paused' })
  })

  it('a running job: the first phase that is not through every row', () => {
    expect(importAmbient(job({ done: 40 }))).toEqual({ kind: 'matching', done: 40, total: 100 })
    expect(importAmbient(job({ done: 100, cover_edition: 30, cover_none: 5 }))).toEqual({ kind: 'covers', done: 35, total: 100 })
    expect(importAmbient(job({ done: 100, cover_edition: 100, added: 20, kept: 5 }))).toEqual({ kind: 'writing', done: 25, total: 100 })
  })

  it('done carries what was added, kept and failed; failed says it stopped', () => {
    expect(importAmbient(job({ state: 'done', done: 100, added: 12, kept: 3, already: 1, failed: 2 }))).toEqual({ kind: 'done', added: 12, kept: 4, failed: 2 })
    expect(importAmbient(job({ state: 'done' }))).toEqual({ kind: 'done', added: 0, kept: 0, failed: 0 })
    expect(importAmbient(job({ state: 'failed' }))).toEqual({ kind: 'failed' })
  })

  it('the thin bar: a fraction for what has a count, none for waiting, paused, done and failed', () => {
    expect(ambientFraction({ kind: 'matching', done: 50, total: 200 })).toBe(0.25)
    expect(ambientFraction({ kind: 'writing', done: 5, total: 0 })).toBe(0)
    expect(ambientFraction({ kind: 'covers', done: 9, total: 3 })).toBe(1)
    for (const none of [{ kind: 'queued', ahead: 1 }, { kind: 'paused' }, { kind: 'failed' }, { kind: 'done', added: 3, kept: 0, failed: 0 }] as const) expect(ambientFraction(none)).toBeNull()
  })
})

describe('a finished job is told once', () => {
  const memory = () => {
    const items = new Map<string, string>()
    return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) }
  }
  const NOW = Date.parse('2026-11-05T12:00:00Z')
  const ended = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString()

  it('a live job is always shown; a done or failed one only when it ended lately and was not seen', () => {
    const none = () => false
    expect(worthShowing(job({ state: 'running' }), none, NOW)).toBe(true)
    expect(worthShowing(job({ state: 'done', finished_at: ended(0.1) }), none, NOW)).toBe(true)
    expect(worthShowing(job({ state: 'failed', finished_at: ended(1) }), none, NOW)).toBe(true)
    expect(worthShowing(job({ state: 'done', finished_at: ended(TELL_FINISHED_DAYS + 1) }), none, NOW)).toBe(false)
    expect(worthShowing(job({ state: 'done', finished_at: ended(0.1) }), () => true, NOW)).toBe(false)
    expect(worthShowing(job({ state: 'cancelled', finished_at: ended(0.1) }), none, NOW)).toBe(false)
  })

  it('what she has seen is kept on the device, a few jobs back', () => {
    const storage = memory()
    expect(hasSeen(storage, 'a')).toBe(false)
    markSeen(storage, 'a')
    expect(hasSeen(storage, 'a')).toBe(true)
    for (let at = 0; at < 30; at++) markSeen(storage, `job-${at}`)
    expect(hasSeen(storage, 'a')).toBe(false)
    expect(hasSeen(storage, 'job-29')).toBe(true)
    expect(JSON.parse(storage.getItem(SEEN_JOBS_KEY)!)).toHaveLength(20)
  })

  it('storage that fails or holds rubbish tells nothing and breaks nothing', () => {
    const broken = { getItem: () => 'not json', setItem: () => { throw new Error('full') } }
    expect(hasSeen(broken, 'a')).toBe(false)
    expect(() => markSeen(broken, 'a')).not.toThrow()
    expect(hasSeen(null, 'a')).toBe(false)
  })
})

describe('what the device sends of itself', () => {
  it('only the languages the server takes, at most five', () => {
    expect(languagesOf(['en', 'de-AT', 'fra', 'x', 'english', 'it', 'es', 'pt'])).toEqual(['en', 'de-AT', 'fra', 'it', 'es'])
  })

  it('one id, made once and kept', () => {
    const items = new Map<string, string>()
    const storage = { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) }
    const first = deviceOf(storage, () => 'abcdef123456')
    expect(first).toBe('dev-abcdef123456')
    expect(deviceOf(storage, () => 'other-one-12345')).toBe(first)
    expect(deviceOf(null, () => 'abcdef123456')).toBe('dev-abcdef123456')
  })
})

describe('the row that goes up', () => {
  const book = (over: Partial<ImportBook> = {}): ImportBook => ({
    source: 'goodreads',
    key: 'goodreads:1',
    sourceId: '1',
    row: 1,
    title: 'Dune',
    series: null,
    authors: ['Frank Herbert'],
    isbn13: null,
    isbn10: null,
    pageCount: null,
    year: null,
    originalYear: null,
    binding: null,
    language: null,
    publisher: null,
    shelf: 'read',
    shelves: ['sci-fi', 'Sci-Fi', 'favourites'],
    status: 'finished',
    session: { startedOn: null, endedOn: '2026-01-02', outcome: 'finished', rating: 16, review: 'Loved it.' },
    earlierReads: [],
    extraReads: 0,
    otherKeys: [],
    addedOn: null,
    problems: [],
    ...over,
  })

  it('keeps every other shelf as a Collection (there is no step left to decline one in)', () => {
    expect(uploadRow(book())).toMatchObject({ key: 'goodreads:1', title: 'Dune', collections: ['sci-fi', 'Sci-Fi', 'favourites'] })
  })

  it('a runaway review is dropped rather than refused: one row over the server\'s 20 kB would refuse the whole file', () => {
    const long = uploadRow(book({ session: { startedOn: null, endedOn: '2026-01-02', outcome: 'finished', rating: 16, review: 'x'.repeat(30_000) } }))
    expect((long.session as { review: string | null; rating: number }).review).toBeNull()
    expect((long.session as { rating: number }).rating).toBe(16)
    expect(JSON.stringify(long).length).toBeLessThan(15_000)
  })
})
