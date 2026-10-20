import { assert, assertEquals } from '@std/assert'
import type { FetchLike } from '../../../web/app/data/fetching.ts'
import { createGoodreadsCover } from '../../../web/app/data/goodreadsCover.ts'
import { type Pace, PaceBusy } from '../_shared/pace.ts'
import { coverSizeOf } from './cover_size.ts'
import { createCoverWork, GOODREADS_BLOCK_PAUSE_MS, GOODREADS_RETRY_S } from './covers.ts'
import type { CoverResult, CoverRow, Job, WorkContext } from './runner.ts'
import { jobFetch } from './sources.ts'
import { NOBODY, PIRANESI, recordedOpenLibrary } from './test_support.ts'

const JOB: Job = { id: 'job-1', member_id: 'ada', source: 'goodreads', languages: ['de-DE'], total: 4, done: 4 }
const GR_COVER = 'https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1603384684l/54272863._SY475_.jpg'

const coverRow = (book: Record<string, unknown>, idx: number, state: CoverRow['cover_state'] = 'pending', tries = 0): CoverRow => ({
  idx,
  key: String(book.key),
  payload: book,
  edition: { book: { isbn13: null } },
  cover_state: state,
  cover_tries: tries,
})

/** What the stage saved and asked, over Open Library's recordings and the function's recorded answers. */
function world(options: { failOpenLibrary?: boolean; goodreads?: (body: Record<string, unknown>) => unknown; pace?: Pace; refuse?: boolean } = {}) {
  const { openLibrary, asked } = recordedOpenLibrary({ fail: options.failOpenLibrary })
  const { fetch } = jobFetch({ openLibrary, fetch: () => Promise.reject(new Error('no request may leave')), userAgent: 'test' })
  const invoked: Record<string, unknown>[] = []
  const goodreads = createGoodreadsCover({
    functions: {
      invoke(name, { body }) {
        assertEquals(name, 'goodreads-rating')
        invoked.push(body as Record<string, unknown>)
        const answer = options.goodreads?.(body as Record<string, unknown>)
        return Promise.resolve(answer instanceof Error ? { data: null, error: answer } : { data: answer ?? { status: 'not_found' }, error: null })
      },
    },
  })
  const turns = { taken: 0 }
  const pace: Pace = options.pace ?? { take: () => (turns.taken++, Promise.resolve()), hold: () => Promise.resolve() }
  const clock = { time: 5_000_000 }
  const work = createCoverWork({ fetch: fetch as FetchLike, goodreads, pace, now: () => clock.time, log: () => {} })
  const saves: { idx: number; result: CoverResult }[] = []
  const waits: number[] = []
  const context = (deadlineIn = 120_000): WorkContext => ({
    runner: 'r',
    deadline: clock.time + deadlineIn,
    save: () => Promise.resolve(true),
    saveWrite: () => Promise.resolve(true),
    saveCover: (idx, result) => {
      if (options.refuse) return Promise.resolve(false)
      saves.push({ idx, result })
      return Promise.resolve(true)
    },
    waitUntil: (until) => waits.push(until),
    stopped: () => Boolean(options.refuse) || waits.length > 0,
  })
  return { work, saves, waits, invoked, asked, turns, clock, context }
}

const resultOf = (saves: { idx: number; result: CoverResult }[], idx: number) => saves.findLast((save) => save.idx === idx)?.result

const sourceOf = (saves: { idx: number; result: CoverResult }[], idx: number) => (resultOf(saves, idx) as { source?: string } | undefined)?.source

// ------------------------------------------------------------------ Open Library

Deno.test('Open Library by ISBN: the very edition\'s cover, decided with its source and size', async () => {
  const w = world()
  await w.work(JOB, [coverRow(PIRANESI as never, 0)], w.context())
  const result = resultOf(w.saves, 0) as { source: string; url: string; size: string }
  assertEquals(result.source, 'openlibrary')
  assert(/^https:\/\/covers\.openlibrary\.org\/b\/id\/\d+-L\.jpg$/.test(result.url), result.url)
  assertEquals(result.size, 'L')
  assertEquals(w.asked.filter((url) => url.includes('/api/books')).length, 1, 'one api/books call for the batch')
  assertEquals(w.invoked.length, 0, 'Goodreads is the last step: not asked')
})

Deno.test('Open Library by title and author when the ISBN has no cover: another edition of the work', async () => {
  const w = world()
  const noIsbn = { ...PIRANESI, key: 'goodreads:1', isbn13: null }
  await w.work(JOB, [coverRow(noIsbn as never, 3)], w.context())
  const result = resultOf(w.saves, 3)
  assertEquals(result, { source: 'openlibrary', url: 'https://covers.openlibrary.org/b/id/10226290-L.jpg', size: 'L' })
  assert(!w.asked.some((url) => url.includes('/api/books')), 'no ISBN, no api/books')
})

