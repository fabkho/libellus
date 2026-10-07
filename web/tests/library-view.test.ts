import { describe, expect, it } from 'vitest'
import type { LibraryEntry, ReadingSession } from '@/data/library'
import {
  activeFilters,
  arrange,
  authorOptions,
  defaultSort,
  LIBRARY_VIEW_KEY,
  listViewFromJson,
  newListView,
  readAsOptions,
  statusOptions,
  readLibraryViews,
  saveLibraryViews,
  sortLibrary,
  withoutFilter,
  withoutFilters,
  yearOptions,
  type ListView,
} from '@/data/libraryView'
import { readAsFromFormat, readAsOf } from '@/data/readAs'

/**
 * Filters and sort of the Library (issue #169) on plain entries: no database, the lists are loaded
 * already. The rules are the client's, a native port copies them 1:1.
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
    abandonReason: null,
    progressPage: null,
    progressPercent: null,
    progressUpdatedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...fields,
  }
}

function entry(title: string, fields: Partial<LibraryEntry> & { authors?: string[]; pages?: number | null; format?: string | null } = {}): LibraryEntry {
  const { authors = ['Ursula K. Le Guin'], pages = 300, format, ...rest } = fields
  return {
    id: `e-${title}`,
    status: 'finished',
    addedAt: '2026-01-01T00:00:00Z',
    pageCountOverride: null,
    readAs: null,
    latestSession: null,
    book: { id: `b-${title}`, title, authors, pageCount: pages, format } as unknown as LibraryEntry['book'],
    ...rest,
  }
}

const finished = (end: string, rating: number | null = null, outcome: 'finished' | 'abandoned' = 'finished') =>
  session({ startedOn: end, endedOn: end, outcome, rating })

const titles = (entries: readonly LibraryEntry[]) => entries.map((e) => e.book.title)

// A Finished list in the order the database returns it: newest end date first.
const shelf = [
  entry('Dune', { authors: ['Frank Herbert'], pages: 612, readAs: 'physical', latestSession: finished('2026-05-02', 20) }),
  entry('Emma', { authors: ['Jane Austen'], pages: 474, readAs: 'ebook', latestSession: finished('2026-02-10', 12) }),
  entry('Hyperion', { authors: ['Dan Simmons'], pages: 482, readAs: 'audiobook', latestSession: finished('2025-11-20', null) }),
  entry('Piranesi', { authors: ['Susanna Clarke'], pages: 272, latestSession: finished('2025-03-03', 16) }),
  entry('Earthsea', { authors: ['Ursula K. Le Guin'], pages: null, readAs: 'physical', latestSession: session({ outcome: 'finished', rating: 8 }) }),
]

describe('Read as', () => {
  it('is the member\'s own word, else what the edition\'s format implies, else nothing', () => {
    expect(readAsOf(entry('a', { readAs: 'ebook', format: 'hardcover' }))).toBe('ebook')
    expect(readAsOf(entry('a', { format: 'paperback' }))).toBe('physical')
    expect(readAsOf(entry('a', { format: 'hardcover' }))).toBe('physical')
    expect(readAsOf(entry('a', { format: 'ebook' }))).toBe('ebook')
    expect(readAsOf(entry('a', { format: 'audiobook' }))).toBe('audiobook')
    expect(readAsOf(entry('a', { format: null }))).toBeNull()
    expect(readAsOf(entry('a'))).toBeNull()
  })

  it('goes with the format she corrected (PR #165) before the source\'s', () => {
    const corrected = { ...entry('a', { format: 'ebook' }), formatOverride: 'paperback' }
    expect(readAsOf(corrected)).toBe('physical')
    expect(readAsFromFormat('CD-ROM')).toBeNull()
  })
})

describe('filters', () => {
  const view = (changes: Partial<ListView>): ListView => ({ ...newListView('finished'), ...changes })

  it('leaves the list alone without any filter and in the list\'s own order', () => {
    expect(arrange(shelf, 'finished', newListView('finished'))).toBe(shelf)
  })

  it('filters by Read as, the edition\'s format counting where she has not said, and "not set"', () => {
    expect(titles(arrange(shelf, 'finished', view({ readAs: ['physical'] })))).toEqual(['Dune', 'Earthsea'])
    expect(titles(arrange(shelf, 'finished', view({ readAs: ['ebook', 'audiobook'] })))).toEqual(['Emma', 'Hyperion'])
    expect(titles(arrange(shelf, 'finished', view({ readAs: ['unset'] })))).toEqual(['Piranesi'])
    const byFormat = [entry('Kindle', { format: 'ebook' }), entry('Bare')]
    expect(titles(arrange(byFormat, 'finished', view({ readAs: ['ebook'] })))).toEqual(['Kindle'])
    expect(titles(arrange(byFormat, 'finished', view({ readAs: ['unset'] })))).toEqual(['Bare'])
  })

  it('filters by author, any author of the Book', () => {
    const books = [...shelf, entry('Good Omens', { authors: ['Terry Pratchett', 'Neil Gaiman'] })]
    expect(titles(arrange(books, 'finished', view({ authors: ['Neil Gaiman'] })))).toEqual(['Good Omens'])
    expect(titles(arrange(books, 'finished', view({ authors: ['Jane Austen', 'Frank Herbert'] })))).toEqual(['Dune', 'Emma'])
  })

  it('filters by rating: at least n stars, or not rated', () => {
    expect(titles(arrange(shelf, 'finished', view({ rating: 16 })))).toEqual(['Dune', 'Piranesi'])
    expect(titles(arrange(shelf, 'finished', view({ rating: 12 })))).toEqual(['Dune', 'Emma', 'Piranesi'])
    expect(titles(arrange(shelf, 'finished', view({ rating: 'unrated' })))).toEqual(['Hyperion'])
  })

  it('filters by the year the read ended in, undated reads under the empty year', () => {
    expect(titles(arrange(shelf, 'finished', view({ years: ['2026'] })))).toEqual(['Dune', 'Emma'])
    expect(titles(arrange(shelf, 'finished', view({ years: ['2025', ''] })))).toEqual(['Hyperion', 'Piranesi', 'Earthsea'])
  })

  it('filters by page range with the member\'s own total counting; a book with no count never passes', () => {
    expect(titles(arrange(shelf, 'finished', view({ pages: { min: 400, max: null } })))).toEqual(['Dune', 'Emma', 'Hyperion'])
    expect(titles(arrange(shelf, 'finished', view({ pages: { min: null, max: 300 } })))).toEqual(['Piranesi'])
    expect(titles(arrange(shelf, 'finished', view({ pages: { min: 470, max: 490 } })))).toEqual(['Emma', 'Hyperion'])
    const own = [{ ...entry('Ebook', { pages: 200 }), pageCountOverride: 520 }]
    expect(titles(arrange(own, 'finished', view({ pages: { min: 500, max: null } })))).toEqual(['Ebook'])
  })

  it('filters Finished by how the latest read ended: finished, or given up (Not finished)', () => {
    const mixed = [...shelf, entry('Ruin', { latestSession: finished('2026-01-04', null, 'abandoned') })]
    expect(titles(arrange(mixed, 'finished', view({ status: 'notFinished' })))).toEqual(['Ruin'])
    expect(titles(arrange(mixed, 'finished', view({ status: 'finished' })))).toEqual(titles(shelf))
    expect(titles(arrange(mixed, 'finished', view({ status: 'notFinished', pages: { min: 900, max: null } })))).toEqual([])
    expect(statusOptions(mixed)).toEqual([{ value: 'finished', count: 5 }, { value: 'notFinished', count: 1 }])
    expect(statusOptions(shelf)).toEqual([{ value: 'finished', count: 5 }])
    expect(activeFilters('finished', view({ status: 'notFinished' }))).toEqual([{ facet: 'status', value: 'notFinished' }])
    expect(withoutFilter(view({ status: 'notFinished' }), { facet: 'status', value: 'notFinished' }).status).toBeNull()
    // Not a Status of the other lists.
    expect(activeFilters('reading', { ...newListView('reading'), status: 'notFinished' })).toEqual([])
  })

  it('combines filters: every one must pass, a facet with several values any of them', () => {
    const both = view({ readAs: ['physical'], rating: 16, pages: { min: 500, max: null } })
    expect(titles(arrange(shelf, 'finished', both))).toEqual(['Dune'])
  })

  it('ignores a filter that does not apply to the Status (rating, year read: Finished only)', () => {
    const want = shelf.map((e) => ({ ...e, status: 'want_to_read' as const }))
    expect(titles(arrange(want, 'want_to_read', { ...newListView('want_to_read'), rating: 20, years: ['1999'] }))).toHaveLength(5)
  })

  it('filters by genre only through a lookup (#168), and not at all without one', () => {
    const lookup = (id: string) => (id === 'b-Dune' ? ['sci-fi'] : id === 'b-Emma' ? ['classics'] : undefined)
    const sciFi = view({ genres: ['sci-fi'] })
    expect(titles(arrange(shelf, 'finished', sciFi, { genres: lookup }))).toEqual(['Dune'])
    expect(arrange(shelf, 'finished', sciFi)).toBe(shelf)
    expect(activeFilters('finished', sciFi)).toEqual([])
    expect(activeFilters('finished', sciFi, { genres: true })).toEqual([{ facet: 'genre', value: 'sci-fi' }])
  })

  it('lists the filters that are set as chips and takes them off one by one or all together', () => {
    const set = view({ readAs: ['physical', 'ebook'], authors: ['Jane Austen'], rating: 16, pages: { min: 100, max: 200 } })
    expect(activeFilters('finished', set)).toEqual([
      { facet: 'readAs', value: 'physical' },
      { facet: 'readAs', value: 'ebook' },
      { facet: 'author', value: 'Jane Austen' },
      { facet: 'rating', value: '16' },
      { facet: 'pages', value: 'range' },
    ])
    expect(withoutFilter(set, { facet: 'readAs', value: 'ebook' }).readAs).toEqual(['physical'])
    expect(withoutFilter(set, { facet: 'pages', value: 'range' }).pages).toEqual({ min: null, max: null })
    const sorted = { ...set, sort: { key: 'title' as const, dir: 'asc' as const } }
    expect(withoutFilters(sorted)).toEqual({ ...newListView('finished'), sort: sorted.sort })
    // Rating is a Finished facet only: Want to read does not list it.
    expect(activeFilters('want_to_read', set).map((f) => f.facet)).toEqual(['readAs', 'readAs', 'author', 'pages'])
  })

  it('offers what the list has: authors by count, years newest first, Read as in its own order', () => {
    expect(authorOptions(shelf).map((o) => o.value)).toEqual(['Dan Simmons', 'Frank Herbert', 'Jane Austen', 'Susanna Clarke', 'Ursula K. Le Guin'])
    expect(authorOptions([...shelf, entry('The Dispossessed')])[0]).toEqual({ value: 'Ursula K. Le Guin', count: 2 })
    expect(yearOptions(shelf).map((o) => o.value)).toEqual(['2026', '2025', ''])
    expect(readAsOptions(shelf).map((o) => o.value)).toEqual(['physical', 'ebook', 'audiobook', 'unset'])
  })
})

describe('sort', () => {
  it('leaves the list\'s own order for its own sort and sorts a Status only by what it offers', () => {
    expect(defaultSort('want_to_read')).toEqual({ key: 'dateAdded', dir: 'desc' })
    expect(defaultSort('finished')).toEqual({ key: 'dateRead', dir: 'desc' })
    // Rating means nothing on Want to read: its own order.
    expect(sortLibrary(shelf, 'want_to_read', { key: 'rating', dir: 'asc' })).toEqual([...shelf])
  })

  it('sorts by date read both ways, reads without a date last either way', () => {
    expect(titles(sortLibrary(shelf, 'finished', { key: 'dateRead', dir: 'asc' }))).toEqual(['Piranesi', 'Hyperion', 'Emma', 'Dune', 'Earthsea'])
    expect(titles(sortLibrary(shelf, 'finished', { key: 'dateRead', dir: 'desc' }))).toEqual(['Dune', 'Emma', 'Hyperion', 'Piranesi', 'Earthsea'])
  })

  it('sorts by the date a Currently reading book was started', () => {
    const reading = [
      entry('B', { status: 'reading', latestSession: session({ startedOn: '2026-06-01' }) }),
      entry('A', { status: 'reading', latestSession: session({ startedOn: '2026-07-01' }) }),
    ]
    expect(titles(sortLibrary(reading, 'reading', { key: 'dateRead', dir: 'desc' }))).toEqual(['A', 'B'])
    expect(titles(sortLibrary(reading, 'reading', { key: 'dateRead', dir: 'asc' }))).toEqual(['B', 'A'])
  })

  it('sorts by date added', () => {
    const books = [entry('Old', { addedAt: '2026-01-01T00:00:00Z' }), entry('New', { addedAt: '2026-03-01T00:00:00Z' })]
    expect(titles(sortLibrary(books, 'want_to_read', { key: 'dateAdded', dir: 'desc' }))).toEqual(['New', 'Old'])
    expect(titles(sortLibrary(books, 'want_to_read', { key: 'dateAdded', dir: 'asc' }))).toEqual(['Old', 'New'])
  })

  it('sorts by rating, unrated last either way', () => {
    expect(titles(sortLibrary(shelf, 'finished', { key: 'rating', dir: 'desc' }))).toEqual(['Dune', 'Piranesi', 'Emma', 'Earthsea', 'Hyperion'])
    expect(titles(sortLibrary(shelf, 'finished', { key: 'rating', dir: 'asc' }))).toEqual(['Earthsea', 'Emma', 'Piranesi', 'Dune', 'Hyperion'])
  })

  it('sorts by title, numbers by value and case ignored', () => {
    const books = [entry('book 10'), entry('Book 9'), entry('apple')]
    expect(titles(sortLibrary(books, 'finished', { key: 'title', dir: 'asc' }))).toEqual(['apple', 'Book 9', 'book 10'])
    expect(titles(sortLibrary(books, 'finished', { key: 'title', dir: 'desc' }))).toEqual(['book 10', 'Book 9', 'apple'])
  })

  it('sorts by the last word of the first author\'s name, then the whole name; a book without authors last', () => {
    const books = [
      entry('x', { authors: ['Ursula K. Le Guin'] }),
      entry('y', { authors: ['Jane Austen'] }),
      entry('z', { authors: [] }),
      entry('w', { authors: ['Frank Herbert'] }),
    ]
    expect(titles(sortLibrary(books, 'finished', { key: 'author', dir: 'asc' }))).toEqual(['y', 'x', 'w', 'z'])
    expect(titles(sortLibrary(books, 'finished', { key: 'author', dir: 'desc' }))).toEqual(['w', 'x', 'y', 'z'])
  })

  it('sorts by pages, the member\'s own total counting, no count last', () => {
    expect(titles(sortLibrary(shelf, 'finished', { key: 'pages', dir: 'asc' }))).toEqual(['Piranesi', 'Emma', 'Hyperion', 'Dune', 'Earthsea'])
    expect(titles(sortLibrary(shelf, 'finished', { key: 'pages', dir: 'desc' }))).toEqual(['Dune', 'Hyperion', 'Emma', 'Piranesi', 'Earthsea'])
  })

  it('is stable: ties keep the list\'s own order', () => {
    const same = [entry('b', { authors: ['A'] }), entry('a', { authors: ['A'] })]
    expect(titles(sortLibrary(same, 'finished', { key: 'author', dir: 'asc' }))).toEqual(['b', 'a'])
  })

  it('arranges filtered and sorted in one go', () => {
    const out = arrange(shelf, 'finished', { ...newListView('finished'), readAs: ['physical', 'ebook'], sort: { key: 'title', dir: 'asc' } })
    expect(titles(out)).toEqual(['Dune', 'Earthsea', 'Emma'])
  })
})

describe('what the device remembers', () => {
  const memory = () => {
    const store = new Map<string, string>()
    return { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), store }
  }

  it('gives the default for a member the device does not know', () => {
    const views = readLibraryViews(memory(), 'ida')
    expect(views.finished).toEqual(newListView('finished'))
    expect(views.want_to_read.sort).toEqual({ key: 'dateAdded', dir: 'desc' })
  })

  it('keeps each member\'s choice apart and gives it back as it was saved', () => {
    const storage = memory()
    const ida = readLibraryViews(storage, 'ida')
    ida.finished = { ...ida.finished, status: 'notFinished', readAs: ['audiobook', 'unset'], authors: ['Jane Austen'], rating: 16, years: ['2026', ''], pages: { min: 100, max: null }, sort: { key: 'rating', dir: 'desc' } }
    saveLibraryViews(storage, 'ida', ida)
    const max = readLibraryViews(storage, 'max')
    max.reading = { ...max.reading, sort: { key: 'title', dir: 'asc' } }
    saveLibraryViews(storage, 'max', max)

    expect(readLibraryViews(storage, 'ida').finished).toEqual(ida.finished)
    expect(readLibraryViews(storage, 'ida').reading).toEqual(newListView('reading'))
    expect(readLibraryViews(storage, 'max').reading.sort).toEqual({ key: 'title', dir: 'asc' })
    expect(readLibraryViews(storage, 'max').finished).toEqual(newListView('finished'))
  })

  it('reads damaged memory as the default and never throws', () => {
    const storage = memory()
    storage.store.set(LIBRARY_VIEW_KEY, '{nope')
    expect(readLibraryViews(storage, 'ida').finished).toEqual(newListView('finished'))
    storage.store.set(LIBRARY_VIEW_KEY, JSON.stringify({ ida: { finished: { sort: { key: 'bogus', dir: 'up' }, readAs: ['paper', 'ebook'], rating: 7, years: ['x', '2025'], pages: { min: -3, max: 'a' }, authors: 4 } } }))
    const view = readLibraryViews(storage, 'ida').finished
    expect(view).toEqual({ ...newListView('finished'), readAs: ['ebook'], years: ['2025'] })
    // A sort the Status does not offer (Rating on Want to read) is forgotten.
    expect(listViewFromJson('want_to_read', { sort: { key: 'rating', dir: 'asc' } }).sort).toEqual(defaultSort('want_to_read'))
  })

  it('drops the save when the storage refuses', () => {
    const refusing = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError') } }
    expect(() => saveLibraryViews(refusing, 'ida', readLibraryViews(refusing, 'ida'))).not.toThrow()
  })
})
