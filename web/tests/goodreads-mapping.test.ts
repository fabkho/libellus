import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  bookFromRow,
  countByStatus,
  goodreadsDay,
  goodreadsIsbn,
  goodreadsKey,
  isSameWork,
  NotAGoodreadsExportError,
  parseGoodreads,
  titleQuery,
  type GoodreadsBook,
} from '@/data/import/goodreads'

/**
 * The pure step of the Goodreads import (#40): a library export → books,
 * Statuses and sessions. The fixtures (tests/fixtures/goodreads) are synthetic
 * rows in the structure of real exports: a BOM, `="…"` ISBNs, quoted fields
 * with commas, quotes and line breaks, HTML reviews, series in titles, a
 * custom shelf, a duplicate and an empty row; `newer_export.csv` has no
 * Average Rating column and CRLF line ends, as newer exports do.
 */

const fixture = (name: string) => readFileSync(new URL(`./fixtures/goodreads/${name}`, import.meta.url), 'utf8')
const TODAY = '2026-10-03'

const parsed = parseGoodreads(fixture('library_export.csv'), TODAY)
const byKey = (key: string) => parsed.books.find((book) => book.key === key) as GoodreadsBook

describe('parseGoodreads', () => {
  it('reads every book of a Goodreads export, once', () => {
    expect(parsed.books.map((book) => book.key)).toEqual([
      'goodreads:1001',
      'goodreads:1002',
      'goodreads:1003',
      'goodreads:1004',
      'goodreads:1005',
      'goodreads:1006',
      'goodreads:1009',
    ])
    expect(parsed.skipped).toEqual([
      { row: 7, title: 'The Lantern Keeper', problem: { code: 'duplicate' } },
      { row: 8, title: '', problem: { code: 'noTitle' } },
    ])
  })

  it('counts the books per Status: read → Finished, currently-reading → Currently reading, everything else → Want to read', () => {
    expect(countByStatus(parsed.books)).toEqual({ finished: 3, reading: 1, want_to_read: 3 })
  })

  it('maps a read book to one finished read: the day it was read, no start, stars as quarters, the review as text', () => {
    expect(byKey('goodreads:1001')).toMatchObject({
      row: 1,
      title: 'The Lantern Keeper',
      series: 'Harbour Lights, #2',
      authors: ['Mira Okafor'],
      isbn13: '9781900000017',
      isbn10: '1900000016',
      pageCount: 412,
      year: 2019,
      publisher: 'Northlight Press',
      status: 'finished',
      addedOn: '2023-11-20',
      session: {
        startedOn: null,
        endedOn: '2024-03-09',
        outcome: 'finished',
        rating: 16,
        review: 'Loved it.\n\nSlow start, but the ending, "oh", the ending.',
      },
      problems: [],
    })
  })

  it('keeps a read without a Date Read as finished without a day, and 0 stars as unrated', () => {
    expect(byKey('goodreads:1002')).toMatchObject({
      authors: ['Jonas Weller', 'Ana Ruiz', 'Tom Beck'],
      isbn13: '9790000001022',
      isbn10: null,
      session: { startedOn: null, endedOn: null, outcome: 'finished', rating: null, review: null },
    })
  })

  it('keeps line breaks, commas and entities inside a quoted review', () => {
    expect(byKey('goodreads:1006').session).toMatchObject({
      rating: 20,
      review: 'First line\nSecond line, with a comma & an ampersand',
    })
  })

  it('opens a read for a book being read, started on the day it was added', () => {
    expect(byKey('goodreads:1003')).toMatchObject({
      status: 'reading',
      pageCount: null,
      session: { startedOn: '2025-08-01', endedOn: null, outcome: null, rating: null, review: null },
    })
  })

  it('puts to-read books and any other shelf on Want to read, and says so for a custom shelf', () => {
    expect(byKey('goodreads:1004')).toMatchObject({
      status: 'want_to_read',
      session: null,
      isbn13: null,
      isbn10: null,
      year: 2016,
      problems: [],
    })
    expect(byKey('goodreads:1005')).toMatchObject({
      shelf: 'wishlist',
      status: 'want_to_read',
      session: null,
      problems: [{ code: 'otherShelf', shelf: 'wishlist' }],
    })
  })

  it('leaves out a rating on a book that is not finished, and says so', () => {
    expect(byKey('goodreads:1009')).toMatchObject({ status: 'want_to_read', session: null, problems: [{ code: 'notFinishedRating' }] })
  })

  it('reads newer exports without the Average Rating column and with CRLF line ends', () => {
    const newer = parseGoodreads(fixture('newer_export.csv'), TODAY)
    expect(newer.books.map((book) => [book.key, book.title, book.status, book.session?.rating])).toEqual([
      ['goodreads:1001', 'The Lantern Keeper', 'finished', 16],
      ['goodreads:1002', 'Salt and Paper', 'finished', null],
    ])
    expect(newer.books[0]!.session!.review).toBe('Loved it.\n\nSlow start, but the ending, "oh", the ending.')
  })

  it('refuses a file that is not a Goodreads export', () => {
    expect(() => parseGoodreads('title,author\nPiranesi,Susanna Clarke\n', TODAY)).toThrow(NotAGoodreadsExportError)
    expect(() => parseGoodreads('', TODAY)).toThrow(NotAGoodreadsExportError)
  })

  it('needs only Title, Author and Exclusive Shelf', () => {
    const minimal = parseGoodreads('Title,Author,Exclusive Shelf\n"Howling Dark (Sun Eater, #2)",Christopher Ruocchio,read\n', TODAY)
    expect(minimal.books).toEqual([
      expect.objectContaining({
        key: 'goodreads:t-howling-dark|ruocchio',
        title: 'Howling Dark',
        series: 'Sun Eater, #2',
        status: 'finished',
        session: { startedOn: null, endedOn: null, outcome: 'finished', rating: null, review: null },
      }),
    ])
  })

  it('leaves out a day that is no day or has not come yet, and a rating that is not 0–5 stars', () => {
    const file = [
      'Book Id,Title,Author,My Rating,Date Read,Date Added,Exclusive Shelf',
      '1,Early,A. Writer,7,2026/10/04,2026/02/30,read',
      '2,Reading Now,A. Writer,0,,2027/01/01,currently-reading',
    ].join('\n')
    const [early, now] = parseGoodreads(file, TODAY).books
    expect(early).toMatchObject({
      addedOn: null,
      session: { endedOn: null, rating: null },
      problems: [{ code: 'dateInvalid' }, { code: 'ratingInvalid' }],
    })
    // No usable Date Added: the read started today.
    expect(now).toMatchObject({ session: { startedOn: TODAY }, problems: [{ code: 'dateInvalid' }] })
  })

  it('is pure: the same file and day give the same books', () => {
    expect(parseGoodreads(fixture('library_export.csv'), TODAY)).toEqual(parsed)
  })
})

