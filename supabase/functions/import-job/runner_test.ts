import { assertEquals } from '@std/assert'
import { type CoverResult, type CoverRow, type CoverWork, type Job, type JobRow, type ReleaseState, type RowResult, runChunk, type Store, type Work } from './runner.ts'

const JOB: Job = { id: 'job-1', member_id: 'ada', source: 'goodreads', languages: ['de-DE'], total: 5, done: 0 }

/** An in-memory job of `total` rows: pending until saved; the release answers as the database would. */
function memoryStore(total: number, { refuseSaveAt = -1, noJob = false } = {}) {
  const pending = new Map<number, JobRow>(
    Array.from({ length: total }, (_, idx) => [idx, { idx, key: `goodreads:${idx}`, payload: { key: `goodreads:${idx}` }, pass: 0, attempts: 0 }]),
  )
  const saved: { idx: number; result: RowResult }[] = []
  const released: { error: string | null | undefined; waitUntil?: number | null }[] = []
  const taken = new Set<number>()
  // The cover stage: rows saved with `cover: 'none'` wait here for their cover decision.
  const coverPending = new Map<number, CoverRow>()
  const coverTaken = new Set<number>()
  const coverSaved: { idx: number; result: CoverResult }[] = []
  const store: Store = {
    claim: () => Promise.resolve(noJob ? null : JOB),
    takeRows(_job, _runner, limit) {
      const rows = [...pending.values()].filter((row) => !taken.has(row.idx)).slice(0, limit)
      for (const row of rows) taken.add(row.idx)
      return Promise.resolve(rows)
    },
    saveRow(_job, _runner, idx, result) {
      if (saved.length === refuseSaveAt) return Promise.resolve(false)
      saved.push({ idx, result })
      if (!('defer' in result)) {
        pending.delete(idx)
        if (result.cover === 'none') coverPending.set(idx, { idx, key: `goodreads:${idx}`, payload: { key: `goodreads:${idx}` }, edition: null, cover_state: 'pending', cover_tries: 0 })
      }
      return Promise.resolve(true)
    },
    takeCoverRows(_job, _runner, limit) {
      if (pending.size) return Promise.resolve([])
      const rows = [...coverPending.values()].filter((row) => !coverTaken.has(row.idx)).slice(0, limit)
      for (const row of rows) coverTaken.add(row.idx)
      return Promise.resolve(rows)
    },
    saveCover(_job, _runner, idx, result) {
      coverSaved.push({ idx, result })
      if (!('retry' in result)) coverPending.delete(idx)
      return Promise.resolve(true)
    },
    release(_job, _runner, error, waitUntil) {
      released.push(waitUntil ? { error, waitUntil } : { error })
      for (const idx of taken) taken.delete(idx)
      for (const idx of coverTaken) coverTaken.delete(idx)
      const state: ReleaseState = error || waitUntil ? 'paused' : pending.size || coverPending.size ? 'more' : 'done'
      return Promise.resolve(state)
    },
  }
  return { store, saved, released, pending, coverPending, coverSaved }
}

/** A clock that only moves when the work says so. */
function fakeClock() {
  let time = 1_000_000
  return { now: () => time, advance: (ms: number) => (time += ms) }
}

const ADDED: RowResult = { verdict: 'matched', tier: 'quiet', outcome: 'added', cover: 'own' }

/** Saves every row of the batch as added, taking `msPerRow` of the clock each. */
function savingWork(clock: ReturnType<typeof fakeClock>, msPerRow = 0, seen: { deadline: number }[] = []): Work {
  return async (_job, rows, context) => {
    seen.push({ deadline: context.deadline })
    for (const row of rows) {
      clock.advance(msPerRow)
      if (!(await context.save(row.idx, ADDED))) return
    }
  }
}

const quiet = () => {}

Deno.test('no job holds the slot: idle, nothing claimed or released', async () => {
  const { store, released } = memoryStore(3, { noJob: true })
  const result = await runChunk({ store, work: savingWork(fakeClock()), runner: 'r', log: quiet })
  assertEquals(result, { state: 'idle', saved: 0, batches: 0 })
  assertEquals(released.length, 0)
})

