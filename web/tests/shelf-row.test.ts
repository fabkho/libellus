import { describe, expect, it } from 'vitest'
import { shelfProgressOf, shelfRowOf, shelfStatusOf } from '@/composables/useShelfRow'
import type { LibraryEntry, ReadingSession } from '@/data/library'
import type { ProgressWords } from '@/composables/useShelfRow'

/**
 * What a shelf row says of an entry (composables/useShelfRow.ts): its Status (utils/bookStatus.ts) and its progress
 * (`useProgressText`'s wording, `progressPercentOf`'s percent). The non-DOM part only: the cover is `coverImage`'s,
 * already pinned in tests/cover-ref.test.ts, and the title and the author are `formatAuthors`'.
 *
 * The words here stand in for the message file the way `useProgressText` words them (i18n/locales/en.json,
 * `book.progress.*`), so what is asserted is which progress and which page count are handed to the words — a stack-free
 * test, there being no component to mount.
 */
const words: ProgressWords = (progress, pageCount) => {
  if (!progress) return { value: 'Not started yet', percent: null }
  if ('percent' in progress) return { value: `${progress.percent} %`, percent: progress.percent }
  return { value: pageCount ? `p. ${progress.page} of ${pageCount}` : `p. ${progress.page}`, percent: pageCount ? Math.round((progress.page / pageCount) * 100) : null }
}

let next = 0
function session(fields: Partial<ReadingSession> = {}): ReadingSession {
  return {
    id: `s${next++}`,
    startedOn: '2026-02-01',
    endedOn: null,
    outcome: null,
    rating: null,
    review: null,
    reviewSpoilers: false,
    abandonReason: null,
    progressPage: null,
    progressPercent: null,
    progressUpdatedAt: null,
    createdAt: '2026-02-01T00:00:00Z',
    ...fields,
  }
}

function book(fields: Partial<LibraryEntry['book']> = {}): LibraryEntry['book'] {
  return { id: 'b1', title: 'The Dispossessed', authors: ['Ursula K. Le Guin'], pageCount: 387, ...fields } as unknown as LibraryEntry['book']
}

function entry(fields: Partial<LibraryEntry> = {}, bookFields: Partial<LibraryEntry['book']> = {}): LibraryEntry {
  return {
    id: `e${next++}`,
    status: 'reading',
    addedAt: '2026-02-01T00:00:00Z',
    book: book(bookFields),
    pageCountOverride: null,
    latestSession: null,
    ...fields,
  }
}

describe('a read counted in pages', () => {
  const shelf = entry({ latestSession: session({ progressPage: 212 }) })

  it('says where it is against the edition\'s page count, and the percent a bar draws', () => {
    expect(shelfProgressOf(shelf, words)).toEqual({ value: 'p. 212 of 387', percent: 55 })
    expect(shelfStatusOf(shelf)).toEqual({ state: 'reading', labelKey: 'status.reading', order: 1 })
  })

  it('counts against her own total when she set one for her copy (pageCountOf, issue #60)', () => {
    expect(shelfProgressOf({ ...shelf, pageCountOverride: 400 }, words)).toEqual({ value: 'p. 212 of 400', percent: 53 })
  })

  it('has no total to count against when the Book has no page count: a page and no percent', () => {
    const bare = entry({ latestSession: session({ progressPage: 212 }) }, { pageCount: null })
    expect(shelfProgressOf(bare, words)).toEqual({ value: 'p. 212', percent: null })
  })
})

describe('a read counted in percent', () => {
  it('says the percent, and is its own percent for the bar', () => {
    const shelf = entry({ latestSession: session({ progressPercent: 45 }) })
    expect(shelfProgressOf(shelf, words)).toEqual({ value: '45 %', percent: 45 })
  })
})

describe('a catalogue-only Book', () => {
  it('has no shelf state and no progress at all: no Status, the words for a read not started', () => {
    expect(shelfStatusOf(null)).toBeNull()
    expect(shelfStatusOf(undefined)).toBeNull()
    expect(shelfProgressOf(null, words)).toEqual({ value: 'Not started yet', percent: null })
  })

  it('is not read out of the Book it shows, whatever the Book carries', () => {
    // The row is handed the Book and no entry (a search result): nothing here invents a shelf state for it.
    expect(shelfStatusOf(null)).toBeNull()
    expect(shelfProgressOf(undefined, words).percent).toBeNull()
  })
})

describe('a finished entry', () => {
  it('says Finished, and its last read\'s place stays what it was', () => {
    const shelf = entry({ status: 'finished', latestSession: session({ endedOn: '2026-02-03', outcome: 'finished', progressPage: 387 }) })
    expect(shelfStatusOf(shelf)).toEqual({ state: 'finished', labelKey: 'status.finished', order: 2 })
    expect(shelfProgressOf(shelf, words)).toEqual({ value: 'p. 387 of 387', percent: 100 })
  })

  it('says Not finished for a read that was given up, which is not a Status of its own', () => {
    const shelf = entry({ status: 'finished', latestSession: session({ endedOn: '2026-02-03', outcome: 'abandoned', progressPage: 90 }) })
    expect(shelfStatusOf(shelf)).toEqual({ state: 'notFinished', labelKey: 'status.notFinished', order: 3 })
  })
})

describe('the row of a Book with no entry (a search result)', () => {
  it('takes the Book\'s own title and author, its cover from `coverImage`, and no shelf state', () => {
    const shown = shelfRowOf({ title: 'Piranesi', authors: ['Susanna Clarke', 'Another', 'A Third'], coverUrl: null }, null, 'sm', {}, { progress: words, etAl: () => 'et al.' })
    expect(shown.title).toBe('Piranesi')
    expect(shown.author).toBe('Susanna Clarke et al.')
    expect(shown.status).toBeNull()
    expect(shown.progress).toEqual({ value: 'Not started yet', percent: null })
    // No cover address of that Book: the row hands on what `coverImage` says, which is no image.
    expect(shown.cover.src).toBeNull()
    expect(shown.cover.sizes).not.toBe('')
  })

  it('says nothing rather than guessing when it is handed no Book at all', () => {
    const empty = shelfRowOf(null, null, 'sm', {}, { progress: words, etAl: () => 'et al.' })
    expect([empty.title, empty.author, empty.status]).toEqual(['', '', null])
  })
})