describe('the pieces', () => {
  it('reads Goodreads days', () => {
    expect(goodreadsDay('2024/03/09', TODAY)).toBe('2024-03-09')
    expect(goodreadsDay('2024-3-9', TODAY)).toBe('2024-03-09')
    expect(goodreadsDay('', TODAY)).toBeNull()
    expect(goodreadsDay('2024/02/30', TODAY)).toBe('invalid')
    expect(goodreadsDay('next week', TODAY)).toBe('invalid')
    expect(goodreadsDay('2026/10/04', TODAY)).toBe('invalid')
  })

  it('unwraps ISBNs, converts an ISBN-10 and drops a wrong check digit', () => {
    expect(goodreadsIsbn('="9780553283686"', '="0553283685"')).toEqual({ isbn13: '9780553283686', isbn10: '0553283685' })
    expect(goodreadsIsbn('=""', '="067972477X"')).toEqual({ isbn13: '9780679724773', isbn10: '067972477X' })
    expect(goodreadsIsbn('=""', '=""')).toEqual({ isbn13: null, isbn10: null })
    expect(goodreadsIsbn('="9780553283687"', '')).toEqual({ isbn13: null, isbn10: null })
  })

  it('keys a row by its Book Id, else by its ISBN, else by title and author', () => {
    const book = { title: 'Salt and Paper', authors: ['Jonas Weller'], isbn13: '9790000001022' }
    expect(goodreadsKey('1002', book)).toBe('goodreads:1002')
    expect(goodreadsKey('', book)).toBe('goodreads:isbn-9790000001022')
    expect(goodreadsKey('', { ...book, isbn13: null })).toBe('goodreads:t-salt-and-paper|weller')
  })

  it('makes the file\'s own Book: an import Book with an ISBN, a Manual book without', () => {
    expect(bookFromRow(byKey('goodreads:1001'))).toMatchObject({
      title: 'The Lantern Keeper',
      authors: ['Mira Okafor'],
      isbn13: '9781900000017',
      pageCount: 412,
      source: 'import',
      coverUrl: null,
    })
    expect(bookFromRow(byKey('goodreads:1004'))).toMatchObject({ title: 'Quiet Rooms: Essays', source: 'manual', isbn13: null })
  })

  it('takes a title search result only for the same work by the same author', () => {
    const row = byKey('goodreads:1001')
    expect(titleQuery(row)).toBe('The Lantern Keeper Mira Okafor')
    expect(isSameWork(row, { title: 'The Lantern Keeper: A Novel', authors: ['Mira Okafor'] })).toBe(true)
    expect(isSameWork(row, { title: 'The Lantern Keeper (Harbour Lights Book 2)', authors: ['M. Okafor'] })).toBe(true)
    expect(isSameWork(row, { title: 'The Lantern Keeper', authors: ['Someone Else'] })).toBe(false)
    expect(isSameWork(row, { title: 'The Lantern Keeper Companion', authors: ['Mira Okafor'] })).toBe(false)
  })
})
