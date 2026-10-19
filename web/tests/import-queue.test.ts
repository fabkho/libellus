import { describe, expect, it } from 'vitest'
import {
  BEAT_MS,
  createImportQueue,
  deviceOf,
  holderOf,
  POLL_MS,
  readSlot,
  runWithSlot,
  type ImportQueue,
  SECONDS_PER_BOOK,
  waitSecondsOf,
  type QueueRpc,
  type QueueStatus,
  type Scheduler,
  type SlotState,
} from '@/data/importQueue'

/**
 * The device's side of the import queue (data/importQueue.ts): takes the slot or a place in line, asks again
 * while it waits, beats while it runs, notices a slot that went, and leaves. The server's rules are pgTAP's
 * (supabase/tests/import_queue_test.sql); here it is a stand-in that answers what the tests say, and the
 * clock is a manual one that only moves when a test advances it. Nothing waits for real.
 */

/** Timers that run when the test moves the clock past them, in order. */
function manualClock() {
  let now = 0
  let next = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  const scheduler: Scheduler = {
    after(ms, fn) {
      const id = next++
      timers.set(id, { at: now + ms, fn })
      return () => void timers.delete(id)
    },
  }
  const flush = async () => {
    for (let n = 0; n < 20; n++) await Promise.resolve()
  }
  return {
    scheduler,
    now: () => now,
    pending: () => timers.size,
    flush,
    /** Moves time on, running every timer that falls due on the way, and lets what they start settle. */
    async advance(ms: number) {
      const target = now + ms
      for (;;) {
        await flush()
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        now = Math.max(now, due[1].at)
        due[1].fn()
      }
      now = target
      await flush()
    },
  }
}

const answer = (slot: Partial<SlotState> & { state: SlotState['state'] }) => ({
  data: [{ state: slot.state, mine: slot.mine ?? true, ahead: slot.ahead ?? 0, rows_ahead: slot.rowsAhead ?? 0 }],
  error: null,
})

/** A server that answers from a queue of replies per function, and remembers what it was asked. */
function server(replies: Partial<Record<'import_slot_take' | 'import_slot_beat' | 'import_slot_leave', (args: Record<string, unknown>) => ReturnType<typeof answer> | 'throw'>>) {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const rpc: QueueRpc = async (name, args) => {
    calls.push({ name, args })
    const reply = replies[name]?.(args) ?? answer({ state: 'none', mine: false })
    if (reply === 'throw') throw new TypeError('Failed to fetch')
    return reply
  }
  return { rpc, calls, names: () => calls.map((call) => call.name) }
}

const HOLDER = 'device:11111111-2222-3333-4444-555555555555'
const DEVICE = 'dev-99999999-8888-7777-6666-555555555555'

function setup(replies: Parameters<typeof server>[0], extra: { onLost?: () => void } = {}) {
  const clock = manualClock()
  const api = server(replies)
  const statuses: QueueStatus[] = []
  const base = createImportQueue({ rpc: api.rpc, holder: HOLDER, device: DEVICE, scheduler: clock.scheduler, onStatus: (status) => statuses.push(status) })
  // The holder of the slot says what it wants to hear when the slot goes (as `runWithSlot` does).
  const queue = { ...base, acquire: (rows: number, signal?: AbortSignal) => base.acquire(rows, signal, extra.onLost) }
  return { clock, api, statuses, queue }
}

