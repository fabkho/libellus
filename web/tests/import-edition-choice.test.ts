import { describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import { createBookImport, editionChoices, fileEdition, findEdition, type Lookups } from '@/data/bookImport'
import type { ImportBook } from '@/data/import/rows'
import { signUpMember } from './support/member'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * Choosing the edition of a row in the import's preview (#111): what the
 * match keeps of its search (the same work's editions, best fit first), what
 * the Choose edition sheet opens with (`editionChoices`), the row as the file
 * has it (`fileEdition`), and that the import then writes the edition she
 * picked rather than the match's own.
 */

const row = (overrides: Partial<ImportBook> = {}): ImportBook => ({
  source: 'goodreads',
  key: `goodreads:${Math.random().toString(36).slice(2)}`,
  sourceId: '1',
  row: 1,
  title: 'Piranesi',
  series: null,
  authors: ['Susanna Clarke'],
  isbn13: null,
  isbn10: null,
  pageCount: null,
  year: null,
  originalYear: null,
  binding: null,
  language: null,
  publisher: null,
  shelf: 'read',
  shelves: [],
  status: 'want_to_read',
  session: null,
  earlierReads: [],
  extraReads: 0,
  otherKeys: [],
  addedOn: null,
  problems: [],
  ...overrides,
})

function snapshot(overrides: Partial<BookSnapshot> = {}): BookSnapshot {
  return {
    title: 'Piranesi',
    authors: ['Susanna Clarke'],
    isbn13: null,
    isbn10: null,
    pageCount: null,
    year: null,
    language: null,
    publisher: TEST_PUBLISHER,
    description: null,
    coverUrl: null,
    coverThumbhash: null,
    coverColors: null,
    source: 'openlibrary',
    appleId: null,
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
    ...overrides,
  }
}

const found = (book: BookSnapshot) => ({ book, entry: null, otherEdition: false })

function lookupsFinding(...books: BookSnapshot[]): Lookups {
  return {
    catalogue: { search: async () => [] },
    search: { lookupIsbn: async () => null, search: async () => ({ results: books.map(found), pending: false, failed: false }) },
  }
}

describe('the editions a row can be chosen from', () => {
  const english = snapshot({ language: 'en', pageCount: 272, isbn13: '9781526622419', openLibraryEditionKey: 'OL1M' })
  const german = snapshot({ language: 'ger', pageCount: 288, isbn13: '9783446270299', openLibraryEditionKey: 'OL2M' })
  const other = snapshot({ title: 'Piranesi: Drawings', authors: ['Maria Peitcheva'] })

  it('the match keeps the same work\'s editions, the one it picked first and the others in the order it ranks them', async () => {
    const edition = await findEdition(row({ pageCount: 288 }), lookupsFinding(english, other, german))
    expect(edition.book).toBe(german)
    expect(edition.alternatives).toEqual([german, english])
  })

  it('keeps them for a row only its ISBN knows, and for a row nothing was found for (none then)', async () => {
    const known = await findEdition(row({ isbn13: '9790000001022' }), lookupsFinding(english))
    expect(known).toMatchObject({ via: null, coverFrom: english, alternatives: [english] })
    const none = await findEdition(row(), lookupsFinding(other))
    expect(none).toMatchObject({ via: null, alternatives: [] })
  })

  it('keeps none for a row found by its ISBN: that edition is the one she shelved', async () => {
    const lookups: Lookups = { ...lookupsFinding(english), search: { ...lookupsFinding(english).search, lookupIsbn: async () => english } }
    const edition = await findEdition(row({ isbn13: '9781526622419' }), lookups)
    expect(edition).toMatchObject({ via: 'isbn' })
    expect(edition.alternatives).toBeUndefined()
  })

  it('opens on the edition the preview has, then the file\'s own row, then the match\'s other editions', async () => {
    const book = row({ pageCount: 288 })
    const edition = await findEdition(book, lookupsFinding(english, german))
    const choices = editionChoices(book, edition)
    expect(choices.map(({ book: shown, current, file }) => [shown.title, shown.language ?? null, current, Boolean(file)])).toEqual([
      ['Piranesi', 'ger', true, false],
      ['Piranesi', null, false, true],
      ['Piranesi', 'en', false, false],
    ])
    // The row as the file has it is a Manual book of hers without an ISBN.
    expect(choices[1]!.book).toMatchObject({ source: 'manual', isbn13: null, pageCount: 288 })
  })

  it('a row only from the file has its own row as the current one, once, and wears the cover it borrows', async () => {
    const work = snapshot({ language: 'en', coverUrl: 'https://example.test/c.jpg', coverThumbhash: 'abc' })
    const book = row({ isbn13: '9790000001022' })
    const edition = await findEdition(book, lookupsFinding(work))
    const choices = editionChoices(book, edition)
    expect(choices.map(({ current, file }) => [current, Boolean(file)])).toEqual([
      [true, true],
      [false, false],
    ])
    expect(choices[0]!.book).toMatchObject({ source: 'import', isbn13: '9790000001022', coverUrl: 'https://example.test/c.jpg' })
    // Picked, it is still the import Book of its ISBN; the cover is lent only when it is written.
    expect(fileEdition(book, [work])).toMatchObject({ via: null, coverFrom: work, book: { source: 'import', coverUrl: null } })
  })

  it('leaves out an edition that looks like one already listed', () => {
    const book = row()
    const edition = { book: english, via: 'title' as const, unsure: false, alternatives: [english, { ...english }, german] }
    expect(editionChoices(book, edition).map(({ book: shown }) => shown.language ?? null)).toEqual(['en', null, 'ger'])
  })
})

describe('writing the edition she chose', () => {
  it('adds the entry with the picked edition, not the one the match had', async () => {
    const member = await signUpMember()
    const title = runTitle('Choice')
    const matched = snapshot({ title, language: 'en', isbn13: null, appleId: uniqueAppleId(), source: 'apple' })
    const picked = snapshot({ title, language: 'de', isbn13: null, appleId: uniqueAppleId(), source: 'apple', pageCount: 321 })
    const book = row({ title })
    const importer = createBookImport(member.client, { lookups: lookupsFinding(matched, picked), probe: async () => null })

    const chosen = { book: picked, via: 'title' as const, unsure: false }
    const written = await importer.write(
      [{
        key: book.key,
        title: book.title,
        authors: book.authors,
        status: 'want_to_read',
        session: null,
        extraReads: 0,
        pageCount: null,
        otherKeys: [],
        addedOn: null,
        collections: [],
        book: chosen.book,
        coverFrom: null,
      }],
      { onWritten: () => {} },
    )
    expect(written.data!.map((outcome) => outcome.outcome)).toEqual(['added'])
    const stored = await sql<{ title: string; language: string | null; page_count: number | null; apple_id: string | null }>(
      `select b.title, b.language, b.page_count, b.apple_id
         from public.library_entries e join public.books b on b.id = e.book_id where e.member_id = $1`,
      [member.id],
    )
    expect(stored).toEqual([{ title, language: 'de', page_count: 321, apple_id: picked.appleId }])
  })
})
