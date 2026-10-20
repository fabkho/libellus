import { isLive, jobOf, type ImportJob, type JobResult } from './importJob'
import type { JobFeedPort, OpenFeed } from './importJobFeed'

/**
 * Follows the member's import job (proposal #329, part 5): what the pill and the import page show. Pure logic around two
 * doors, so Vitest drives it with a stub channel and no network (tests/import-job-watch.test.ts):
 *
 *   - `read`: her newest job (one read; `ahead` says how many imports are in line before a queued one);
 *   - `port`: the live feed (data/importJobFeed.ts), opened ONLY while a job of hers is live and closed the moment it ends.
 *
 * `check()` is the first look: one read, no socket; a live job opens the feed. The feed says it is subscribed on the first
 * connect, after every reconnect and when the server has her Postgres changes subscribed (a moment after the join), and each time
 * the watch reads once (a change in between is not pushed again). The server updates the job once per saved row, so the changes that
 * come in are coalesced, at most one a `throttleMs`, the last one winning; a job that ends is told at once.
 *
 * Nothing polls. The one timer that reads is the silence net, a fallback for a deaf socket: while a job is live and the feed has said
 * nothing for `silenceMs` (30 s), one read, and every change heard pushes it back. A running job changes once per saved row, so a
 * feed that works never stays that silent. One that is open may still be deaf: on a project whose Realtime was idle, the change
 * stream waits for its replication slot, and every open transaction holds that up (production, 20 October 2026: the pg_net worker
 * that chains the import's chunks held it for most of a minute, and the page stayed on "Starting soon"); or the phone put the socket
 * to sleep without closing it.
 */

export type JobWatchDeps = {
  read: () => Promise<JobResult<ImportJob | null>>
  ahead: (jobId: string) => Promise<JobResult<number>>
  port: JobFeedPort
  /** The signed-in member (the feed's filter). */
  member: () => string | null
  /** Whether a finished job is worth showing (not seen yet, ended lately). A live one always is. */
  worth: (job: ImportJob) => boolean
  /** The job on show changed (null: none), with how many imports are in line before it while it is queued. */
  onJob: (job: ImportJob | null, ahead: number) => void
  /** Coalescing of the changes the server pushes (ms); 0 passes each one on. */
  throttleMs?: number
  /** The silence net (ms): no word from the feed this long while a job is live, one read. */
  silenceMs?: number
  after?: (ms: number, fn: () => void) => () => void
  now?: () => number
}

export type JobWatch = {
  /** The first look (app start, member change): one read; follows the job when it is live. */
  check: () => Promise<void>
  /** A job was just started or retried here: show it and follow it. */
  adopt: (jobId: string) => Promise<void>
  /** The app came back to the front while a job is live: one read, in case the socket slept. */
  nudge: () => void
  /** Stops everything (another member, sign-out): the socket is closed and nothing more is told. */
  stop: () => void
  /** Whether the feed is open. */
  readonly following: boolean
}

const THROTTLE_MS = 400
const SILENCE_MS = 30_000

