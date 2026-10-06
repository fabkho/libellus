/**
 * How the reader writes progress (#131, owner decision 2026-10-06): the
 * reader's place becomes pages of the Book's page count and is written through
 * the existing progress path, **forward only**: reading back over an earlier
 * chapter never lowers it; only the member does that, explicitly ("Set to
 * here"). Written once the member has rested on a page for `idleMs` and at most
 * once per `minIntervalMs`; closing the reader writes at once.
 *
 * In the prototype `write` only updates the page's state and shows the line;
 * in production it calls the progress repository (`update_progress`, through
 * the offline outbox, #93).
 */
export interface ProgressPolicy {
  idleMs: number
  minIntervalMs: number
}

/** The spec's numbers. */
export const SPEC_POLICY: ProgressPolicy = { idleMs: 10_000, minIntervalMs: 60_000 }
/** For trying it out on the phone without waiting a minute. */
export const QUICK_POLICY: ProgressPolicy = { idleMs: 2_500, minIntervalMs: 5_000 }

/** The page `fraction` of the way through a Book of `pageCount` pages. */
export function pageAt(fraction: number, pageCount: number): number {
  return Math.max(0, Math.min(pageCount, Math.round(fraction * pageCount)))
}

export class ProgressWriter {
  private timer: ReturnType<typeof setTimeout> | null = null
  private lastWrite = Number.NEGATIVE_INFINITY
  private pending: number | null = null

  constructor(
    private options: {
      saved: () => number
      pageCount: () => number
      policy: () => ProgressPolicy
      enabled: () => boolean
      write: (page: number, why: 'idle' | 'close' | 'member') => void
    },
  ) {}

  /** The reader is at `fraction` now: schedules a write if that is ahead of what is saved. */
  saw(fraction: number) {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const page = pageAt(fraction, this.options.pageCount())
    if (!this.options.enabled() || page <= this.options.saved()) {
      this.pending = null
      return
    }
    this.pending = page
    const { idleMs, minIntervalMs } = this.options.policy()
    const wait = Math.max(idleMs, this.lastWrite + minIntervalMs - Date.now())
    this.timer = setTimeout(() => this.commit('idle'), wait)
  }

  /** The reader closes: what is ahead is written now. */
  flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.pending !== null) this.commit('close')
  }

  /** The member moves her progress herself (also backwards). */
  setTo(page: number) {
    if (this.timer) clearTimeout(this.timer)
    this.pending = null
    this.lastWrite = Date.now()
    this.options.write(page, 'member')
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private commit(why: 'idle' | 'close') {
    const page = this.pending
    this.pending = null
    this.timer = null
    if (page === null || page <= this.options.saved() || !this.options.enabled()) return
    this.lastWrite = Date.now()
    this.options.write(page, why)
  }
}