Deno.test('Open Library has nothing: a row with a title and an author goes on to Goodreads, one without is decided: no cover', async () => {
  const w = world()
  const nameless = { key: 'goodreads:2', title: '', authors: [] }
  await w.work(JOB, [coverRow(NOBODY as never, 1), coverRow(nameless, 2)], w.context())
  assertEquals(resultOf(w.saves, 1), { next: 'goodreads' })
  assertEquals(resultOf(w.saves, 2), { source: 'none' })
})

Deno.test('Open Library cannot be asked: the row is asked again in the next chunk, then goes on without it', async () => {
  const w = world({ failOpenLibrary: true })
  await w.work(JOB, [coverRow(PIRANESI as never, 0, 'pending', 0)], w.context())
  assertEquals(resultOf(w.saves, 0), { retry: true, wait_seconds: 0 })
  await w.work(JOB, [coverRow(PIRANESI as never, 0, 'pending', 1)], w.context())
  assertEquals(resultOf(w.saves, 0), { next: 'goodreads' }, 'the second failure is no reason to hold the job: Goodreads is next')
})

// ------------------------------------------------------------------ Goodreads

Deno.test('Goodreads found: the row\'s cover, asked ISBN-first with the file\'s own book id, on the pace', async () => {
  const w = world({ goodreads: () => ({ status: 'found', coverUrl: GR_COVER, goodreadsId: '54272863' }) })
  await w.work(JOB, [coverRow(PIRANESI as never, 0, 'goodreads')], w.context())
  assertEquals(resultOf(w.saves, 0), { source: 'goodreads', url: GR_COVER, size: 'L' })
  assertEquals(w.invoked, [{ title: 'Piranesi', authors: ['Susanna Clarke'], cover: true, isbn13: '9781635575637', goodreadsBookId: '50202953' }])
  assertEquals(w.turns.taken, 1, 'every ask takes its turn on the shared pace')
})

Deno.test('Goodreads asks any row with a title and an author, not only a Goodreads file\'s (no book id sent)', async () => {
  const w = world({ goodreads: () => ({ status: 'found', coverUrl: GR_COVER }) })
  const other = { key: 'hardcover:77', title: 'Bleak House', authors: ['Charles Dickens'], isbn13: null, isbn10: '0140430547' }
  await w.work(JOB, [coverRow(other, 0, 'goodreads')], w.context())
  assertEquals(sourceOf(w.saves, 0), 'goodreads')
  assertEquals(w.invoked[0]!.goodreadsBookId, undefined)
  assertEquals(w.invoked[0]!.isbn13, '9780140430547', 'the ISBN-10 is converted: the ISBN comes first')
})

Deno.test('Goodreads answered, no cover for this book: decided, no cover (not asked again)', async () => {
  const w = world({ goodreads: () => ({ status: 'found', coverUrl: null }) })
  await w.work(JOB, [coverRow(NOBODY as never, 0, 'goodreads'), coverRow({ ...NOBODY, key: 'goodreads:5' } as never, 1, 'goodreads')], w.context())
  assertEquals(w.saves.map((save) => save.result), [{ source: 'none' }, { source: 'none' }])
})

Deno.test('Goodreads not_found: no cover', async () => {
  const w = world({ goodreads: () => ({ status: 'not_found' }) })
  await w.work(JOB, [coverRow(NOBODY as never, 0, 'goodreads')], w.context())
  assertEquals(resultOf(w.saves, 0), { source: 'none' })
})

Deno.test('Goodreads unsure (an empty answer): asked again in a later chunk, 30 s later at the least, three tries in all, then no cover', async () => {
  const w = world({ goodreads: () => ({ status: 'unsure', retryAfterSeconds: 30 }) })
  const found = { ...PIRANESI, key: 'goodreads:6' }
  await w.work(JOB, [coverRow(found as never, 0, 'goodreads', 0)], w.context())
  assertEquals(resultOf(w.saves, 0), { retry: true, wait_seconds: GOODREADS_RETRY_S })
  assert(GOODREADS_RETRY_S >= 30)
  await w.work(JOB, [coverRow(found as never, 0, 'goodreads', 1)], w.context())
  assertEquals(resultOf(w.saves, 0), { retry: true, wait_seconds: GOODREADS_RETRY_S })
  await w.work(JOB, [coverRow(found as never, 0, 'goodreads', 2)], w.context())
  assertEquals(resultOf(w.saves, 0), { source: 'none' }, 'the third unsure answer ends it')
})

