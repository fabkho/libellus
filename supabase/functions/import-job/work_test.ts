import { assert, assertEquals } from '@std/assert'
import type { ImportBook } from '../../../web/app/data/import/rows.ts'
import type { Job, JobRow, RowResult, WorkContext } from './runner.ts'
import { APPLE_OFF_ANSWER, jobFetch, jobSources } from './sources.ts'
import { emptyCatalogue, functions, NOBODY, PIRANESI, recordedOpenLibrary } from './test_support.ts'
import { coverLender, type Edition, withLentCover } from '../../../web/app/data/bookImport.ts'
import type { Book } from '../../../web/app/data/books.ts'
import { createWork, type EditionSummary, matchResult, matchRow } from './work.ts'

const JOB: Job = { id: 'job-1', member_id: 'ada', source: 'goodreads', languages: ['de-DE', 'en-US'], total: 2, done: 0 }

const jobRow = (book: ImportBook, idx: number, pass = 0): JobRow => ({ idx, key: book.key, payload: { ...book, collections: ['Favourites'] }, pass, attempts: 1 })

/** The worker over the recordings and its saves. */
function world(options: { failOpenLibrary?: boolean } = {}) {
  const { openLibrary, asked } = recordedOpenLibrary({ fail: options.failOpenLibrary })
  const upstream: string[] = []
  const { fetch, asked: counted } = jobFetch({
    openLibrary,
    fetch: (url) => {
      upstream.push(url)
      return Promise.resolve(new Response('{}', { status: 404 }))
    },
    userAgent: 'Libellus/1.0 (test)',
  })
  const fns = functions()
  const lookups = () => jobSources({ fetch, languages: JOB.languages, catalogueClient: emptyCatalogue, functions: fns.client }).lookups
  const work = createWork({ lookups, log: () => {} })
  const saves: { idx: number; result: RowResult }[] = []
  let refuse = false
  const context = (deadlineIn = 120_000): WorkContext => ({
    runner: 'r',
    deadline: Date.now() + deadlineIn,
    save: (idx, result) => {
      if (refuse) return Promise.resolve(false)
      saves.push({ idx, result })
      return Promise.resolve(true)
    },
    saveCover: () => Promise.resolve(!refuse),
    saveWrite: () => Promise.resolve(!refuse),
    waitUntil: () => {},
    stopped: () => refuse,
  })
  return { work, lookups, saves, asked, upstream, counted, invoked: fns.invoked, context, refuseSaves: () => (refuse = true) }
}

const resultOf = (saves: { idx: number; result: RowResult }[], idx: number) => saves.findLast((save) => save.idx === idx)?.result as Exclude<RowResult, { defer: true }>

Deno.test('a row its ISBN finds at Open Library with a cover: matched, nothing to look at, nothing written yet', async () => {
  const w = world()
  await w.work(JOB, [jobRow(PIRANESI, 0)], w.context())
  const result = resultOf(w.saves, 0)
  assertEquals(result.verdict, 'matched')
  assertEquals(result.outcome, null, 'the write is not part of the matching')
  assertEquals(result.cover, 'own')
  assertEquals(result.tier, 'quiet')
  const edition = result.edition as EditionSummary
  assertEquals(edition.via, 'isbn')
  assertEquals(edition.book.source, 'openlibrary')
  assertEquals(edition.book.isbn13, PIRANESI.isbn13)
  assert(edition.book.coverUrl?.startsWith('https://covers.openlibrary.org/'))
  assertEquals(result.cover_url, edition.book.coverUrl, 'the cover decision carries the address (the stage has nothing to do for this row)')
  assertEquals(result.cover_size, 'L')
  assert(w.asked.length > 0, 'Open Library was asked (through the shared pace)')
})

Deno.test('a row no source knows: the file\'s own row, one to look at', async () => {
  const w = world()
  await w.work(JOB, [jobRow(NOBODY, 1)], w.context())
  const result = resultOf(w.saves, 1)
  assertEquals(result.verdict, 'fromFile')
  assertEquals(result.tier, 'needsLook')
  assertEquals(result.cover, 'none')
  assertEquals(result.cover_url, undefined, 'no cover: the row goes on to the cover stage')
  assertEquals((result.edition as EditionSummary).book.title, NOBODY.title)
  assert(w.invoked.some((call) => call.name === 'dnb-lookup'), 'the National Library is asked after Open Library')
  assert(!w.invoked.some((call) => call.name === 'goodreads-rating'), 'Goodreads is not asked (the cover stage does that)')
})

