import { randomInt } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createCatalogueSearch } from '@/data/catalogueSearch'
import { createBookImport, importedKeys, libraryTitleIndex, type Edition, type ImportRow, type Lookups } from '@/data/bookImport'
import { parseExport } from '@/data/import/detect'
import type { ImportBook } from '@/data/import/rows'
import { isoDay } from '@/utils/dates'
import { signUpMember } from './support/member'
import { runTitle, sql, TEST_PUBLISHER } from './support/stack'

/**
 * Importing a Hardcover export (#111) through the same repository and
 * `import_books` as Goodreads', against the local stack, as real signed-in
 * members: every read with its days, the same file twice adding nothing, and
 * a Goodreads export then a Hardcover export of the same library adding no
 * second entry and no second read. No source is asked (`nowhere`): every
 * Book is the file's own. Titles carry the run's tag and the test publisher,
 * so the sweep removes the Books.
 */

const today = isoDay()

/** A valid ISBN-13 no real book has (979-0, the music range), unique enough per run. */
function uniqueIsbn(): string {
  const body = `9790${String(randomInt(0, 1e8)).padStart(8, '0')}`
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0)
  return `${body}${(10 - (sum % 10)) % 10}`
}

const nowhere: Lookups['search'] = {
  lookupIsbn: async () => null,
  search: async () => ({ results: [], pending: false, failed: false }),
}

const HEADER =
  'Title,Author,Series,Status,Privacy,Hardcover Book ID,Hardcover Edition ID,ISBN 10,ISBN 13,ASIN,Media,Country Code,' +
  'Language Code,Binding,Pages,Duration in Seconds,Publish Date,Publisher,Genres,Moods,Tags,Content Warnings,Lists,' +
  'Date Added,Date Started,Date Finished,Rating,Review,Review Contains Spoilers,Sponsored Review,Review Date,Review URL,' +
  'Review Media URL,Private Notes,Owned,Compilation,Review Slate'

type HardcoverRow = Partial<Record<'title' | 'author' | 'status' | 'id' | 'isbn' | 'lists' | 'added' | 'started' | 'finished' | 'rating' | 'review' | 'owned', string>>

/** A Hardcover export in its own shape: every column, most of them empty. */
function hardcoverFile(rows: HardcoverRow[]): string {
  const cell = (value = '') => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)
  return [
    HEADER,
    ...rows.map((row) =>
      [
        row.title, row.author, '', row.status, 'Public', row.id, '', '', row.isbn, '', 'Book', 'us', 'en', '', '300', '',
        '2019-01-01', TEST_PUBLISHER, '', '', '', '', row.lists, row.added, row.started, row.finished, row.rating, row.review,
        'false', 'false', '', '', '', '', row.owned ?? 'false', 'No', '{}',
      ]
        .map(cell)
        .join(','),
    ),
  ].join('\n')
}

async function matchAll(importer: ReturnType<typeof createBookImport>, books: readonly ImportBook[]) {
  const editions: Edition[] = []
  await importer.match(books, { onEdition: (index, edition) => void (editions[index] = edition) })
  return editions
}

const rowsOf = (books: readonly ImportBook[], editions: readonly Edition[]): ImportRow[] =>
  books.map((book, index) => ({
    key: book.key,
    title: book.title,
    authors: book.authors,
    status: book.status,
    session: book.session,
    extraReads: book.extraReads,
    earlierReads: book.earlierReads,
    pageCount: book.pageCount,
    otherKeys: book.otherKeys,
    addedOn: book.addedOn,
    collections: book.shelves,
    book: editions[index]!.book,
  }))

async function importFile(member: Awaited<ReturnType<typeof signUpMember>>, text: string) {
  const file = parseExport(text, today)
  const importer = createBookImport(member.client, { lookups: { catalogue: createCatalogueSearch(member.client), search: nowhere }, probe: async () => null })
  const written = await importer.write(rowsOf(file.books, await matchAll(importer, file.books)), { onWritten: () => {} })
  expect(written.error).toBeNull()
  return { file, outcomes: written.data!.map((outcome) => outcome.outcome) }
}

const readsOf = (memberId: string) =>
  sql<{ title: string; status: string; reads: unknown; collections: string[] | null }>(
    `select b.title, e.status,
            (select json_agg(json_build_object('started', s.started_on, 'ended', s.ended_on, 'outcome', s.outcome,
                                               'rating', s.rating, 'key', s.import_key) order by s.created_at)
               from public.reading_sessions s where s.entry_id = e.id) as reads,
            (select array_agg(c.name order by c.name) from public.collection_entries ce
               join public.collections c on c.id = ce.collection_id where ce.entry_id = e.id) as collections
       from public.library_entries e join public.books b on b.id = e.book_id
      where e.member_id = $1 order by b.title`,
    [memberId],
  )

