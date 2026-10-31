import { assert, assertEquals, assertRejects } from '@std/assert'
import { importArguments } from '../../../web/app/data/bookImport.ts'
import type { Book, BookSnapshot } from '../../../web/app/data/books.ts'
import { importRowOf, type WriteChoice } from './choice.ts'
import type { Job, WorkContext, WriteFailure, WriteRow, WrittenOutcome } from './runner.ts'
import { PIRANESI, row as fileRow } from './test_support.ts'
import { createWriteWork } from './write.ts'

const JOB: Job = { id: 'job-1', member_id: 'ada', source: 'goodreads', languages: ['de-DE'], total: 4, done: 4 }

const snapshot = (fields: Partial<BookSnapshot> = {}): BookSnapshot => ({
  title: 'Piranesi',
  authors: ['Susanna Clarke'],
  isbn13: '9781635575637',
  isbn10: null,
  pageCount: 272,
  year: 2020,
  language: 'en',
  publisher: 'Bloomsbury',
  description: null,
  coverUrl: null,
  coverThumbhash: null,
  coverColors: null,
  source: 'openlibrary',
  appleId: null,
  openLibraryEditionKey: null,
  openLibraryWorkKey: null,
  ...fields,
})
const catalogueBook = (fields: Partial<Book> = {}) => ({ id: 'book-1', ...snapshot(), ...fields }) as unknown as Book

/** A row for the write phase, as `import_job_take_write_rows` hands it out. */
function writeRow(idx: number, choice: Partial<WriteChoice> & Pick<WriteChoice, 'book'>, cover: Partial<WriteRow> = {}, file = PIRANESI): WriteRow {
  return {
    idx,
    key: file.key,
    payload: { ...file, collections: ['Favourites'] },
    match_book: { lent: null, filled: false, ...choice },
    cover_source: null,
    cover_url: null,
    cover_size: null,
    outcome: null,
    ...cover,
  }
}

/** The member's calls: `import_books` answers `outcome` per key (added by default), the fill is recorded. */
function world(outcomes: Record<string, WrittenOutcome> = {}) {
  const written: { idx: number; row: Record<string, unknown> }[] = []
  const filled: Record<string, unknown>[][] = []
  const saved: { idx: number; failure?: WriteFailure }[] = []
  let refuse = false
  let failWrite: Error | null = null
  let failFill = false
  const calls = {
    write(idx: number, row: Record<string, unknown>) {
      if (failWrite && idx === 2) return Promise.reject(failWrite)
      written.push({ idx, row })
      return Promise.resolve({ key: String(row.key), outcome: outcomes[String(row.key)] ?? 'added', entry_id: null, error: null })
    },
    fillCovers(covers: Record<string, unknown>[]) {
      if (failFill) return Promise.reject(new Error('fill_book_covers: down'))
      filled.push(covers)
      return Promise.resolve()
    },
  }
  const work = createWriteWork({ member: () => calls, now: () => 1_000_000, log: () => {} })
  const context = (): WorkContext => ({
    runner: 'r',
    deadline: 1_000_000 + 120_000,
    save: () => Promise.resolve(true),
    saveCover: () => Promise.resolve(true),
    saveWrite: (idx, failure) => {
      if (refuse) return Promise.resolve(false)
      saved.push(failure ? { idx, failure } : { idx })
      return Promise.resolve(true)
    },
    waitUntil: () => {},
    stopped: () => refuse,
  })
  return {
    work,
    context,
    written,
    filled,
    saved,
    refuseSaves: () => (refuse = true),
    failWriteOf: (error: Error) => (failWrite = error),
    failFills: () => (failFill = true),
  }
}