Deno.test('a small job is done in one chunk, batch by batch', async () => {
  const clock = fakeClock()
  const { store, saved, released } = memoryStore(5)
  const seen: { deadline: number }[] = []
  const result = await runChunk({ store, work: savingWork(clock, 1000, seen), runner: 'r', clock, batchRows: 2, log: quiet })
  assertEquals(result, { state: 'done', job: 'job-1', saved: 5, batches: 3, ms: 5000 })
  assertEquals(saved.map((row) => row.idx), [0, 1, 2, 3, 4])
  assertEquals(released, [{ error: null }])
  assertEquals(seen[0]!.deadline, 1_000_000 + 125_000, 'the batch is told the hard end')
})

Deno.test('no new batch after the wall-clock budget: released with rows left, the next chunk is kicked', async () => {
  const clock = fakeClock()
  const { store, saved } = memoryStore(10)
  const result = await runChunk({ store, work: savingWork(clock, 20_000), runner: 'r', clock, batchRows: 2, budgetMs: 90_000, log: quiet })
  // 2 rows × 20 s a batch: after three batches (120 s > 90 s) no fourth starts.
  assertEquals(result.state, 'more')
  assertEquals(result.batches, 3)
  assertEquals(saved.length, 6)
})

Deno.test('no new batch once the chunk took its rows (the CPU is budgeted by rows)', async () => {
  const clock = fakeClock()
  const { store, saved } = memoryStore(100)
  const result = await runChunk({ store, work: savingWork(clock), runner: 'r', clock, batchRows: 24, maxRows: 48, log: quiet })
  assertEquals(result.batches, 2)
  assertEquals(saved.length, 48)
  assertEquals(result.state, 'more')
})

Deno.test('the last batch is cut to the rows left of the chunk', async () => {
  const clock = fakeClock()
  const { store, saved } = memoryStore(100)
  const result = await runChunk({ store, work: savingWork(clock), runner: 'r', clock, batchRows: 24, maxRows: 30, log: quiet })
  assertEquals(result.batches, 2)
  assertEquals(saved.length, 30)
})

Deno.test('a refused save (cancelled, or the lease went to another runner) stops the chunk and releases nothing', async () => {
  const clock = fakeClock()
  const { store, released, saved } = memoryStore(6, { refuseSaveAt: 3 })
  const result = await runChunk({ store, work: savingWork(clock), runner: 'r', clock, batchRows: 2, log: quiet })
  assertEquals(result.state, 'gone')
  assertEquals(saved.length, 3)
  assertEquals(released.length, 0)
})

Deno.test('a deferred row stays pending for the second pass', async () => {
  const clock = fakeClock()
  const { store, pending } = memoryStore(2)
  const work: Work = async (_job, rows, context) => {
    for (const row of rows) await context.save(row.idx, row.idx === 1 ? { defer: true } : ADDED)
  }
  const result = await runChunk({ store, work, runner: 'r', clock, batchRows: 5, log: quiet })
  assertEquals(result.state, 'more')
  assertEquals([...pending.keys()], [1])
})

Deno.test('a batch that fails before saving anything pauses the job', async () => {
  const clock = fakeClock()
  const { store, released } = memoryStore(4)
  const work: Work = () => Promise.reject(new Error('sources unavailable'))
  const result = await runChunk({ store, work, runner: 'r', clock, log: quiet })
  assertEquals(result.state, 'paused')
  assertEquals(released, [{ error: 'sources unavailable' }])
})

Deno.test('a batch that fails after rows were saved goes on at once (no pause)', async () => {
  const clock = fakeClock()
  const { store, released } = memoryStore(4)
  let calls = 0
  const work: Work = async (_job, rows, context) => {
    if (calls++ > 0) throw new Error('a passing hiccup')
    for (const row of rows) await context.save(row.idx, ADDED)
  }
  const result = await runChunk({ store, work, runner: 'r', clock, batchRows: 2, log: quiet })
  assertEquals(result.state, 'more')
  assertEquals(released, [{ error: null }])
})

const NEEDS_COVER: RowResult = { verdict: 'fromFile', tier: 'needsLook', outcome: null, cover: 'none' }

/** Matches every row as one that needs a cover, and decides every cover as Open Library's. */
const matchingWithoutCovers: Work = async (_job, rows, context) => {
  for (const row of rows) await context.save(row.idx, NEEDS_COVER)
}
const decidingCovers: CoverWork = async (_job, rows, context) => {
  for (const row of rows) await context.saveCover(row.idx, { source: 'openlibrary', url: `https://covers.openlibrary.org/b/id/${row.idx}-L.jpg`, size: 'L' })
}

