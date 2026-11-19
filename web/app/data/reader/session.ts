/**
 * The two waits and the poll of the reader's persistence lifecycle (#131 phase
 * 2), as plain functions: the book never waits for the network longer than
 * `SERVER_WAIT_MS` for its place or its highlights, and while it stays open the
 * highlights are read again every `HIGHLIGHTS_POLL_MS` — but only while the
 * page is visible and the app is online, and again as soon as either returns.
 *
 * Framework-free: the clock, the page's visibility and the connection come in
 * as arguments (`data/reader/progress.ts` takes its timers the same way), so
 * Vitest drives all of it with fake ones and a native reader reimplements it
 * 1:1. `composables/useReaderSession.ts` wires these to the store.
 */

/** How long the book waits for the server's place, and for its highlights (the same moment, twice). */
export const SERVER_WAIT_MS = 800

/** While the reader stays open the server's highlights are read again this often. */
export const HIGHLIGHTS_POLL_MS = 60_000

/** The timers, the page's visibility and the connection, as this module needs them. */
export interface SessionTimers {
  set: (fn: () => void, ms: number) => unknown
  clear: (handle: unknown) => void
  interval: (fn: () => void, ms: number) => unknown
  clearInterval: (handle: unknown) => void
  /** `document.visibilityState === 'visible'`. */
  visible: () => boolean
}

export const browserSessionTimers: SessionTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  interval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
  visible: () => document.visibilityState === 'visible',
}

/**
 * `work`'s answer, or `fallback` once `SERVER_WAIT_MS` has passed — whichever
 * comes first, and the loser is left to settle on its own (a place that arrives
 * after the book opened still lands in the store; nothing waits for it).
 */
export function withinServerWait<T>(work: Promise<T>, fallback: T, timers: SessionTimers = browserSessionTimers): Promise<T> {
  return Promise.race([work, new Promise<T>((resolve) => timers.set(() => resolve(fallback), SERVER_WAIT_MS))])
}

/** Whether a background read may run now: the page is showing and the app has a connection. */
export type CanRead = () => boolean

/**
 * The open book's highlights, read again in the background: every
 * `HIGHLIGHTS_POLL_MS` while the page is visible and online, and at once when
 * either comes back (`visibilitychange` on `document`, `online` on `window`).
 * Returns how to stop it, which the reader does when the book closes.
 *
 * `byConnection` is the connection's own word (`isOnline`, `composables/useOnline.ts`);
 * the two targets come in so a test can drive them without a browser.
 */
export function pollHighlights(
  read: () => void,
  byConnection: CanRead,
  targets: {
    document: { visibilityState: string; addEventListener: (type: string, fn: () => void) => void; removeEventListener: (type: string, fn: () => void) => void }
    window: { addEventListener: (type: string, fn: () => void) => void; removeEventListener: (type: string, fn: () => void) => void }
  },
  timers: SessionTimers = browserSessionTimers,
): () => void {
  const tick = () => {
    if (timers.visible() && byConnection()) read()
  }
  const timer = timers.interval(tick, HIGHLIGHTS_POLL_MS)
  targets.document.addEventListener('visibilitychange', tick)
  targets.window.addEventListener('online', tick)
  return () => {
    timers.clearInterval(timer)
    targets.document.removeEventListener('visibilitychange', tick)
    targets.window.removeEventListener('online', tick)
  }
}
