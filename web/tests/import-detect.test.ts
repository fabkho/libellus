import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeExport, NotACsvFileError, readCsv } from '@/data/import/csv'
import { detectExport, MIN_SCORE, parseExport, scoreHeader } from '@/data/import/detect'
import { goodreadsAdapter } from '@/data/import/goodreads'
import { hardcoverAdapter } from '@/data/import/hardcover'
import { MissingColumnsError, UnknownExportError } from '@/data/import/rows'

/**
 * Which app wrote a file (#111): the member drops an export and Libellus tells
 * Goodreads from Hardcover by the header alone, whatever a spreadsheet did to
 * it on the way (BOM, `;`, Excel's `sep=` line, Windows-1252, quoted or
 * re-cased header cells, columns in another order). A CSV of no supported app
 * is refused naming the app that wrote it when the header tells; a supported
 * app's export without the columns its rows need names the missing ones.
 */

const fixture = (path: string) => readFileSync(new URL(`./fixtures/${path}`, import.meta.url), 'utf8')
const TODAY = '2026-10-07'
const columnsOf = (text: string) => readCsv(text).columns

const goodreads = fixture('goodreads/library_export.csv')
const hardcover = fixture('hardcover/hardcover_export.csv')

/** Why a header is refused: the app it names, or the columns it lacks. */
function refusal(header: string): unknown {
  try {
    return detectExport(columnsOf(`${header}\nx`)).source
  } catch (error) {
    if (error instanceof UnknownExportError) return { app: error.app }
    if (error instanceof MissingColumnsError) return { source: error.source, missing: error.missing }
    throw error
  }
}

describe('detectExport', () => {
  it('tells Goodreads and Hardcover exports apart by their headers', () => {
    expect(detectExport(columnsOf(goodreads)).source).toBe('goodreads')
    expect(detectExport(columnsOf(fixture('goodreads/newer_export.csv'))).source).toBe('goodreads')
    expect(detectExport(columnsOf(fixture('goodreads/battle_export.csv'))).source).toBe('goodreads')
    expect(detectExport(columnsOf(hardcover)).source).toBe('hardcover')
    expect(detectExport(columnsOf(fixture('hardcover/custom_import.csv'))).source).toBe('hardcover')
  })

  it('scores each export far above the threshold for its own app and below it for the other', () => {
    expect(scoreHeader(goodreadsAdapter, columnsOf(goodreads))).toBeGreaterThan(3 * MIN_SCORE)
    expect(scoreHeader(hardcoverAdapter, columnsOf(goodreads))).toBeLessThan(MIN_SCORE)
    expect(scoreHeader(hardcoverAdapter, columnsOf(hardcover))).toBeGreaterThan(3 * MIN_SCORE)
    expect(scoreHeader(goodreadsAdapter, columnsOf(hardcover))).toBeLessThan(MIN_SCORE)
  })

  it('takes a Goodreads-shaped file another tool wrote, with only the columns it needs', () => {
    expect(refusal('Title,Author,Exclusive Shelf')).toBe('goodreads')
  })

  it('names the app another export comes from', () => {
    expect(refusal('Title,Authors,Contributors,ISBN/UID,Format,Read Status,Date Added,Last Date Read,Dates Read,Read Count,Star Rating,Review,Tags,Owned?')).toEqual({
      app: 'storygraph',
    })
    expect(refusal('Book Id,Title,Sort Character,Primary Author,Secondary Author,ISBNs')).toEqual({ app: 'librarything' })
    expect(refusal('Name,Author,Status,Series,Volume,Started,Finished,Language,Rating')).toEqual({ app: 'bookshelf' })
    expect(refusal('Name,Email')).toEqual({ app: null })
    expect(refusal('Title,Author,Status')).toEqual({ app: null })
    expect(refusal('')).toEqual({ app: null })
  })

  it('names the columns a supported export lacks', () => {
    const hardcoverHeader = hardcover.split('\n')[0]!
    expect(refusal(hardcoverHeader.replace(',Status,', ','))).toEqual({ source: 'hardcover', missing: ['Status'] })
    const goodreadsHeader = goodreads.replace(/^\uFEFF/, '').split(/\r?\n/)[0]!
    expect(refusal(goodreadsHeader.replace(',Exclusive Shelf', '').replace(/(^|,)Author(?=,)/, ''))).toEqual({
      source: 'goodreads',
      missing: ['Author', 'Exclusive Shelf'],
    })
  })
})

describe('parseExport, whatever a spreadsheet did to the file', () => {
  const plain = parseExport(hardcover, TODAY)
  const keys = (text: string) => parseExport(text, TODAY).books.map((book) => book.key)

  /** The export as Excel in Europe saves it: `;` between cells, every cell quoted. */
  function semicolons(text: string): string {
    const { columns, rows } = readCsv(text)
    const cell = (value: string | undefined) => `"${(value ?? '').replace(/"/g, '""')}"`
    return [columns.map(cell).join(';'), ...rows.map((row) => columns.map((column) => cell(row[column])).join(';'))].join('\r\n')
  }

  it('reads a BOM, `;` with quoted cells, and Excel\'s `sep=;` line', () => {
    expect(keys(`\uFEFF${hardcover}`)).toEqual(plain.books.map((book) => book.key))
    expect(keys(semicolons(hardcover))).toEqual(plain.books.map((book) => book.key))
    expect(keys(`sep=;\r\n${semicolons(hardcover)}`)).toEqual(plain.books.map((book) => book.key))
    expect(parseExport(semicolons(hardcover), TODAY).books[0]).toEqual(plain.books[0])
  })

  it('reads header cells in another case or with stray spaces, and columns in another order', () => {
    const [header, ...lines] = hardcover.split('\n')
    const shouting = [header!.replace('Hardcover Book ID', ' hardcover book id ').replace('Date Finished', 'DATE FINISHED'), ...lines].join('\n')
    expect(parseExport(shouting, TODAY).books[0]).toEqual(plain.books[0])

    const { columns, rows } = readCsv(hardcover)
    const reversed = [...columns].reverse()
    const cell = (value: string | undefined) => `"${(value ?? '').replace(/"/g, '""')}"`
    const shuffled = [reversed.join(','), ...rows.map((row) => reversed.map((column) => cell(row[column])).join(','))].join('\n')
    expect(parseExport(shuffled, TODAY).books).toEqual(plain.books)
  })

  it('reads a Goodreads export saved again as Windows-1252 with `;`', () => {
    const text = 'Book Id;Title;Author;ISBN13;My Rating;Exclusive Shelf;Date Read\n7;Die Br'
    const bytes = new Uint8Array([...new TextEncoder().encode(text), 0xfc, ...new TextEncoder().encode('cke;Ana Weiss;9.79E+12;4;read;09.03.2024\n')])
    const file = parseExport(decodeExport(bytes), TODAY)
    expect(file.source).toBe('goodreads')
    expect(file.books[0]).toMatchObject({ title: 'Die Brücke', session: { endedOn: '2024-03-09', rating: 16 } })
  })

  it('refuses what is no CSV at all, and a CSV of no supported app', () => {
    expect(() => decodeExport(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toThrow(NotACsvFileError)
    expect(() => parseExport('Name,Email\nIda,ida@example.com\n', TODAY)).toThrow(UnknownExportError)
    expect(() => parseExport('just some words\n', TODAY)).toThrow(UnknownExportError)
  })
})
