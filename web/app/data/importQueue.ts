/**
 * The import queue, the device's side: one member's import does its lookups at a time, across all
 * members (owner decision 19 Oct 2026: nothing is gained by several imports at once when the requests
 * would only start timing out). The rules are the database's (supabase/migrations/20261030020000_import_queue.sql,
 * `import_slot_take` / `import_slot_beat` / `import_slot_leave`); this is the one place that talks to them.
 *
 * `acquire` takes the slot, or a place in the line, and resolves when it is this import's turn. While it
 * waits it asks again every `POLL_MS` (which also tells the server she is still there: a place nobody asks
 * about for 75 s is given up) and says where she stands (`onStatus`: how many imports are ahead, and a rough
 * wait). Once the slot is hers it beats every `BEAT_MS` with how far the lookups are; a beat that finds the
 * slot gone (the phone slept, the connection was lost for over 75 s) calls `onLost`: the lookups pause and
 * `runWithSlot` takes a place in line again. `release` leaves the line, or gives the slot up.
 *
 * Her second device (another `holder`) is told her own import is running or waiting elsewhere (`elsewhere`)
 * and does not start another; it takes the slot when that one is done.
 *
 * The queue is not a gate the import cannot pass: when the first call fails (offline, the functions not
 * deployed) the import goes on without a slot (`'open'`), as it did before the queue.
 *
 * Framework-free: the RPC, the timers and the clock come in from outside. The planned server job (proposal
 * #329) takes the same slot with its own holder, so a device import and a job queue behind each other.
 */

/** The running import beats this often (the server gives a place up after 75 s without one). */
export const BEAT_MS = 15_000
/** A waiting import asks where it stands this often. */
export const POLL_MS = 5_000
/** A rough guess of how long one book takes the lookups, for the wait someone behind sees (it is only a guess). */
export const SECONDS_PER_BOOK = 1

/** The server's answer: where this holder stands. */
export type SlotState = {
  /** `running`: the slot is hers · `waiting`: in line · `none`: not in line (never taken, left, or the place expired). */
  state: 'running' | 'waiting' | 'none'
  /** The place belongs to this device; false when her other device holds it. */
  mine: boolean
  /** Imports before hers, the running one included. */
  ahead: number
  /** Books those imports still have to look up. */
  rowsAhead: number
}

/** What the screen shows while the import waits for its turn; null when it does not wait. */
export type QueueStatus =
  | { kind: 'waiting'; ahead: number; waitSeconds: number | null }
  | { kind: 'elsewhere' }
  | null