Deno.test('the Catalogue is asked first (as the member), Open Library after it', async () => {
  const asked: string[] = []
  const { openLibrary } = recordedOpenLibrary()
  const { fetch } = jobFetch({ openLibrary, fetch: () => Promise.reject(new Error('no request may leave')), userAgent: 'test' })
  const catalogueClient = {
    rpc(name: string) {
      asked.push(`catalogue:${name}`)
      return emptyCatalogue.rpc(name, {})
    },
  }
  const { lookups } = jobSources({ fetch, languages: JOB.languages, catalogueClient, functions: functions().client })
  const found = await matchRow(jobRow(PIRANESI, 0), lookups)
  assertEquals(asked[0], 'catalogue:search_books')
  assertEquals(found?.edition.book.source, 'openlibrary')
})

Deno.test('Apple is never asked: every Apple address gets its own empty answer, nothing leaves', async () => {
  const { fetch, asked } = jobFetch({
    openLibrary: recordedOpenLibrary().openLibrary,
    fetch: () => Promise.reject(new Error('no request may leave')),
    userAgent: 'test',
  })
  const response = await fetch('https://itunes.apple.com/lookup?isbn=9781635575637&country=de&entity=ebook')
  assertEquals(response.status, 200)
  assertEquals(await response.json(), APPLE_OFF_ANSWER)
  assertEquals(asked.appleOff, 1)
})

Deno.test('a source that cannot be asked: the row waits for the second pass, then is the file\'s own row, one to look at', async () => {
  const w = world({ failOpenLibrary: true })
  await w.work(JOB, [jobRow(PIRANESI, 0)], w.context())
  assertEquals(w.saves, [{ idx: 0, result: { defer: true } }], 'first pass: deferred')
  await w.work(JOB, [jobRow(PIRANESI, 0, 1)], w.context())
  const result = resultOf(w.saves, 0)
  assertEquals(result.verdict, 'fromFile')
  assertEquals(result.tier, 'needsLook', 'a row a source could not be asked about is one to look at')
  assert((result.edition as EditionSummary).unsure)
})

Deno.test('a batch past its deadline leaves its rows pending', async () => {
  const w = world()
  await w.work(JOB, [jobRow(PIRANESI, 0), jobRow(NOBODY, 1)], w.context(5_000))
  assertEquals(w.saves.length, 0)
  assertEquals(w.asked.length, 0)
})

Deno.test('a refused save stops the batch: no row after it is started', async () => {
  const w = world()
  w.refuseSaves()
  await w.work(JOB, [jobRow(PIRANESI, 0), jobRow(NOBODY, 1)], w.context())
  assertEquals(w.saves.length, 0)
  assertEquals(w.asked.length, 0)
})

Deno.test('an edition without a cover borrows its work\'s (coverLender, mergeCover): the row\'s cover is decided as lent, with the address', () => {
  const book = (fields: Partial<Book>) => ({ id: null, source: 'openlibrary', title: 'Piranesi', authors: ['Susanna Clarke'], isbn13: null, language: 'en', coverUrl: null, coverThumbhash: null, coverColors: null, ...fields }) as unknown as Book
  const exact = book({ isbn13: PIRANESI.isbn13 })
  const sibling = book({ isbn13: '9781526622426', coverUrl: 'https://covers.openlibrary.org/b/id/10226290-L.jpg' })
  const edition: Edition = withLentCover({ book: exact, via: 'isbn', unsure: false, alternatives: [sibling], near: [] }, coverLender(PIRANESI, exact, [sibling]))
  const result = matchResult({ row: jobRow(PIRANESI, 0), book: PIRANESI, edition, matched: true, review: { tier: 'quiet', choose: false, notes: [] } as never })
  assertEquals(result.cover, 'lent')
  assertEquals(result.cover_url, 'https://covers.openlibrary.org/b/id/10226290-L.jpg')
  assertEquals(result.cover_size, 'L')
  assertEquals((result.edition as EditionSummary).book.coverUrl, result.cover_url, 'the review shows the lent cover')
  // What the write phase needs of the match is saved with the row (choice.ts): the Catalogue Book by id, the borrowed cover, the fill.
  assertEquals((result.write as { filled: boolean }).filled, true)
})
