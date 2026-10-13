import { describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import { coverLender } from '@/data/bookImport'
import { snapshotFromApple } from '@/data/apple'
import { type Candidate, collectIsbn, isComplete, mergeGenreLabels, mergeSources, STORABLE_DESCRIPTION } from '@/data/mergeBook'
import { snapshotFromOpenLibrary } from '@/data/openLibrary'

/**
 * The field-level merge (data/mergeBook.ts): one book from several sources' answers.
 * Synthetic candidates only: nothing here calls a source.
 */

const ISBN = '9783453441088'
const APPLE_COVER = 'https://is1-ssl.mzstatic.com/image/thumb/Publication/1/600x900bb.jpg'
const OL_COVER = 'https://covers.openlibrary.org/b/id/1-L.jpg'
const OL_OTHER = 'https://covers.openlibrary.org/b/id/2-L.jpg'
const GR_COVER = 'https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1/1.jpg'
const LONG = 'Ein Roman über ein Dorf am Meer, in dem im Winter alle Uhren stehen bleiben und niemand weiß, warum.'
const LONGER = `${LONG} Eine Geschichte vom Warten und vom Weggehen, erzählt in kurzen Kapiteln und mit viel Wind.`
const ENGLISH = 'A novel about a village by the sea where every clock stops in winter and nobody knows why, told in short chapters.'

const from = (source: Candidate['source'], book: Candidate['book'], over: Partial<Candidate> = {}): Candidate => ({ source, book, exact: false, ...over })

describe('merging the same book from several sources', () => {
  const dnb = from('dnb', { title: 'Das Wintermeer', authors: ['Anna Autorin'], isbn13: ISBN, pageCount: 320, year: 2021, language: 'ger', publisher: 'Heyne' }, { exact: true })
  const openLibrary = from('openlibrary', { title: 'Das Wintermeer', authors: ['Anna Autorin'], isbn13: ISBN, pageCount: 320, year: 2020, coverUrl: OL_COVER }, { exact: true })
  const apple = from('apple', { title: 'Das Wintermeer', authors: ['Anna Autorin'], pageCount: 288, year: 2021, language: 'de', coverUrl: APPLE_COVER, description: LONG, format: 'ebook' })

  it('takes each field from the best source for it, and says where it came from', () => {
    const { book, provenance } = mergeSources([openLibrary, apple, dnb])
    expect(book).toMatchObject({ title: 'Das Wintermeer', isbn13: ISBN, pageCount: 320, year: 2021, language: 'de', publisher: 'Heyne', description: LONG })
    expect(provenance.pageCount).toEqual({ source: 'dnb', from: 2, exact: true })
    expect(provenance.year).toEqual({ source: 'dnb', from: 2, exact: true })
    expect(provenance.language).toEqual({ source: 'dnb', from: 2, exact: true })
    expect(provenance.description).toEqual({ source: 'apple', from: 1, exact: false })
  })

  it('takes the edition\'s own cover over a sharper one of another edition: edition-exact beats the work\'s ebook', () => {
    const { book, provenance } = mergeSources([openLibrary, apple])
    expect(book.coverUrl).toBe(OL_COVER)
    expect(provenance.cover).toEqual({ source: 'openlibrary', from: 0, exact: true, kind: 'exact' })
  })

  it('takes the work\'s ebook cover when the edition has none, over another print edition and Goodreads', () => {
    const noCover = { ...openLibrary, book: { ...openLibrary.book, coverUrl: null } }
    const sibling = from('openlibrary', { coverUrl: OL_OTHER, format: 'paperback' })
    const goodreads = from('goodreads', { coverUrl: GR_COVER })
    const { book, provenance } = mergeSources([noCover, sibling, goodreads, apple])
    expect(book.coverUrl).toBe(APPLE_COVER)
    expect(provenance.cover?.kind).toBe('ebook')
    expect(mergeSources([noCover, goodreads, sibling]).book.coverUrl).toBe(OL_OTHER)
    expect(mergeSources([noCover, goodreads]).book.coverUrl).toBe(GR_COVER)
    expect(mergeSources([noCover]).book.coverUrl).toBeNull()
  })

  it('takes the taller cover inside one kind, the probed height over the source\'s usual one, and keeps its thumbhash with it', () => {
    const small = from('openlibrary', { coverUrl: OL_COVER, coverThumbhash: 'small', coverColors: { dominant: '#111111', secondary: '#222222' } })
    const big = from('openlibrary', { coverUrl: OL_OTHER, coverThumbhash: 'big', coverColors: { dominant: '#333333', secondary: '#444444' } }, { coverHeight: 900 })
    const merged = mergeSources([small, big])
    expect(merged.book).toMatchObject({ coverUrl: OL_OTHER, coverThumbhash: 'big', coverColors: { dominant: '#333333', secondary: '#444444' } })
    const same = from('openlibrary', { coverUrl: OL_OTHER, coverThumbhash: 'later' })
    expect(mergeSources([small, same]).book.coverThumbhash).toBe('small')
  })

  it('never gives the paperback the ebook\'s pages, year or publisher: those are the edition\'s own', () => {
    const exactWithoutPages = from('openlibrary', { title: 'Das Wintermeer', authors: ['Anna Autorin'], isbn13: ISBN }, { exact: true })
    const { book, provenance } = mergeSources([exactWithoutPages, apple])
    expect(book.pageCount).toBeNull()
    expect(book.year).toBeNull()
    expect(provenance.pageCount).toBeUndefined()
    // …but the work's language and description do come from the ebook.
    expect(book.language).toBe('de')
    expect(book.description).toBe(LONG)
  })

  it('lets what most sources agree on win over the best-ranked source, ties going to the better-ranked, then the earlier', () => {
    const a = from('openlibrary', { pageCount: 288 }, { exact: true })
    const b = from('apple', { pageCount: 288 }, { exact: true })
    const c = from('dnb', { pageCount: 320 }, { exact: true })
    expect(mergeSources([a, b, c]).book.pageCount).toBe(288)
    expect(mergeSources([a, c]).book.pageCount).toBe(320)
    const x = from('import', { pageCount: 300 }, { exact: true })
    const y = from('import', { pageCount: 310 }, { exact: true })
    expect(mergeSources([x, y]).book.pageCount).toBe(300)
    expect(mergeSources([y, x]).book.pageCount).toBe(310)
  })
})

describe('a bad value never replaces a good one', () => {
  const good = from('catalogue', { title: 'Das Wintermeer', authors: ['Anna Autorin'], isbn13: ISBN, pageCount: 320, year: 2021, coverUrl: OL_COVER, description: LONG }, { exact: true })

  it('drops zero pages, an impossible year, a wrong check digit, a cover over plain http and a three-word description', () => {
    const bad = from('dnb', { isbn13: '9783453441089', pageCount: 0, year: 3021, coverUrl: 'http://example.org/c.jpg', description: 'Ein kurzer Satz.', publisher: '   ' }, { exact: true })
    const { book } = mergeSources([bad, good])
    expect(book).toMatchObject({ isbn13: ISBN, pageCount: 320, year: 2021, coverUrl: OL_COVER, description: LONG, publisher: null })
  })

  it('leaves a field null when everything said about it is implausible', () => {
    const { book, provenance } = mergeSources([from('dnb', { pageCount: -3, year: 1066, coverUrl: 'ftp://x' }, { exact: true })])
    expect(book.pageCount).toBeNull()
    expect(book.year).toBeNull()
    expect(book.coverUrl).toBeNull()
    expect(provenance.pageCount).toBeUndefined()
  })

  it('keeps what the Book has when the first candidate is its own record and nothing is strictly better', () => {
    const other = from('catalogue', { pageCount: 280 }, { exact: true })
    expect(mergeSources([good, other]).book.pageCount).toBe(320)
  })

  it('an ISBN-10 stands for its ISBN-13 and a wrong one is dropped', () => {
    expect(mergeSources([from('openlibrary', { isbn10: '3453441087' }, { exact: true })]).book.isbn13).toBe(ISBN)
    expect(mergeSources([from('openlibrary', { isbn10: '3453441088' }, { exact: true })]).book.isbn13).toBeNull()
  })
})

describe('descriptions', () => {
  it('takes the one in the book\'s language over a longer one in another, then the longest', () => {
    const german = from('openlibrary', { description: LONG, language: 'de' })
    const longerGerman = from('apple', { description: LONGER, language: 'de' })
    const english = from('apple', { description: `${ENGLISH} ${ENGLISH}`, language: 'en' })
    expect(mergeSources([english, german], { language: 'de' }).book.description).toBe(LONG)
    expect(mergeSources([german, longerGerman, english], { language: 'de' }).book.description).toBe(LONGER)
    // With nothing in the language, any is better than none.
    expect(mergeSources([english], { language: 'de' }).book.description).toBe(`${ENGLISH} ${ENGLISH}`)
  })

  it('takes none from a source whose terms do not let it be stored, and says it withheld one', () => {
    expect(STORABLE_DESCRIPTION).not.toContain('goodreads')
    expect(STORABLE_DESCRIPTION).not.toContain('google')
    const { book, provenance } = mergeSources([from('goodreads', { description: LONGER }), from('google', { description: LONGER }), from('apple', { description: LONG })])
    expect(book.description).toBe(LONG)
    expect(provenance.withheld).toEqual(['goodreads', 'google'])
    expect(mergeSources([from('goodreads', { description: LONGER })]).book.description).toBeNull()
  })
})

describe('title and authors', () => {
  it('takes the fuller title and the fuller list of authors, never a shorter one over them', () => {
    const plain = from('openlibrary', { title: 'Das Wintermeer', authors: ['Anna Autorin'] })
    const fuller = from('apple', { title: 'Das Wintermeer: Roman', authors: ['Anna Autorin', 'Bernd Übersetzer'] })
    const { book } = mergeSources([plain, fuller])
    expect(book.title).toBe('Das Wintermeer: Roman')
    expect(book.authors).toEqual(['Anna Autorin', 'Bernd Übersetzer'])
    expect(mergeSources([fuller, plain]).book.authors).toEqual(['Anna Autorin', 'Bernd Übersetzer'])
  })

  it('keeps the Catalogue\'s own title', () => {
    const own = from('catalogue', { title: 'Das Wintermeer', authors: ['Anna Autorin'] })
    expect(mergeSources([own, from('apple', { title: 'Das Wintermeer: Roman', authors: ['Anna Autorin'] })]).book.title).toBe('Das Wintermeer')
  })
})

describe('ISBN first', () => {
  it('uses the edition\'s own ISBN, else any source\'s (an ISBN-10 converted), else none', () => {
    expect(collectIsbn([from('apple', {}), from('openlibrary', { isbn13: ISBN })])).toBe(ISBN)
    expect(collectIsbn([from('apple', { isbn13: '9780306406157' }), from('openlibrary', { isbn13: ISBN }, { exact: true })])).toBe(ISBN)
    expect(collectIsbn([from('openlibrary', { isbn10: '3453441087' })])).toBe(ISBN)
    expect(collectIsbn([from('openlibrary', { isbn13: '9783453441089' }), from('apple', { title: 'x' })])).toBeNull()
  })
})

describe('knowing when to stop asking', () => {
  it('is complete with the edition\'s own cover, pages and a language', () => {
    const merged = mergeSources([from('openlibrary', { isbn13: ISBN, pageCount: 320, language: 'ger', coverUrl: OL_COVER }, { exact: true })])
    expect(isComplete(merged)).toBe(true)
    expect(isComplete(mergeSources([from('openlibrary', { isbn13: ISBN, pageCount: 320, language: 'ger' }, { exact: true }), from('apple', { coverUrl: APPLE_COVER })]))).toBe(false)
  })
})

describe('the import borrows a cover by the same ranking', () => {
  const row = { title: 'Das Wintermeer', language: 'de' }
  const book = (over: Partial<BookSnapshot>): BookSnapshot => ({
    title: 'Das Wintermeer',
    authors: ['Anna Autorin'],
    isbn13: null,
    isbn10: null,
    pageCount: null,
    year: null,
    language: null,
    publisher: null,
    description: null,
    coverUrl: null,
    coverThumbhash: null,
    coverColors: null,
    source: 'openlibrary',
    appleId: null,
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
    ...over,
  })

  it('lends the work\'s ebook (Apple) over another print edition, whatever order they came in', () => {
    const print = book({ coverUrl: OL_COVER })
    const ebook = book({ coverUrl: APPLE_COVER, source: 'apple' })
    expect(coverLender(row, book({ isbn13: ISBN, source: 'import' }), [print, ebook])).toBe(ebook)
    expect(coverLender(row, book({ isbn13: ISBN, source: 'import' }), [ebook, print])).toBe(ebook)
  })

  it('lends the first one with a cover, skips a bare one and one in another language, and nothing when the Book has its own', () => {
    const bare = book({ source: 'apple' })
    const english = book({ title: 'The Winter Sea', coverUrl: OL_OTHER, language: 'en' })
    const print = book({ coverUrl: OL_COVER })
    expect(coverLender(row, book({ source: 'import' }), [bare, english, print])).toBe(print)
    expect(coverLender(row, book({ source: 'import' }), [bare, english])).toBeNull()
    expect(coverLender(row, book({ source: 'import', coverUrl: OL_COVER }), [print])).toBeNull()
  })
})

describe('raw genre labels (collected, not stored yet)', () => {
  it('unites every candidate\'s labels, one per spelling, with the sources that named them; agreed ones first', () => {
    const { genres } = mergeSources([
      { source: 'apple', exact: true, book: { title: 'Bleak House', genreLabels: ['Classics', 'Fiction & Literature'] } },
      { source: 'openlibrary', exact: false, book: { title: 'Bleak House', genreLabels: ['fiction  & literature', 'London (England)', 'Classics'] } },
      { source: 'openlibrary', exact: false, book: { title: 'Bleak House', genreLabels: ['Classics', ' '] } },
    ])
    expect(genres).toEqual([
      { label: 'Classics', sources: ['apple', 'openlibrary'], from: [0, 1, 2] },
      { label: 'Fiction & Literature', sources: ['apple', 'openlibrary'], from: [0, 1] },
      { label: 'London (England)', sources: ['openlibrary'], from: [1] },
    ])
  })

  it('maps nothing onto the app\'s genre list and is empty when no source named any', () => {
    expect(mergeGenreLabels([{ source: 'apple', exact: true, book: { title: 'Bleak House' } }])).toEqual([])
    expect(mergeGenreLabels([{ source: 'apple', exact: true, book: { genreLabels: ['Mysteries & Thrillers'] } }])[0]!.label).toBe('Mysteries & Thrillers')
  })

  it('carries what Apple and Open Library call a book\'s genres on their snapshots, raw', () => {
    expect(snapshotFromApple({ kind: 'ebook', trackId: 1, trackName: 'Bleak House', genres: ['Classics', 'Books'] })?.genreLabels).toEqual(['Classics'])
    expect(snapshotFromApple({ kind: 'ebook', trackId: 1, trackName: 'Bleak House' })).not.toHaveProperty('genreLabels')
    const doc = { key: '/works/OL1W', title: 'Bleak House', cover_edition_key: 'OL1M', subject: ['Fiction', 'London (England)'] }
    expect(snapshotFromOpenLibrary(doc)?.genreLabels).toEqual(['Fiction', 'London (England)'])
  })
})
