import { readFileSync } from 'node:fs'
import Papa from 'papaparse'
import { strToU8, unzip, zipSync } from 'fflate'
import { beforeAll, describe, expect, it } from 'vitest'
import { startImportJob } from '@/data/importJob'
import { importArguments } from '@/data/bookImport'
import { parseExport } from '@/data/import/detect'
import { hardcoverAdapter } from '@/data/import/hardcover'
import { COVER_HINT_MIN_SIDE, judgeCover, LIST_LIMITS, limitLists, mapHardcoverExport, readHardcoverZip, ZIP_LIMITS } from '@/data/import/hardcoverZip'
import { HardcoverZipError, type ImportBook, type ImportFile } from '@/data/import/rows'
import { prepareUpload, uploadRow } from '@/data/importUpload'
import { signUpMember } from './support/member'
import { sql } from './support/stack'
import { Account, bigAccount, fullAccount, lieAboutSize, manyEntries, testIsbn } from './fixtures/hardcover-zip/make'

/**
 * Reading Hardcover's "everything" zip (docs/plans/hardcover-zip.md, PR 1): the reader with its limits, then one `it` per mapping
 * rule of the plan, detection and every error code, zip-vs-CSV parity for the fields both carry, and what `importUpload` does
 * with what only a zip knows: progress, list order and empty lists go to the job (PR 2), the cover address is mapped and kept out
 * of the upload until the job takes it (PR 3).
 * Every zip is built here from an invented account (tests/fixtures/hardcover-zip/make.ts); nothing is a real export.
 */

const TODAY = '2026-11-01'

async function mapped(account: Account, options: Parameters<Account['zip']>[0] = {}): Promise<ImportFile> {
  return mapHardcoverExport(await readHardcoverZip(account.zip(options)), TODAY)
}

async function failure(bytes: Uint8Array): Promise<HardcoverZipError> {
  const error = await readHardcoverZip(bytes).then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(HardcoverZipError)
  return error as HardcoverZipError
}

