import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { findEdition } from '@/data/bookImport'
import { createDnb, DNB_FAILURES, dnbAuthors, dnbTitle, parseDnb, snapshotFromDnb } from '@/data/dnb'
import type { FetchLike } from '@/data/fetching'

/**
 * The German National Library as an import source (docs/ENRICHMENT.md): its records read from
 * recordings of the real SRU answers (tests/fixtures/dnb, CC0 data; no live call here).
 */

const fixture = (name: string) => readFileSync(new URL(`./fixtures/dnb/${name}.xml`, import.meta.url), 'utf8')
const answering = (...bodies: string[]): { fetch: FetchLike; urls: string[] } => {
  const urls: string[] = []
  let at = 0
  return {
    urls,
    fetch: async (url) => {
      urls.push(url)
      const body = bodies[Math.min(at++, bodies.length - 1)]!
      return { ok: true, status: 200, json: async () => ({}), text: async () => body }
    },
  }
}

describe('reading a record', () => {
  it('maps an ISBN hit: title, authors without the translator, ISBN-13, publisher, year, language, pages', () => {
    const [record] = parseDnb(fixture('isbn-bergman'))
    const book = snapshotFromDnb(record!)
    expect(book).toMatchObject({
      title: 'Die Toten, die niemand vermisst: ein Fall für Sebastian Bergman ; Kriminalroman',
      authors: ['Michael Hjorth', 'Hans Rosenfeldt'],
      isbn13: '9783499267017',
      publisher: 'Rowohlt Polaris',
      year: 2013,
      language: 'ger',
      pageCount: 622,
      source: 'import',
      coverUrl: null,
    })
  })

  it('has no snapshot for a record without an ISBN (an import Book is keyed by its ISBN)', () => {
    const [record] = parseDnb(fixture('isbn-bergman'))
    expect(snapshotFromDnb({ ...record!, isbn13s: [] })).toBeNull()
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

describe('asking the source', () => {
  it('looks an ISBN up and gives the snapshot of the record that has it', async () => {
    const { fetch, urls } = answering(fixture('isbn-bergman'))
    const book = await createDnb({ fetch }).lookupIsbn('9783499267017')
    expect(book?.title).toContain('Die Toten, die niemand vermisst')
    expect(new URL(urls[0]!).searchParams.get('query')).toBe('num=9783499267017')
  })

  it('is null for an ISBN no record has', async () => {
    expect(await createDnb({ fetch: answering(fixture('isbn-none')).fetch }).lookupIsbn('9780000000002')).toBeNull()
  })

  it('searches title and author surname, books only, and keeps the records that have an ISBN-13', async () => {
    const { fetch, urls } = answering(fixture('title-schwarm'))
    const found = await createDnb({ fetch }).search('Der Schwarm', 'Frank Schätzing')
    expect(new URL(urls[0]!).searchParams.get('query')).toBe('tit="Der Schwarm" and per="Schätzing" and (bbg=Aa* or bbg=Oa*)')
    expect(found.length).toBeGreaterThan(0)
    expect(found.every((book) => book.isbn13 && book.source === 'import')).toBe(true)
  })

  it('does not put CQL syntax from a title into the query', async () => {
    const { fetch, urls } = answering(fixture('isbn-none'))
    await createDnb({ fetch }).search('Wer "stört" (die) Nachtigall*', 'Harper Lee')
    expect(new URL(urls[0]!).searchParams.get('query')).toBe('tit="Wer stört die Nachtigall" and per="Lee" and (bbg=Aa* or bbg=Oa*)')
  })

  it('rests after a few errors in a row, and asks again once the rest is over', async () => {
    let clock = 0
    const { fetch, urls } = answering(fixture('diagnostic'), fixture('diagnostic'), fixture('diagnostic'), fixture('isbn-bergman'))
    const dnb = createDnb({ fetch, now: () => clock })
    for (let n = 0; n < DNB_FAILURES; n++) await expect(dnb.lookupIsbn('9783499267017')).rejects.toThrow()
    expect(urls).toHaveLength(DNB_FAILURES)
    await expect(dnb.lookupIsbn('9783499267017')).rejects.toThrow('resting')
    expect(urls).toHaveLength(DNB_FAILURES)
    clock = 61_000
    expect(await dnb.lookupIsbn('9783499267017')).not.toBeNull()
  })

  it('rejects with an abort when its signal aborted', async () => {
    const controller = new AbortController()
    const fetch: FetchLike = async () => {
      controller.abort()
      throw new Error('aborted')
    }
    await expect(createDnb({ fetch }).lookupIsbn('9783499267017', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('as the last source of an import row', () => {
  const nothing = { catalogue: { search: async () => [] }, search: { lookupIsbn: async () => null, search: async () => ({ results: [], pending: false, failed: false }) } }
  const row = (fields: object) =>
    ({ title: 'Der Schwarm', authors: ['Frank Schätzing'], isbn13: null, isbn10: null, pageCount: null, year: null, binding: null, language: null, ...fields }) as never

  it('finds the exact edition of an ISBN nobody else knows, keeping her title and authors', async () => {
    const dnb = createDnb({ fetch: answering(fixture('isbn-bergman')).fetch })
    const edition = await findEdition(row({ title: 'Die Toten, die niemand vermisst', authors: ['Michael Hjorth'], isbn13: '9783499267017' }), { ...nothing, dnb } as never)
    expect(edition).toMatchObject({ via: 'isbn', book: { title: 'Die Toten, die niemand vermisst', authors: ['Michael Hjorth'], isbn13: '9783499267017', publisher: 'Rowohlt Polaris', language: 'ger' } })
  })

  it('finds a row without an ISBN by title and author, and gives it the edition\'s ISBN', async () => {
    const dnb = createDnb({ fetch: answering(fixture('title-schwarm')).fetch })
    const edition = await findEdition(row({}), { ...nothing, dnb } as never)
    expect(edition.via).toBe('title')
    expect(edition.book).toMatchObject({ title: 'Der Schwarm', authors: ['Frank Schätzing'], source: 'import' })
    expect(edition.book.isbn13).toMatch(/^97[89]\d{10}$/)
  })

  it('is not asked when another source knew the book, and a source that fails is no match', async () => {
    let asked = 0
    const dnb = { lookupIsbn: async () => (asked++, null), search: async () => (asked++, []) }
    const known = { title: 'X', authors: ['A'], isbn13: '9783499267017', source: 'apple' }
    await findEdition(row({ isbn13: '9783499267017' }), { ...nothing, search: { ...nothing.search, lookupIsbn: async () => known }, dnb } as never)
    expect(asked).toBe(0)
    const failing = createDnb({ fetch: answering(fixture('diagnostic')).fetch })
    const edition = await findEdition(row({}), { ...nothing, dnb: failing } as never)
    expect(edition).toMatchObject({ via: null, unsure: true })
  })
})
