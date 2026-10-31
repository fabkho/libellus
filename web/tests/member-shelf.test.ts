import { describe, expect, it } from 'vitest'
import type { Book } from '../app/data/books'
import { validateLibraryFile } from '../app/data/export/regalLibraryFile'
import type { LibraryEntry, ReadingSession } from '../app/data/library'
import { MEMBER_SHELF_GENERATOR, memberShelfDocument } from '../app/data/memberShelf'
import { booksReadIn, shelfOf } from '../app/data/shelf'
import { bookColour } from '../app/utils/bookColour'

/**
 * Your shelf for everyone: a member's own Library as Regal's library document,
 * built on the device (data/memberShelf.ts), with each Book's one colour.
 * Synthetic Books only.
 */

let counter = 0
function book(over: Partial<Book> = {}): Book {
  counter++
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    createdAt: '2026-01-01T00:00:00Z',
    title: `Book ${counter}`,
    authors: ['A. Writer'],
    isbn13: null,
    isbn10: null,
    pageCount: 320,
    year: 2020,
    language: 'en',
    publisher: null,
    description: null,
    coverUrl: `https://is1-ssl.mzstatic.com/image/thumb/Publication/v4/aa/bb/${counter}.jpg/600x900bb.jpg`,
    coverThumbhash: null,
    coverColors: { dominant: '#1f3f5b', secondary: '#d9c9a3' },
    source: 'apple',
    appleId: String(counter),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
    format: null,
    ...over,
  }
}

function session(over: Partial<ReadingSession> = {}): ReadingSession {
  return {
    id: `s-${counter}`,
    startedOn: '2026-02-01',
    endedOn: '2026-02-20',
    outcome: 'finished',
    rating: 16,
    review: null,
    abandonReason: null,
    progressPage: null,
    progressPercent: null,
    progressUpdatedAt: null,
    createdAt: '2026-02-01T08:00:00Z',
    ...over,
  }
}

function entry(status: LibraryEntry['status'], over: Partial<LibraryEntry> = {}, sessionOver: Partial<ReadingSession> | null = {}): LibraryEntry {
  const b = over.book ?? book()
  return {
    id: `e-${b.id}`,
    status,
    addedAt: '2026-01-15T22:30:00Z',
    book: b,
    pageCountOverride: null,
    latestSession: sessionOver ? session(sessionOver) : null,
    ...over,
  }
}

const OPTIONS = { timeZone: 'Europe/Berlin', generatedAt: '2026-10-11T08:00:00Z' }

