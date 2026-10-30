/**
 * The thumbhash and the two colours of a cover that has none (`books.cover_thumbhash`, `cover_dominant/_secondary`),
 * from a small JPEG decoded with `jpeg-js` (pure JS) and shrunk to at most 100 × 100, then described by the app's own
 * `describeCover` (web/app/data/covers.ts: one implementation for the app, the import job and this function).
 *
 * Decoding is the one real CPU cost of a run (everything else is bytes copied): Supabase's edge runtime has 2 s of CPU
 * and no CPU clock to read, so the cost is budgeted by wall clock around each decode (`performance.now()`, what the
 * import job's README says it can measure) and by count: `ThumbBudget`.
 *
 *   - at most `GOODREADS_PER_RUN` Books of Goodreads a run (their image is the whole cover, a big JPEG; the others are
 *     small probes: Apple's `66x100bb.jpg`, Open Library's `-M`);
 *   - no decode starts once the run's decodes have taken `DECODE_BUDGET_MS`.
 *
 * What the budget refuses stays queued for the next run (the runner books it again), it is never stored without.
 */
import { describeCover, type CoverDescription, type Pixels } from '../../../web/app/data/covers.ts'
import jpeg from 'jpeg-js'
import { sniffImage } from './image.ts'

export const GOODREADS_PER_RUN = 2
export const DECODE_BUDGET_MS = 500
/** An image with more pixels than this is not decoded (memory: RGBA is 4 bytes a pixel, a 4 MP image is 16 MB). */
export const MAX_DECODE_PIXELS = 4_000_000
/** The side thumbhash takes at most. */
const THUMB_SIDE = 100

export type ThumbBudget = {
  /** Whether a Book needing its thumbhash may start now; counts a Goodreads one. Synchronous, so concurrent rows are counted exactly. */
  admit: (host: string) => boolean
  /** Whether a decode may start now (a row admitted earlier may find the budget spent since). */
  canDecode: () => boolean
  /** Runs one decode and adds the time it took. */
  measure: <T>(decode: () => T) => T
  /** The decode time so far (ms), for the run's log line. */
  spentMs: () => number
}

export function thumbBudget(options: { now?: () => number; goodreadsPerRun?: number; budgetMs?: number } = {}): ThumbBudget {
  const now = options.now ?? (() => performance.now())
  const goodreadsPerRun = options.goodreadsPerRun ?? GOODREADS_PER_RUN
  const budgetMs = options.budgetMs ?? DECODE_BUDGET_MS
  let goodreads = 0
  let spent = 0
  return {
    admit(host) {
      if (spent >= budgetMs) return false
      if (host === 'goodreads') {
        if (goodreads >= goodreadsPerRun) return false
        goodreads++
      }
      return true
    },
    canDecode: () => spent < budgetMs,
    measure(decode) {
      const start = now()
      try {
        return decode()
      } finally {
        spent += Math.max(0, now() - start)
      }
    },
    spentMs: () => spent,
  }
}

/** A box-filter shrink to at most `side` on the longer side (average of the source pixels each destination pixel covers). */
export function shrink(source: Pixels, side = THUMB_SIDE): Pixels {
  const scale = Math.min(1, side / Math.max(source.width, source.height))
  if (scale === 1) return source
  const width = Math.max(1, Math.round(source.width * scale))
  const height = Math.max(1, Math.round(source.height * scale))
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor((y * source.height) / height)
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * source.height) / height))
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor((x * source.width) / width)
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * source.width) / width))
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const at = (sy * source.width + sx) * 4
          r += source.data[at]!
          g += source.data[at + 1]!
          b += source.data[at + 2]!
          a += source.data[at + 3]!
        }
      }
      const count = (y1 - y0) * (x1 - x0)
      const to = (y * width + x) * 4
      data[to] = Math.round(r / count)
      data[to + 1] = Math.round(g / count)
      data[to + 2] = Math.round(b / count)
      data[to + 3] = Math.round(a / count)
    }
  }
  return { width, height, data }
}

/**
 * The thumbhash and colours of a JPEG's bytes, or null when they cannot be had (another format: jpeg-js reads JPEG
 * only; too many pixels; corrupt). Never throws: a cover is stored without a thumbhash rather than not at all.
 */
export function describeJpeg(bytes: Uint8Array): CoverDescription | null {
  try {
    const info = sniffImage(bytes)
    if (!info || info.kind !== 'jpeg' || info.width * info.height > MAX_DECODE_PIXELS) return null
    const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 64 })
    return describeCover(shrink({ width: decoded.width, height: decoded.height, data: decoded.data }))
  } catch {
    return null
  }
}
