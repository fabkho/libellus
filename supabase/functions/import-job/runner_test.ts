import { assertEquals } from '@std/assert'
import { type Job, type JobRow, type ReleaseState, type RowResult, runChunk, type Store, type Work } from './runner.ts'

const JOB: Job = { id: 'job-1', member_id: 'ada', source: 'goodreads', languages: ['de-DE'], total: 5, done: 0 }

/** An in-memory job of `total` rows: pending until saved; the release answers as the database would. */
function memoryStore(total: number, { refuseSaveAt = -1, noJob = false } = {}) {
  const pending = new Map<number, JobRow>(
    Array.from({ length: total }, (_, idx) => [idx, { idx, key: `goodreads:${idx}`, payload: { key: `goodreads:${idx}` }, pass: 0, attempts: 0 }]),
  )
  const saved: { idx: number; result: RowResult }[] = []
  const released: { error: string | null | undefined }[] = []
  const taken = new Set<number>()
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
      if (!('defer' in result)) pending.delete(idx)
      return Promise.resolve(true)
    },
    release(_job, _runner, error) {
      released.push({ error })
      for (const idx of taken) taken.delete(idx)
      const state: ReleaseState = error ? 'paused' : pending.size ? 'more' : 'done'
      return Promise.resolve(state)
    },
  }
  return { store, saved, released, pending }
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
  assertEquals(result, { state: 'done', job: 'job-1', saved: 5, batches: 3 })
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

Deno.test('no new batch after the CPU budget', async () => {
  const clock = fakeClock()
  let cpu = 100
  const { store } = memoryStore(10)
  const work: Work = async (_job, rows, context) => {
    for (const row of rows) await context.save(row.idx, ADDED)
    cpu += 700
  }
  const result = await runChunk({ store, work, runner: 'r', clock, cpu: () => cpu, cpuBudgetMs: 1300, batchRows: 2, log: quiet })
  assertEquals(result.batches, 2, 'after 1.4 s of CPU no third batch')
  assertEquals(result.state, 'more')
})

Deno.test('a platform without a CPU reading runs on the wall clock alone', async () => {
  const clock = fakeClock()
  const { store } = memoryStore(4)
  const result = await runChunk({ store, work: savingWork(clock), runner: 'r', clock, cpu: () => null, batchRows: 2, log: quiet })
  assertEquals(result.state, 'done')
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
