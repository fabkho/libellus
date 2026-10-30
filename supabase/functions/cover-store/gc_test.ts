import { assertEquals } from '@std/assert'
import { GC_BATCH, runGc } from './gc.ts'
import { createR2 } from './r2.ts'
import type { GcClaimed, GcStore } from './store.ts'
import { fakeS3, fixture } from './test_support.ts'

const key = (n: number) => n.toString(16).padStart(32, '0')

/**
 * The database's GC RPCs over an in-memory table: `claim` hands out the objects not yet held (up to the limit) and holds
 * them, `done` removes the rows, `failed` releases them (and `failed` ones are not claimed again: the retry date).
 * `enabled` false = the claim answers nothing, as `cover_gc_claim` does while the feature is off.
 */
function fakeGcStore(initial: GcClaimed[], options: { enabled?: boolean } = {}) {
  const rows = new Map(initial.map((object) => [object.key, { ...object, state: 'free' as 'free' | 'held' | 'retry' }]))
  const calls = { claims: [] as number[], done: [] as string[][], failed: [] as string[][] }
  const store: GcStore = {
    claim(limit) {
      calls.claims.push(limit)
      if (options.enabled === false) return Promise.resolve([])
      const picked = [...rows.values()].filter((row) => row.state === 'free').slice(0, limit)
      for (const row of picked) row.state = 'held'
      return Promise.resolve(picked.map(({ key, widths }) => ({ key, widths })))
    },
    done(keys) {
      calls.done.push(keys)
      for (const key of keys) if (rows.get(key)?.state === 'held') rows.delete(key)
      return Promise.resolve(keys.length)
    },
    failed(keys) {
      calls.failed.push(keys)
      for (const key of keys) {
        const row = rows.get(key)
        if (row?.state === 'held') row.state = 'retry'
      }
      return Promise.resolve(keys.length)
    },
  }
  return { store, calls, rows, states: () => Object.fromEntries([...rows.values()].map((row) => [row.key, row.state])) }
}

async function world(objects: { key: string; widths: number[] | null; stored?: number[] }[], options: { s3?: Parameters<typeof fakeS3>[0]; enabled?: boolean; batch?: number; deadlineMs?: number } = {}) {
  const s3 = fakeS3(options.s3)
  const r2 = createR2({ accountId: 'acct', accessKeyId: 'AKIAFAKE', secretAccessKey: 'fake', fetch: s3.fetch })
  // What R2 holds: the widths the database knows, or what `stored` says (an object whose widths the database never learnt).
  for (const object of objects) for (const width of object.stored ?? object.widths ?? []) await r2.put(object.key, width, fixture('apple-120x180.webp'), 'image/webp')
  s3.puts.length = 0
  const db = fakeGcStore(objects.map(({ key, widths }) => ({ key, widths })), { enabled: options.enabled })
  const logged: string[] = []
  const result = await runGc({ store: db.store, r2, log: (message) => logged.push(message), batch: options.batch, deadlineMs: options.deadlineMs })
  return { result, s3, db, logged }
}

Deno.test('gc deletes every width of every claimed object, then the database removes the rows', async () => {
  const { result, s3, db } = await world([
    { key: key(1), widths: [114, 227, 341, 568] },
    { key: key(2), widths: [180, 353] },
    { key: key(3), widths: [400] },
  ])
  assertEquals([...s3.objects.keys()], [])
  assertEquals(s3.deletes.length, 7)
  assertEquals(db.calls.done.flat().sort(), [key(1), key(2), key(3)])
  assertEquals(db.calls.failed, [])
  assertEquals([...db.rows.keys()], [])
  assertEquals([result.state, result.claimed, result.deleted, result.failed], ['ran', 3, 3, 0])
})

Deno.test('gc keeps the objects of other keys', async () => {
  const s3 = fakeS3()
  const r2 = createR2({ accountId: 'acct', accessKeyId: 'AKIAFAKE', secretAccessKey: 'fake', fetch: s3.fetch })
  await r2.put(key(9), 120, fixture('apple-120x180.webp'), 'image/webp')
  await r2.put(key(1), 120, fixture('apple-120x180.webp'), 'image/webp')
  const db = fakeGcStore([{ key: key(1), widths: [120] }])
  await runGc({ store: db.store, r2, log: () => {} })
  assertEquals([...s3.objects.keys()], [`c/${key(9)}/120`])
})

