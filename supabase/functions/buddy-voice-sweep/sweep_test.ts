import { assertEquals } from '@std/assert'
import { itemsOf, removedNames, removeFromBuckets, sweep, type SweepDeps, type SweepItem } from './sweep.ts'

const buddy = (path: string): SweepItem => ({ bucket: 'buddy-voice', path })
const note = (path: string): SweepItem => ({ bucket: 'note-voice', path })
const same = (a: SweepItem, b: SweepItem) => a.bucket === b.bucket && a.path === b.path

/** A fake outside: `queue` is what the database names, `refuse` what the Storage API will not remove. */
function fake(queue: SweepItem[], refuse: SweepItem[] = []) {
  const log = { batches: 0, removed: [] as SweepItem[], done: [] as SweepItem[][] }
  const deps: SweepDeps = {
    batch(limit) {
      log.batches++
      return Promise.resolve(queue.filter((p) => !log.removed.some((r) => same(r, p))).slice(0, limit))
    },
    remove(items) {
      const gone = items.filter((p) => !refuse.some((r) => same(r, p)))
      log.removed.push(...gone)
      return Promise.resolve(gone)
    },
    done(items) {
      log.done.push(items)
      return Promise.resolve()
    },
  }
  return { deps, log }
}

Deno.test('it removes what the database names and reports it', async () => {
  const items = [buddy('r/a/1.m4a'), buddy('r/a/2.webm')]
  const { deps, log } = fake(items)
  assertEquals(await sweep(deps, 100), { removed: 2, rounds: 1 })
  assertEquals(log.removed, items)
  assertEquals(log.done, [items])
})

Deno.test('it removes the objects of both buckets, each reported with its own bucket', async () => {
  const items = [buddy('r/a/1.m4a'), note('a/r/1.m4a'), note('a/r/2.webm')]
  const { deps, log } = fake(items)
  assertEquals(await sweep(deps, 100), { removed: 3, rounds: 1 })
  assertEquals(log.done, [items])
})

Deno.test('the same name in the other bucket is another object: only the one that was removed is reported', async () => {
  const { deps, log } = fake([buddy('x/y/z.m4a'), note('x/y/z.m4a')], [note('x/y/z.m4a')])
  assertEquals(await sweep(deps, 100), { removed: 1, rounds: 1 })
  assertEquals(log.done, [[buddy('x/y/z.m4a')]])
})

Deno.test('it does nothing when there is nothing', async () => {
  const { deps, log } = fake([])
  assertEquals(await sweep(deps), { removed: 0, rounds: 0 })
  assertEquals(log.done, [])
})

Deno.test('it takes another batch while the last one was full', async () => {
  const items = ['p/1', 'p/2', 'p/3', 'p/4', 'p/5'].map((p, i) => (i % 2 ? note(p) : buddy(p)))
  const { deps, log } = fake(items)
  assertEquals(await sweep(deps, 2), { removed: 5, rounds: 3 })
  assertEquals(log.removed, items)
})

Deno.test('it stops when nothing in a batch could be removed, so a refused path cannot loop', async () => {
  const items = [buddy('p/1'), note('p/2')]
  const { deps, log } = fake(items, items)
  assertEquals(await sweep(deps, 2), { removed: 0, rounds: 1 })
  assertEquals(log.batches, 1)
  assertEquals(log.done, [])
})

Deno.test('it reports only what was removed', async () => {
  const { deps, log } = fake([buddy('p/1'), note('p/2')], [note('p/2')])
  assertEquals(await sweep(deps, 100), { removed: 1, rounds: 1 })
  assertEquals(log.done, [[buddy('p/1')]])
})

Deno.test('a run is bounded to its rounds', async () => {
  const { deps } = fake(Array.from({ length: 20 }, (_, i) => note(`p/${i}`)))
  assertEquals(await sweep(deps, 2, 3), { removed: 6, rounds: 3 })
})

Deno.test('the names in the Storage API answer', () => {
  assertEquals(removedNames([{ name: 'a' }, { name: 'b', id: 1 }, null, { id: 2 }, 'x']), ['a', 'b'])
  assertEquals(removedNames(null), [])
  assertEquals(removedNames({ name: 'a' }), [])
})

Deno.test('the items in the database answer: only what is shaped like one', () => {
  assertEquals(itemsOf([{ bucket: 'note-voice', path: 'a/b/c.m4a' }, { bucket: 'buddy-voice', path: 'x', extra: 1 }, { path: 'y' }, null, 'z', { bucket: 1, path: 'q' }]), [
    note('a/b/c.m4a'),
    buddy('x'),
  ])
  assertEquals(itemsOf(null), [])
  assertEquals(itemsOf('a/b'), [])
  // The answer of the previous version of the function (bare paths) is no batch of this one: nothing is removed from a guess.
  assertEquals(itemsOf(['a/b/c.m4a']), [])
})

Deno.test('it removes from each bucket on its own and reports each object with its bucket', async () => {
  const calls: [string, string[]][] = []
  const gone = await removeFromBuckets([buddy('r/a/1.m4a'), note('a/r/1.m4a'), note('a/r/2.webm')], (bucket, paths) => {
    calls.push([bucket, paths])
    return Promise.resolve({ data: paths.map((name) => ({ name })), error: null })
  })
  assertEquals(calls, [['buddy-voice', ['r/a/1.m4a']], ['note-voice', ['a/r/1.m4a', 'a/r/2.webm']]])
  assertEquals(gone, [buddy('r/a/1.m4a'), note('a/r/1.m4a'), note('a/r/2.webm')])
})

Deno.test('a bucket the Storage API refuses costs the other nothing, and only a run that removed nothing fails', async () => {
  const items = [buddy('r/a/1.m4a'), note('a/r/1.m4a')]
  const gone = await removeFromBuckets(items, (bucket, paths) =>
    Promise.resolve(bucket === 'note-voice' ? { data: null, error: { message: 'down' } } : { data: paths.map((name) => ({ name })), error: null }))
  assertEquals(gone, [buddy('r/a/1.m4a')])
  let failed = ''
  try {
    await removeFromBuckets(items, () => Promise.resolve({ data: null, error: { message: 'down' } }))
  } catch (error) {
    failed = (error as Error).message
  }
  assertEquals(failed, 'storage (buddy-voice): down')
})

Deno.test('an object of a bucket the function does not know is never removed', async () => {
  const calls: string[] = []
  const gone = await removeFromBuckets([{ bucket: 'avatars', path: 'a/b.jpg' }], (bucket) => {
    calls.push(bucket)
    return Promise.resolve({ data: [{ name: 'a/b.jpg' }], error: null })
  })
  assertEquals(calls, [])
  assertEquals(gone, [])
})
