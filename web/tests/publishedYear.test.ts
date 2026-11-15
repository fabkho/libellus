import { describe, expect, it } from 'vitest'
import { firstYearOf, bookFromRow, type BookRow } from '@/data/library'
import { editionLine, firstPublishedYear } from '@/utils/publishedYear'

/**
 * The Book page's two years (`utils/publishedYear.ts`, docs/proposals/first-published-data-2026-11-15.md §4).
 *
 * The hero shows the *work's* first publication and falls back to the edition's year; the edition line under About says
 * when this copy was printed. No stack: these are the display rules and the mapping, which are pure.
 */

const book = (fields: { firstYear?: number | null; year: number | null; publisher?: string | null; title?: string }) => ({
  title: fields.title ?? 'A Book',
  year: fields.year,
  firstYear: fields.firstYear ?? null,
  publisher: fields.publisher ?? null,
})

describe('firstPublishedYear: the hero year', () => {
  it('shows the work’s year when it is before the edition’s: the reprint', () => {
    expect(firstPublishedYear(book({ firstYear: 1949, year: 2023 }))).toBe(1949)
  })

  it('shows the work’s year when it is the edition’s own year', () => {
    expect(firstPublishedYear(book({ firstYear: 2020, year: 2020 }))).toBe(2020)
  })

  it('G1: falls back to the edition year when the work’s is later, which is impossible (a wrong work link)', () => {
    // Dream Again: an edition of 1900 linked to a work first published in 2020.
    expect(firstPublishedYear(book({ firstYear: 2020, year: 1900 }))).toBe(1900)
  })

  it('shows the work’s year when the edition has none', () => {
    expect(firstPublishedYear(book({ firstYear: 1956, year: null }))).toBe(1956)
  })

  it('falls back to the edition year when no work was matched: today’s behaviour, never a hole', () => {
    expect(firstPublishedYear(book({ firstYear: null, year: 2019 }))).toBe(2019)
  })

  it('shows nothing when neither is known', () => {
    expect(firstPublishedYear(book({ firstYear: null, year: null }))).toBeNull()
  })

  it('reads a missing firstYear (a row from before the embed, a cached Library) as unknown', () => {
    expect(firstPublishedYear({ year: 2019 })).toBe(2019)
  })

  it('G2 is not guarded: a large gap that is not impossible still shows the work’s year', () => {
    // The Unhoneymooners: a 2020 edition of what the linked work dates 1934. Only the titles could tell; this shows 1934.
    expect(firstPublishedYear(book({ firstYear: 1934, year: 2020 }))).toBe(1934)
  })
})

describe('editionLine: what the line under About says', () => {
  it('says publisher and year when the hero says another year', () => {
    expect(editionLine(book({ firstYear: 1949, year: 2023, publisher: 'Penguin' }))).toEqual({ publisher: 'Penguin', year: 2023 })
  })

  it('says the year alone when the publisher is unknown', () => {
    expect(editionLine(book({ firstYear: 1949, year: 2023 }))).toEqual({ publisher: null, year: 2023 })
  })

  it('says the publisher alone when the edition has no year', () => {
    expect(editionLine(book({ firstYear: 1956, year: null, publisher: 'Penguin' }))).toEqual({ publisher: 'Penguin', year: null })
  })

  it('says nothing when it would only repeat the hero’s year', () => {
    // No work matched: the hero's year *is* the edition's, so the line would print the same number twice.
    expect(editionLine(book({ firstYear: null, year: 2019 }))).toBeNull()
    expect(editionLine(book({ firstYear: null, year: 2019, publisher: 'Faber' }))).toBeNull()
    expect(editionLine(book({ firstYear: 2019, year: 2019 }))).toBeNull()
  })

  it('says nothing when the year is unknown and there is no publisher to name', () => {
    expect(editionLine(book({ firstYear: null, year: null }))).toBeNull()
    expect(editionLine(book({ firstYear: 1956, year: null }))).toBeNull()
    expect(editionLine(book({ firstYear: null, year: 2019, publisher: '   ' }))).toBeNull()
  })

  it('compares against the year the hero shows, so G1 leaves no line either', () => {
    // firstYear 2020 > year 1900: the hero falls back to 1900, so the line has nothing to contrast.
    expect(editionLine(book({ firstYear: 2020, year: 1900, publisher: 'Hodder' }))).toBeNull()
  })
})

describe('bookFromRow: where firstYear comes from', () => {
  const row = (overrides: Partial<BookRow> = {}) =>
    ({
      id: 'b1',
      title: 'Nineteen Eighty-Four',
      authors: ['George Orwell'],
      isbn13: null,
      isbn10: null,
      page_count: 328,
      published_year: 2023,
      language: 'en',
      publisher: 'Penguin',
      cover_url: null,
      cover_thumbhash: null,
      cover_dominant: null,
      cover_secondary: null,
      source: 'openlibrary',
      apple_id: null,
      openlibrary_edition_key: null,
      openlibrary_work_key: null,
      created_at: '2026-01-01T00:00:00Z',
      ...overrides,
    }) as BookRow

  it('carries the work’s year from the embed, and keeps the edition’s year as year', () => {
    const book = bookFromRow(row({ works: { work: { first_year: 1949 } } }))
    expect(book.firstYear).toBe(1949)
    expect(book.year).toBe(2023)
  })

  it('reads a work with no date, an empty embed, a null work and no embed at all as null', () => {
    expect(firstYearOf(row({ works: { work: { first_year: null } } }))).toBeNull()
    expect(firstYearOf(row({ works: { work: null } }))).toBeNull()
    expect(firstYearOf(row({ works: null }))).toBeNull()
    expect(firstYearOf(row())).toBeNull()
  })

  it('reads the embed as the array PostgREST might answer too, empty or not', () => {
    // The embed is a to-one in the table (`book_works.book_id` is its primary key), but the shape is PostgREST's.
    expect(firstYearOf(row({ works: [{ work: { first_year: 1949 } }] }))).toBe(1949)
    expect(firstYearOf(row({ works: [] }))).toBeNull()
    expect(firstYearOf(row({ works: [{ work: null }] }))).toBeNull()
  })
})