describe('taking the slot', () => {
  it('is immediate when nobody runs: the slot is hers, with her holder and her books, and she beats while she runs', async () => {
    const { clock, api, queue, statuses } = setup({
      import_slot_take: () => answer({ state: 'running' }),
      import_slot_beat: () => answer({ state: 'running' }),
    })
    await expect(queue.acquire(120)).resolves.toBe('slot')
    expect(queue.holding()).toBe(true)
    expect(api.calls).toEqual([{ name: 'import_slot_take', args: { p_holder: HOLDER, p_rows: 120, p_device: DEVICE } }])
    expect(statuses.at(-1)).toBeNull()

    queue.progress(40)
    await clock.advance(BEAT_MS - 1)
    expect(api.names()).toEqual(['import_slot_take'])
    await clock.advance(1)
    expect(api.calls.at(-1)).toEqual({ name: 'import_slot_beat', args: { p_holder: HOLDER, p_done: 40 } })
    queue.progress(75)
    await clock.advance(BEAT_MS)
    expect(api.calls.at(-1)).toEqual({ name: 'import_slot_beat', args: { p_holder: HOLDER, p_done: 75 } })
    expect(api.names().filter((name) => name === 'import_slot_beat')).toHaveLength(2)
  })

  it('waits in line: says how many are ahead and a rough wait, asks again every few seconds, and starts by itself', async () => {
    let asked = 0
    const { clock, api, queue, statuses } = setup({
      import_slot_take: () => {
        asked++
        if (asked === 1) return answer({ state: 'waiting', ahead: 2, rowsAhead: 300 })
        if (asked === 2) return answer({ state: 'waiting', ahead: 1, rowsAhead: 90 })
        return answer({ state: 'running' })
      },
      import_slot_beat: () => answer({ state: 'running' }),
    })
    let result: string | null = null
    void queue.acquire(50).then((value) => (result = value))
    await clock.flush()
    expect(statuses.at(-1)).toEqual({ kind: 'waiting', ahead: 2, waitSeconds: 300 * SECONDS_PER_BOOK })
    expect(result).toBeNull()
    expect(queue.holding()).toBe(false)

    await clock.advance(POLL_MS - 1)
    expect(asked).toBe(1)
    await clock.advance(1)
    expect(statuses.at(-1)).toEqual({ kind: 'waiting', ahead: 1, waitSeconds: 90 * SECONDS_PER_BOOK })
    expect(result).toBeNull()

    await clock.advance(POLL_MS)
    expect(result).toBe('slot')
    expect(queue.holding()).toBe(true)
    expect(statuses.at(-1)).toBeNull()
    // Every ask is the same call: the server keeps her place when the same device asks again.
    expect(api.names()).toEqual(['import_slot_take', 'import_slot_take', 'import_slot_take'])
  })

  it('no rough wait when the ones ahead say nothing about their books', async () => {
    const { clock, queue, statuses } = setup({ import_slot_take: () => answer({ state: 'waiting', ahead: 1, rowsAhead: 0 }) })
    void queue.acquire(10).catch(() => {})
    await clock.flush()
    expect(statuses.at(-1)).toEqual({ kind: 'waiting', ahead: 1, waitSeconds: null })
  })

  it("her other device's import is told, not joined: she waits for it and takes the slot when it is done", async () => {
    let asked = 0
    const { clock, queue, statuses } = setup({
      import_slot_take: () => (++asked < 3 ? answer({ state: 'running', mine: false }) : answer({ state: 'running' })),
      import_slot_beat: () => answer({ state: 'running' }),
    })
    let result: string | null = null
    void queue.acquire(10).then((value) => (result = value))
    await clock.flush()
    expect(statuses.at(-1)).toEqual({ kind: 'elsewhere' })
    await clock.advance(POLL_MS * 2)
    expect(result).toBe('slot')
    expect(statuses.at(-1)).toBeNull()
  })

  it('a place the server gave up (none) is asked for again, not waited on', async () => {
    let asked = 0
    const { clock, queue } = setup({
      import_slot_take: () => (++asked === 1 ? answer({ state: 'none', mine: false }) : answer({ state: 'running' })),
      import_slot_beat: () => answer({ state: 'running' }),
    })
    let result: string | null = null
    void queue.acquire(10).then((value) => (result = value))
    await clock.advance(POLL_MS)
    expect(result).toBe('slot')
  })

  it('the queue out of reach on the first call: the import goes on without a slot, as before the queue', async () => {
    const { clock, api, queue, statuses } = setup({ import_slot_take: () => 'throw' })
    await expect(queue.acquire(10)).resolves.toBe('open')
    expect(queue.holding()).toBe(false)
    expect(statuses.at(-1)).toBeNull()
    await clock.advance(BEAT_MS * 3)
    // Nothing to beat, nothing to leave.
    expect(api.names()).toEqual(['import_slot_take'])
    await queue.release()
    expect(api.names()).toEqual(['import_slot_take'])
  })

  it('an answer that is not the queue (a stray function) is the same as the queue out of reach', async () => {
    const { queue } = setup({ import_slot_take: () => ({ data: { nope: 1 }, error: null }) as ReturnType<typeof answer> })
    await expect(queue.acquire(10)).resolves.toBe('open')
  })

  it('a call failing while she waits is tried again, not given up', async () => {
    let asked = 0
    const { clock, queue } = setup({
      import_slot_take: () => {
        asked++
        if (asked === 1) return answer({ state: 'waiting', ahead: 1 })
        if (asked === 2) return 'throw'
        return answer({ state: 'running' })
      },
      import_slot_beat: () => answer({ state: 'running' }),
    })
    let result: string | null = null
    void queue.acquire(10).then((value) => (result = value))
    await clock.advance(POLL_MS * 3)
    expect(result).toBe('slot')
  })
})