Deno.test('the cover stage is its own phase: it starts when no row is left to match, in the same chunk when there is time', async () => {
  const clock = fakeClock()
  const { store, saved, coverSaved } = memoryStore(5)
  const order: string[] = []
  const work: Work = async (job, rows, context) => {
    order.push(`match ${rows.map((row) => row.idx)}`)
    await matchingWithoutCovers(job, rows, context)
  }
  const cover: CoverWork = async (job, rows, context) => {
    order.push(`cover ${rows.map((row) => row.idx)}`)
    await decidingCovers(job, rows, context)
  }
  const result = await runChunk({ store, work, cover, runner: 'r', clock, batchRows: 2, maxRows: 100, log: quiet })
  assertEquals(order, ['match 0,1', 'match 2,3', 'match 4', 'cover 0,1', 'cover 2,3', 'cover 4'])
  assertEquals(saved.length, 5)
  assertEquals(coverSaved.length, 5)
  assertEquals(result.state, 'done', 'done only when every row has its cover decision')
  assertEquals(result.saved, 10)
})

Deno.test('rows still to cover keep the job going: more, and the next chunk takes them', async () => {
  const clock = fakeClock()
  const { store, coverPending } = memoryStore(4)
  const first = await runChunk({ store, work: matchingWithoutCovers, cover: decidingCovers, runner: 'r', clock, batchRows: 2, maxRows: 4, log: quiet })
  // The chunk's rows (4) were all spent on the match: the covers wait.
  assertEquals(first.state, 'more')
  assertEquals(coverPending.size, 4)
  const second = await runChunk({ store, work: matchingWithoutCovers, cover: decidingCovers, runner: 'r', clock, batchRows: 2, maxRows: 4, log: quiet })
  assertEquals(second.state, 'done')
  assertEquals(coverPending.size, 0)
})

Deno.test('without a cover stage the rows keep waiting for it (the job is not done)', async () => {
  const clock = fakeClock()
  const { store, coverPending } = memoryStore(3)
  const result = await runChunk({ store, work: matchingWithoutCovers, runner: 'r', clock, log: quiet })
  assertEquals(result.state, 'more')
  assertEquals(coverPending.size, 3)
})

Deno.test('a cover batch that asks to wait ends the chunk and releases the job until then, with no fault', async () => {
  const clock = fakeClock()
  const { store, released, coverPending } = memoryStore(4)
  let batches = 0
  const cover: CoverWork = async (_job, rows, context) => {
    batches++
    await context.saveCover(rows[0]!.idx, { source: 'none' })
    context.waitUntil(clock.now() + 600_000)
  }
  const result = await runChunk({ store, work: matchingWithoutCovers, cover, runner: 'r', clock, batchRows: 2, maxRows: 100, log: quiet })
  assertEquals(batches, 1, 'no batch after the wait was asked for')
  assertEquals(result.state, 'paused')
  assertEquals(released, [{ error: null, waitUntil: clock.now() + 600_000 }])
  assertEquals(coverPending.size, 3)
})

Deno.test('a cover batch that fails before saving anything pauses the job, like the match', async () => {
  const clock = fakeClock()
  const { store, released } = memoryStore(2)
  const cover: CoverWork = () => Promise.reject(new Error('goodreads-rating did not answer'))
  // The first chunk only matches (its rows are spent); the second one's cover batch fails with nothing saved.
  await runChunk({ store, work: matchingWithoutCovers, cover, runner: 'r', clock, maxRows: 2, log: quiet })
  released.length = 0
  const result = await runChunk({ store, work: matchingWithoutCovers, cover, runner: 'r', clock, maxRows: 100, log: quiet })
  assertEquals(result.state, 'paused')
  assertEquals(released[0]!.error, 'goodreads-rating did not answer')
})

Deno.test('a refused cover save stops the chunk and releases nothing', async () => {
  const clock = fakeClock()
  const { store, released } = memoryStore(2)
  store.saveCover = () => Promise.resolve(false)
  const result = await runChunk({ store, work: matchingWithoutCovers, cover: decidingCovers, runner: 'r', clock, maxRows: 100, log: quiet })
  assertEquals(result.state, 'gone')
  assertEquals(released.length, 0)
})
