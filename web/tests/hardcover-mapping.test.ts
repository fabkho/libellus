import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseExport } from '@/data/import/detect'
import { bookFromRow, editionFit } from '@/data/import/editions'
import { hardcoverAuthors, hardcoverLists, hardcoverSeries } from '@/data/import/hardcover'
import { countByStatus, type ImportBook } from '@/data/import/rows'

/**
 * The Hardcover adapter (#111): a Hardcover CSV export, and a file written by
 * hand in Hardcover's custom import format (the same columns), → the
 * normalised import rows. The fixtures (tests/fixtures/hardcover) are
 * synthetic, in the structure of Hardcover's export (its 37 columns, in its
 * order): several reads in Date Started / Date Finished, half-star ratings,
 * roles in Author, positions in Series and Lists, Owned, an audiobook and an
 * ebook, a Paused and a None row, a duplicate, a row without a title, the
 * same work in two languages, a spreadsheet's ISBN and a day still to come.
 */

const fixture = (name: string) => readFileSync(new URL(`./fixtures/hardcover/${name}`, import.meta.url), 'utf8')
const TODAY = '2026-10-07'

const parsed = parseExport(fixture('hardcover_export.csv'), TODAY)
const byKey = (key: string) => parsed.books.find((book) => book.key === key) as ImportBook

describe('a Hardcover export', () => {
  it('is told to be Hardcover by its header and read once per book', () => {
    expect(parsed.source).toBe('hardcover')
    expect(parsed.books.map((book) => book.key)).toEqual([
      'hardcover:5001',
      'hardcover:5002',
      'hardcover:5003',
      'hardcover:5004',
      'hardcover:5005',
      'hardcover:5006',
      'hardcover:5010',
      'hardcover:5011',
      'hardcover:5012',
    ])
    expect(parsed.skipped).toEqual([
      { row: 7, title: 'Hidden Away', problem: { code: 'notShelved' } },
      { row: 8, title: '', problem: { code: 'noTitle' } },
      { row: 9, title: 'Glass Orchard', problem: { code: 'duplicate' } },
    ])
    expect(countByStatus(parsed.books)).toEqual({ finished: 5, reading: 2, want_to_read: 2 })
  })

  it('maps a book read twice: the latest read with its days, rating and review, the first as an earlier read', () => {
    expect(byKey('hardcover:5001')).toMatchObject({
      source: 'hardcover',
      sourceId: '5001',
      title: 'The Lantern Keeper',
      series: 'Harbour Lights, #2',
      authors: ['Mira Okafor'],
      isbn13: '9790000050013',
      pageCount: 412,
      year: 2019,
      binding: 'Paperback',
      language: 'en',
      publisher: 'Tidewater Press',
      status: 'finished',
      session: { startedOn: '2024-02-20', endedOn: '2024-03-09', outcome: 'finished', rating: 18, review: 'Lovely.\nTruly, "quietly" sad.' },
      earlierReads: [{ startedOn: '2020-01-05', endedOn: '2020-02-01' }],
      extraReads: 0,
      addedOn: '2023-11-20',
      problems: [{ code: 'earlierReads', count: 1 }],
    })
  })

  it('offers her lists as Collections, positions dropped, and Owned once', () => {
    expect(byKey('hardcover:5001').shelves).toEqual(['Owned', 'Favourites'])
    expect(byKey('hardcover:5003').shelves).toEqual(['Wishlist'])
    expect(byKey('hardcover:5010').shelves).toEqual(['Favourites'])
  })

  it('maps one being read to an open read from its start; Paused reads the same, with a note', () => {
    expect(byKey('hardcover:5002')).toMatchObject({
      status: 'reading',
      authors: ['Hanne Soberg'],
      binding: 'Ebook',
      language: 'de',
      year: 2020,
      session: { startedOn: '2025-08-01', endedOn: null, outcome: null, rating: null },
      earlierReads: [],
      problems: [],
    })
    expect(byKey('hardcover:5006')).toMatchObject({ status: 'reading', session: { startedOn: '2025-03-01' }, problems: [{ code: 'paused' }] })
  })

  it('maps Did Not Finish to an abandoned read with its start and review, without the rating', () => {
    expect(byKey('hardcover:5004')).toMatchObject({
      status: 'finished',
      session: { startedOn: '2024-05-01', endedOn: null, outcome: 'abandoned', rating: null, review: 'Not for me.' },
      problems: [{ code: 'abandonedRating' }],
    })
  })

  it('keeps the author of an audiobook, not its narrator, and says it is one', () => {
    expect(byKey('hardcover:5005')).toMatchObject({
      authors: ['Tove Lindqvist'],
      series: 'Ember Road',
      isbn13: null,
      binding: 'Audiobook',
      session: { startedOn: '2025-01-01', endedOn: '2025-01-23', rating: 14 },
    })
  })

  it('wants a book without its rating, and knows two editions of one work are two books', () => {
    expect(byKey('hardcover:5012')).toMatchObject({ status: 'want_to_read', session: null, problems: [{ code: 'notFinishedRating' }] })
    expect(byKey('hardcover:5001').otherKeys).toEqual(['hardcover:5010'])
    expect(byKey('hardcover:5010')).toMatchObject({ authors: ['Mira Okafor'], language: 'de', otherKeys: ['hardcover:5001'] })
  })

  it('leaves out what cannot be: a spreadsheet ISBN, a day still to come, a rating past five stars', () => {
    expect(byKey('hardcover:5011')).toMatchObject({
      isbn13: null,
      session: { endedOn: null, rating: null },
      problems: [{ code: 'isbnMangled' }, { code: 'dateInvalid' }, { code: 'ratingInvalid' }],
    })
  })

  it('ranks editions by the language the file names, not only the title', () => {
    const row = byKey('hardcover:5010')
    const found = (language: string) => ({ title: 'The Lantern Keeper', language, pageCount: null, year: null, source: 'openlibrary' as const })
    expect(editionFit(row, found('ger'))).toBeGreaterThan(editionFit(row, found('eng')))
    expect(bookFromRow(row)).toMatchObject({ source: 'import', isbn13: '9790000050204', language: 'de', pageCount: 520 })
  })
})