describe('leaving', () => {
  it('cancelling in line leaves the line (the place goes) and stops asking', async () => {
    const { clock, api, queue, statuses } = setup({
      import_slot_take: () => answer({ state: 'waiting', ahead: 1, rowsAhead: 10 }),
      import_slot_leave: () => answer({ state: 'none', mine: false }),
    })
    const controller = new AbortController()
    const waiting = queue.acquire(10, controller.signal)
    const outcome = expect(waiting).rejects.toThrow('cancelled')
    await clock.flush()
    controller.abort(new Error('cancelled'))
    await outcome
    await clock.flush()
    expect(api.names()).toEqual(['import_slot_take', 'import_slot_leave'])
    expect(statuses.at(-1)).toBeNull()
    expect(clock.pending()).toBe(0)
    await clock.advance(POLL_MS * 4)
    expect(api.names()).toHaveLength(2)
  })

  it('releasing gives the slot up: it stops beating and tells the server, once', async () => {
    const { clock, api, queue } = setup({
      import_slot_take: () => answer({ state: 'running' }),
      import_slot_beat: () => answer({ state: 'running' }),
      import_slot_leave: () => answer({ state: 'none', mine: false }),
    })
    await queue.acquire(10)
    await queue.release()
    expect(queue.holding()).toBe(false)
    expect(api.names()).toEqual(['import_slot_take', 'import_slot_leave'])
    await clock.advance(BEAT_MS * 3)
    expect(api.names()).toEqual(['import_slot_take', 'import_slot_leave'])
    await queue.release()
    expect(api.names()).toHaveLength(2)
  })

  it('a release that cannot reach the server is no error: the place expires by itself', async () => {
    const { queue } = setup({ import_slot_take: () => answer({ state: 'running' }), import_slot_beat: () => answer({ state: 'running' }), import_slot_leave: () => 'throw' })
    await queue.acquire(10)
    await expect(queue.release()).resolves.toBeUndefined()
  })
})

describe('while she runs', () => {
  it('a slot that was given up (her beat found no place: the phone slept past 75 s) is reported once, and she can take a place again', async () => {
    let beats = 0
    let lost = 0
    const { clock, api, queue } = setup(
      {
        import_slot_take: () => answer({ state: 'running' }),
        import_slot_beat: () => (++beats < 2 ? answer({ state: 'running' }) : answer({ state: 'none', mine: false })),
      },
      { onLost: () => lost++ },
    )
    await queue.acquire(10)
    await clock.advance(BEAT_MS)
    expect(queue.holding()).toBe(true)
    await clock.advance(BEAT_MS)
    expect(lost).toBe(1)
    expect(queue.holding()).toBe(false)
    // Not beating any more.
    await clock.advance(BEAT_MS * 3)
    expect(api.names().filter((name) => name === 'import_slot_beat')).toHaveLength(2)
    await expect(queue.acquire(10)).resolves.toBe('slot')
  })

  it('a slot that is hers no more (running on another holder) is lost too', async () => {
    let lost = 0
    const { clock, queue } = setup(
      { import_slot_take: () => answer({ state: 'running' }), import_slot_beat: () => answer({ state: 'running', mine: false }) },
      { onLost: () => lost++ },
    )
    await queue.acquire(10)
    await clock.advance(BEAT_MS)
    expect(lost).toBe(1)
  })

  it('a beat that does not get through is not a lost slot: the place lives 75 s, the next beat tries again', async () => {
    let beats = 0
    let lost = 0
    const { clock, queue } = setup(
      { import_slot_take: () => answer({ state: 'running' }), import_slot_beat: () => (++beats === 1 ? 'throw' : answer({ state: 'running' })) },
      { onLost: () => lost++ },
    )
    await queue.acquire(10)
    await clock.advance(BEAT_MS * 3)
    expect(beats).toBe(3)
    expect(lost).toBe(0)
    expect(queue.holding()).toBe(true)
  })

  it('the app coming back to the front beats (or asks) at once instead of at the next tick', async () => {
    const { clock, api, queue } = setup({
      import_slot_take: () => answer({ state: 'running' }),
      import_slot_beat: () => answer({ state: 'running' }),
    })
    await queue.acquire(10)
    queue.nudge()
    await clock.flush()
    expect(api.names()).toEqual(['import_slot_take', 'import_slot_beat'])
    // The next tick is a full beat away again.
    await clock.advance(BEAT_MS - 1)
    expect(api.names()).toHaveLength(2)
    await clock.advance(1)
    expect(api.names()).toHaveLength(3)
  })

  it('a waiting import is nudged too', async () => {
    let asked = 0
    const { clock, queue } = setup({ import_slot_take: () => (++asked === 1 ? answer({ state: 'waiting', ahead: 1 }) : answer({ state: 'running' })), import_slot_beat: () => answer({ state: 'running' }) })
    let result: string | null = null
    void queue.acquire(10).then((value) => (result = value))
    await clock.flush()
    queue.nudge()
    await clock.flush()
    expect(result).toBe('slot')
  })
})

