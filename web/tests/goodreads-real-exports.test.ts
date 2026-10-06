import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { hintFromAnswer } from '@/data/goodreadsEditions'
import {
  countByStatus,
  decodeExport,
  editionFit,
  goodreadsDay,
  goodreadsRating,
  isAbandonedShelf,
  isSameWork,
  languageCode,
  NotACsvFileError,
  NotAGoodreadsExportError,
  parseGoodreads,
  pickEdition,
  readGoodreadsCsv,
  titleLanguage,
  type GoodreadsBook,
} from '@/data/import/goodreads'

/**
 * The Goodreads import against what real exports carry (#111). The owner's
 * own exports were measured locally (scripts/import-battle.ts); what they
 * showed is modelled here, synthetically, in tests/fixtures/goodreads/
 * battle_export.csv: no Average Rating column, `="…"` ISBNs and `=""` ones,
 * an ISBN-10 ending in X, a Kindle row without any ISBN, the same work read
 * twice in two languages under two Book Ids, Read Counts of 0 to 2, a custom
 * exclusive shelf, a did-not-finish shelf, non-exclusive shelves, a review in
 * HTML with quotes and entities, umlauts and several authors, a private note,
 * an ISBN a spreadsheet turned into a number, a box set and a rated book not
 * yet read.
 */

const TODAY = '2026-10-07'
const text = readFileSync(new URL('./fixtures/goodreads/battle_export.csv', import.meta.url), 'utf8')
const parsed = parseGoodreads(text, TODAY)
const byKey = (key: string) => parsed.books.find((book) => book.key === key) as GoodreadsBook

describe('a real export, row by row', () => {
  it('reads every row and counts the Statuses, a did-not-finish book among the finished', () => {
    expect(parsed.books).toHaveLength(12)
    expect(parsed.skipped).toEqual([])
    expect(countByStatus(parsed.books)).toEqual({ finished: 8, reading: 1, want_to_read: 3 })
  })

  it('turns a Read Count above 1 into earlier reads, for a read book and one being read again', () => {
    expect(byKey('goodreads:2001')).toMatchObject({ extraReads: 1, problems: [{ code: 'extraReads', count: 1 }] })
    expect(byKey('goodreads:2005')).toMatchObject({ status: 'reading', extraReads: 1 })
    // Read Count 0 on a read book is still one read.
    expect(byKey('goodreads:2008')).toMatchObject({ status: 'finished', extraReads: 0, session: { endedOn: null, rating: null } })
  })

  it('maps a did-not-finish shelf to an abandoned read with its day and review, without the rating', () => {
    expect(byKey('goodreads:2007')).toMatchObject({
      status: 'finished',
      session: { outcome: 'abandoned', endedOn: '2024-06-30', rating: null, review: 'Stopped at page 120.\nNot for me.' },
      shelves: [],
      problems: [{ code: 'abandonedRating' }],
    })
    expect(['dnf', 'DNF', 'did-not-finish', 'did not finish', 'abandoned', 'gave-up', 'abgebrochen'].every(isAbandonedShelf)).toBe(true)
    expect(isAbandonedShelf('finished')).toBe(false)
  })

  it('offers her other shelves, and a custom exclusive one, as Collections', () => {
    expect(byKey('goodreads:2001').shelves).toEqual(['favourites'])
    expect(byKey('goodreads:2004').shelves).toEqual(['sci-fi', 'favourites'])
    expect(byKey('goodreads:2006')).toMatchObject({ status: 'want_to_read', shelves: ['wishlist'] })
    expect(byKey('goodreads:2002').shelves).toEqual([])
  })

  it('ties together the rows of one work under different Book Ids: two editions she shelved', () => {
    expect(byKey('goodreads:2001').otherKeys).toEqual(['goodreads:2003'])
    expect(byKey('goodreads:2003').otherKeys).toEqual(['goodreads:2001'])
    expect(byKey('goodreads:2011').otherKeys).toEqual([])
  })

  it('reads the ISBNs as they come: wrapped, an ISBN-10 with X, none, and one a spreadsheet mangled', () => {
    expect(byKey('goodreads:2001')).toMatchObject({ isbn13: '9790000002104', isbn10: '1900002108' })
    expect(byKey('goodreads:2004')).toMatchObject({ isbn13: '9781900002233', isbn10: '190000223X' })
    expect(byKey('goodreads:2002')).toMatchObject({ isbn13: null, goodreadsId: '2002', binding: 'Kindle Edition' })
    expect(byKey('goodreads:2009')).toMatchObject({ isbn13: null, problems: [{ code: 'isbnMangled' }] })
  })

  it('keeps a review as text, umlauts, every author once, and leaves private notes out', () => {
    expect(byKey('goodreads:2001').session?.review).toBe('Read it twice.\n\nThe ending, "oh", the ending & the map.')
    expect(byKey('goodreads:2010')).toMatchObject({
      title: 'Über die Brücke: Erzählungen',
      authors: ['Käthe Müller', 'Sören Weiß', 'Zoë Ïlić', 'Æsa Ørn'],
      year: 1999,
      originalYear: 1987,
      session: { review: 'Wunderbar, "leise", schön.', rating: 20 },
    })
    expect(JSON.stringify(byKey('goodreads:2010'))).not.toContain('Borrowed')
  })

  it('drops the rating of a book not read yet, with a note', () => {
    expect(byKey('goodreads:2012')).toMatchObject({ status: 'want_to_read', session: null, problems: [{ code: 'notFinishedRating' }] })
  })
})

