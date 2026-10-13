import { describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import { isNearWork, isSameWork, otherLanguage, rankEditions, sameAuthor, sameTitle, titleLanguage } from '@/data/import/editions'

/**
 * When two records are one book (issue #111): `sameTitle` (a series prefix
 * before a dash, a subtitle after one, a series number with a colon, a volume
 * mark, the Goodreads series aside), `sameAuthor` (catalogue order, initials,
 * umlauts written out or dropped, a surname typo), the work's rule
 * `isSameWork` and its near miss `isNearWork`, and the ranking of one work's
 * editions (`rankEditions`). Invented titles and authors throughout; pure.
 */

/** What a source found: the fields the same-work rule and the ranking look at. */
type FoundBook = Pick<BookSnapshot, 'title' | 'authors' | 'language' | 'pageCount' | 'year' | 'source'> & {
  coverUrl?: string | null
}
type Found = { id: string; book: FoundBook }

const book = (id: string, overrides: Partial<FoundBook> = {}): Found => ({
  id,
  book: {
    title: 'Cold Water',
    authors: ['Greta Mueller'],
    language: null,
    pageCount: null,
    year: null,
    source: 'openlibrary',
    coverUrl: null,
    ...overrides,
  },
})

describe('sameTitle', () => {
  it('never takes a later volume for the book the series is named after', () => {
    expect(sameTitle('Harbour Lights', 'Harbour Lights - Tome 02 : Warm Sand')).toBe(false)
    expect(sameTitle('Harbour Lights', 'Harbour Lights - Buch 3')).toBe(false)
    expect(sameTitle('Harbour Lights', 'Harbour Lights: Volume Three')).toBe(false)
    expect(sameTitle('Harbour Lights: Volume One', 'Harbour Lights')).toBe(true)
    // …while that volume's own title still finds it.
    expect(sameTitle('Warm Sand', 'Harbour Lights - Tome 02 : Warm Sand')).toBe(true)
  })

  it('takes a series prefix before a dash as not part of the title', () => {
    expect(sameTitle('Harbour Lights - Cold Water', 'Cold Water')).toBe(true)
    expect(sameTitle('Cold Water', 'Harbour Lights - Cold Water')).toBe(true)
  })

  it('takes a subtitle after a dash as not part of the title', () => {
    expect(sameTitle('Cold Water - Eine Liebe am Meer', 'Cold Water')).toBe(true)
  })

  it('takes a series number and colon as not part of the title', () => {
    expect(sameTitle('Nordic Tales 1: Cold Water', 'Cold Water')).toBe(true)
  })

  it('takes a volume mark after the title as not part of it', () => {
    expect(sameTitle('Cold Water T01', 'Cold Water')).toBe(true)
  })

  it('takes the full stop after a series number as where the title begins', () => {
    expect(sameTitle('Harbour 1. Cold Water', 'Cold Water')).toBe(true)
  })

  it('takes a subtitle after a colon as not part of the title', () => {
    expect(sameTitle('Cold Water: A Novel', 'Cold Water')).toBe(true)
  })

  it('takes the Goodreads series in brackets as not part of the title', () => {
    expect(sameTitle('Cold Water (Harbour Lights, #1)', 'Cold Water')).toBe(true)
  })

  it('does not take two volumes of one dash series as one book', () => {
    expect(sameTitle('Harbour Lights – Cold Water', 'Harbour Lights – Warm Sand')).toBe(false)
  })

  it('does not take two different titles as one book', () => {
    expect(sameTitle('Cold Water', 'Bleak House')).toBe(false)
  })
})

describe('sameAuthor', () => {
  it('takes an identical name as one author', () => {
    expect(sameAuthor('Herman Melville', 'Herman Melville')).toBe(true)
  })

  it('takes the catalogue’s surname-first form as the same name', () => {
    expect(sameAuthor('Melville, Herman', 'Herman Melville')).toBe(true)
  })

  it('takes initials spaced or not as the same name', () => {
    expect(sameAuthor('H. G. Wells', 'H.G. Wells')).toBe(true)
  })

  it('takes an umlaut written out or dropped as the same name', () => {
    expect(sameAuthor('Greta Müller', 'Greta Mueller')).toBe(true)
    expect(sameAuthor('Greta Müller', 'Greta Muller')).toBe(true)
    expect(sameAuthor('Greta Muller', 'Greta Mueller')).toBe(true)
  })

  it('takes a two-letter surname typo with the same initial as the same name', () => {
    expect(sameAuthor('Anna Bramley', 'Anna Brumlee')).toBe(true)
  })

  it('does not take a surname typo under another initial', () => {
    expect(sameAuthor('Anna Bramley', 'Nora Brumlee')).toBe(false)
  })

  it('does not take a typo in a surname of three letters or fewer', () => {
    expect(sameAuthor('Jan Vos', 'Jan Voz')).toBe(false)
  })

  it('does not take two clearly different authors as one', () => {
    expect(sameAuthor('Charles Dickens', 'Herman Melville')).toBe(false)
  })
})

describe('isSameWork', () => {
  it('takes a dash series prefix and a spelling of the author as the row’s book', () => {
    expect(
      isSameWork({ title: 'Harbour Lights - Cold Water', authors: ['Greta Müller'] }, { title: 'Cold Water', authors: ['Greta Mueller'] }),
    ).toBe(true)
  })

  it('does not take another volume of the series', () => {
    expect(
      isSameWork(
        { title: 'Harbour Lights: Volume Two', authors: ['Greta Müller'] },
        { title: 'Harbour Lights: Volume Three', authors: ['Greta Mueller'] },
      ),
    ).toBe(false)
  })

  it('takes the same title as the row’s book when the row names no author', () => {
    expect(isSameWork({ title: 'Cold Water', authors: [] }, { title: 'Cold Water', authors: ['Anna Bramley'] })).toBe(true)
  })

  it('does not take a found book by another author', () => {
    expect(isSameWork({ title: 'Cold Water', authors: ['Greta Müller'] }, { title: 'Cold Water', authors: ['Charles Dickens'] })).toBe(false)
  })

  it('does not take a translation whose brackets name the work', () => {
    expect(
      isSameWork({ title: 'Cold Water', authors: ['Greta Müller'] }, { title: 'Θνητοί Θεοί (Cold Water)', authors: ['Greta Müller'] }),
    ).toBe(false)
  })
})

describe('isNearWork', () => {
  it('takes a title that shares its telling words with the row’s, by the same author', () => {
    expect(isNearWork({ title: 'Cold Dark Water', authors: ['Greta Müller'] }, { title: 'Water', authors: ['Greta Mueller'] })).toBe(true)
  })

  it('takes the same title by another author', () => {
    expect(isNearWork({ title: 'Cold Water', authors: ['Anna Bramley'] }, { title: 'Cold Water', authors: ['Charles Dickens'] })).toBe(true)
  })

  it('does not take an unrelated title by the same author', () => {
    expect(isNearWork({ title: 'Cold Water', authors: ['Greta Müller'] }, { title: 'Bleak House', authors: ['Greta Mueller'] })).toBe(false)
  })

  it('does not take another volume of the series', () => {
    expect(
      isNearWork(
        { title: 'Harbour Lights: Volume Two', authors: ['Greta Müller'] },
        { title: 'Harbour Lights: Volume Three', authors: ['Greta Mueller'] },
      ),
    ).toBe(false)
  })
})

describe('rankEditions', () => {
  const row = {
    title: 'Cold Water',
    authors: ['Greta Müller'],
    pageCount: null,
    year: null,
    binding: 'Kindle Edition',
    language: null,
    isbn13: null,
  }

  it('leaves out results that are another work', () => {
    const ranked = rankEditions(row, [book('other', { title: 'Bleak House', authors: ['Charles Dickens'] }), book('ours')])
    expect(ranked.map((result) => result.id)).toEqual(['ours'])
  })

  it('ranks an Apple edition first for a Kindle row, over a print edition without a cover', () => {
    const ranked = rankEditions(row, [book('print'), book('apple', { source: 'apple' })])
    expect(ranked.map((result) => result.id)).toEqual(['apple', 'print'])
  })

  it('ranks an edition with a cover before one without, all else equal', () => {
    const ranked = rankEditions(row, [book('no-cover'), book('cover', { coverUrl: 'https://covers.example/cold-water.jpg' })])
    expect(ranked.map((result) => result.id)).toEqual(['cover', 'no-cover'])
  })
})

describe('what is not the book', () => {
  it('a summary, study guide or workbook sold under its title is not the book', () => {
    const row = { title: 'Bleak House', authors: ['Charles Dickens'] }
    expect(isSameWork(row, { title: 'Bleak House (a Concise and Precise Summary)', authors: ['Charles Dickens'] })).toBe(false)
    expect(isSameWork(row, { title: 'Bleak House: Study Guide', authors: ['Charles Dickens'] })).toBe(false)
    expect(isSameWork({ title: 'Bleak House: Study Guide', authors: ['Charles Dickens'] }, { title: 'Bleak House: Study Guide', authors: ['Charles Dickens'] })).toBe(true)
  })

  it('a French edition of a row that names no language is a translation, ranked last', () => {
    expect(titleLanguage('Cold Water : Une romance de Noël irrésistible')).toBe('fr')
    expect(titleLanguage('Cold Water (édition française)')).toBe('fr')
    expect(titleLanguage('The Cold Water (Svensk utgåva)')).toBe('sv')
    expect(titleLanguage('Cold Water (German Edition)')).toBe('de')
    expect(otherLanguage({ title: 'The Cold Water', language: null }, { title: 'The Cold Water', language: 'pol' })).toBe(true)
    const row = { title: 'Cold Water', authors: ['Greta Mueller'], pageCount: null, year: null, binding: 'Kindle Edition' }
    const french = { title: 'Cold Water : Une romance de Noël', authors: ['Greta Mueller'], language: null, pageCount: null, year: null, source: 'apple' as const, coverUrl: 'https://example.test/fr.jpg' }
    const plain = { ...french, title: 'Cold Water', coverUrl: 'https://example.test/en.jpg' }
    expect(otherLanguage(row, french)).toBe(true)
    expect(otherLanguage(row, plain)).toBe(false)
    expect(rankEditions(row, [{ book: french }, { book: plain }]).map(({ book }) => book.coverUrl)).toEqual(['https://example.test/en.jpg', 'https://example.test/fr.jpg'])
  })
})
