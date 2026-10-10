/**
 * How long what Home and the Library hold stands for a visit (ms): the three Status lists, the
 * year's count and Home's series are not asked for again within it when a tab is shown
 * (stores/library.ts, stores/series.ts, `load({ ifStale })`). Short, because another device can
 * change the Library and nothing tells this one; long enough that a run of tab switches is one read.
 *
 * Off (0) in the Playwright flows' build (`__LIBELLUS_E2E__`): their flows play the other device
 * (a write straight to the database a second before the tab is shown) and expect it on screen.
 * The window itself is covered by tests/library-fresh.test.ts and measured by the perf harness.
 */
export const FRESH_MS = typeof __LIBELLUS_E2E__ !== 'undefined' && __LIBELLUS_E2E__ ? 0 : 60_000

/** A read's ticket: when it was asked for, and which generation of the data it was asked in. */
export type FreshTicket = { at: number; epoch: number }

/**
 * When what a store holds from a read still stands for a visit (`FRESH_MS`), the one rule Home's
 * lists, the year's count and series (stores/library.ts, stores/series.ts) apply by hand and the
 * Profile's record, the genres and the Collections' list apply through this.
 *
 *     const freshness = createFreshness()
 *     if (ifStale && freshness.isFresh()) return          // a visit: nothing to ask
 *     const ticket = freshness.ask()                      // before the request goes out
 *     …                                                   // the answer lands
 *     freshness.landed(ticket)                            // only now does the answer count as seen
 *
 * `invalidate()` is a change the held data does not show yet (a write on this device, the outbox
 * drained): it forgets the stamp at once, and a read that was asked before it and lands after it
 * does not set the stamp again, so it can never make the stale data fresh. Nothing is fresh until
 * a read has landed: a copy the device kept is shown, not trusted.
 */
export function createFreshness({ now = () => performance.now(), ms = FRESH_MS }: { now?: () => number; ms?: number } = {}) {
  let stamped = -Infinity
  let epoch = 0
  return {
    /** Whether a read landed within the window and no change was made since it was asked for. */
    isFresh: () => now() - stamped < ms,
    /** Call as a read is asked for; give the ticket to `landed`. */
    ask: (): FreshTicket => ({ at: now(), epoch }),
    /** Whether a change was made after this ticket's read was asked for: what it brings may not show it. */
    outdated: (ticket: FreshTicket) => ticket.epoch !== epoch,
    /** The read of this ticket landed and was applied. */
    landed(ticket: FreshTicket) {
      if (ticket.epoch === epoch) stamped = ticket.at
    },
    /** What is held changed under it (or its member did): the next visit asks again. */
    invalidate() {
      epoch++
      stamped = -Infinity
    },
  }
}