export type QueueRpc = (name: 'import_slot_take' | 'import_slot_beat' | 'import_slot_leave', args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>

export type Scheduler = {
  /** Calls `fn` after `ms`; the returned function cancels it. */
  after: (ms: number, fn: () => void) => () => void
}

export const realScheduler: Scheduler = {
  after(ms, fn) {
    const timer = setTimeout(fn, ms)
    return () => clearTimeout(timer)
  },
}

/** The rough wait behind `rowsAhead` books, in seconds; null when nothing is known about them. */
export function waitSecondsOf(rowsAhead: number): number | null {
  return rowsAhead > 0 ? Math.round(rowsAhead * SECONDS_PER_BOOK) : null
}

/** The answer of one of the three functions (a one-row table), or throws when it is not what they answer. */
export function readSlot(data: unknown): SlotState {
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined
  const state = row?.state
  if ((state !== 'running' && state !== 'waiting' && state !== 'none') || typeof row?.mine !== 'boolean') throw new Error('unexpected answer')
  return { state, mine: row.mine, ahead: Number(row.ahead) || 0, rowsAhead: Number(row.rows_ahead) || 0 }
}

/**
 * This tab's name in the queue, kept for the tab's life (`sessionStorage`): a reload of the page is the same
 * device and finds its own place again, another tab or device is another holder.
 */
export function holderOf(storage: Pick<Storage, 'getItem' | 'setItem'> | null, make: () => string): string {
  const key = 'libellus.import-holder'
  try {
    const kept = storage?.getItem(key)
    if (kept && /^device:[A-Za-z0-9-]{8,56}$/.test(kept)) return kept
  } catch {
    // Storage refused: a name for this page load is enough.
  }
  const holder = `device:${make()}`
  try {
    storage?.setItem(key, holder)
  } catch {
    // Not kept: a reload takes a new place.
  }
  return holder
}

/**
 * This DEVICE's id, made once and kept in `localStorage` (not per tab: it must outlive the app being closed). The server
 * stores it with the place: the same member asking from the same device again, in a new run of the app, takes her own
 * place back at once instead of waiting out its 75 s (supabase/migrations/20261031010000_import_queue_device.sql).
 */
export function deviceOf(storage: Pick<Storage, 'getItem' | 'setItem'> | null, make: () => string): string | null {
  const key = 'libellus.import-device'
  const valid = (value: string | null | undefined): value is string => Boolean(value && /^dev-[A-Za-z0-9-]{8,56}$/.test(value))
  try {
    const kept = storage?.getItem(key)
    if (valid(kept)) return kept
  } catch {
    // Storage refused: no device id, so only the same run reclaims its place.
    return null
  }
  const device = `dev-${make()}`
  try {
    storage?.setItem(key, device)
  } catch {
    return null
  }
  return device
}

export type ImportQueue = {
  /**
   * Resolves when it is this import's turn: `'slot'` (the slot is hers, beating until `release`) or `'open'` (the queue
   * could not be asked: go on without). Rejects with the signal's reason when it is aborted, after leaving the line.
   * `onLost` is called once if the slot is found gone while it is held (the phone slept past 75 s): the holder pauses
   * and `acquire`s again.
   */
  acquire: (rows: number, signal?: AbortSignal, onLost?: () => void) => Promise<'slot' | 'open'>
  /** How many books are looked up in this turn so far: the next beat tells the others behind her. */
  progress: (done: number) => void
  /** Leaves the line, or gives the slot up. Safe to call again. */
  release: () => Promise<void>
  /** The app came back to the front: asks (or beats) now instead of at the next tick. */
  nudge: () => void
  /** Whether the slot is hers right now. */
  holding: () => boolean
}

export function createImportQueue(options: {
  rpc: QueueRpc
  /** This run's name in the queue (`holderOf`). */
  holder: string
  /** This device's id (`deviceOf`), sent when a place is taken: the same device in a new run takes its place back at once. */
  device?: string | null
  scheduler?: Scheduler
  /** The status while waiting changes (also back to null when her turn comes). */
  onStatus?: (status: QueueStatus) => void
}): ImportQueue {
  const scheduler = options.scheduler ?? realScheduler
  const status = (next: QueueStatus) => options.onStatus?.(next)
  let held = false
  let done = 0
  /** Cancels the timer the loop is waiting on, and lets the wait end. */
  let wake: (() => void) | null = null
  let stopBeating: (() => void) | null = null
  let beating = false
  /** What the holder of the slot wants to hear when it is found gone. */
  let lostHandler: (() => void) | undefined

  const call = async (name: Parameters<QueueRpc>[0], args: Record<string, unknown>) => {
    const { data, error } = await options.rpc(name, { p_holder: options.holder, ...args })
    if (error) throw new Error(error.message)
    return readSlot(data)
  }

  function wait(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason)
      const cancel = scheduler.after(ms, finish)
      function finish() {
        cancel()
        signal?.removeEventListener('abort', onAbort)
        if (wake === finish) wake = null
        resolve()
      }
      function onAbort() {
        cancel()
        if (wake === finish) wake = null
        reject(signal!.reason)
      }
      wake = finish
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  function beatLoop() {
    beating = true
    const tick = async () => {
      stopBeating = null
      if (!held) return
      let lost = false
      try {
        const slot = await call('import_slot_beat', { p_done: done })
        lost = !(slot.state === 'running' && slot.mine)
      } catch {
        // A beat that did not get through is tried again at the next tick: the place lives 75 s.
      }
      if (!held) return
      if (lost) {
        held = false
        beating = false
        const tell = lostHandler
        lostHandler = undefined
        tell?.()
        return
      }
      schedule()
    }
    const schedule = () => {
      const cancel = scheduler.after(BEAT_MS, () => void tick())
      stopBeating = cancel
      wake = () => {
        cancel()
        wake = null
        void tick()
      }
    }
    schedule()
  }

  return {
    async acquire(rows, signal, onLost) {
      if (held) return 'slot'
      // A new turn: how far she got in the last one does not count for the books that are left now.
      done = 0
      let first = true
      try {
        for (;;) {
          if (signal?.aborted) throw signal.reason
          let slot: SlotState
          try {
            // Asking again from the same device keeps its place in line and tells the server it is still here.
            slot = await call('import_slot_take', { p_rows: rows, ...(options.device ? { p_device: options.device } : {}) })
          } catch {
            // The first call failing is "no queue" (offline, not deployed): the import goes on without. Later, ask again.
            if (first) {
              status(null)
              return 'open'
            }
            await wait(POLL_MS, signal)
            continue
          }
          first = false
          if (signal?.aborted) throw signal.reason
          if (slot.state === 'running' && slot.mine) {
            held = true
            lostHandler = onLost
            status(null)
            beatLoop()
            return 'slot'
          }
          status(slot.mine ? { kind: 'waiting', ahead: slot.ahead, waitSeconds: waitSecondsOf(slot.rowsAhead) } : { kind: 'elsewhere' })
          await wait(POLL_MS, signal)
        }
      } catch (error) {
        // Aborted while in line: the place goes with it.
        status(null)
        void call('import_slot_leave', {}).catch(() => {})
        throw error
      }
    },
    progress(count) {
      done = Math.max(done, count)
    },
    async release() {
      const was = held || beating
      held = false
      beating = false
      lostHandler = undefined
      stopBeating?.()
      stopBeating = null
      wake = null
      done = 0
      status(null)
      if (!was) return
      try {
        await call('import_slot_leave', {})
      } catch {
        // The place expires on its own after 75 s.
      }
    },
    nudge() {
      wake?.()
    },
    holding: () => held,
  }
}

/**
 * Runs `run` on the slot: waits for the turn, runs, and when the slot is found gone half way, stops the run (its
 * `signal` aborts), takes a place in line again and runs what is left (`rows` says how many books that is) when
 * the turn comes. `signal` is hers: aborting it (cancel, "go on with what is found") leaves the line, stops the run and
 * ends with `'cancelled'`. A run that fails for another reason throws it (the caller decides what a failed lookup is).
 * The slot is NOT released here: the caller does that once the import has left the lookups (the preview, a new file).
 */
export async function runWithSlot(
  queue: ImportQueue,
  options: {
    rows: () => number
    signal: AbortSignal
    run: (signal: AbortSignal) => Promise<void>
    /** About to wait for a turn (the first time, and again after a slot that went): nothing is being looked up. */
    onWait?: () => void
    /** The turn came: the run starts. */
    onTurn?: () => void
  },
): Promise<'finished' | 'cancelled'> {
  const { signal } = options
  for (;;) {
    if (signal.aborted) return 'cancelled'
    const paused = new AbortController()
    let lost = false
    options.onWait?.()
    try {
      await queue.acquire(options.rows(), signal, () => {
        lost = true
        paused.abort()
      })
    } catch (error) {
      if (signal.aborted) return 'cancelled'
      throw error
    }
    if (signal.aborted) return 'cancelled'
    options.onTurn?.()
    // Either her cancel or the lost slot stops the run.
    const stop = new AbortController()
    const forward = () => stop.abort()
    signal.addEventListener('abort', forward, { once: true })
    paused.signal.addEventListener('abort', forward, { once: true })
    try {
      await options.run(stop.signal)
    } catch (error) {
      if (signal.aborted) return 'cancelled'
      if (!lost) throw error
    } finally {
      signal.removeEventListener('abort', forward)
    }
    if (signal.aborted) return 'cancelled'
    // Nothing left to look up (the slot went as the last book came in): no place in line for nothing.
    if (!lost || options.rows() === 0) return 'finished'
  }
}