Deno.test('Goodreads blocked: the stage waits for the job (not for good), the row is not charged and nothing more is asked', async () => {
  const w = world({ goodreads: () => ({ status: 'blocked', retryAfterSeconds: 600 }) })
  const rows = [0, 1, 2, 3].map((idx) => coverRow({ ...NOBODY, key: `goodreads:${idx}` } as never, idx, 'goodreads'))
  await w.work(JOB, rows, w.context())
  assertEquals(w.saves, [], 'no row is saved or charged')
  assertEquals(w.waits.length > 0, true)
  assertEquals(w.waits[0], w.clock.time + GOODREADS_BLOCK_PAUSE_MS)
  assert(w.invoked.length <= 2, 'the asks in flight are all there were')
})

Deno.test('Goodreads not answering at all: the batch fails as a whole (the job backs off), no row is charged', async () => {
  const w = world({ goodreads: () => new Error('502') })
  let thrown: unknown
  await w.work(JOB, [coverRow(NOBODY as never, 0, 'goodreads'), coverRow({ ...NOBODY, key: 'goodreads:5' } as never, 1, 'goodreads')], w.context()).catch((error) => (thrown = error))
  assert(thrown instanceof Error)
  assertEquals(w.saves, [])
})

Deno.test('Goodreads not asked for one row among answered ones: that row is asked again later, charged a try; the third time it is none', async () => {
  const w = world({ goodreads: (body) => (body.goodreadsBookId === '13' ? new Error('503') : { status: 'found', coverUrl: GR_COVER }) })
  const rows = [coverRow({ ...NOBODY, key: 'goodreads:12' } as never, 0, 'goodreads'), coverRow({ ...NOBODY, key: 'goodreads:13' } as never, 1, 'goodreads', 1)]
  await w.work(JOB, rows, w.context())
  assertEquals(sourceOf(w.saves, 0), 'goodreads')
  assertEquals(resultOf(w.saves, 1), { retry: true, wait_seconds: GOODREADS_RETRY_S })
  await w.work(JOB, [coverRow({ ...NOBODY, key: 'goodreads:13' } as never, 1, 'goodreads', 2), coverRow({ ...NOBODY, key: 'goodreads:14' } as never, 2, 'goodreads')], w.context())
  assertEquals(resultOf(w.saves, 1), { source: 'none' })
})

Deno.test('Goodreads\' turn on the pace is further away than the stage waits: the job waits that long, nothing is asked or charged', async () => {
  const pace: Pace = { take: () => Promise.reject(new PaceBusy(7)), hold: () => Promise.resolve() }
  const w = world({ pace })
  await w.work(JOB, [coverRow(NOBODY as never, 0, 'goodreads')], w.context())
  assertEquals(w.saves, [])
  assertEquals(w.waits, [w.clock.time + 7000])
  assertEquals(w.invoked, [])
})

Deno.test('no time budget for Goodreads: a batch of rows is all asked, 24 of 24, one after the other on the pace', async () => {
  const w = world({ goodreads: () => ({ status: 'found', coverUrl: GR_COVER }) })
  const rows = Array.from({ length: 24 }, (_, idx) => coverRow({ ...NOBODY, key: `goodreads:${100 + idx}` } as never, idx, 'goodreads'))
  await w.work(JOB, rows, w.context())
  assertEquals(w.saves.length, 24)
  assertEquals(w.turns.taken, 24)
})

Deno.test('a refused save stops the stage: no ask after it', async () => {
  const w = world({ refuse: true, goodreads: () => ({ status: 'found', coverUrl: GR_COVER }) })
  await w.work(JOB, [coverRow(PIRANESI as never, 0, 'goodreads')], w.context())
  assertEquals(w.invoked, [])
})

Deno.test('a batch past its deadline leaves its rows pending', async () => {
  const w = world()
  await w.work(JOB, [coverRow(PIRANESI as never, 0)], w.context(5_000))
  assertEquals(w.saves, [])
  assertEquals(w.asked, [])
})

Deno.test('the size an address says', () => {
  assertEquals(coverSizeOf('https://covers.openlibrary.org/b/id/123-L.jpg'), 'L')
  assertEquals(coverSizeOf('https://covers.openlibrary.org/b/id/123-M.jpg'), 'M')
  assertEquals(coverSizeOf(GR_COVER), 'L')
  assertEquals(coverSizeOf('https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1603384684s/54272863.jpg'), 'S')
  assertEquals(coverSizeOf('https://example.org/cover.jpg'), null)
})