describe("Hardcover's custom import format, written by hand", () => {
  const custom = parseExport(fixture('custom_import.csv'), TODAY)

  it('reads several reads, Yes/No, `\\n` line breaks and statuses in any case; keys by ISBN or title without ids', () => {
    expect(custom.source).toBe('hardcover')
    expect(custom.books).toHaveLength(3)
    expect(custom.books[0]).toMatchObject({
      key: 'hardcover:isbn-9790000050211',
      sourceId: null,
      status: 'finished',
      session: { startedOn: '2022-06-10', endedOn: '2022-06-19', rating: 20, review: 'This book is **amazing**.\n\nAnother paragraph.' },
      earlierReads: [{ startedOn: '2015-01-15', endedOn: '2015-01-22' }],
      shelves: ['Recommendations', 'Okafor Books', 'Owned'],
    })
    expect(custom.books[1]).toMatchObject({ key: 'hardcover:t-quiet-rooms|marchetti', status: 'want_to_read', shelves: [], problems: [] })
    expect(custom.books[2]).toMatchObject({ status: 'finished', session: { endedOn: '2023-03-03', outcome: 'abandoned' } })
  })
})

describe('the parts of a Hardcover cell', () => {
  it('reads authors without their roles, series and lists without their positions', () => {
    expect(hardcoverAuthors('Roberto Bolaño, Natasha Wimmer (Translator)')).toEqual(['Roberto Bolaño'])
    expect(hardcoverAuthors('Helen Lazer (Narrator), Alison Espach')).toEqual(['Alison Espach'])
    expect(hardcoverAuthors('Neil Gaiman (Author), Terry Pratchett')).toEqual(['Neil Gaiman', 'Terry Pratchett'])
    expect(hardcoverAuthors('Only Narrator (Narrator)')).toEqual(['Only Narrator'])
    expect(hardcoverSeries('The Mistborn Saga (#1), The Cosmere')).toBe('The Mistborn Saga, #1')
    expect(hardcoverSeries('Sprawl (#1.5)')).toBe('Sprawl, #1.5')
    expect(hardcoverSeries('')).toBeNull()
    expect(hardcoverLists('Recommendations, Brandon Sanderson Books (#1), Shelved By Genre (19)')).toEqual([
      'Recommendations',
      'Brandon Sanderson Books',
      'Shelved By Genre',
    ])
  })
})