Deno.test('the row is written as the app writes it: importArguments of the app\'s own ImportRow (statuses, dates, rating, shelves)', async () => {
  const w = world()
  const file = fileRow({ key: 'goodreads:7', title: 'Seven', authors: ['A. Writer'], status: 'finished', addedOn: '2023-05-06', pageCount: 300, otherKeys: ['goodreads:8'] }, 7)
  const book = snapshot({ title: 'Seven', isbn13: '9780000000007', coverUrl: 'https://covers.openlibrary.org/b/id/7-L.jpg', coverThumbhash: 'abc=' })
  const row = writeRow(0, { book }, { cover_source: 'edition', cover_url: book.coverUrl }, file)
  await w.work(JOB, [row], w.context())
  assertEquals(w.written.length, 1)
  const argument = w.written[0]!.row
  assertEquals(argument, importArguments({
    key: 'goodreads:7',
    title: 'Seven',
    authors: ['A. Writer'],
    status: 'finished',
    session: file.session,
    extraReads: 0,
    earlierReads: [],
    pageCount: 300,
    otherKeys: ['goodreads:8'],
    addedOn: '2023-05-06',
    collections: ['Favourites'],
    book,
  }))
  assertEquals(argument.status, 'finished')
  assertEquals(argument.rating, 16)
  assertEquals(argument.ended_on, '2024-03-09')
  assertEquals(argument.collections, ['Favourites'])
  assertEquals(w.saved, [{ idx: 0 }])
})

Deno.test('a Hardcover zip row\'s progress is written with its read: on an open read and on an abandoned one, as { page } or { percent }', async () => {
  const w = world()
  const reading = fileRow({
    key: 'hardcover:11',
    title: 'Eleven',
    authors: ['A. Writer'],
    status: 'reading',
    session: { startedOn: '2026-09-01', endedOn: null, outcome: null, rating: null, review: null, progress: { page: 120 } },
  }, 11)
  const stopped = fileRow({
    key: 'hardcover:12',
    title: 'Twelve',
    authors: ['A. Writer'],
    status: 'finished',
    session: { startedOn: '2026-01-01', endedOn: '2026-02-01', outcome: 'abandoned', rating: null, review: null, progress: { percent: 35 } },
  }, 12)
  await w.work(JOB, [writeRow(0, { book: snapshot() }, {}, reading), writeRow(1, { book: snapshot() }, {}, stopped)], w.context())
  assertEquals(w.written.map(({ row }) => row.progress), [{ page: 120 }, { percent: 35 }])
  assertEquals(w.written[1]!.row.outcome, 'abandoned')
})

Deno.test('a row of the old shape (no progress, as every CSV row and every job queued before the migration) is written without the field', async () => {
  const w = world()
  const finished = fileRow({ key: 'goodreads:13', title: 'Thirteen', authors: ['A. Writer'] }, 13)
  const reading = fileRow({
    key: 'goodreads:14',
    title: 'Fourteen',
    authors: ['A. Writer'],
    status: 'reading',
    session: { startedOn: '2026-09-01', endedOn: null, outcome: null, rating: null, review: null, progress: null },
  }, 14)
  await w.work(JOB, [writeRow(0, { book: snapshot() }, {}, finished), writeRow(1, { book: snapshot() }, {}, reading)], w.context())
  for (const { row } of w.written) assertEquals('progress' in row, false)
})

Deno.test('a matched Catalogue Book is written by its id; its own cover is nothing to fill', async () => {
  const w = world()
  const book = catalogueBook({ coverUrl: 'https://covers.openlibrary.org/b/id/1-L.jpg' })
  await w.work(JOB, [writeRow(0, { book }, { cover_source: 'edition', cover_url: book.coverUrl })], w.context())
  assertEquals(w.written[0]!.row.book_id, 'book-1')
  assertEquals('book' in w.written[0]!.row, false)
  assertEquals(w.filled, [])
  assertEquals(w.saved, [{ idx: 0 }])
})

