import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { dnbAuthors, dnbTitle, editionFromRecord, isbnQuery, parseDnb, titleQuery, toIsbn13 } from '@/data/dnbRecord'

/**
 * The German National Library as an import source (docs/ENRICHMENT.md): its records read from
 * recordings of the real SRU answers (tests/fixtures/dnb, CC0 data; no live call here).
 */

const fixture = (name: string) => readFileSync(new URL(`./fixtures/dnb/${name}.xml`, import.meta.url), 'utf8')

describe('reading a record', () => {
  it('maps an ISBN hit: title, authors without the translator, ISBN-13, publisher, year, language, pages', () => {
    const [record] = parseDnb(fixture('isbn-bergman'))
    const book = editionFromRecord(record!)
    expect(book).toMatchObject({
      title: 'Die Toten, die niemand vermisst: ein Fall für Sebastian Bergman ; Kriminalroman',
      authors: ['Michael Hjorth', 'Hans Rosenfeldt'],
      isbn13: '9783499267017',
      publisher: 'Rowohlt Polaris',
      year: 2013,
      language: 'ger',
      pages: 622,
    })
    expect(book).not.toHaveProperty('coverUrl')
  })

  it('has no edition for a record without an ISBN-13, and none for a reading', () => {
    const [record] = parseDnb(fixture('isbn-bergman'))
    expect(editionFromRecord({ ...record!, isbn13s: [] })).toBeNull()
    expect(editionFromRecord({ ...record!, rawTitle: 'Der Schwarm : vollständige Lesung / Frank Schätzing' })).toBeNull()
  })

  it('answers nothing for an ISBN it does not know', () => {
    expect(parseDnb(fixture('isbn-none'))).toEqual([])
  })

  it('says a diagnostic is an error, not an empty answer', () => {
    expect(() => parseDnb(fixture('diagnostic'))).toThrow(/Conversion unsuccessful/)
  })
})

describe('the title and the authors as a reader knows them', () => {
  it.each([
    ['Der Schwarm : Roman / Frank Schätzing', 'Der Schwarm: Roman'],
    ['[Schätzing] ; Der Schwarm : Roman / Frank Schätzing', 'Der Schwarm: Roman'],
    ['Knightstone Academy 1 : Begehre uns nicht / Christina Rain', 'Begehre uns nicht'],
    ['[The Hunger Games] ; Die Tribute von Panem 1. Tödliche Spiele / Suzanne Collins', 'Tödliche Spiele'],
    ['Grischa, Band 3: Lodernde Schwingen / Leigh Bardugo', 'Lodernde Schwingen'],
    ['Momo', 'Momo'],
    ['Faust : der Tragödie erster Teil', 'Faust: der Tragödie erster Teil'],
  ])('%s → %s', (raw, title) => {
    expect(dnbTitle(raw)).toBe(title)
  })

  it('turns "Nachname, Vorname [Verfasser]" around and leaves translators, artists and readers out', () => {
    expect(dnbAuthors(['Rowling, J. K. [Verfasser]', 'Fritz, Klaus [Übersetzer]', 'Kaminski, Stefan [Erzähler]'])).toEqual(['J. K. Rowling'])
    // A record that names only contributors (a reading) has no author: it is no match for a book.
    expect(dnbAuthors(['Schätzing, Frank [Mitwirkender]', 'Kaminski, Stefan [Erzähler]'])).toEqual([])
    expect(dnbAuthors(['Goethe'])).toEqual(['Goethe'])
  })
})

describe('asking', () => {
  it('reads an ISBN as typed or printed, or not at all', () => {
    expect(toIsbn13('978-3-499-26701-7')).toBe('9783499267017')
    expect(toIsbn13('3-499-26701-2')).toBe('9783499267017')
    expect(toIsbn13('9783499267018')).toBeNull()
    expect(toIsbn13('hello')).toBeNull()
  })

  it('searches title and author surname, books only, without CQL syntax from the title', () => {
    expect(isbnQuery('9783499267017')).toBe('num=9783499267017')
    expect(titleQuery('Der Schwarm', 'Frank Schätzing')).toBe('tit="Der Schwarm" and per="Schätzing" and (bbg=Aa* or bbg=Oa*)')
    expect(titleQuery('Wer "stört" (die) Nachtigall*', 'Harper Lee')).toBe('tit="Wer stört die Nachtigall" and per="Lee" and (bbg=Aa* or bbg=Oa*)')
    expect(titleQuery('X', 'A')).toBeNull()
  })

  it('keeps the records of a title search that have an ISBN-13, books and readings apart', () => {
    const editions = parseDnb(fixture('title-panem')).map((record) => editionFromRecord(record))
    expect(editions.some((edition) => edition?.title === 'Tödliche Spiele')).toBe(true)
    expect(editions.every((edition) => !edition || !/lesung|hörbuch/i.test(edition.title))).toBe(true)
  })
})
