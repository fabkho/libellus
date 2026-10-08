import { describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import { createLibrary } from '@/data/library'
import {
  createStats,
  DAYS_SHOWN,
  figuresOf,
  readingDaysSummary,
  readsOnDay,
  type ReadingDay,
  readingSinceOf,
  readsInMonth,
  readsWithoutPages,
  readsWithStars,
  starOf,
  type StatsRead,
  yearsOf,
} from '@/data/stats'
import { addDays, isoDay } from '@/utils/dates'
import { signUpMember } from './support/member'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * The Profile's figures (issue #78) through the repository, against the local
 * stack: the member's closed reads with their Books, the Library counts and
 * the days of progress of the last weeks, and every figure worked out from
 * them by the rules in data/stats.ts (a year is the year a read ended,
 * re-reads included; the member's own page count first; days counted at both
 * ends; whole-star rows take 4.75 as four). Nothing of another member's.
 */

function book(title: string, { author = 'Ursula K. Le Guin', pages = 300 as number | null } = {}): BookSnapshot {
  return {
    title: runTitle(title),
    authors: [author],
    isbn13: null,
    isbn10: null,
    pageCount: pages,
    year: 1969,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: null,
    coverUrl: null,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

type Read = { started?: string | null; ended?: string | null; outcome?: 'finished' | 'abandoned' | null; rating?: number | null }

/** Reads written as the owner's import would: dates the member could not pick through the actions. */
async function reads(entryId: string, rows: Read[]) {
  for (const { started = null, ended = null, outcome = 'finished', rating = null } of rows) {
    await sql('insert into public.reading_sessions (entry_id, started_on, ended_on, outcome, rating) values ($1, $2, $3, $4, $5)', [
      entryId,
      started,
      ended,
      outcome,
      rating,
    ])
  }
}

async function member() {
  const m = await signUpMember()
  const library = createLibrary(m.client)
  const add = async (title: string, options?: Parameters<typeof book>[1]) => (await library.addToLibrary(book(title, options))).data!
  return { member: m, library, stats: createStats(m.client), add }
}

describe('starOf', () => {
  it('puts a Rating in its whole-star row, rounding down, never below one', () => {
    expect([20, 19, 16, 15, 4, 3, 1].map(starOf)).toEqual([5, 4, 4, 3, 1, 1, 1])
  })
})
/** A closed read as the figures take them, without a database: `pages` is what her own total comes to. */
function statsRead(title: string, ended: string | null, pages: number | null, { outcome = 'finished' as const, nth = 1 } = {}): StatsRead {
  return {
    sessionId: title,
    entryId: title,
    book: { ...book(title, { pages }), id: title, createdAt: '2026-01-01T00:00:00.000Z' },
    startedOn: null,
    endedOn: ended,
    outcome,
    rating: null,
    pages,
    days: null,
    nth,
  }
}

describe('readsWithoutPages', () => {
  it('is the finished reads whose Book has no page count, newest end first', () => {
    // Oldest end first, as the record hands them over.
    const reads = [
      statsRead('Answered', '2024-12-05', null),
      statsRead('Uncounted', '2025-02-01', null),
      statsRead('Paged', '2025-03-02', 300),
      statsRead('Unnumbered again', '2025-04-09', null, { nth: 2 }),
      statsRead('Abandoned', '2025-05-01', null, { outcome: 'abandoned' }),
      statsRead('No end date', null, null),
    ]
    // A year: only its finished reads, a re-read included and an abandoned one never.
    expect(readsWithoutPages(reads, 2025).map((r) => r.sessionId)).toEqual(['Unnumbered again', 'Uncounted'])
    // All (the default): every finished one, a read logged without an end date counting here alone.
    expect(readsWithoutPages(reads).map((r) => r.sessionId)).toEqual(['No end date', 'Unnumbered again', 'Uncounted', 'Answered'])
  })
})
/** A day of the calendar as the record has it, naming the titles it was read in. */
function readingDay(day: string, read: boolean, ...titles: string[]): ReadingDay {
  return { day, read, pages: read ? 10 : 0, reads: titles.map((title) => statsRead(title, null, 100)) }
}

describe('readsOnDay', () => {
  const days = [readingDay('2026-03-11', false), readingDay('2026-03-12', true, 'Mort', 'Dune'), readingDay('2026-03-13', true, 'Dune')]

  it("is the reads the day's dot stands for, as the record named them", () => {
    expect(readsOnDay(days, '2026-03-12').map((r) => r.sessionId)).toEqual(['Mort', 'Dune'])
    expect(readsOnDay(days, '2026-03-13').map((r) => r.sessionId)).toEqual(['Dune'])
  })

  it('is nothing for a day not read, a day outside the weeks, or a day kept without its reads', () => {
    expect(readsOnDay(days, '2026-03-11')).toEqual([])
    expect(readsOnDay(days, '2026-01-01')).toEqual([])
    // A record the device kept before the days named their reads.
    expect(readsOnDay([{ day: '2026-03-12', read: true, pages: 10 } as ReadingDay], '2026-03-12')).toEqual([])
  })

  it('gives every day that was read at least one read', () => {
    for (const day of days) expect(day.read).toBe(day.reads.length > 0)
  })
})

describe('the record', () => {
  it('is empty for a member who has read nothing yet', async () => {
    const { stats, add } = await member()
    await add('Waiting')
    const today = isoDay()
    const { data, error } = await stats.record(today)
    expect(error).toBeNull()
    expect(data!.reads).toEqual([])
    expect(data!.wantToRead).toBe(1)
    expect(data!.reading).toBe(0)
    expect(data!.days).toHaveLength(DAYS_SHOWN)
    expect(data!.days.at(-1)).toEqual({ day: today, read: false, pages: 0, reads: [] })
    expect(data!.daysSince).toBeNull()
    expect(figuresOf(data!.reads, 'all').books).toBe(0)
    expect(yearsOf(data!.reads)).toEqual([])
  })

  it('works out the figures of a year and of all of them', async () => {
    const { stats, add, library } = await member()
    const dune = await add('Dune', { author: 'Frank Herbert', pages: 896 })
    const messiah = await add('Dune Messiah', { author: 'Frank Herbert', pages: 336 })
    const gods = await add('Small Gods', { author: 'Terry Pratchett', pages: null })
    const ruin = await add('Ruin', { author: 'John Gwynne', pages: 800 })
    const piranesi = await add('Piranesi', { author: 'Susanna Clarke', pages: 272 })
    await add('Up next')
    const reading = await add('East of Eden')
    await library.startReading(reading.id, isoDay())

    await reads(dune.id, [{ started: '2025-04-12', ended: '2025-05-17', rating: 16 }])
    await reads(messiah.id, [{ started: '2025-05-22', ended: '2025-07-23', rating: 19 }])
    await reads(gods.id, [{ started: null, ended: '2024-11-05', rating: 20 }])
    await reads(ruin.id, [{ started: '2025-02-04', ended: '2025-02-04', outcome: 'abandoned' }])
    await reads(piranesi.id, [
      { started: '2024-11-27', ended: '2024-12-29', rating: 20 },
      { started: '2025-08-31', ended: '2025-09-09', rating: 20 },
    ])
    // The member's own count for her copy counts over the edition's.
    await sql('update public.library_entries set page_count_override = 300 where id = $1', [messiah.id])

    const { data } = await stats.record(isoDay())
    const record = data!
    expect(record.wantToRead).toBe(1)
    expect(record.reading).toBe(1)
    expect(record.reads.map((r) => r.book.title)).toEqual(
      ['Small Gods', 'Piranesi', 'Ruin', 'Dune', 'Dune Messiah', 'Piranesi'].map(runTitle),
    )
    expect(yearsOf(record.reads)).toEqual([2025, 2024])
    expect(readingSinceOf(record.reads)).toBe('2024-11-05')

    const y2025 = figuresOf(record.reads, 2025)
    expect(y2025.books).toBe(3) // Dune, Dune Messiah, Piranesi again; Ruin was not finished
    expect(y2025.pages).toBe(896 + 300 + 272)
    expect(y2025.pagesMissing).toBe(0)
    expect(y2025.rated).toBe(3)
    expect(y2025.average).toBeCloseTo((16 + 19 + 20) / 3)
    expect(y2025.byStar).toEqual([
      { star: 5, count: 1 },
      { star: 4, count: 2 },
      { star: 3, count: 0 },
      { star: 2, count: 0 },
      { star: 1, count: 0 },
    ])
    expect(y2025.columns.map((c) => c.count)).toEqual([0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0])
    expect(y2025.medianDays).toBe(36) // 10 (Piranesi), 36 (Dune), 63 (Messiah)
    expect(y2025.quickest?.book.title).toBe(runTitle('Piranesi'))
    expect(y2025.slowest?.days).toBe(63)
    expect(y2025.longest?.book.title).toBe(runTitle('Dune'))
    expect(y2025.shortest?.pages).toBe(272)
    expect(y2025.rereads).toBe(1)
    expect(y2025.abandoned).toBe(1)
    expect(y2025.authors.map((a) => [a.name, a.count])).toEqual([['Frank Herbert', 2]])
    expect(y2025.favourite?.book.title).toBe(runTitle('Piranesi'))

    const all = figuresOf(record.reads, 'all')
    expect(all.books).toBe(5)
    expect(all.pagesMissing).toBe(1) // Small Gods has no page count
    // What the Pages card's line opens: the very reads the figure counts (a year's, or all of them).
    expect(readsWithoutPages(record.reads, 'all').map((r) => r.book.title)).toEqual([runTitle('Small Gods')])
    expect(readsWithoutPages(record.reads, 2025)).toEqual([])
    expect(all.columns).toEqual([
      { key: 2024, count: 2 },
      { key: 2025, count: 3 },
    ])
    expect(all.rereads).toBe(1)

    // A month's books, and a star row's, best rated first.
    expect(readsInMonth(record.reads, 2025, 5).map((r) => r.book.title)).toEqual([runTitle('Dune')])
    expect(readsWithStars(record.reads, 'all', 5).map((r) => r.endedOn)).toEqual(['2025-09-09', '2024-12-29', '2024-11-05'])
    expect(readsWithStars(record.reads, 2025, 4).map((r) => r.rating)).toEqual([19, 16])
  })

  it('reads the days of progress of the last weeks, all Books together', async () => {
    const { stats, add, library } = await member()
    const today = isoDay()
    const eden = await add('East of Eden', { pages: 608 })
    const mort = await add('Mort', { pages: null })
    await library.startReading(eden.id, addDays(today, -5))
    await library.startReading(mort.id, addDays(today, -5))
    const session = async (entryId: string) =>
      (await sql<{ id: string }>('select id from public.reading_sessions where entry_id = $1', [entryId]))[0]!.id
    const day = (sessionId: string, offset: number, from: [number | null, number | null], to: [number | null, number | null]) =>
      sql(
        'insert into public.reading_progress_days (session_id, day, start_page, start_percent, end_page, end_percent) values ($1, $2, $3, $4, $5, $6)',
        [sessionId, addDays(today, offset), from[0], from[1], to[0], to[1]],
      )
    const edenRead = await session(eden.id)
    const mortRead = await session(mort.id)
    await day(edenRead, -60, [null, null], [10, null]) // before the window: only the first day kept
    await day(edenRead, -2, [10, null], [40, null])
    await day(edenRead, 0, [40, null], [60, null])
    await day(mortRead, 0, [null, 5], [null, 9]) // percent: a day read, no pages
    await day(mortRead, -1, [null, 5], [null, 5]) // nothing read

    const { data } = await stats.record(today)
    expect(data!.daysSince).toBe(addDays(today, -60))
    const figures = (index: number) => {
      const { reads, ...day } = data!.days.at(index)!
      return { ...day, titles: reads.map((r) => r.book.title) }
    }
    // Both Books were read today (Mort by percent, so no pages): each is named, the open reads among them.
    expect(figures(-1)).toEqual({ day: today, read: true, pages: 20, titles: [runTitle('East of Eden'), runTitle('Mort')].sort() })
    expect(figures(-2)).toEqual({ day: addDays(today, -1), read: false, pages: 0, titles: [] }) // a day of no progress names nothing
    expect(figures(-3)).toEqual({ day: addDays(today, -2), read: true, pages: 30, titles: [runTitle('East of Eden')] })
    expect(readingDaysSummary(data!.days)).toEqual({ read: 2, count: 30, perDay: 25 })
    // A read still going is named like any other, with the Book and nothing it has not got (no end, no outcome).
    const eden0 = readsOnDay(data!.days, today).find((r) => r.book.title === runTitle('East of Eden'))!
    expect(eden0).toMatchObject({ outcome: null, endedOn: null, startedOn: addDays(today, -5), pages: 608, nth: 0 })
  })

  it("names a finished read as the record's own, second read and all, on the days it was read", async () => {
    const { stats, add } = await member()
    const today = isoDay()
    const entry = await add('Dune', { pages: 400 })
    await reads(entry.id, [
      { started: addDays(today, -20), ended: addDays(today, -15), rating: 16 },
      { started: addDays(today, -4), ended: addDays(today, -2), rating: 20 },
    ])
    const [first, second] = (await sql<{ id: string }>('select id from public.reading_sessions where entry_id = $1 order by started_on', [entry.id])).map((r) => r.id)
    await sql('insert into public.reading_progress_days (session_id, day, start_page, end_page) values ($1, $2, 0, 100), ($3, $4, 100, 130)', [
      first,
      addDays(today, -16),
      second,
      addDays(today, -3),
    ])
    const { data } = await stats.record(today)
    const onFirst = readsOnDay(data!.days, addDays(today, -16))
    const onSecond = readsOnDay(data!.days, addDays(today, -3))
    expect(onFirst).toEqual([data!.reads.find((r) => r.sessionId === first)])
    expect(onSecond).toEqual([data!.reads.find((r) => r.sessionId === second)])
    expect(onFirst[0]!.nth).toBe(1)
    expect(onSecond[0]).toMatchObject({ nth: 2, rating: 20, outcome: 'finished' })
  })

  it('reads a history longer than one page of the API (1,000 rows) whole', async () => {
    const { stats, add } = await member()
    const entry = await add('Read and read again')
    await sql(
      `insert into public.reading_sessions (entry_id, started_on, ended_on, outcome)
       select $1, d, d, 'finished' from generate_series(date '2020-01-01', date '2020-01-01' + 1049, interval '1 day') as d`,
      [entry.id],
    )
    const { data } = await stats.record(isoDay())
    expect(data!.reads).toHaveLength(1050)
    expect(data!.reads.at(-1)!.nth).toBe(1050)
    expect(figuresOf(data!.reads, 2020).books).toBe(366)
  })

  it("never counts another member's reads or days", async () => {
    const mine = await member()
    const theirs = await member()
    const a = await mine.add('Mine')
    const b = await theirs.add('Theirs')
    await reads(a.id, [{ started: '2024-01-02', ended: '2024-02-01', rating: 12 }])
    await reads(b.id, [{ started: '2024-01-02', ended: '2024-02-01' }, { started: '2024-03-02', ended: '2024-04-01' }])

    expect(figuresOf((await mine.stats.record(isoDay())).data!.reads, 'all').books).toBe(1)
    expect(figuresOf((await theirs.stats.record(isoDay())).data!.reads, 'all').books).toBe(2)
  })
})