Deno.test('a Catalogue Book that got a cover in the job (Open Library, Goodreads, a lent one) is handed to fill_book_covers, by id', async () => {
  const w = world()
  const bare = catalogueBook({ coverUrl: null })
  const lent = catalogueBook({ id: 'book-3', coverUrl: 'https://covers.openlibrary.org/b/id/3-L.jpg' })
  await w.work(JOB, [
    writeRow(0, { book: bare }, { cover_source: 'openlibrary', cover_url: 'https://covers.openlibrary.org/b/id/22-L.jpg' }),
    writeRow(1, { book: catalogueBook({ id: 'book-2' }) }, { cover_source: 'goodreads', cover_url: 'https://i.gr-assets.com/books/1l/2.jpg' }),
    writeRow(2, { book: lent, filled: true }, { cover_source: 'lent', cover_url: lent.coverUrl }),
  ], w.context())
  assertEquals(w.filled.length, 1)
  assertEquals(w.filled[0], [
    { book_id: 'book-1', cover_url: 'https://covers.openlibrary.org/b/id/22-L.jpg', cover_thumbhash: null, cover_dominant: null, cover_secondary: null },
    { book_id: 'book-2', cover_url: 'https://i.gr-assets.com/books/1l/2.jpg', cover_thumbhash: null, cover_dominant: null, cover_secondary: null },
    { book_id: 'book-3', cover_url: 'https://covers.openlibrary.org/b/id/3-L.jpg', cover_thumbhash: null, cover_dominant: null, cover_secondary: null },
  ])
  // Never `replaces`: that is the device's one-time Apple upgrade; the server gives a cover to a Book that has none only.
  assert(w.filled[0]!.every((cover) => !('replaces' in cover)))
})

Deno.test('the file\'s own row (an import Book, a Goodreads-only Book) is written with the cover the job decided, and its ISBN fills the Catalogue Book of it', async () => {
  const w = world()
  const own = snapshot({ source: 'import', title: 'Obscure', isbn13: '9780000000011', coverUrl: null })
  const goodreadsOnly = snapshot({ source: 'import', title: 'Only Goodreads', isbn13: null, coverUrl: 'https://i.gr-assets.com/books/1l/9.jpg' })
  await w.work(JOB, [
    writeRow(0, { book: own }, { cover_source: 'openlibrary', cover_url: 'https://covers.openlibrary.org/b/id/5-L.jpg' }),
    writeRow(1, { book: goodreadsOnly }, { cover_source: 'goodreads', cover_url: goodreadsOnly.coverUrl }),
  ], w.context())
  const [first, second] = w.written.sort((a, b) => a.idx - b.idx)
  assertEquals((first!.row.book as { cover_url: string }).cover_url, 'https://covers.openlibrary.org/b/id/5-L.jpg')
  assertEquals((second!.row.book as { cover_url: string }).cover_url, 'https://i.gr-assets.com/books/1l/9.jpg')
  // Only the one with an ISBN can be matched to a Catalogue Book (`fillCatalogueCovers`'s rule).
  assertEquals(w.filled[0]!.map((cover) => cover.isbn13), ['9780000000011'])
})

Deno.test('a sibling edition\'s cover keeps its thumbhash when the address is the lender\'s', () => {
  const lent = { coverUrl: 'https://covers.openlibrary.org/b/id/9-L.jpg', coverThumbhash: 'hash=', coverColors: { dominant: '#112233', secondary: '#445566' } }
  const imported = importRowOf(writeRow(0, { book: snapshot(), lent }, { cover_source: 'lent', cover_url: lent.coverUrl }))
  assertEquals(imported.book.coverUrl, lent.coverUrl)
  assertEquals(imported.book.coverThumbhash, 'hash=')
  const found = importRowOf(writeRow(0, { book: snapshot(), lent }, { cover_source: 'openlibrary', cover_url: 'https://covers.openlibrary.org/b/id/10-L.jpg' }))
  assertEquals(found.book.coverThumbhash, null)
})

Deno.test('a row without the match\'s choice is the file\'s own row', () => {
  const imported = importRowOf({ ...writeRow(0, { book: snapshot() }), match_book: null })
  assertEquals('id' in imported.book, false)
  assertEquals(imported.book.title, PIRANESI.title)
  assertEquals(imported.book.source, 'import')
})

