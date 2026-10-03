import { describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import { createLibrary, type LibraryEntry } from '@/data/library'
import {
  convertProgressField,
  parseProgress,
  progressFraction,
  progressModeFor,
  progressOf,
  progressPercentOf,
  progressReachedEnd,
} from '@/data/progress'
import { addDays, isoDay } from '@/utils/dates'
import { signUpMember } from './support/member'
import { runTitle, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * Reading progress (issue #39) through the repository, against the local
 * stack, as real signed-in members: a page or a percent on the open read, the
 * latest value only, the database's refusals as codes, finishing keeps the
 * value on the closed read, Read again starts with none. The pure helpers the
 * sheet and the cards use are checked without the stack.
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

async function reading(title: string, pageCount: number | null = 480) {
  const member = await signUpMember()
  const library = createLibrary(member.client)
  const added = await library.addToLibrary(book(title, pageCount), { status: 'reading', startedOn: addDays(today, -3) })
  return { member, library, entry: added.data as LibraryEntry }
}

describe('updateProgress', () => {
  it('starts with none, then keeps the page on the open read', async () => {
    const { library, entry } = await reading('Piranesi')
    expect(entry.latestSession).toMatchObject({ progressPage: null, progressPercent: null, progressUpdatedAt: null })

    const { data, error } = await library.updateProgress(entry.id, { page: 212 })

    expect(error).toBeNull()
    expect(data).toMatchObject({
      id: entry.id,
      status: 'reading',
      latestSession: { outcome: null, progressPage: 212, progressPercent: null },
    })
    expect(data!.latestSession!.progressUpdatedAt).toEqual(expect.any(String))
    // What a list loads is the same.
    const listed = (await library.entries('reading')).data!.find((e) => e.id === entry.id)
    expect(listed!.latestSession).toMatchObject({ progressPage: 212 })
  })

  it('keeps only the latest value: a new page replaces it, a percent replaces a page', async () => {
    const { library, entry } = await reading('Jonathan Strange')
    await library.updateProgress(entry.id, { page: 120 })
    await library.updateProgress(entry.id, { page: 40 })
    expect(progressOf((await library.entry(entry.id)).data!.latestSession)).toEqual({ page: 40 })

    const { data } = await library.updateProgress(entry.id, { percent: 45 })

    expect(progressOf(data!.latestSession)).toEqual({ percent: 45 })
    expect(data!.latestSession).toMatchObject({ progressPage: null, progressPercent: 45 })
    expect((await library.sessions(entry.id)).data).toHaveLength(1)
  })

  it('takes the last page and page 0, and a percentage on a Book without a page count', async () => {
    const { library, entry } = await reading('Last page')
    expect((await library.updateProgress(entry.id, { page: 480 })).data!.latestSession).toMatchObject({ progressPage: 480 })
    expect((await library.updateProgress(entry.id, { page: 0 })).data!.latestSession).toMatchObject({ progressPage: 0 })

    const bare = await reading('No page count', null)
    const { data } = await bare.library.updateProgress(bare.entry.id, { percent: 30 })
    expect(data!.latestSession).toMatchObject({ progressPercent: 30, progressPage: null })
  })

  it('refuses a page past the page count, a percent over 100 and negative numbers', async () => {
    const { library, entry } = await reading('Out of range')
    await library.updateProgress(entry.id, { page: 100 })

    expect((await library.updateProgress(entry.id, { page: 481 })).error).toBe('progress_invalid')
    expect((await library.updateProgress(entry.id, { page: -1 })).error).toBe('progress_invalid')
    expect((await library.updateProgress(entry.id, { percent: 101 })).error).toBe('progress_invalid')
    expect((await library.updateProgress(entry.id, { percent: -1 })).error).toBe('progress_invalid')
    // Nothing of that reached the read.
    expect(progressOf((await library.entry(entry.id)).data!.latestSession)).toEqual({ page: 100 })
  })

  it('is refused without an open read', async () => {
    const member = await signUpMember()
    const library = createLibrary(member.client)
    const want = (await library.addToLibrary(book('Not started'))).data!
    const done = (await library.addToLibrary(book('Done'), { status: 'finished', endedOn: today })).data!

    expect((await library.updateProgress(want.id, { page: 10 })).error).toBe('not_reading')
    expect((await library.updateProgress(done.id, { page: 10 })).error).toBe('not_reading')
  })

  it('does not find another member\'s entry', async () => {
    const mine = await reading('Mine')
    const other = await signUpMember()
    const { error } = await createLibrary(other.client).updateProgress(mine.entry.id, { page: 10 })
    expect(error).toBe('entry_not_found')
    expect((await mine.library.entry(mine.entry.id)).data!.latestSession).toMatchObject({ progressPage: null })
  })

  it('is refused offline before anything is sent', async () => {
    const { member, entry } = await reading('Offline')
    const offline = createLibrary(member.client, { online: () => false })
    expect(await offline.updateProgress(entry.id, { page: 10 })).toEqual({ data: null, error: 'offline' })
    const online = createLibrary(member.client)
    expect((await online.entry(entry.id)).data!.latestSession).toMatchObject({ progressPage: null })
  })

  it('stays on the closed read when it is finished or abandoned, and Read again starts with none', async () => {
    const { library, entry } = await reading('Kept')
    await library.updateProgress(entry.id, { page: 300 })

    const finished = await library.finish(entry.id, { endedOn: today })
    expect(finished.data!.latestSession).toMatchObject({ outcome: 'finished', progressPage: 300 })
    expect((await library.updateProgress(entry.id, { page: 310 })).error).toBe('not_reading')

    const again = await library.readAgain(entry.id, today)
    expect(again.data!.latestSession).toMatchObject({ outcome: null, progressPage: null, progressPercent: null, progressUpdatedAt: null })

    await library.updateProgress(entry.id, { percent: 60 })
    const abandoned = await library.abandon(entry.id, { endedOn: today })
    expect(abandoned.data!.latestSession).toMatchObject({ outcome: 'abandoned', progressPercent: 60 })
    // The earlier read kept its own value.
    const sessions = (await library.sessions(entry.id)).data!
    expect(sessions.map((s) => s.progressPage ?? s.progressPercent)).toEqual([60, 300])
  })
})

describe('progress helpers', () => {
  it('reads a session as a page, a percent or none', () => {
    const none = { progressPage: null, progressPercent: null }
    expect(progressOf(null)).toBeNull()
    expect(progressOf(none as never)).toBeNull()
    expect(progressOf({ progressPage: 0, progressPercent: null } as never)).toEqual({ page: 0 })
    expect(progressOf({ progressPage: null, progressPercent: 45 } as never)).toEqual({ percent: 45 })
    // A cached session from before progress existed has neither field.
    expect(progressOf({} as never)).toBeNull()
  })

  it('draws the bar from the page against the page count, or the percent', () => {
    expect(progressFraction({ page: 120 }, 480)).toBe(0.25)
    expect(progressFraction({ page: 120 }, null)).toBe(0)
    expect(progressFraction({ percent: 45 }, null)).toBe(0.45)
    expect(progressFraction(null, 480)).toBe(0)
    expect(progressFraction({ page: 600 }, 480)).toBe(1)
    expect(progressPercentOf({ page: 212 }, 480)).toBe(44)
    expect(progressPercentOf({ page: 212 }, null)).toBeNull()
    expect(progressPercentOf({ percent: 45 }, 480)).toBe(45)
  })

  it('knows the end: the last page, or 100 %', () => {
    expect(progressReachedEnd({ page: 480 }, 480)).toBe(true)
    expect(progressReachedEnd({ page: 479 }, 480)).toBe(false)
    expect(progressReachedEnd({ page: 480 }, null)).toBe(false)
    expect(progressReachedEnd({ percent: 100 }, null)).toBe(true)
    expect(progressReachedEnd({ percent: 99 }, 480)).toBe(false)
    expect(progressReachedEnd(null, 480)).toBe(false)
  })

  it('starts the sheet in pages when the Book has a page count, unless a percent is set', () => {
    expect(progressModeFor({ pageCount: 480 }, null)).toBe('page')
    expect(progressModeFor({ pageCount: 480 }, { page: 5 })).toBe('page')
    expect(progressModeFor({ pageCount: 480 }, { percent: 5 })).toBe('percent')
    expect(progressModeFor({ pageCount: null }, null)).toBe('percent')
  })

  it('checks what was typed: whole digits within the limit of the mode', () => {
    expect(parseProgress(' 120 ', 'page', 480)).toEqual({ value: { page: 120 }, error: null })
    expect(parseProgress('0', 'page', 480)).toEqual({ value: { page: 0 }, error: null })
    expect(parseProgress('480', 'page', 480)).toEqual({ value: { page: 480 }, error: null })
    expect(parseProgress('481', 'page', 480).error).toBe('progress_invalid')
    expect(parseProgress('45', 'percent', 480)).toEqual({ value: { percent: 45 }, error: null })
    expect(parseProgress('101', 'percent', 480).error).toBe('progress_invalid')
    for (const typed of ['', 'abc', '-3', '4.5', '1e3', '12 3']) {
      expect(parseProgress(typed, 'page', 480).error).toBe('progress_invalid')
    }
  })

  it('carries the place over when the mode is switched', () => {
    expect(convertProgressField('240', 'percent', 480)).toBe('50')
    expect(convertProgressField('50', 'page', 480)).toBe('240')
    expect(convertProgressField('', 'percent', 480)).toBe('')
    expect(convertProgressField('50', 'page', null)).toBe('')
  })
})
