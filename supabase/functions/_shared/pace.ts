/**
 * The pace of the edge functions' upstreams that count requests per address (Open Library: 3 a
 * second identified; the German National Library: 5 a second). Supabase runs more than one instance
 * of a function under load, and an in-memory queue only keeps ITS instance's distance, so N instances
 * asked N times as fast from one address. `sharedPace` takes every request's turn in Postgres
 * (`edge_pace_take`, supabase/migrations/20261030010000_edge_pace.sql): the turns are `gapMs`
 * apart across every instance and every member, a request that has to wait sleeps until its turn
 * (at most `maxWaitMs`, which the caller picks to fit under its own deadline), and one that would
 * wait longer is refused with `PaceBusy` (the function answers 503 with a `Retry-After`).
 *
 * The database being unreachable must not stop the import: then the request takes a turn in this
 * instance's own queue (`localPace`, the pace before the shared one existed) and the failure is one
 * log line. `hold` makes an upstream's `Retry-After` the pace of every instance, not just the one
 * that was told.
 *
 * `clock` comes in from outside, so the tests never wait for real.
 */

export type Clock = { now: () => number; sleep: (ms: number) => Promise<void> }
export const realClock: Clock = { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }

export type Pace = {
  /** Resolves when the request may go out; rejects with `PaceBusy` when its turn is further away than the caller will wait. */
  take: () => Promise<void>
  /** The upstream asked for a pause (`Retry-After`): no request goes out before it is over. */
  hold: (ms: number) => Promise<void>
}

/** The turn is further away than the caller will wait: answer "busy, retry after N seconds". */
export class PaceBusy extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('busy')
  }
}

/** This instance's own queue: requests wait behind each other, `gapMs` apart. */
export function localPace(options: { gapMs: number; clock?: Clock }): Pace {
  const clock = options.clock ?? realClock
  let nextAt = 0
  return {
    async take() {
      const at = Math.max(clock.now(), nextAt)
      nextAt = at + options.gapMs
      if (at > clock.now()) await clock.sleep(at - clock.now())
    },
    hold(ms) {
      nextAt = Math.max(nextAt, clock.now() + ms)
      return Promise.resolve()
    },
  }
}

/** The slice of the Supabase client the pace needs (a service-role client). */
export type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>

export function sharedPace(options: {
  rpc: Rpc
  /** What is paced: `openlibrary`, `dnb` (`edge_pace.bucket`). */
  bucket: string
  gapMs: number
  /** The longest a request waits for its turn. */
  maxWaitMs: number
  clock?: Clock
  log?: (message: string) => void
}): Pace {
  const clock = options.clock ?? realClock
  const log = options.log ?? ((message) => console.error(message))
  const local = localPace({ gapMs: options.gapMs, clock })

  return {
    async take() {
      let turn: { granted: boolean; wait_ms: number } | undefined
      try {
        const { data, error } = await options.rpc('edge_pace_take', {
          p_bucket: options.bucket,
          p_gap_ms: options.gapMs,
          p_max_wait_ms: options.maxWaitMs,
        })
        if (error) throw new Error(error.message)
        const row = (Array.isArray(data) ? data[0] : data) as { granted?: unknown; wait_ms?: unknown } | undefined
        if (typeof row?.granted !== 'boolean' || typeof row.wait_ms !== 'number') throw new Error('unexpected answer')
        turn = { granted: row.granted, wait_ms: row.wait_ms }
      } catch (error) {
        // The shared pace is out of reach: this instance keeps its own distance, so the import goes on.
        log(`pace: ${options.bucket} shared pace failed, using this instance's own: ${error instanceof Error ? error.message : error}`)
        return await local.take()
      }
      if (!turn.granted) throw new PaceBusy(Math.max(1, Math.ceil(turn.wait_ms / 1000)))
      if (turn.wait_ms > 0) await clock.sleep(turn.wait_ms)
    },
    async hold(ms) {
      await local.hold(ms)
      try {
        const { error } = await options.rpc('edge_pace_hold', { p_bucket: options.bucket, p_ms: Math.round(ms) })
        if (error) throw new Error(error.message)
      } catch (error) {
        log(`pace: ${options.bucket} hold failed: ${error instanceof Error ? error.message : error}`)
      }
    },
  }
}