describe('importing a Hardcover export', () => {
  it('adds every read with its days, her lists and Owned as Collections, and nothing the second time', async () => {
    const member = await signUpMember()
    const twice = runTitle('Twice Read')
    const now = runTitle('Read Now')
    const stopped = runTitle('Stopped Reading')
    const text = hardcoverFile([
      { title: twice, author: 'Mira Okafor', status: 'Read', id: '7001', isbn: uniqueIsbn(), lists: 'Favourites (#2)', owned: 'true',
        added: '2019-12-30', started: '2020-01-05,2024-02-20', finished: '2020-02-01,2024-03-09', rating: '4.5', review: 'Again, better.' },
      { title: now, author: 'Hanne Soberg', status: 'Currently Reading', id: '7002', isbn: uniqueIsbn(), added: '2025-07-30',
        started: '2023-01-01,2025-08-01', finished: '2023-01-20' },
      { title: stopped, author: 'Bram Oduya', status: 'Did Not Finish', id: '7003', started: '2024-05-01', finished: '2024-05-09' },
    ])

    const first = await importFile(member, text)
    expect(first.file.source).toBe('hardcover')
    expect(first.outcomes).toEqual(['added', 'added', 'added'])
    const stored = await readsOf(member.id)
    expect(stored).toEqual([
      { title: now, status: 'reading', collections: null, reads: [
        { started: '2023-01-01', ended: '2023-01-20', outcome: 'finished', rating: null, key: 'hardcover:7002#2' },
        { started: '2025-08-01', ended: null, outcome: null, rating: null, key: 'hardcover:7002' },
      ] },
      { title: stopped, status: 'finished', collections: null, reads: [
        { started: '2024-05-01', ended: '2024-05-09', outcome: 'abandoned', rating: null, key: 'hardcover:7003' },
      ] },
      { title: twice, status: 'finished', collections: ['Favourites', 'Owned'], reads: [
        { started: '2020-01-05', ended: '2020-02-01', outcome: 'finished', rating: null, key: 'hardcover:7001#2' },
        { started: '2024-02-20', ended: '2024-03-09', outcome: 'finished', rating: 18, key: 'hardcover:7001' },
      ] },
    ])

    // The same file again: every row imported before, no read added.
    const again = await importFile(member, text)
    expect(again.outcomes).toEqual(['imported', 'imported', 'imported'])
    expect(await readsOf(member.id)).toEqual(stored)
    const keys = await importedKeys(member.client)
    expect([...keys.data!.keys()].sort()).toEqual(['hardcover:7001', 'hardcover:7002', 'hardcover:7003'])
  })

  it('adds no second entry and no read for a library imported from Goodreads before', async () => {
    const member = await signUpMember()
    const shared = runTitle('Shared Shelf')
    const plain = runTitle('Plain Wish')
    const isbn = uniqueIsbn()
    const goodreads = [
      'Book Id,Title,Author,ISBN,ISBN13,My Rating,Publisher,Number of Pages,Date Read,Date Added,Bookshelves,Exclusive Shelf,Read Count',
      `81,"${shared} (Shared, #1)",Nora Vale,"=""""","=""${isbn}""",4,${TEST_PUBLISHER},300,2024/03/09,2024/02/01,,read,2`,
      `82,${plain},Ola Strand,"=""""","=""""",0,,200,,2025/06/10,,to-read,0`,
    ].join('\n')
    const first = await importFile(member, goodreads)
    expect(first.file.source).toBe('goodreads')
    expect(first.outcomes).toEqual(['added', 'added'])
    const before = await readsOf(member.id)

    // Hardcover's export of the same library: the same ISBN; the other found by its title and author.
    const hardcover = hardcoverFile([
      { title: shared, author: 'Nora Vale', status: 'Read', id: '8101', isbn, started: '2019-05-01,2024-02-20', finished: '2019-05-30,2024-03-09', rating: '4' },
      { title: plain, author: 'Ola Strand', status: 'Want to Read', id: '8102' },
    ])
    const file = parseExport(hardcover, today)
    // The preview already knows both are hers (libraryTitleIndex), as the database does on writing.
    const library = await createCatalogueSearch(member.client).libraryEntries()
    const keys = await importedKeys(member.client)
    const hers = libraryTitleIndex(library, keys.data!)
    expect(file.books.map((book) => hers(book)?.book.title ?? null)).toEqual([shared, plain])

    const second = await importFile(member, hardcover)
    expect(second.outcomes).toEqual(['in_library', 'in_library'])
    expect(await readsOf(member.id)).toEqual(before)
  })
})