describe('reading the zip', () => {
  it('reads the files the import needs and never inflates the others', async () => {
    // activities.json is not even JSON in the fixture: it would throw if it were read.
    const { account } = fullAccount()
    const exp = await readHardcoverZip(account.zip())
    expect(exp.userBooks.length).toBe(account.records().user_books!.length)
    expect(exp.lists.length).toBe(account.records().lists!.length)
    expect(exp.manifest.userId).toBe(account.userId)
    // Cached contributors everywhere: the credits' files are not read either.
    expect(exp.contributions).toEqual([])
  })

  it('reads the entries a member zipped again inside one folder, and ignores macOS resource forks', async () => {
    const { account } = fullAccount()
    const flat = await mapped(account)
    const nested = await mapped(account, { folder: 'my-export', extra: { '__MACOSX/._manifest.json': strToU8('junk'), '__MACOSX/my-export/._books.json': strToU8('junk') } })
    expect(nested).toEqual(flat)
  })

  it('reads stored (uncompressed) entries as well as deflated ones', async () => {
    const { account } = fullAccount()
    expect(await mapped(account, { level: 0 })).toEqual(await mapped(account))
  })

  it('is the same file mapped twice: pure', async () => {
    const { account } = fullAccount()
    expect(await mapped(account)).toEqual(await mapped(account))
  })

  describe('detection and errors', () => {
    it('zipUnknown: no manifest, or another format', async () => {
      const { account } = fullAccount()
      expect((await failure(account.zip({ manifest: null }))).code).toBe('zipUnknown')
      expect((await failure(account.zip({ manifest: { format: 'something-else', version: 1 } }))).code).toBe('zipUnknown')
      expect((await failure(zipSync({ 'readme.txt': strToU8('hello') }))).code).toBe('zipUnknown')
    })

    it('zipVersion: a layout newer than version 1', async () => {
      const { account } = fullAccount()
      expect((await failure(account.zip({ manifest: { format: 'hardcover-everything', version: 2 } }))).code).toBe('zipVersion')
      expect((await failure(account.zip({ manifest: { format: 'hardcover-everything', version: '1' } }))).code).toBe('zipVersion')
    })

    it('zipMissing: names the files it lacks', async () => {
      const { account } = fullAccount()
      const one = await failure(account.zip({ omit: ['lists'] }))
      expect(one.code).toBe('zipMissing')
      expect(one.files).toEqual(['lists.json'])
      expect((await failure(account.zip({ omit: ['books', 'editions'] }))).files).toEqual(['books.json', 'editions.json'])
      // Inside a folder, too.
      expect((await failure(account.zip({ folder: 'x', omit: ['series'] }))).files).toEqual(['series.json'])
    })

    it('unreadable: JSON that does not parse, a file that is no array, a zip that is none', async () => {
      const { account } = fullAccount()
      expect((await failure(account.zip({ raw: { books: '[{"id": 1,' } }))).code).toBe('unreadable')
      expect((await failure(account.zip({ raw: { user_books: '{"a": 1}' } }))).code).toBe('unreadable')
      expect((await failure(account.zip({ raw: { manifest: 'not json' } }))).code).toBe('unreadable')
      expect((await failure(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).code).toBe('unreadable')
    })

    it('a zip of a Hardcover export of no books maps to nothing: the upload says empty', async () => {
      expect((await mapped(new Account())).books).toEqual([])
    })
  })

  describe('limits', () => {
    it('zipTooBig: a file over 50 MB', async () => {
      expect((await failure(new Uint8Array(ZIP_LIMITS.file + 1))).code).toBe('zipTooBig')
    })

    it('zipTooBig: more than 1,000 entries in the central directory; 1,000 are still a zip (just no export)', async () => {
      expect((await failure(manyEntries(ZIP_LIMITS.entries + 1))).code).toBe('zipTooBig')
      expect((await failure(manyEntries(ZIP_LIMITS.entries))).code).toBe('zipUnknown')
    })

    it('zipTooBig: an entry that declares more than 64 MB, before anything is inflated', async () => {
      const { account } = fullAccount()
      const zip = lieAboutSize(account.zip(), 'books.json', ZIP_LIMITS.entry + 1)
      expect((await failure(zip)).code).toBe('zipTooBig')
    })

    it('zipTooBig: entries that declare more than 160 MB together, each within its own limit', async () => {
      const { account } = fullAccount()
      let zip = account.zip()
      for (const name of ['books.json', 'editions.json', 'user_books.json']) zip = lieAboutSize(zip, name, 60 * 1024 * 1024)
      expect((await failure(zip)).code).toBe('zipTooBig')
    })

    it('a manifest over its limit is too big', async () => {
      const { account } = fullAccount()
      expect((await failure(lieAboutSize(account.zip(), 'manifest.json', ZIP_LIMITS.manifest + 1))).code).toBe('zipTooBig')
    })

    it('lying header: an entry that inflates past its declared size is cut at that size, so memory stays bounded, and then fails', async () => {
      // What fflate does (the plan assumed an error): it inflates into a buffer of the declared size and drops the rest, silently.
      const big = strToU8(`[${'1,'.repeat(400_000)}1]`)
      const zip = lieAboutSize(zipSync({ 'a.json': big }, { level: 9 }), 'a.json', 600_000)
      const inflated = await new Promise<Record<string, Uint8Array>>((resolve, reject) => unzip(zip, {}, (error, files) => (error ? reject(error) : resolve(files))))
      expect(big.length).toBeGreaterThan(600_000)
      // 600,000 > 512 kB: the worker path; the output is the declared size, not the real one.
      expect(inflated['a.json']!.length).toBe(600_000)
      // So the reader never holds more than the sum it checked, and the cut JSON does not parse: a clear refusal.
      const { account } = fullAccount()
      const lying = lieAboutSize(account.zip(), 'user_books.json', 40)
      expect((await failure(lying)).code).toBe('unreadable')
    })

    it('an entry that declares more than it holds is harmless', async () => {
      const { account } = fullAccount()
      expect(await mapped(account)).toEqual(mapHardcoverExport(await readHardcoverZip(lieAboutSize(account.zip(), 'languages.json', 4_000_000)), TODAY))
    })
  })

  describe('credits behind the cached ones', () => {
    it('reads contributions.json and authors.json only when a book has no cached contributors', async () => {
      const account = new Account()
      account.credits = 'contributions'
      const work = account.book({ title: 'Test Book: Credits', authors: ['Cora Credit', ['Tom Translator', 'Translator']] })
      account.shelve(work, { status: 1 })
      const file = await mapped(account)
      expect(file.books[0]!.authors).toEqual(['Cora Credit'])
    })

    it('uses another role only when no author is left (the CSV rule), the edition first', async () => {
      const account = new Account()
      account.credits = 'contributions'
      const work = account.book({ title: 'Test Book: Only a translator', authors: [['Tom Translator', 'Translator'], ['Ida Illustrator', 'Illustrator']] })
      const edition = account.edition(work, { authors: ['Edie Edition'] })
      const other = account.book({ title: 'Test Book: No edition credit', authors: [['Tom Translator', 'Translator'], ['Ida Illustrator', 'Illustrator']] })
      account.shelve(work, { status: 1, edition })
      account.shelve(other, { status: 1 })
      const file = await mapped(account)
      expect(file.books.map((book) => book.authors)).toEqual([['Edie Edition'], ['Tom Translator']])
    })

    it('reads them when the edition a row uses has none, though another edition of the book has', async () => {
      const account = new Account()
      account.credits = 'contributions'
      const work = account.book({ title: 'Test Book: Credits by edition', authors: ['Cora Credit'] })
      account.credits = 'cached'
      account.edition(work, { authors: ['Edie Edition'] })
      account.credits = 'contributions'
      const chosen = account.edition(work)
      account.shelve(work, { status: 1, edition: chosen })
      expect((await mapped(account)).books[0]!.authors).toEqual(['Cora Credit'])
    })

    it('does not read them when every book has its own: a broken file there is no error', async () => {
      const account = new Account()
      account.shelve(account.book({ title: 'Test Book: Cached' }), { status: 1 })
      const file = await mapped(account, { raw: { contributions: 'not json', authors: 'not json' } })
      expect(file.books[0]!.authors).toEqual(['Tessa Test'])
    })
  })
})

describe('the mapping of a library book', () => {
  const { account, ids } = fullAccount()
  let file!: ImportFile
  beforeAll(async () => {
    file = await mapped(account)
  })
  const row = (name: string): ImportBook => {
    const found = file.books.find((book) => book.sourceId === String(ids[name]))
    if (!found) throw new Error(`no row for ${name}`)
    return found
  }
  const skippedTitles = () => file.skipped.map((skip) => skip.title)
  const isbnOf = (name: string) => account.records().editions!.find((edition) => edition.book_id === ids[name])!.isbn_13 as string

  it('one row per entry of the library, the key and source id of the CSV (Hardcover Book ID)', () => {
    expect(row('Read once')).toMatchObject({ source: 'hardcover', key: `hardcover:${ids['Read once']}`, sourceId: String(ids['Read once']) })
    const statuses = file.books.filter((book) => !book.problems.some((problem) => problem.code === 'fromList'))
    expect(statuses.length).toBe(account.records().user_books!.length - 1)
    expect(file.skipped.filter((skip) => skip.problem.code === 'notShelved').map((skip) => skip.title)).toContain('Test Book: Ignored')
  })

  it('a finished book: the read is the session, the rating in quarters, the edition describes the row', () => {
    expect(row('Read once')).toMatchObject({
      title: 'Test Book: Read once',
      authors: ['Ada Author'],
      isbn13: isbnOf('Read once'),
      pageCount: 320,
      year: 2010,
      originalYear: 1999,
      binding: 'Paperback',
      language: 'en',
      publisher: 'Test Press',
      shelf: 'Read',
      status: 'finished',
      addedOn: '2024-01-05',
      session: { startedOn: '2024-03-01', endedOn: '2024-03-20', outcome: 'finished', rating: 18, review: null },
      earlierReads: [],
      extraReads: 0,
    })
  })

  it('a re-read: the latest finished read is the session, the one before it an earlier read', () => {
    const twice = row('Read twice')
    expect(twice.session).toMatchObject({ startedOn: '2024-05-01', endedOn: '2024-05-09', rating: 12 })
    expect(twice.earlierReads).toEqual([{ startedOn: '2022-01-01', endedOn: '2022-01-10' }])
    expect(twice.problems).toContainEqual({ code: 'earlierReads', count: 1 })
  })

  it('precision 0: a finished read without a day; precision 2 and 3: the first of the month, of the year', () => {
    expect(row('Read undated').session).toMatchObject({ startedOn: null, endedOn: null, outcome: 'finished', rating: 20 })
    expect(row('Read undated').extraReads).toBe(0)
    expect(row('Read month').session).toMatchObject({ endedOn: '2023-06-01', outcome: 'finished' })
    expect(row('Read year').session).toMatchObject({ endedOn: '2021-01-01', outcome: 'finished' })
  })

  it('a day inside a month or year precision is moved to its first day', async () => {
    const small = new Account()
    small.shelve(small.book({ title: 'Test Book: M' }), { status: 3, reads: [{ finished: '2023-06-15', precision: 2 }] })
    small.shelve(small.book({ title: 'Test Book: Y' }), { status: 3, reads: [{ finished: '2021-09-30', precision: 3 }] })
    const sessions = (await mapped(small)).books.map((book) => book.session?.endedOn)
    expect(sessions).toEqual(['2023-06-01', '2021-01-01'])
  })

  it('a start inside a finish’s month or year is kept: the finish is not moved before it', async () => {
    const small = new Account()
    small.shelve(small.book({ title: 'Test Book: M' }), { status: 3, reads: [{ started: '2023-06-10', finished: '2023-06-01', precision: 2 }] })
    small.shelve(small.book({ title: 'Test Book: Y' }), { status: 3, reads: [{ started: '2021-05-04', finished: '2021-01-01', precision: 3 }] })
    // A start after that month is a real mistake: dropped, told.
    small.shelve(small.book({ title: 'Test Book: L' }), { status: 3, reads: [{ started: '2023-07-02', finished: '2023-06-01', precision: 2 }] })
    const [month, year, late] = (await mapped(small)).books
    expect(month!.session).toMatchObject({ startedOn: '2023-06-10', endedOn: '2023-06-10' })
    expect(month!.problems).toEqual([])
    expect(year!.session).toMatchObject({ startedOn: '2021-05-04', endedOn: '2021-05-04' })
    expect(late!.session).toMatchObject({ startedOn: null, endedOn: '2023-06-01' })
    expect(late!.problems).toContainEqual({ code: 'dateInvalid' })
  })

  it('reads in order, undated first: dated earlier reads keep their days, the undated add to extraReads', () => {
    const three = row('Read three')
    expect(three.session).toMatchObject({ startedOn: '2020-02-01', endedOn: '2020-02-09' })
    expect(three.earlierReads).toEqual([{ startedOn: null, endedOn: '2019-01-01' }])
    expect(three.extraReads).toBe(1)
    expect(three.problems).toContainEqual({ code: 'extraReads', count: 1 })
  })

  it('a finished book with no read at all is a session without days, with its rating', () => {
    expect(row('Read no reads').session).toEqual({ startedOn: null, endedOn: null, outcome: 'finished', rating: 10, review: null, progress: null })
  })

  it('reviews: Markdown, else raw, else HTML as plain text; a rating alone is the rating, not a review', () => {
    expect(row('Review markdown').session?.review).toBe('A **good** book.\n\nTwo paragraphs.')
    expect(row('Review raw').session?.review).toBe('Plain words.')
    expect(row('Review html').session?.review).toBe('Only html & more.')
    expect(row('Review rating only').session).toMatchObject({ review: null, rating: 18 })
  })

  it('a rating or review on a book that is not finished is left out and told', () => {
    expect(row('Want').session).toBeNull()
    expect(row('Want').problems).toContainEqual({ code: 'notFinishedRating' })
    expect(row('Want')).toMatchObject({ status: 'want_to_read', shelf: 'Want to Read', earlierReads: [] })
  })

  it('owned makes the Collection Owned, as the CSV does', () => {
    expect(row('Owned').shelves).toEqual(['Owned'])
  })

  it('Currently Reading: the open read from its start; a day-less one starts when she added it', () => {
    expect(row('Reading page')).toMatchObject({ status: 'reading', shelf: 'Currently Reading', session: { startedOn: '2024-09-01', endedOn: null, outcome: null, rating: null, review: null } })
    expect(row('Reading no start').session?.startedOn).toBe('2024-08-08')
    const again = row('Reading again')
    expect(again.session?.startedOn).toBe('2024-09-06')
    expect(again.earlierReads).toEqual([{ startedOn: '2020-01-01', endedOn: '2020-01-31' }])
  })

  it('Paused is reading, with the note', () => {
    expect(row('Paused')).toMatchObject({ status: 'reading', shelf: 'Paused' })
    expect(row('Paused').problems).toContainEqual({ code: 'paused' })
  })

  it('Did Not Finish: abandoned, the day she stopped (finish, else pause, else none), no rating, the progress kept', () => {
    expect(row('DNF day')).toMatchObject({ status: 'finished', shelf: 'Did Not Finish', session: { startedOn: '2024-04-01', endedOn: '2024-04-08', outcome: 'abandoned', rating: null, progress: { page: 80 } } })
    expect(row('DNF day').problems).toContainEqual({ code: 'abandonedRating' })
    expect(row('DNF paused').session).toMatchObject({ endedOn: '2024-04-09', outcome: 'abandoned', progress: { percent: 12 } })
    expect(row('DNF bare').session).toMatchObject({ startedOn: null, endedOn: null, outcome: 'abandoned', progress: null })
  })

  it('Ignored is skipped', () => {
    expect(skippedTitles()).toContain('Test Book: Ignored')
  })

  describe('progress', () => {
    it('a page, when it is not past the row’s page count', () => {
      expect(row('Reading page').session?.progress).toEqual({ page: 120 })
    })

    it('a page past the page count, or no page count: the percent, rounded; 0 and 100 are no progress', () => {
      expect(row('Reading past the end').session?.progress).toEqual({ percent: 22 })
      expect(row('Reading percent').session?.progress).toEqual({ percent: 42 })
      expect(row('Reading percent').pageCount).toBeNull()
    })

    it('audio: seconds of the length, when there is no percent', () => {
      expect(row('Reading audio').session?.progress).toEqual({ percent: 25 })
      expect(row('Reading audio').binding).toBe('Audiobook')
    })

    it('nothing: a zero is never trusted (progress_seconds is 0, not null, on print reads)', () => {
      expect(row('Reading nothing').session?.progress).toBeNull()
    })

    it('finished and wanted books carry none', () => {
      expect(row('Read once').session?.progress).toBeNull()
      expect(row('Want').session).toBeNull()
    })

    it('0 and 100 percent are not progress', async () => {
      const small = new Account()
      for (const percent of [0, 100, 0.4, 99.6]) small.shelve(small.book({ title: `Test Book: ${percent}`, pages: null }), { status: 2, reads: [{ started: '2024-01-01', percent }] })
      expect((await mapped(small)).books.map((book) => book.session?.progress)).toEqual([null, null, null, null])
    })
  })

  describe('the edition and the book', () => {
    it('the edition the entry names, else the latest read’s, else the book’s default; one of another book is not used', () => {
      expect(row('Edition from read')).toMatchObject({ isbn13: testIsbn(901), pageCount: 444, publisher: 'Read Press', year: 2012 })
      expect(row('Edition default')).toMatchObject({ isbn13: testIsbn(902), pageCount: 555, language: 'de', publisher: 'Default Press' })
      expect(row('Edition foreign')).toMatchObject({ isbn13: null, pageCount: null, publisher: null })
    })

    it('no edition at all: the book’s own pages and year', () => {
      expect(row('No edition')).toMatchObject({ isbn13: null, isbn10: null, pageCount: 222, year: 1988, originalYear: 1988, language: null, publisher: null, binding: null })
    })

    it('binding: the edition’s format; else from the reading format (2 audio, 4 ebook)', () => {
      expect(row('Audio format').binding).toBe('Audiobook')
      expect(row('Ebook format').binding).toBe('Ebook')
      expect(row('Read once').binding).toBe('Paperback')
    })

    it('ISBNs go through the same check as the CSV’s; an ISBN-10 alone gives the ISBN-13', () => {
      expect(row('Invalid ISBN').isbn13).toBeNull()
      expect(row('Isbn10 only')).toMatchObject({ isbn10: '0306406152', isbn13: '9780306406157' })
    })

    it('the featured series as "Name, #n"; the title’s own series when the export has none', () => {
      expect(row('Series').series).toBe('Test Saga, #2')
      expect(row('Series unnumbered').series).toBe('Test Saga')
      expect(row('Title in series (Test Saga, #3)')).toMatchObject({ title: 'Test Book: Title in series', series: 'Test Saga, #3' })
    })

    it('authors: only the author’s role; a translator is left out', () => {
      expect(row('Read once').authors).toEqual(['Ada Author'])
    })
  })

  describe('the cover hint', () => {
    it('the edition’s cached image on the Hardcover host with a short side of 150 px or more', () => {
      const edition = account.records().editions!.find((one) => one.book_id === ids['Read once'])!
      expect(row('Read once').coverHint).toEqual({ url: `https://assets.hardcover.app/test/${edition.id}.jpg`, width: 400, height: 600 })
    })

    it('none for a small image, another host or no image', () => {
      expect(row('Small cover').coverHint).toBeNull()
      expect(row('Other host').coverHint).toBeNull()
      expect(row('No cover').coverHint).toBeNull()
    })

    it('judges an address: host exactly, https, no port or credentials, the short side at 150', () => {
      const image = (url: string, width = 400, height = 600) => ({ url, width, height })
      const ok = 'https://assets.hardcover.app/x.jpg'
      expect(judgeCover(image(ok, COVER_HINT_MIN_SIDE, 900)).verdict).toBe('kept')
      expect(judgeCover(image(ok, COVER_HINT_MIN_SIDE - 1, 900)).verdict).toBe('small')
      expect(judgeCover(image(ok, 400, 100)).verdict).toBe('small')
      expect(judgeCover({ url: ok }).verdict).toBe('small')
      for (const url of ['http://assets.hardcover.app/x.jpg', 'https://assets.hardcover.app:8443/x.jpg', 'https://user@assets.hardcover.app/x.jpg', 'https://assets.hardcover.app.evil.test/x.jpg', 'https://evil.test/assets.hardcover.app', 'not a url']) {
        expect(judgeCover(image(url)), url).toEqual({ hint: null, verdict: 'otherHost' })
      }
      expect(judgeCover(null).verdict).toBe('none')
      expect(judgeCover({ url: '' }).verdict).toBe('none')
    })
  })
})

describe('lists → Collections (option A)', () => {
  const { account, ids } = fullAccount()
  let file!: ImportFile
  beforeAll(async () => {
    file = await mapped(account)
  })
  const row = (name: string) => file.books.find((book) => book.sourceId === String(ids[name]))

  it('a library book gets the names of her lists it is on', () => {
    expect(row('Read once')!.shelves).toEqual(['Test Ranked'])
    expect(row('Read twice')!.shelves).toEqual(['Test Plain'])
    expect(row('Want')!.shelves).toEqual(['Test Ranked'])
  })

  it('a book only on her lists is a Want to read row of its own, problem fromList, in its Collections', () => {
    const only = row('List only one')!
    expect(only).toMatchObject({
      source: 'hardcover',
      key: `hardcover:${ids['List only one']}`,
      status: 'want_to_read',
      shelf: 'Want to Read',
      session: null,
      earlierReads: [],
      extraReads: 0,
      shelves: ['Test Ranked', 'Test Plain'],
      problems: [{ code: 'fromList' }],
    })
    // One row for a book on two lists; its day is the earliest it was added to any of them.
    expect(file.books.filter((book) => book.sourceId === String(ids['List only one'])).length).toBe(1)
    expect(only.addedOn).toBe('2024-01-15')
    expect(row('List only two')).toMatchObject({ shelves: ['Test Ranked'], authors: ['Lena Lister'] })
    expect(row('List only three')!.shelves).toEqual(['Test Plain'])
  })

  it('a list-only book takes the edition its list entry names, else the book’s default', () => {
    expect(row('List only one')).toMatchObject({ isbn13: testIsbn(900), pageCount: 111, language: 'de', publisher: 'Liste Press', binding: 'Hardcover' })
    expect(row('List only two')).toMatchObject({ isbn13: null, pageCount: null })
  })

  it('a list she only contributed to belongs to someone else: left out; a name over 80 characters makes no Collection, and its book is no book of hers', () => {
    expect(row('Others only')).toBeUndefined()
    expect(row('Long name only')).toBeUndefined()
    expect(file.books.flatMap((book) => book.shelves)).not.toContain('Test Someone Elses')
  })

  it('ranked lists keep their order: by position, empty positions last, as keys of the file’s rows', () => {
    expect(file.collectionOrder).toEqual([
      {
        name: 'Test Ranked',
        keys: [ids['Read once'], ids['List only two'], ids['Want'], ids['List only one']].map((id) => `hardcover:${id}`),
      },
    ])
  })

  it('ranked ties go by the day added, then the file’s order', async () => {
    const small = new Account()
    const list = small.list('Test Ties', { ranked: true })
    const [a, b, c] = ['A', 'B', 'C'].map((title) => small.book({ title: `Test Book: ${title}` }))
    small.onList(list, a!, { position: 1, addedAt: '2024-05-02T00:00:00.000Z' })
    small.onList(list, b!, { position: 1, addedAt: '2024-05-01T00:00:00.000Z' })
    small.onList(list, c!, { position: 1, addedAt: '2024-05-01T00:00:00.000Z' })
    expect((await mapped(small)).collectionOrder).toEqual([{ name: 'Test Ties', keys: [b, c, a].map((id) => `hardcover:${id}`) }])
  })

  it('an empty list still becomes a Collection: named in emptyCollections', () => {
    expect(file.emptyCollections).toEqual(['Test Empty'])
  })

  it('a book she keeps off her shelves (Ignored) but put on a list is a list-only book: Want to read, in its Collection', async () => {
    const small = new Account()
    const list = small.list('Test Kept')
    const ignored = small.book({ title: 'Test Book: Ignored on a list' })
    small.shelve(ignored, { status: 6 })
    small.onList(list, ignored)
    const result = await mapped(small)
    expect(result.books).toHaveLength(1)
    expect(result.books[0]).toMatchObject({ key: `hardcover:${ignored}`, status: 'want_to_read', shelves: ['Test Kept'], problems: [{ code: 'fromList' }] })
    expect(result.skipped).toContainEqual(expect.objectContaining({ title: 'Test Book: Ignored on a list', problem: { code: 'notShelved' } }))
    expect(result.emptyCollections).toEqual([])
  })

  it('a name she has twice in another case is one Collection', async () => {
    const small = new Account()
    const [one, two] = [small.list('Test Case'), small.list('test case')]
    const [a, b] = [small.book({ title: 'Test Book: A' }), small.book({ title: 'Test Book: B' })]
    small.onList(one, a)
    small.onList(two, b)
    const result = await mapped(small)
    expect(result.books.flatMap((book) => book.shelves)).toEqual(['Test Case', 'Test Case'])
    expect(result.emptyCollections).toEqual([])
  })
})

describe('zip and CSV of one account', () => {
  /** What Hardcover's CSV export would write for an account's library (the columns hardcover.ts reads). */
  function csvOf(account: Account): string {
    const { user_books, user_book_reads, books, editions, lists, list_books, publishers, languages, book_series, series } = account.records() as Record<string, Record<string, any>[]>
    const byId = (rows: Record<string, any>[], id: unknown) => rows.find((rec) => rec.id === id)
    const rows = user_books!.map((entry) => {
      const book = byId(books!, entry.book_id)!
      const edition = byId(editions!, entry.edition_id)
      const reads = user_book_reads!.filter((read) => read.user_book_id === entry.id)
      const link = book_series!.find((one) => one.book_id === book.id)
      const credits = (edition?.cached_contributors?.length ? edition : book).cached_contributors as { author: { name: string }; contribution: string }[]
      const named = lists!.filter((list) => list_books!.some((on) => on.list_id === list.id && on.book_id === book.id)).map((list) => list.name)
      const status = ['', 'Want to Read', 'Currently Reading', 'Read', 'Paused', 'Did Not Finish', 'Ignored'][entry.status_id]
      return {
        Title: edition?.title ?? book.title,
        Author: credits.map((credit) => (credit.contribution === 'Author' ? credit.author.name : `${credit.author.name} (${credit.contribution})`)).join(', '),
        Series: link ? `${byId(series!, link.series_id)!.name} (#${link.position})` : '',
        Status: status,
        'Hardcover Book ID': String(book.id),
        'Hardcover Edition ID': edition ? String(edition.id) : '',
        'ISBN 10': edition?.isbn_10 ?? '',
        'ISBN 13': edition?.isbn_13 ?? '',
        Binding: edition?.edition_format ?? '',
        Pages: String(edition?.pages ?? book.pages ?? ''),
        'Language Code': edition?.language_id ? byId(languages!, edition.language_id)!.code2 : '',
        'Publish Date': edition?.release_date ?? '',
        Publisher: edition?.publisher_id ? byId(publishers!, edition.publisher_id)!.name : '',
        Lists: named.join(', '),
        'Date Added': entry.date_added ?? '',
        'Date Started': reads.map((read) => read.started_at ?? '').join(', '),
        'Date Finished': reads.map((read) => read.finished_at ?? '').join(', '),
        Rating: entry.rating ?? '',
        Review: entry.review_markdown ?? '',
        Owned: String(entry.owned),
      }
    })
    return Papa.unparse({ fields: [...hardcoverAdapter.columns], data: rows.map((row) => hardcoverAdapter.columns.map((column) => (row as Record<string, string>)[column] ?? '')) })
  }

  function parityAccount(): Account {
    const account = new Account()
    const list = account.list('Test Parity List')
    const spec = { isbn13: testIsbn(700), pages: 300, language: 'de', publisher: 'Parity Press', year: 2011, releaseDate: '2011-04-05', format: 'Hardcover' }
    const make = (title: string, extra: Parameters<Account['book']>[0]['series'] = undefined) => {
      const book = account.book({ title, series: extra, authors: ['Pia Parity', ['Tom Translator', 'Translator']] })
      return { book, edition: account.edition(book, { ...spec, isbn13: testIsbn(700 + book) }) }
    }
    const a = make('Test Book: Parity read', [{ name: 'Parity Saga', position: 3 }])
    const b = make('Test Book: Parity reading')
    const c = make('Test Book: Parity dnf')
    const d = make('Test Book: Parity want')
    account.shelve(a.book, { status: 3, edition: a.edition, rating: '4.5', review: { markdown: 'Fine, very fine.' }, owned: true, reads: [{ started: '2022-02-01', finished: '2022-02-20' }, { started: '2024-02-01', finished: '2024-02-12' }] })
    account.shelve(b.book, { status: 2, edition: b.edition, addedOn: '2024-06-01', reads: [{ started: '2024-06-02', pages: 12 }] })
    account.shelve(c.book, { status: 5, edition: c.edition, rating: '2', reads: [{ started: '2024-03-03', finished: '2024-03-09' }] })
    account.shelve(d.book, { status: 1, edition: d.edition })
    account.onList(list, a.book)
    account.onList(list, d.book)
    return account
  }

  const SHARED = ['key', 'sourceId', 'title', 'series', 'authors', 'isbn13', 'isbn10', 'pageCount', 'year', 'binding', 'language', 'publisher', 'shelf', 'shelves', 'status', 'earlierReads', 'extraReads', 'addedOn', 'problems'] as const

  it('equal rows for every field the CSV carries', async () => {
    const account = parityAccount()
    const zip = (await mapped(account)).books
    const csv = parseExport(csvOf(account), TODAY).books
    expect(csv.length).toBe(4)
    expect(zip.length).toBe(4)
    for (const fromCsv of csv) {
      const fromZip = zip.find((book) => book.key === fromCsv.key)!
      expect(fromZip, fromCsv.title).toBeDefined()
      for (const field of SHARED) expect(fromZip[field], `${fromCsv.title}: ${field}`).toEqual(fromCsv[field])
      const { progress: _progress, ...session } = fromZip.session ?? { progress: null }
      expect(fromZip.session ? session : null, `${fromCsv.title}: session`).toEqual(fromCsv.session)
    }
  })

  it('the same keys as the CSV adapter writes, and the cover hint besides; the session’s progress besides', async () => {
    const account = parityAccount()
    const [zip] = (await mapped(account)).books
    const [csv] = parseExport(csvOf(account), TODAY).books
    expect(Object.keys(zip!).sort()).toEqual([...Object.keys(csv!), 'coverHint'].sort())
    expect(Object.keys(zip!.session!).sort()).toEqual([...Object.keys(csv!.session!), 'progress'].sort())
  })

  it('a zip after a CSV (or the other way round) adds nothing twice: the same key', async () => {
    const account = parityAccount()
    const zipKeys = (await mapped(account)).books.map((book) => book.key).sort()
    const csvKeys = parseExport(csvOf(account), TODAY).books.map((book) => book.key).sort()
    expect(zipKeys).toEqual(csvKeys)
  })
})

describe('what the upload does with a zip', () => {
  it('uploads the library and the list-only rows with their Collections, the progress on their reads, and the lists apart', async () => {
    const ada = await signUpMember()
    const { account, ids } = fullAccount()
    const prepared = await prepareUpload(ada.client, account.zip(), TODAY, { zip: true })
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    expect(prepared.source).toBe('hardcover')
    expect(prepared.rows.length).toBe(prepared.books)
    expect(prepared.already).toBe(0)
    // collectionOrder and emptyCollections come apart from the rows (they go with the start).
    expect(prepared.collectionOrder.map((order) => order.name)).toEqual(['Test Ranked'])
    expect(prepared.emptyCollections).toEqual(['Test Empty'])
    // The cover address stays out until PR 3; the progress goes along with its read.
    const wire = JSON.stringify(prepared.rows)
    expect(wire).not.toContain('coverHint')
    expect(wire).not.toContain('assets.hardcover.app')
    for (const row of prepared.rows) expect(Object.keys(row)).not.toContain('coverHint')
    const progress = (id: number) => (prepared.rows.find((row) => row.key === `hardcover:${id}`) as { session: { progress?: unknown } }).session.progress
    expect(progress(ids['Reading page']!)).toEqual({ page: 120 })
    expect(progress(ids['DNF day']!)).toEqual({ page: 80 })
    const listOnly = prepared.rows.find((row) => row.title === 'Test Book: List only one')
    expect(listOnly).toMatchObject({ status: 'want_to_read', collections: ['Test Ranked', 'Test Plain'] })
    // What the server takes, as it is: the lists are kept with the job.
    const started = await startImportJob(ada.client, {
      rows: prepared.rows,
      source: prepared.source,
      device: null,
      already: 0,
      languages: ['en'],
      collectionOrder: prepared.collectionOrder,
      emptyCollections: prepared.emptyCollections,
    })
    expect(started.error).toBeNull()
    const kept = await sql<{ order: { name: string; keys: string[] }[]; empty: string[]; made: boolean }>(
      'select collection_order as order, empty_collections as empty, empty_made as made from public.import_job_collections where job_id = $1',
      [started.data],
    )
    expect(kept).toEqual([{ order: prepared.collectionOrder, empty: ['Test Empty'], made: false }])
  })

  it('an oversize row is trimmed without its review and keeps its progress', async () => {
    const { account, ids } = fullAccount()
    const book = (await mapped(account)).books.find((one) => one.sourceId === String(ids['DNF day']))!
    expect(book.session?.progress).toEqual({ page: 80 })
    const row = uploadRow({ ...book, session: { ...book.session!, review: 'x'.repeat(30_000) } }) as { session: Record<string, unknown>; problems: unknown[] }
    expect(row.session.review).toBeNull()
    expect(row.problems).toEqual([])
    expect(row.session.progress).toEqual({ page: 80 })
  })

  it('uploadRow strips the cover hint, keeps the session’s progress and everything else', async () => {
    const { account, ids } = fullAccount()
    const book = (await mapped(account)).books.find((one) => one.sourceId === String(ids['Reading page']))!
    expect(book.coverHint).not.toBeNull()
    expect(book.session?.progress).toEqual({ page: 120 })
    const row = uploadRow(book) as { session: Record<string, unknown>; coverHint?: unknown }
    expect(row.coverHint).toBeUndefined()
    expect(row.session.progress).toEqual({ page: 120 })
    expect(row).toMatchObject({ key: book.key, title: book.title, status: 'reading', session: { startedOn: '2024-09-01', outcome: null }, collections: [] })
  })

  it('the job’s write argument carries the progress, and a CSV row’s has none', async () => {
    const { account, ids } = fullAccount()
    const books = (await mapped(account)).books
    const argumentOf = (id: number) => {
      const book = books.find((one) => one.sourceId === String(id))!
      return importArguments({ ...book, collections: [], book: { title: book.title, authors: book.authors } as never }) as Record<string, unknown>
    }
    expect(argumentOf(ids['Reading page']!).progress).toEqual({ page: 120 })
    expect(argumentOf(ids['DNF day']!).progress).toEqual({ page: 80 })
    expect(argumentOf(ids['Reading percent']!).progress).toEqual({ percent: 42 })
    const csv = parseExport(new TextDecoder().decode(new Uint8Array(readFileSync(new URL('./fixtures/hardcover/hardcover_export.csv', import.meta.url)))), TODAY)
    for (const book of csv.books) {
      expect('progress' in importArguments({ ...book, collections: [], book: { title: book.title, authors: book.authors } as never })).toBe(false)
    }
  })

  it('lists over what the server takes are trimmed on the device, not refused with the whole job', () => {
    const keys = (n: number, tag = 'k') => Array.from({ length: n }, (_, i) => `hardcover:${tag}${i}`)
    const small = [{ name: 'A', keys: keys(3) }]
    expect(limitLists(small, ['E'])).toEqual({ collectionOrder: small, emptyCollections: ['E'] })
    const manyLists = Array.from({ length: 600 }, (_, i) => ({ name: `L${i}`, keys: ['hardcover:1'] }))
    expect(limitLists(manyLists, []).collectionOrder.length).toBe(LIST_LIMITS.lists)
    expect(limitLists([], Array.from({ length: 600 }, (_, i) => `E${i}`)).emptyCollections.length).toBe(LIST_LIMITS.lists)
    expect(limitLists([{ name: 'Long', keys: keys(10_500) }], []).collectionOrder[0]!.keys.length).toBe(LIST_LIMITS.keys)
    // Lists that together are over the byte cap: whole lists past it are dropped, the ones before stay.
    const heavy = Array.from({ length: 40 }, (_, i) => ({ name: `H${i}`, keys: keys(5_000, `h${i}-`) }))
    const trimmed = limitLists(heavy, []).collectionOrder
    expect(trimmed.length).toBeGreaterThan(0)
    expect(trimmed.length).toBeLessThan(heavy.length)
    expect(JSON.stringify(trimmed).length).toBeLessThanOrEqual(LIST_LIMITS.bytes)
    expect(trimmed).toEqual(heavy.slice(0, trimmed.length))
  })

  it('a start with trimmed lists is accepted by the server', async () => {
    const ada = await signUpMember()
    const keys = Array.from({ length: 2 }, (_, i) => `hardcover:${i + 1}`)
    const { collectionOrder, emptyCollections } = limitLists(
      Array.from({ length: 600 }, (_, i) => ({ name: `L${i}`, keys })),
      Array.from({ length: 600 }, (_, i) => `E${i}`),
    )
    const rows = keys.map((key) => ({ key, title: key, authors: ['A. Author'], status: 'want_to_read' }))
    const started = await startImportJob(ada.client, { rows, source: 'hardcover', device: null, already: 0, languages: ['en'], collectionOrder, emptyCollections })
    expect(started.error).toBeNull()
  })

  it('a CSV start sends the five arguments it always did; a zip’s lists go as two more, and only when there are some', async () => {
    const calls: Record<string, unknown>[] = []
    const client = { rpc: (_name: string, args: Record<string, unknown>) => (calls.push(args), Promise.resolve({ data: 'job', error: null, status: 200 })) }
    const base = { rows: [{ key: 'hardcover:1' }], source: 'hardcover', device: null, already: 0, languages: ['en'] }
    await startImportJob(client as never, base)
    await startImportJob(client as never, { ...base, collectionOrder: [], emptyCollections: [] })
    await startImportJob(client as never, { ...base, collectionOrder: [{ name: 'A', keys: ['hardcover:1'] }], emptyCollections: ['B'] })
    expect(Object.keys(calls[0]!).sort()).toEqual(['p_already', 'p_device', 'p_languages', 'p_rows', 'p_source'])
    expect(Object.keys(calls[1]!).sort()).toEqual(Object.keys(calls[0]!).sort())
    expect(calls[2]).toMatchObject({ p_collection_order: [{ name: 'A', keys: ['hardcover:1'] }], p_empty_collections: ['B'] })
  })

  it('flag off: a zip is no CSV, as today; with it on a CSV still reads the same', async () => {
    const ada = await signUpMember()
    const { account } = fullAccount()
    expect(await prepareUpload(ada.client, account.zip(), TODAY)).toMatchObject({ ok: false, error: 'notCsv' })
    expect(await prepareUpload(ada.client, account.zip(), TODAY, { zip: false })).toMatchObject({ ok: false, error: 'notCsv' })
    const csv = new Uint8Array(readFileSync(new URL('./fixtures/hardcover/hardcover_export.csv', import.meta.url)))
    const off = await prepareUpload(ada.client, csv, TODAY)
    const on = await prepareUpload(ada.client, csv, TODAY, { zip: true })
    expect(off.ok && on.ok).toBe(true)
    expect(on).toEqual(off)
  })

  it('every error code of a zip comes through, with the files a zip lacks', async () => {
    const ada = await signUpMember()
    const { account } = fullAccount()
    const prepare = (bytes: Uint8Array) => prepareUpload(ada.client, bytes, TODAY, { zip: true })
    expect(await prepare(account.zip({ manifest: null }))).toMatchObject({ ok: false, error: 'zipUnknown' })
    expect(await prepare(account.zip({ manifest: { format: 'hardcover-everything', version: 2 } }))).toMatchObject({ ok: false, error: 'zipVersion' })
    expect(await prepare(account.zip({ omit: ['lists', 'list_books'] }))).toMatchObject({ ok: false, error: 'zipMissing', detail: { files: ['lists.json', 'list_books.json'] } })
    expect(await prepare(manyEntries(ZIP_LIMITS.entries + 1))).toMatchObject({ ok: false, error: 'zipTooBig' })
    expect(await prepare(account.zip({ raw: { books: 'nope' } }))).toMatchObject({ ok: false, error: 'unreadable' })
    expect(await prepare(new Account().zip())).toMatchObject({ ok: false, error: 'empty' })
    // PK but not PK\x03\x04: not a zip entry's signature, so it is read as a CSV, which it is not.
    expect(await prepare(new Uint8Array([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0]))).toMatchObject({ ok: false, error: 'notCsv' })
  })
})

describe('a big library', () => {
  it('reads and maps 5,000 books (timed, not asserted)', async () => {
    const account = bigAccount(5000)
    const bytes = account.zip()
    const inflated = Object.values(account.records()).reduce((sum, rows) => sum + JSON.stringify(rows).length, 0)
    const start = performance.now()
    const exp = await readHardcoverZip(bytes)
    const read = performance.now()
    const file = mapHardcoverExport(exp, TODAY)
    const done = performance.now()
    console.info(`hardcover zip, 5,000 books: zip ${(bytes.length / 1e6).toFixed(1)} MB, ${(inflated / 1e6).toFixed(1)} MB of JSON; read ${Math.round(read - start)} ms, map ${Math.round(done - read)} ms`)
    expect(file.books.length).toBe(5000)
    expect(file.collectionOrder?.[0]?.keys.length).toBe(1000)
  }, 120_000)
})
