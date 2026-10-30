/**
 * One run of the cover store (docs/plans/owned-covers.md, §3): lease up to 8 due Books (`cover_store_claim`: 170 s,
 * `skip locked`), work 4 at a time, and settle every one of them (stored, or booked again / ended with a reason).
 *
 * For each Book:
 *   1. plan the variants (plan.ts); a host that is not stored, or an address of an unknown shape, is `unsupported_url`;
 *   2. fetch the LARGEST variant (fetch.ts) and compute the key from its bytes (key.ts);
 *   3. reserve the key (`cover_store_reserve`): refused while GC is deleting it (`deleting`: booked again in 10 minutes).
 *      Nothing is uploaded before the reservation, and there is no `HEAD`: a PUT of the same bytes is harmless;
 *   4. fetch the other variants, PUT every distinct real width (r2.ts; equal widths are stored once). Two Books with the
 *      same key in one run share one upload (a lent cover);
 *   5. the thumbhash and colours, only when the Book has none (thumb.ts: the Goodreads cap and the decode budget);
 *   6. `cover_store_done`: a compare-and-swap on the Book's artwork. A miss (the cover changed meanwhile, or GC took the
 *      key) books the row again as `deleting`: if the cover changed the trigger already deleted the row and nothing
 *      happens, the next reconcile finds the Book.
 *
 * A Book the thumbhash budget refuses is left for the next run (`cover_store_release`: due at once, no attempt counted; the run's kick chains it). Failures are logged by
 * Book id and kind only: never a title, an ISBN or a cover address. Framework-free: the store, the fetcher and R2 come in.
 */
import { byCoverId, coverIdFromLocation, type CoverPlan, type HostName, planCover } from './plan.ts'
import type { CoverFetcher, FailKind, Fetched } from './fetch.ts'
import { coverKey } from './key.ts'
import { R2Error, type R2 } from './r2.ts'
import type { Claimed, FailReason, Store } from './store.ts'
import { describeJpeg, thumbBudget, type ThumbBudget } from './thumb.ts'

export const RUN_LIMIT = 8
export const CONCURRENCY = 4
/** No fetch goes on past this: the function lives 150 s, a lease 170 s. What is not done is booked again. */
export const RUN_DEADLINE_MS = 125_000
/** The widest image stored (`books.cover_widths` allows 16..2000). */
export const MAX_WIDTH = 2000

export type RunResult = {
  state: 'idle' | 'ran'
  claimed: number
  stored: number
  failed: number
  throttled: number
  /** Books left for the next run (the Goodreads cap, the decode budget): queued again at once, no attempt counted. */
  deferred: number
  gone: number
  unsupported: number
  /** Books whose copy was stored but whose `cover_store_done` found the cover changed or the key being deleted. */
  stale: number
  ms: number
  /** What the database answered to "kick the next run" (`sent`, `idle`, `busy`, `off`, …), when a run was kicked. */
  kick?: string
}

export type RunnerDeps = {
  store: Store
  fetcher: CoverFetcher
  r2: R2
  /** `COVER_KEY_SECRET`. */
  keySecret: string
  hosts?: ReadonlySet<HostName> | readonly HostName[]
  /** Unique per invocation: a lease holds against the same id too. */
  runner?: string
  concurrency?: number
  /** Overrides `RUN_DEADLINE_MS` (tests). */
  deadlineMs?: number
  limit?: number
  budget?: ThumbBudget
  now?: () => number
  log?: (message: string) => void
}

class Failure extends Error {
  constructor(readonly reason: FailReason) {
    super(reason)
  }
}

type Uploaded = {
  widths: number[]
  bytes: number
  contentType: string
  /** The image the thumbhash is made from (fetched only when a Book needs it, once). */
  thumb: () => Promise<Fetched>
}

const failKind = (kind: FailKind): FailReason => kind