export function createJobWatch(deps: JobWatchDeps): JobWatch {
  const throttleMs = deps.throttleMs ?? THROTTLE_MS
  const silenceMs = deps.silenceMs ?? SILENCE_MS
  const now = deps.now ?? (() => Date.now())
  const after =
    deps.after ??
    ((ms: number, fn: () => void) => {
      const timer = setTimeout(fn, ms)
      return () => clearTimeout(timer)
    })

  let current: ImportJob | null = null
  let ahead = 0
  let feed: OpenFeed | null = null
  let opening: Promise<void> | null = null
  /** Bumped by `stop`: a read or an open that comes back after it is for nobody. */
  let epoch = 0
  let pending: ImportJob | null = null
  let cancelFlush: (() => void) | null = null
  let lastFlush = -Infinity
  let cancelSilence: (() => void) | null = null
  /** Counts the changes the feed delivered: a read that a change overtook is older than what is on show. */
  let changes = 0

  function drop() {
    cancelFlush?.()
    cancelFlush = null
    pending = null
  }

  function quiet() {
    cancelSilence?.()
    cancelSilence = null
  }

  /** The feed said something (a change, or a read was just made): the silence net starts over, while the job is live and followed. */
  function heard() {
    quiet()
    if (!feed || !isLive(current)) return
    const mine = epoch
    cancelSilence = after(silenceMs, () => {
      cancelSilence = null
      if (mine === epoch) void sync()
    })
  }

  function closeFeed() {
    quiet()
    drop()
    const closing = feed
    feed = null
    closing?.close()
  }

  /** The job as the newest state of what is on show; the feed is closed once it is over. */
  function show(job: ImportJob) {
    current = job
    if (job.state !== 'queued') ahead = 0
    if (!isLive(job)) closeFeed()
    deps.onJob(job, ahead)
  }

  /** How many imports are in line before a queued job (one read; the place does not change under a running job). */
  async function place(job: ImportJob, mine: number): Promise<boolean> {
    if (job.state !== 'queued') return true
    const answer = await deps.ahead(job.id)
    if (mine !== epoch) return false
    if (answer.data !== null) ahead = answer.data
    return true
  }

  /** The one read on every (re)connect (and the silence net's). */
  async function sync(): Promise<void> {
    const mine = epoch
    const before = changes
    try {
      const read = await deps.read()
      if (mine !== epoch || !read.data) return
      const job = read.data
      // The job being followed is shown whatever became of it (cancelled included); another is shown when it is worth it.
      if (job.id !== current?.id && !deps.worth(job)) return
      if (!(await place(job, mine))) return
      // A change came in while the read was on its way: the feed works and what it said is newer (the read may have seen the job
      // queued, the change says it failed, and the feed is closed by then: the stale read would stay on show for good).
      if (changes !== before) return
      show(job)
    } finally {
      if (mine === epoch) heard()
    }
  }

  function flush() {
    cancelFlush = null
    const job = pending
    pending = null
    if (!job) return
    lastFlush = now()
    show(job)
  }

  function onChange(row: unknown) {
    const job = jobOf(row)
    if (!job) return
    changes++
    heard()
    // An old job's last word never replaces a live one on show.
    if (current && current.id !== job.id && isLive(current) && !isLive(job)) return
    // What the member must not miss (a state change, the end, a new job) is told at once; a count that moved is coalesced.
    if (!current || current.id !== job.id || job.state !== current.state || !isLive(job)) {
      drop()
      lastFlush = now()
      show(job)
      return
    }
    pending = job
    if (!cancelFlush) cancelFlush = after(Math.max(0, throttleMs - (now() - lastFlush)), flush)
  }

  function open(): Promise<void> {
    if (feed) return Promise.resolve()
    if (opening) return opening
    const member = deps.member()
    if (!member) return Promise.resolve()
    const mine = epoch
    const mineOpening: Promise<void> = deps.port
      .open(member, {
        // A feed of a stopped watch (another member) tells nobody anything, whatever it still delivers.
        onChange: (changed) => mine === epoch && onChange(changed),
        onSubscribed: () => mine === epoch && void sync(),
        // Nothing to do: the client rejoins by itself and says it is subscribed again.
        onDown: () => {},
      })
      .then((opened) => {
        if (mine !== epoch || !isLive(current)) opened.close()
        else {
          feed = opened
          heard()
        }
      })
      .catch(() => {
        // The socket could not be loaded or opened: the job runs on regardless, and the next start of the app reads it.
      })
      .finally(() => {
        if (opening === mineOpening) opening = null
      })
    opening = mineOpening
    return mineOpening
  }

  async function take(job: ImportJob | null, mine: number, always: boolean) {
    if (!job || (!always && !deps.worth(job))) {
      if (!isLive(current)) {
        current = null
        deps.onJob(null, 0)
      }
      return
    }
    if (!(await place(job, mine))) return
    show(job)
    if (isLive(job)) await open()
  }

  return {
    async check() {
      const mine = epoch
      const read = await deps.read()
      if (mine !== epoch) return
      await take(read.data, mine, false)
    },
    async adopt(jobId) {
      const mine = epoch
      const read = await deps.read()
      if (mine !== epoch) return
      if (read.data?.id === jobId) await take(read.data, mine, true)
    },
    nudge() {
      if (isLive(current)) void sync()
    },
    stop() {
      epoch++
      closeFeed()
      opening = null
      current = null
      ahead = 0
    },
    get following() {
      return feed !== null
    },
  }
}