describe('the parts', () => {
  it('reads the one-row table the functions answer', () => {
    expect(readSlot([{ state: 'waiting', mine: true, ahead: 2, rows_ahead: 140 }])).toEqual({ state: 'waiting', mine: true, ahead: 2, rowsAhead: 140 })
    expect(readSlot({ state: 'running', mine: false, ahead: null, rows_ahead: null })).toEqual({ state: 'running', mine: false, ahead: 0, rowsAhead: 0 })
    expect(() => readSlot([])).toThrow()
    expect(() => readSlot([{ state: 'queued', mine: true }])).toThrow()
    expect(() => readSlot([{ state: 'none' }])).toThrow()
  })

  it('a rough wait is the books ahead at about a second each, and nothing when none are known', () => {
    expect(waitSecondsOf(0)).toBeNull()
    expect(waitSecondsOf(300)).toBe(300 * SECONDS_PER_BOOK)
  })

  it("a tab keeps its name for its life, so a reload finds its own place; a garbled one is replaced", () => {
    const store = new Map<string, string>()
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) }
    const first = holderOf(storage, () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    expect(first).toBe('device:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    expect(holderOf(storage, () => 'other-name-that-is-not-used')).toBe(first)
    store.set('libellus.import-holder', 'x')
    expect(holderOf(storage, () => 'ffffffff-0000-1111-2222-333333333333')).toBe('device:ffffffff-0000-1111-2222-333333333333')
    // Fits the 64 characters the server allows.
    expect(first.length).toBeLessThanOrEqual(64)
  })

  it('without storage, or with storage that refuses, a name for this page load is enough', () => {
    expect(holderOf(null, () => 'abcdefgh-1')).toBe('device:abcdefgh-1')
    const refusing = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    expect(holderOf(refusing, () => 'abcdefgh-2')).toBe('device:abcdefgh-2')
  })
})

