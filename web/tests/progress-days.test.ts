import { describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import { createLibrary, type LibraryEntry } from '@/data/library'
import {
  amountOf,
  dailyAmounts,
  daysLeftOf,
  lastTimeOf,
  paceOf,
  readingLogOf,
  readSummaryOf,
  valueIn,
  type ProgressDay,
} from '@/data/progressDays'
import { addDays, isoDay } from '@/utils/dates'
import { signUpMember } from './support/member'
import { runTitle, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * Progress by day (issue #68): every progress update books the member's day in
 * the same call, and the repository reads a read's days back
 * (`progressDays`), against the local stack as real signed-in members. The pure
 * helpers behind the card's sparkline and pace, the book page's figures, chart
 * and log, "Last time" and the Finish sheet's summary are checked without it.
 */

function book(title: string, pageCount: number | null = 480): BookSnapshot {
  return {
    title: runTitle(title),
    authors: ['Susanna Clarke'],
    isbn13: null,
    isbn10: null,
    pageCount,
    year: 2020,
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

const today = isoDay()

async function reading(title: string, startedOn: string, pageCount: number | null = 480) {
  const member = await signUpMember()
  const library = createLibrary(member.client)
  const added = await library.addToLibrary(book(title, pageCount), { status: 'reading', startedOn })
  const entry = added.data as LibraryEntry
  return { member, library, entry, session: entry.latestSession!.id }
}

describe('progress by day, through the repository', () => {
  it('books the member\'s day with each update: the day\'s start stays, its end moves', async () => {
    const { library, entry, session } = await reading('Day one', today)
    expect((await library.progressDays([session])).data).toEqual({ [session]: [] })

    await library.updateProgress(entry.id, { page: 30 }, undefined, today)
    await library.updateProgress(entry.id, { page: 55 }, undefined, today)

    const { data, error } = await library.progressDays([session])
    expect(error).toBeNull()
    expect(data![session]).toEqual([{ day: today, start: null, end: { page: 55 } }])
  })

  it('has no day where the day ends where it began: an Undo takes it back', async () => {
    const { library, entry, session } = await reading('Undo', today)
    await library.updateProgress(entry.id, { page: 40 }, undefined, today)
    await library.updateProgress(entry.id, { page: 0 }, undefined, today)
    expect((await library.progressDays([session])).data![session]).toEqual([])
  })

  it('takes a read\'s first value, set long after it began, as where it already was', async () => {
    const { library, entry, session } = await reading('Begun before', addDays(today, -9))
    await library.updateProgress(entry.id, { page: 200 }, undefined, today)
    expect((await library.progressDays([session])).data![session]).toEqual([])
    await library.updateProgress(entry.id, { page: 224 }, undefined, today)
    expect((await library.progressDays([session])).data![session]).toEqual([{ day: today, start: { page: 200 }, end: { page: 224 } }])
  })

  it('refuses a day no time zone has now, and changes nothing', async () => {
    const { library, entry } = await reading('Far day', today)
    const { error } = await library.updateProgress(entry.id, { page: 10 }, undefined, addDays(today, 3))
    expect(error).toBe('date_invalid')
    const listed = (await library.entries('reading')).data!.find((e) => e.id === entry.id)
    expect(listed!.latestSession!.progressPage).toBeNull()
  })

  it('answers only for the member\'s own reads', async () => {
    const ida = await reading('Hers', today)
    await ida.library.updateProgress(ida.entry.id, { page: 12 }, undefined, today)
    const max = await reading('His', today)
    expect((await max.library.progressDays([ida.session])).data).toEqual({ [ida.session]: [] })
  })
})

const day = (ago: number, start: number | null, end: number, kind: 'page' | 'percent' = 'page'): ProgressDay => ({
  day: addDays(today, -ago),
  start: start === null ? null : kind === 'page' ? { page: start } : { percent: start },
  end: kind === 'page' ? { page: end } : { percent: end },
})

describe('progress by day, worked out', () => {
  // East of Eden, 608 pages: read on most of the last twelve days up to page 212.
  const eden = [day(11, null, 14), day(10, 14, 36), day(9, 36, 66), day(8, 66, 78), day(6, 78, 118), day(5, 118, 144), day(4, 144, 162), day(2, 162, 188), day(1, 188, 212)]

  it('measures a day in the read\'s unit, converting a value of the other kind through the page count', () => {
    expect(amountOf(day(0, 188, 212), 608)).toBe(24)
    expect(amountOf(day(0, null, 30), 608)).toBe(30)
    expect(amountOf({ day: today, start: { percent: 50 }, end: { page: 320 } }, 600)).toBe(20)
    expect(amountOf(day(0, 40, 52, 'percent'), null)).toBe(12)
    // A page with nothing to convert through cannot be told.
    expect(amountOf({ day: today, start: { page: 10 }, end: { percent: 20 } }, null)).toBe(0)
    expect(valueIn(null, 'page', 608)).toBe(0)
    expect(valueIn({ page: 304 }, 'percent', 608)).toBe(50)
  })

  it('draws the last days oldest first, today last, a day without reading as 0 and never below', () => {
    const fortnight = dailyAmounts([...eden, day(0, 212, 200)], today, 14, 608)
    expect(fortnight).toHaveLength(14)
    expect(fortnight.at(-1)).toEqual({ day: today, amount: 0 })
    expect(fortnight.at(-2)).toEqual({ day: addDays(today, -1), amount: 24 })
    expect(fortnight.at(-4)).toEqual({ day: addDays(today, -3), amount: 0 })
    expect(fortnight[0]).toEqual({ day: addDays(today, -13), amount: 0 })
    expect(fortnight.reduce((sum, d) => sum + d.amount, 0)).toBe(212)
  })

  it('works out the pace over two weeks from the first day read, and the days to go', () => {
    // 212 pages over the 12 days from the first one to today.
    expect(paceOf(eden, today, 608)).toBe(18)
    expect(daysLeftOf(18, 212, 608)).toBe(22)
    expect(daysLeftOf(18, 608, 608)).toBe(0)
    expect(daysLeftOf(null, 212, 608)).toBeNull()
    // One day of reading is not a pace yet; days older than two weeks are not counted.
    expect(paceOf([day(1, 188, 212)], today, 608)).toBeNull()
    expect(paceOf([day(20, null, 100), day(1, 100, 124), day(0, 124, 140)], today, 608)).toBe(20)
    expect(paceOf([day(3, 20, 30, 'percent'), day(0, 30, 44, 'percent')], today, null)).toBe(6)
  })

  it('says what she read last time: the latest day before today that read something', () => {
    expect(lastTimeOf(eden, today, 608)).toEqual({ day: addDays(today, -1), amount: 24 })
    expect(lastTimeOf([...eden, day(0, 212, 236)], today, 608)).toEqual({ day: addDays(today, -1), amount: 24 })
    expect(lastTimeOf([day(0, null, 20)], today, 608)).toBeNull()
  })

  it('lists the reading log newest first, with where each day ended', () => {
    const log = readingLogOf([...eden, day(0, 212, 212)], 608)
    expect(log[0]).toEqual({ day: addDays(today, -1), amount: 24, end: 212 })
    expect(log.at(-1)).toEqual({ day: addDays(today, -11), amount: 14, end: 14 })
    expect(log).toHaveLength(9)
  })

  it('sums a finished read up: the days from start to end, both counted, and the book a day', () => {
    expect(readSummaryOf(addDays(today, -11), today, 608)).toEqual({ days: 12, perDay: 51, unit: 'page' })
    expect(readSummaryOf(today, today, 300)).toEqual({ days: 1, perDay: 300, unit: 'page' })
    expect(readSummaryOf(addDays(today, -9), today, null)).toEqual({ days: 10, perDay: 10, unit: 'percent' })
  })
})