describe('files that are not quite a Goodreads export', () => {
  const header = 'Book Id;Title;Author;ISBN13;My Rating;Exclusive Shelf;Date Read'

  it('reads a file a spreadsheet saved again: Windows-1252, semicolons, German dates', () => {
    // "Brücke" in Windows-1252: ü is one byte, 0xFC.
    const bytes = new Uint8Array([...new TextEncoder().encode(`${header}\n7;Die Br`), 0xfc, ...new TextEncoder().encode('cke;Ana Weiss;9.79E+12;4;read;09.03.2024\n')])
    const { books } = parseGoodreads(decodeExport(bytes), TODAY)
    expect(books[0]).toMatchObject({ title: 'Die Brücke', isbn13: null, session: { endedOn: '2024-03-09', rating: 16 }, problems: [{ code: 'isbnMangled' }] })
  })

  it('refuses a spreadsheet or anything else that is no text', () => {
    expect(() => decodeExport(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14]))).toThrow(NotACsvFileError)
    expect(() => decodeExport(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]))).toThrow(NotACsvFileError)
  })

  it('names the app another export comes from', () => {
    const app = (head: string) => {
      try {
        readGoodreadsCsv(`${head}\nx`)
      } catch (error) {
        return error instanceof NotAGoodreadsExportError ? error.app : 'other'
      }
      return 'read'
    }
    expect(app('Title,Authors,Contributors,ISBN/UID,Format,Read Status,Date Added,Last Date Read,Star Rating')).toBe('storygraph')
    expect(app('Book Id,Title,Sort Character,Primary Author,Secondary Author,ISBNs')).toBe('librarything')
    expect(app('Name,Author,Status,Series,Volume,Started,Finished,Language,Rating')).toBe('bookshelf')
    expect(app('Name,Email')).toBeNull()
  })

  it('takes ratings in halves and decimals to the nearest quarter star, days in their spellings', () => {
    expect(['5', '3.5', '3,75', '0.1', '0', '', '6', 'x'].map(goodreadsRating)).toEqual([20, 14, 15, 1, null, null, undefined, undefined])
    expect(['2024/3/9', '2024-03-09', '9.3.2024', '31.02.2024', '03/09/2024'].map((day) => goodreadsDay(day, TODAY))).toEqual([
      '2024-03-09',
      '2024-03-09',
      '2024-03-09',
      'invalid',
      'invalid',
    ])
  })
})

describe('picking the edition among the same work', () => {
  const row = { title: 'Ember Road', authors: ['Tove Lindqvist'], pageCount: 412, year: 2016, binding: 'Paperback' }
  const book = (overrides: Record<string, unknown>) => ({
    title: 'Ember Road',
    authors: ['Tove Lindqvist'],
    language: null,
    pageCount: null,
    year: null,
    source: 'openlibrary' as const,
    ...overrides,
  })

  it('tells languages apart as the sources write them, and a title by its little words', () => {
    expect(['en', 'eng', 'English', 'de-DE', 'ger', 'deu', 'German', '', 'xx-yy-zz'].map(languageCode)).toEqual(['en', 'en', 'en', 'de', 'de', 'de', 'de', null, null])
    expect(['2001: A Space Odyssey', 'Der Anschlag', 'Über die Brücke', 'Circe', 'Neuromancer'].map(titleLanguage)).toEqual(['en', 'de', 'de', null, null])
  })

  it('prefers the edition in Goodreads\' language, then its page count, and an ebook for a Kindle row', () => {
    const hint = { isbn13: null, isbn10: null, asin: null, language: 'de', pageCount: 520, format: 'Taschenbuch', publisher: null, year: 2018 }
    const results = [book({ language: 'eng', pageCount: 412 }), book({ language: 'ger', pageCount: 300 }), book({ language: 'ger', pageCount: 520 })].map((b) => ({ book: b }))
    expect(pickEdition({ ...row, pageCount: 520 }, results, hint)).toBe(results[2])
    expect(editionFit({ ...row, binding: 'Kindle Edition' }, book({ source: 'apple' }))).toBeGreaterThan(editionFit({ ...row, binding: 'Kindle Edition' }, book({ pageCount: 412 })))
    // Nothing to tell them apart: the search's order.
    const plain = [book({}), book({})].map((b) => ({ book: b }))
    expect(pickEdition({ ...row, pageCount: null, year: null }, plain)).toBe(plain[0])
  })

  it('does not take a translation in another script for the book, whatever its brackets say', () => {
    expect(isSameWork(row, { title: 'Θνητοί Θεοί (Ember Road)', authors: ['Tove Lindqvist'] })).toBe(false)
    expect(isSameWork(row, { title: 'Ember Road (The Lantern Cycle Book 1)', authors: ['T. Lindqvist'] })).toBe(true)
  })

  it('reads what the server says about an edition', () => {
    expect(hintFromAnswer({ status: 'not_found', checkedAt: 'x' })).toBeNull()
    expect(
      hintFromAnswer({ status: 'found', isbn13: '9790000002104', isbn10: null, asin: ' B0 ', language: 'de', pageCount: 0, format: 'Kindle Edition', publisher: '', year: 2017 }),
    ).toEqual({ isbn13: '9790000002104', isbn10: null, asin: 'B0', language: 'de', pageCount: null, format: 'Kindle Edition', publisher: null, year: 2017 })
    expect(() => hintFromAnswer({ error: 'busy' })).toThrow()
  })
})