describe('memberShelfDocument', () => {
  it('is a valid Regal library file, made on the device', () => {
    const file = memberShelfDocument([entry('finished'), entry('reading', {}, { endedOn: null, outcome: null, rating: null })], OPTIONS)
    expect(validateLibraryFile(file).ok).toBe(true)
    expect(file.generator).toBe(MEMBER_SHELF_GENERATOR)
    expect(file.owner).toBeUndefined()
  })

  it('shows what she has read and is reading, not Want to read or a read given up', () => {
    const read = entry('finished')
    const reading = entry('reading', {}, { endedOn: null, outcome: null, rating: null })
    const wanted = entry('want_to_read', {}, null)
    const gaveUp = entry('finished', {}, { outcome: 'abandoned', rating: null })
    const file = memberShelfDocument([read, reading, wanted, gaveUp], OPTIONS)
    expect(file.books.map((b) => b.id).sort()).toEqual([read.book.id, reading.book.id].sort())
    expect(file.books.find((b) => b.id === read.book.id)!.status).toBe('read')
    expect(file.books.find((b) => b.id === reading.book.id)!.status).toBe('currently-reading')
  })

  it('gives every Book its one colour from the cover, inside the guard rails', () => {
    const neon = entry('finished', { book: book({ coverColors: { dominant: '#39ff14', secondary: '#000000' } }) })
    const navy = entry('finished')
    const noCover = entry('finished', { book: book({ title: 'Typed in by hand', coverUrl: null, coverColors: null, source: 'manual' as Book['source'] }) })
    const file = memberShelfDocument([neon, navy, noCover], OPTIONS)
    const colourOf = (e: LibraryEntry) => file.books.find((b) => b.id === e.book.id)!.assets!.color
    expect(colourOf(navy)).toBe('#1f3f5b')
    expect(colourOf(neon)).toBe(bookColour(neon.book).colour)
    expect(colourOf(neon)).not.toBe('#39ff14')
    expect(colourOf(noCover)).toBe(bookColour(noCover.book).colour)
    expect(bookColour(noCover.book).source).toBe('cloth')
  })

  it('has the cover as the front and a small copy for the pile, nothing else to load', () => {
    const e = entry('finished')
    const assets = memberShelfDocument([e], OPTIONS).books[0]!.assets!
    expect(assets.front).toMatch(/600x900bb\.jpg$/)
    expect(assets.pile?.front).toMatch(/240x360bb\.jpg$/)
    expect(assets.spine).toBeUndefined()
    expect(assets.back).toBeUndefined()
    // A Book without a cover: no front at all (Regal draws one in its colour).
    const bare = memberShelfDocument([entry('finished', { book: book({ coverUrl: null }) })], OPTIONS).books[0]!.assets!
    expect(bare.front).toBeUndefined()
    expect(bare.pile).toBeUndefined()
    expect(bare.color).toMatch(/^#[\da-f]{6}$/)
  })

  // docs/plans/owned-covers.md §5: the shelf's own covers come through `coverImage` like every screen's, and with the switch
  // off the front and the pile are the source's addresses they always were (the tests above hold for both).
  it('draws our stored copy when the Book has one and the switch is on', () => {
    const key = 'c0ffeec0ffeec0ffeec0ffeec0ffeec0'
    const e = entry('finished', { book: book({ coverKey: key, coverWidths: [120, 240, 360, 600] }) })
    const withCopy = memberShelfDocument([e], { ...OPTIONS, covers: { own: true } }).books[0]!.assets!
    expect(withCopy.front).toBe(`/c/${key}/600`)
    expect(withCopy.pile?.front).toBe(`/c/${key}/240`)
    // The hosts the shelf screens pass say the source (only the Library's row and the reel go through `/cover`).
    const off = memberShelfDocument([e], { ...OPTIONS, covers: { own: false, proxy: false } }).books[0]!.assets!
    expect(off.front).toMatch(/600x900bb\.jpg$/)
  })

  it('makes our stored copies absolute against the page origin, and leaves source addresses alone', () => {
    const key = 'c0ffeec0ffeec0ffeec0ffeec0ffeec0'
    const origin = 'https://app.example.com'
    const e = entry('finished', { book: book({ coverKey: key, coverWidths: [120, 240, 360, 600] }) })
    const on = memberShelfDocument([e], { ...OPTIONS, origin, covers: { own: true } }).books[0]!.assets!
    expect(on.front).toBe(`${origin}/c/${key}/600`)
    expect(on.pile?.front).toBe(`${origin}/c/${key}/240`)
    const off = memberShelfDocument([e], { ...OPTIONS, origin, covers: { own: false, proxy: false } }).books[0]!.assets!
    expect(off.front).toMatch(/^https?:\/\/.*600x900bb\.jpg$/)
    expect(off.front).not.toContain(origin)
  })

  it('takes the date read, Rating, pages and binding from her entry', () => {
    const e = entry('finished', { pageCountOverride: 410, formatOverride: 'hardcover' }, { endedOn: '2025-11-03', rating: 15 })
    const b = memberShelfDocument([e], OPTIONS).books[0]!
    expect(b.dateRead).toBe('2025-11-03')
    expect(b.rating).toBe(3.75)
    expect(b.pages).toBe(410)
    expect(b.binding).toBe('Hardcover')
    // Added at 22:30 UTC on the 15th: 23:30 in Berlin, still the 15th there.
    expect(b.dateAdded).toBe('2026-01-15')
  })

  it('adds the blurb the device keeps, when the list has none', () => {
    const e = entry('finished')
    const file = memberShelfDocument([e], { ...OPTIONS, descriptionOf: (b) => (b.id === e.book.id ? 'A quiet blurb.' : null) })
    expect(file.books[0]!.description).toBe('A quiet blurb.')
  })

  it('gives the app its shelf: count, colours for the pile, a year', () => {
    const a = entry('finished', {}, { endedOn: '2025-03-01' })
    const b = entry('finished', {}, { endedOn: '2026-05-01' })
    const shelf = shelfOf(memberShelfDocument([a, b], OPTIONS))
    expect(shelf.books.map((x) => x.id)).toEqual([b.book.id, a.book.id])
    expect(shelf.books[0]!.spine).toBe('#1f3f5b')
    expect(booksReadIn(shelf.books, 2025).map((x) => x.id)).toEqual([a.book.id])
  })

  it('builds a 1,000-Book shelf quickly', () => {
    const entries = Array.from({ length: 1000 }, (_, i) => entry('finished', {}, { endedOn: `20${String(10 + (i % 16)).padStart(2, '0')}-0${(i % 9) + 1}-1${i % 9}` }))
    const started = performance.now()
    const file = memberShelfDocument(entries, OPTIONS)
    const took = performance.now() - started
    expect(file.books).toHaveLength(1000)
    expect(validateLibraryFile(file).ok).toBe(true)
    // A generous ceiling for a slow CI machine; on a laptop it is a few milliseconds.
    expect(took).toBeLessThan(400)
  })
})