export async function runCoverStore(deps: RunnerDeps): Promise<RunResult> {
  const now = deps.now ?? (() => Date.now())
  const started = now()
  const log = deps.log ?? ((message: string) => console.error(message))
  const runner = deps.runner ?? `fn:${crypto.randomUUID()}`
  const budget = deps.budget ?? thumbBudget()
  const abort = new AbortController()
  const deadline = setTimeout(() => abort.abort(), deps.deadlineMs ?? RUN_DEADLINE_MS)
  const result: RunResult = { state: 'idle', claimed: 0, stored: 0, failed: 0, throttled: 0, deferred: 0, gone: 0, unsupported: 0, stale: 0, ms: 0 }

  try {
    const rows = await deps.store.claim(runner, deps.limit ?? RUN_LIMIT)
    result.claimed = rows.length
    if (rows.length === 0) return result
    result.state = 'ran'

    // One upload per key in a run: the second Book with the same bytes waits for the first's PUTs.
    const uploads = new Map<string, Promise<Uploaded>>()

    const bookAgain = async (row: Claimed, reason: FailReason, count = true): Promise<void> => {
      try {
        await deps.store.failed(row.book_id, runner, reason)
      } catch (error) {
        // The lease runs out (170 s) and counts as one attempt.
        log(`cover-store: ${row.book_id} could not be booked (${reason}): ${error instanceof Error ? error.message : error}`)
      }
      if (!count) {
        // counted by the caller
      } else if (reason === 'throttled' || reason === 'deleting') result.throttled++
      else if (reason === 'gone') result.gone++
      else if (reason === 'unsupported_url') result.unsupported++
      else result.failed++
      log(`cover-store: ${row.book_id} ${reason}`)
    }

    const leaveForNextRun = async (row: Claimed): Promise<void> => {
      try {
        await deps.store.release(row.book_id, runner)
      } catch (error) {
        log(`cover-store: ${row.book_id} could not be left for the next run: ${error instanceof Error ? error.message : error}`)
      }
      result.deferred++
      log(`cover-store: ${row.book_id} deferred`)
    }

    const fetchVariant = async (url: string): Promise<Fetched> => {
      return await deps.fetcher.get(url, { signal: abort.signal })
    }

    // The other variants and the PUTs for one key. Rejects with Failure.
    const upload = async (key: string, plan: CoverPlan, largest: Extract<Fetched, { ok: true }>): Promise<Uploaded> => {
      let work = plan
      // A keyed Open Library address that redirected to the cover's id: the other size goes by id (not limited).
      const named = work.openLibrary && work.keyed && largest.redirects[0] ? coverIdFromLocation(largest.redirects[0]) : null
      if (named) work = byCoverId(work, named)

      const fetched = new Map<string, Fetched>([[plan.largest, largest]])
      const variants = [largest]
      for (const url of work.rest) {
        const got = await fetchVariant(url)
        fetched.set(url, got)
        if (got.ok) variants.push(got)
        // A smaller size the host does not have (or has as a placeholder) is skipped, the larger ones are stored.
        else if (got.kind !== 'gone') throw new Failure(failKind(got.kind))
      }

      // One object per real width, the largest variant's bytes winning an equal width.
      const byWidth = new Map<number, Extract<Fetched, { ok: true }>>()
      for (const variant of variants) if (!byWidth.has(variant.info.width)) byWidth.set(variant.info.width, variant)
      // The column is `smallint` 16..2000: a wider image is not a cover we store.
      for (const width of byWidth.keys()) if (width > MAX_WIDTH) throw new Failure('too_large')

      const entries = [...byWidth.entries()].sort((a, b) => a[0] - b[0])
      try {
        await Promise.all(entries.map(([width, variant]) => deps.r2.put(key, width, variant.bytes, variant.info.mime, { signal: abort.signal })))
      } catch (error) {
        if (error instanceof R2Error) throw new Failure('r2_error')
        throw error
      }

      let thumb: Promise<Fetched> | null = null
      return {
        widths: entries.map(([width]) => width),
        bytes: entries.reduce((sum, [, variant]) => sum + variant.bytes.length, 0),
        contentType: largest.info.mime,
        thumb: () => {
          thumb ??= Promise.resolve(fetched.get(work.thumb) ?? fetchVariant(work.thumb))
          return thumb
        },
      }
    }

    const one = async (row: Claimed): Promise<void> => {
      const plan = planCover(row.source_url, deps.hosts)
      if (!plan) return await bookAgain(row, 'unsupported_url')

      // The thumbhash budget, checked at once (synchronously, so rows starting together are counted exactly).
      const wantsThumb = row.needs_thumbhash
      if (wantsThumb && !budget.admit(plan.host)) return await leaveForNextRun(row)

      const largest = await fetchVariant(plan.largest)
      if (!largest.ok) return await bookAgain(row, failKind(largest.kind))

      // `books.cover_widths` is 16..2000: a wider image is not stored (and its key is not reserved for nothing).
      if (largest.info.width > MAX_WIDTH) return await bookAgain(row, 'too_large')

      const key = await coverKey(deps.keySecret, largest.bytes)
      if (!(await deps.store.reserve(key))) return await bookAgain(row, 'deleting')

      let uploaded: Promise<Uploaded>
      const shared = uploads.get(key)
      if (shared) uploaded = shared
      else {
        uploaded = upload(key, plan, largest)
        uploads.set(key, uploaded)
        // A failed upload is not shared with the next run's Books: it is booked again by every Book that waited on it.
      }
      const stored = await uploaded

      let thumbhash: string | null = null
      let colours: { dominant: string; secondary: string } | null = null
      if (wantsThumb) {
        const probe = await stored.thumb()
        // A probe that could not be fetched now is tried again with the Book; one that is not there, or not a JPEG, is stored without.
        if (!probe.ok && probe.kind !== 'gone' && probe.kind !== 'not_image') return await bookAgain(row, failKind(probe.kind))
        // Admitted at the start, but the budget may have been spent since (by a Book that decoded meanwhile): then the
        // copy stays and the Book is booked again at once (the next run stores the same bytes and decodes first). Checked in
        // the same turn as the decode, so Books that arrive together are counted exactly.
        if (probe.ok && !budget.canDecode()) return await leaveForNextRun(row)
        const described = probe.ok ? budget.measure(() => describeJpeg(probe.bytes)) : null
        if (described) {
          thumbhash = described.thumbhash
          colours = { dominant: described.colors.dominant, secondary: described.colors.secondary }
        } else {
          log(`cover-store: ${row.book_id} no thumbhash`)
        }
      }

      const done = await deps.store.done({
        book: row.book_id,
        sourceUrl: row.source_url,
        key,
        widths: stored.widths,
        bytes: stored.bytes,
        contentType: stored.contentType,
        thumbhash,
        dominant: colours?.dominant,
        secondary: colours?.secondary,
      })
      if (done) result.stored++
      else {
        result.stale++
        await bookAgain(row, 'deleting', false)
      }
    }

    const queue = [...rows]
    const lanes = Array.from({ length: Math.min(deps.concurrency ?? CONCURRENCY, queue.length) }, async () => {
      for (let row = queue.shift(); row; row = queue.shift()) {
        // Past the deadline nothing new is started: the Book is left for the next run (no attempt counted, no request).
        if (abort.signal.aborted) {
          await leaveForNextRun(row)
          continue
        }
        try {
          await one(row)
        } catch (error) {
          if (error instanceof Failure) await bookAgain(row, error.reason)
          else {
            log(`cover-store: ${row.book_id} unexpected: ${error instanceof Error ? error.name : 'error'}`)
            await bookAgain(row, abort.signal.aborted ? 'timeout' : 'host_error')
          }
        }
      }
    })
    await Promise.all(lanes)

    try {
      result.kick = await deps.store.kick()
    } catch (error) {
      log(`cover-store: kick failed: ${error instanceof Error ? error.message : error}`)
    }
    return result
  } finally {
    clearTimeout(deadline)
    result.ms = Math.round(now() - started)
    if (result.claimed > 0) {
      log(`cover-store: run stored=${result.stored} failed=${result.failed} throttled=${result.throttled} deferred=${result.deferred} gone=${result.gone} unsupported=${result.unsupported} stale=${result.stale} ms=${result.ms} decode_ms=${Math.round(budget.spentMs())}`)
    }
  }
}