Deno.test('a delete that fails keeps the row for the next run, and the other objects are still deleted', async () => {
  const { result, s3, db, logged } = await world(
    [{ key: key(1), widths: [114, 568] }, { key: key(2), widths: [120] }, { key: key(3), widths: [120, 240] }],
    { s3: { failDelete: (path) => (path === `c/${key(1)}/568` ? 500 : null) } },
  )
  assertEquals(db.calls.done.flat().sort(), [key(2), key(3)])
  assertEquals(db.calls.failed, [[key(1)]])
  assertEquals(db.states(), { [key(1)]: 'retry' })
  assertEquals([result.claimed, result.deleted, result.failed], [3, 2, 1])
  assertEquals([...s3.objects.keys()].sort(), [`c/${key(1)}/568`]) // the half-deleted one: 114 went before the failure
  // Counts and error kinds only: no key, no address, nothing of the answer's body.
  assertEquals(logged.length, 1)
  assertEquals(logged[0]!.includes(key(1)) || logged[0]!.includes('secret detail') || logged[0]!.includes('r2.cloudflarestorage'), false)
  assertEquals(logged[0]!.includes('r2_500'), true)
})

Deno.test('an unreachable R2 fails every object and keeps every row; a second run in the same week claims nothing', async () => {
  const { result, db } = await world(
    [{ key: key(1), widths: [120] }, { key: key(2), widths: [120] }],
    { s3: { failDelete: () => 503 } },
  )
  assertEquals([result.deleted, result.failed], [0, 2])
  assertEquals(db.calls.done, [])
  assertEquals(Object.values(db.states()), ['retry', 'retry'])
  assertEquals(db.calls.claims.length, 1) // the loop does not claim the failed ones again within the run
})

Deno.test('a cover_objects row with null widths (a failure after the reservation): what is in R2 is listed and deleted', async () => {
  const { result, s3, db } = await world([
    { key: key(1), widths: null, stored: [114, 227] }, // two of four widths were uploaded before the failure
    { key: key(2), widths: null }, // nothing was uploaded at all
  ])
  assertEquals([...s3.objects.keys()], [])
  assertEquals(s3.lists.sort(), [`c/${key(1)}/`, `c/${key(2)}/`])
  assertEquals(s3.deletes.sort(), [`c/${key(1)}/114`, `c/${key(1)}/227`])
  assertEquals(db.calls.done.flat().sort(), [key(1), key(2)])
  assertEquals([result.deleted, result.failed], [2, 0])
})

Deno.test('null widths and a LIST that fails: the row stays', async () => {
  const { result, db } = await world([{ key: key(1), widths: null, stored: [114] }], { s3: { failList: () => 500 } })
  assertEquals([result.deleted, result.failed], [0, 1])
  assertEquals(db.states(), { [key(1)]: 'retry' })
})

Deno.test('an object already gone from R2 counts as deleted (S3 answers 204)', async () => {
  const { result, db } = await world([{ key: key(1), widths: [120, 240], stored: [] }])
  assertEquals([result.deleted, result.failed], [1, 0])
  assertEquals(db.calls.done, [[key(1)]])
})

Deno.test('the feature off: the claim answers nothing and nothing is deleted (or listed)', async () => {
  const s3 = fakeS3()
  const r2 = createR2({ accountId: 'acct', accessKeyId: 'AKIAFAKE', secretAccessKey: 'fake', fetch: s3.fetch })
  await r2.put(key(1), 120, fixture('apple-120x180.webp'), 'image/webp')
  const db = fakeGcStore([{ key: key(1), widths: [120] }], { enabled: false })
  const result = await runGc({ store: db.store, r2, log: () => {} })
  assertEquals([result.state, result.claimed, result.deleted], ['idle', 0, 0])
  assertEquals([s3.deletes, s3.lists, db.calls.done, db.calls.failed], [[], [], [], []])
  assertEquals([...s3.objects.keys()], [`c/${key(1)}/120`])
  assertEquals(db.states(), { [key(1)]: 'free' })
})

Deno.test('batches go on while a claim comes back full, and stop at the first short one', async () => {
  const objects = Array.from({ length: 5 }, (_, index) => ({ key: key(index + 1), widths: [120] }))
  const { result, db } = await world(objects, { batch: 2 })
  assertEquals(db.calls.claims, [2, 2, 2])
  assertEquals([result.claimed, result.deleted], [5, 5])
  assertEquals(GC_BATCH, 100)
})

Deno.test('the deadline cuts the requests: what was claimed is settled (failed, kept), never left held', async () => {
  const never = (request: Request) => new Promise<Response>((_, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason)))
  const r2 = createR2({ accountId: 'acct', accessKeyId: 'AKIAFAKE', secretAccessKey: 'fake', fetch: never, deleteTimeoutMs: 60_000 })
  const db = fakeGcStore([{ key: key(1), widths: [120] }, { key: key(2), widths: [120] }])
  const result = await runGc({ store: db.store, r2, log: () => {}, deadlineMs: 30 })
  assertEquals([result.deleted, result.failed], [0, 2])
  assertEquals(Object.values(db.states()), ['retry', 'retry'])
})
