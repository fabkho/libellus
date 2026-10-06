/**
 * How the reader writes progress (#131; owner decisions 2026-10-06): the place
 * in the book (a fraction of its body, back matter such as a licence left out)
 * becomes the entry's progress — pages of the Book's page count, or a percent
 * where there is none — written through the existing progress path
 * (`updateProgress`, the outbox while offline).
 *
 * - **Forward only:** reading back over an earlier chapter never lowers it;
 *   only the member does that, explicitly (Update progress on the book page).
 * - Written once the member has rested on a place for `idleMs`, at most once per
 *   `minIntervalMs`, and at once when the reader closes.
 * - Not for opening the book, nor for a look-up (Contents, Search, the slider):
 *   the writer only listens once the member reads on (`reading()`).
 *
 * Framework-free: timers come in, so Vitest drives it with fake ones.
 */
import type { ProgressValue } from '../progress'

export interface ProgressPolicy {
  idleMs: number
  minIntervalMs: number
}

export const PROGRESS_POLICY: ProgressPolicy = { idleMs: 10_000, minIntervalMs: 60_000 }

/** The progress a fraction of the book is: a page of `pageCount` (at least 1 once begun), or a whole percent. */
export function progressAt(fraction: number, pageCount: number | null): ProgressValue {
  const f = Math.min(1, Math.max(0, fraction))
  if (pageCount && pageCount > 0) return { page: Math.min(pageCount, Math.max(f > 0 ? 1 : 0, Math.round(f * pageCount))) }
  return { percent: Math.round(f * 100) }
}

/** Whether `next` is further than `current` (none counts as nothing read). */
export function isAhead(next: ProgressValue, current: ProgressValue | null, pageCount: number | null): boolean {
  if (!current) return 'page' in next ? next.page > 0 : next.percent > 0
  if ('page' in next && 'page' in current) return next.page > current.page
  if ('percent' in next && 'percent' in current) return next.percent > current.percent
  // Mixed units (a page count added or dropped since): compare as fractions.
  const asFraction = (v: ProgressValue) => ('page' in v ? (pageCount ? v.page / pageCount : 0) : v.percent / 100)
  return asFraction(next) > asFraction(current)
}

export type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void; now: () => number }

export const browserTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
}

export class ProgressWriter {
  private timer: unknown = null
  private lastWrite = Number.NEGATIVE_INFINITY
  private pending: ProgressValue | null = null
  private listening = false

  constructor(
    private options: {
      current: () => ProgressValue | null
      pageCount: () => number | null
      /** Only a read that is under way gets progress (Currently reading). */
      enabled: () => boolean
      write: (value: ProgressValue) => void
      policy?: ProgressPolicy
      timers?: Timers
    },
  ) {}

  private get timers() {
    return this.options.timers ?? browserTimers
  }
  private get policy() {
    return this.options.policy ?? PROGRESS_POLICY
  }

  /** The member reads on (a page turned, a scroll): from now on places count. */
  reading() {
    this.listening = true
  }
  /** A look-up (Contents, Search, the slider): places stop counting until she reads on again. */
  lookingUp() {
    this.listening = false
    this.cancel()
  }

  /** The reader is at `fraction` now: a write is scheduled if that is ahead of the progress. */
  saw(fraction: number) {
    this.cancel()
    if (!this.listening || !this.options.enabled()) return
    const next = progressAt(fraction, this.options.pageCount())
    if (!isAhead(next, this.options.current(), this.options.pageCount())) return
    this.pending = next
    const { idleMs, minIntervalMs } = this.policy
    const wait = Math.max(idleMs, this.lastWrite + minIntervalMs - this.timers.now())
    this.timer = this.timers.set(() => this.commit(), wait)
  }

  /** The reader closes: what is ahead is written now. */
  flush() {
    if (this.timer !== null) this.timers.clear(this.timer)
    this.timer = null
    if (this.pending) this.commit()
  }

  dispose() {
    this.cancel()
  }

  private cancel() {
    if (this.timer !== null) this.timers.clear(this.timer)
    this.timer = null
    this.pending = null
  }

  private commit() {
    const value = this.pending
    this.pending = null
    this.timer = null
    if (!value || !this.options.enabled() || !isAhead(value, this.options.current(), this.options.pageCount())) return
    this.lastWrite = this.timers.now()
    this.options.write(value)
  }
}