describe('running on the slot', () => {
  /** A queue that grants its turns when told: `grant()` lets the oldest waiting `acquire` through. */
  function fakeQueue() {
    const waiting: { resolve: (value: 'slot' | 'open') => void; reject: (reason: unknown) => void; rows: number; onLost?: () => void }[] = []
    let onLost: (() => void) | undefined
    const asked: number[] = []
    const queue = {
      acquire(rows, signal, lost) {
        asked.push(rows)
        return new Promise((resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
          waiting.push({ resolve: (value) => { onLost = lost; resolve(value) }, reject, rows, onLost: lost })
        })
      },
      progress: () => {},
      release: async () => {},
      nudge: () => {},
      holding: () => false,
    } satisfies ImportQueue
    return { queue, asked, grant: () => waiting.shift()!.resolve('slot'), lose: () => onLost?.() }
  }
  const flush = async () => {
    for (let n = 0; n < 20; n++) await Promise.resolve()
  }

  it('waits for the turn, then runs once, and says when the turn came', async () => {
    const { queue, grant, asked } = fakeQueue()
    const events: string[] = []
    const outcome = runWithSlot(queue, {
      rows: () => 30,
      signal: new AbortController().signal,
      onTurn: () => events.push('turn'),
      run: async () => void events.push('run'),
    })
    await flush()
    expect(events).toEqual([])
    grant()
    await expect(outcome).resolves.toBe('finished')
    expect(events).toEqual(['turn', 'run'])
    expect(asked).toEqual([30])
  })

  it('a slot lost half way stops the run, waits in line again and runs what is left', async () => {
    const { queue, grant, lose, asked } = fakeQueue()
    let left = 100
    const runs: number[] = []
    const outcome = runWithSlot(queue, {
      rows: () => left,
      signal: new AbortController().signal,
      run: (signal) =>
        new Promise<void>((resolve, reject) => {
          runs.push(left)
          if (runs.length === 2) return resolve()
          // The first run does 60 books, then the slot goes while the rest is being looked up.
          left = 40
          signal.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')), { once: true })
        }),
    })
    await flush()
    grant()
    await flush()
    expect(runs).toEqual([100])
    lose()
    await flush()
    // Back in line with the 40 books that are left; not running meanwhile.
    expect(asked).toEqual([100, 40])
    expect(runs).toEqual([100])
    grant()
    await expect(outcome).resolves.toBe('finished')
    expect(runs).toEqual([100, 40])
  })

  it('cancelling while in line ends it without a run; cancelling while running stops the run', async () => {
    const waiting = fakeQueue()
    const early = new AbortController()
    let ran = false
    const first = runWithSlot(waiting.queue, { rows: () => 5, signal: early.signal, run: async () => void (ran = true) })
    await flush()
    early.abort()
    await expect(first).resolves.toBe('cancelled')
    expect(ran).toBe(false)

    const running = fakeQueue()
    const late = new AbortController()
    let stopped = false
    const second = runWithSlot(running.queue, {
      rows: () => 5,
      signal: late.signal,
      run: (signal) =>
        new Promise<void>((_, reject) => {
          signal.addEventListener('abort', () => {
            stopped = true
            reject(new DOMException('stopped', 'AbortError'))
          }, { once: true })
        }),
    })
    await flush()
    running.grant()
    await flush()
    late.abort()
    await expect(second).resolves.toBe('cancelled')
    expect(stopped).toBe(true)
  })

  it('a run that fails for its own reason throws it (the caller decides what a failed lookup is)', async () => {
    const { queue, grant } = fakeQueue()
    const outcome = runWithSlot(queue, { rows: () => 1, signal: new AbortController().signal, run: async () => { throw new Error('boom') } })
    await flush()
    grant()
    await expect(outcome).rejects.toThrow('boom')
  })

  it('works on the real queue end to end: in line, her turn, a lost slot, her turn again', async () => {
    const clock = manualClock()
    let takes = 0
    let beats = 0
    const api = server({
      import_slot_take: () => {
        takes++
        // Behind somebody the first time, free the second (the slot went and nobody else was in line).
        return takes === 1 ? answer({ state: 'waiting', ahead: 1, rowsAhead: 20 }) : answer({ state: 'running' })
      },
      import_slot_beat: () => (++beats === 1 ? answer({ state: 'none', mine: false }) : answer({ state: 'running' })),
      import_slot_leave: () => answer({ state: 'none', mine: false }),
    })
    const statuses: QueueStatus[] = []
    const queue = createImportQueue({ rpc: api.rpc, holder: HOLDER, scheduler: clock.scheduler, onStatus: (status) => statuses.push(status) })
    const started: number[] = []
    let done = 0
    const outcome = runWithSlot(queue, {
      rows: () => 50 - done,
      signal: new AbortController().signal,
      onTurn: () => started.push(clock.now()),
      run: (signal) =>
        new Promise<void>((resolve, reject) => {
          if (started.length === 2) return resolve()
          done = 20
          signal.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')), { once: true })
        }),
    })
    await clock.advance(POLL_MS)
    expect(started).toEqual([POLL_MS])
    expect(statuses[0]).toEqual({ kind: 'waiting', ahead: 1, waitSeconds: 20 * SECONDS_PER_BOOK })
    await clock.advance(BEAT_MS)
    await clock.advance(0)
    await expect(outcome).resolves.toBe('finished')
    expect(started).toHaveLength(2)
    // Asked twice while in line (the second ask is the poll), then again, with the books that were left.
    expect(api.calls.filter((call) => call.name === 'import_slot_take').map((call) => call.args.p_rows)).toEqual([50, 50, 30])
  })
})