Deno.test('a failed row is nothing to fill; a Manual book is never filled', async () => {
  const w = world({ [PIRANESI.key]: 'failed' })
  await w.work(JOB, [writeRow(0, { book: catalogueBook() }, { cover_source: 'openlibrary', cover_url: 'https://covers.openlibrary.org/b/id/22-L.jpg' })], w.context())
  assertEquals(w.filled, [])
  assertEquals(w.saved, [{ idx: 0 }], 'a failure is an outcome too: the row is written (failed)')
  const manual = world()
  await manual.work(JOB, [writeRow(0, { book: catalogueBook({ source: 'manual' } as Partial<Book>) }, { cover_source: 'openlibrary', cover_url: 'https://covers.openlibrary.org/b/id/22-L.jpg' })], manual.context())
  assertEquals(manual.filled, [])
})

Deno.test('a row whose write was recorded already (a runner died before saving it) is not written again, only saved', async () => {
  const w = world()
  await w.work(JOB, [writeRow(0, { book: catalogueBook() }, { outcome: 'in_library' })], w.context())
  assertEquals(w.written, [])
  assertEquals(w.saved, [{ idx: 0 }])
})

Deno.test('a row import_job_write refuses is failed with the reason; the others are written', async () => {
  const w = world()
  w.failWriteOf(new Error('import_job_write: row_invalid'))
  await w.work(JOB, [writeRow(0, { book: catalogueBook() }), writeRow(2, { book: catalogueBook() })], w.context())
  assertEquals(w.written.map((write) => write.idx), [0])
  assertEquals(w.saved, [{ idx: 0 }, { idx: 2, failure: { outcome: 'failed', error: 'row_invalid' } }])
})

Deno.test('any other error fails the batch, after the rows written meanwhile are saved (their outcome is recorded)', async () => {
  const w = world()
  w.failWriteOf(new Error('import_job_write: connection reset'))
  await assertRejects(() => w.work(JOB, [writeRow(0, { book: catalogueBook() }), writeRow(2, { book: catalogueBook() })], w.context()), Error, 'connection reset')
  assertEquals(w.saved, [{ idx: 0 }])
})

Deno.test('a failed cover fill costs nothing: the rows are written and saved', async () => {
  const w = world()
  w.failFills()
  await w.work(JOB, [writeRow(0, { book: catalogueBook() }, { cover_source: 'openlibrary', cover_url: 'https://covers.openlibrary.org/b/id/22-L.jpg' })], w.context())
  assertEquals(w.saved, [{ idx: 0 }])
})

Deno.test('a refused save (cancelled, or the lease went to another runner) stops: nothing more is saved', async () => {
  const w = world()
  w.refuseSaves()
  await w.work(JOB, [writeRow(0, { book: catalogueBook() })], w.context())
  assertEquals(w.saved, [])
})

Deno.test('a batch past its deadline leaves its rows pending', async () => {
  const w = world()
  const late = { ...w.context(), deadline: 1_000_000 + 5_000 }
  await w.work(JOB, [writeRow(0, { book: catalogueBook() })], late)
  assertEquals(w.written, [])
  assertEquals(w.saved, [])
})

Deno.test('a second run of the same rows writes nothing: the recorded outcomes stand (as the database answers them)', async () => {
  const w = world()
  const rows = [writeRow(0, { book: catalogueBook() }), writeRow(1, { book: catalogueBook({ id: 'book-2' }) })]
  await w.work(JOB, rows, w.context())
  assertEquals(w.written.length, 2)
  // import_job_take_write_rows hands the unsaved rows back with the outcome recorded with their write.
  await w.work(JOB, rows.map((row) => ({ ...row, outcome: 'added' as const })), w.context())
  assertEquals(w.written.length, 2, 'nothing is written the second time')
})
