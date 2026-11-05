import { assertEquals } from '@std/assert'
import { removedNames, sweep, type SweepDeps } from './sweep.ts'

/** A fake outside: `queue` is what the database names, `refuse` what the Storage API will not remove. */
function fake(queue: string[], refuse: string[] = []) {
  const log = { batches: 0, removed: [] as string[], done: [] as string[][] }
  const deps: SweepDeps = {
    batch(limit) {
      log.batches++
      return Promise.resolve(queue.filter((p) => !log.removed.includes(p)).slice(0, limit))
    },
    remove(paths) {
      const gone = paths.filter((p) => !refuse.includes(p))
      log.removed.push(...gone)
      return Promise.resolve(gone)
    },
    done(paths) {
      log.done.push(paths)
      return Promise.resolve()
    },
  }
  return { deps, log }
}

Deno.test('it removes what the database names and reports it', async () => {
  const { deps, log } = fake(['r/a/1.m4a', 'r/a/2.webm'])
  assertEquals(await sweep(deps, 100), { removed: 2, rounds: 1 })
  assertEquals(log.removed, ['r/a/1.m4a', 'r/a/2.webm'])
  assertEquals(log.done, [['r/a/1.m4a', 'r/a/2.webm']])
})

Deno.test('it does nothing when there is nothing', async () => {
  const { deps, log } = fake([])
  assertEquals(await sweep(deps), { removed: 0, rounds: 0 })
  assertEquals(log.done, [])
})

Deno.test('it takes another batch while the last one was full', async () => {
  const paths = ['p/1', 'p/2', 'p/3', 'p/4', 'p/5']
  const { deps, log } = fake(paths)
  assertEquals(await sweep(deps, 2), { removed: 5, rounds: 3 })
  assertEquals(log.removed, paths)
})

Deno.test('it stops when nothing in a batch could be removed, so a refused path cannot loop', async () => {
  const { deps, log } = fake(['p/1', 'p/2'], ['p/1', 'p/2'])
  assertEquals(await sweep(deps, 2), { removed: 0, rounds: 1 })
  assertEquals(log.batches, 1)
  assertEquals(log.done, [])
})

Deno.test('it reports only what was removed', async () => {
  const { deps, log } = fake(['p/1', 'p/2'], ['p/2'])
  assertEquals(await sweep(deps, 100), { removed: 1, rounds: 1 })
  assertEquals(log.done, [['p/1']])
})

Deno.test('a run is bounded to its rounds', async () => {
  const { deps } = fake(Array.from({ length: 20 }, (_, i) => `p/${i}`))
  assertEquals(await sweep(deps, 2, 3), { removed: 6, rounds: 3 })
})

Deno.test('the names in the Storage API answer', () => {
  assertEquals(removedNames([{ name: 'a' }, { name: 'b', id: 1 }, null, { id: 2 }, 'x']), ['a', 'b'])
  assertEquals(removedNames(null), [])
  assertEquals(removedNames({ name: 'a' }), [])
})
