import { abortError } from './fetching'
import type { FunctionsClient } from './goodreads'
import { GOODREADS_FUNCTION } from './goodreads'
import type { EditionHint } from './import/goodreads'

/**
 * What Goodreads knows about one edition, by its Book Id (issue #111): the
 * import asks it for rows without an ISBN, so it can find the exact edition
 * (its ISBN), or at least the right language, page count and kind, instead of
 * the first edition a title search shows. Answered server-side by the
 * `goodreads-rating` function (`{ goodreadsId }`), which reads the edition's
 * Goodreads page, caches the answer and keeps Goodreads' rate; the browser
 * never talks to Goodreads.
 *
 * The function allows about one Goodreads request a second and refuses a
 * request that would queue too long (`busy`), so calls go one at a time here,
 * each with its own deadline once it is its turn, and a `busy` is tried again
 * after a pause. Framework-free: the Supabase client comes in from outside.
 */

/** How long one answer may take once it is asked. */
export const EDITION_TIMEOUT_MS = 15_000

/** Pauses before asking again after `busy`. */
const BUSY_RETRIES_MS = [1500, 3000]

/** The function's answer for a Book Id. */
type Answer =
  | {
      status: 'found'
      isbn13: string | null
      isbn10: string | null
      asin: string | null
      language: string | null
      pageCount: number | null
      format: string | null
      publisher: string | null
      year: number | null
    }
  | { status: 'not_found' }

export type GoodreadsEditions = {
  /** The edition's details; null when Goodreads does not know the id. Rejects when it could not be asked (or `signal` aborts). */
  edition: (goodreadsId: string, signal?: AbortSignal) => Promise<EditionHint | null>
}

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null)
const count = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null)

/** An answer as an EditionHint; null for `not_found`. Throws on anything it does not understand. */
export function hintFromAnswer(data: unknown): EditionHint | null {
  const answer = data as Answer | null
  if (answer?.status === 'not_found') return null
  if (answer?.status !== 'found') throw new Error('goodreads-edition: unexpected answer')
  return {
    isbn13: text(answer.isbn13),
    isbn10: text(answer.isbn10),
    asin: text(answer.asin),
    language: text(answer.language),
    pageCount: count(answer.pageCount),
    format: text(answer.format),
    publisher: text(answer.publisher),
    year: count(answer.year),
  }
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(abortError())
    }, { once: true })
  })
}

/** Whether the function said `busy` (503): worth asking again in a moment. */
function isBusy(error: unknown): boolean {
  const context = (error as { context?: { status?: number } } | null)?.context
  return context?.status === 503
}

export function createGoodreadsEditions(
  client: FunctionsClient,
  { online = () => true, timeoutMs = EDITION_TIMEOUT_MS }: { online?: () => boolean; timeoutMs?: number } = {},
): GoodreadsEditions {
  // One call at a time: the function keeps Goodreads' rate, so a burst only queues there.
  let queue: Promise<unknown> = Promise.resolve()

  async function ask(goodreadsId: string, signal?: AbortSignal): Promise<EditionHint | null> {
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw abortError()
      if (!online()) throw new Error('offline')
      const call = client.functions.invoke(GOODREADS_FUNCTION, { body: { goodreadsId } })
      let timer: ReturnType<typeof setTimeout> | undefined
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('goodreads-edition: no answer in time')), timeoutMs)
      })
      try {
        const { data, error } = await Promise.race([call, deadline])
        if (!error) return hintFromAnswer(data)
        if (!isBusy(error) || attempt >= BUSY_RETRIES_MS.length) throw error
      } finally {
        clearTimeout(timer)
      }
      await sleep(BUSY_RETRIES_MS[attempt]!, signal)
    }
  }

  return {
    edition(goodreadsId, signal) {
      const turn = queue.then(() => ask(goodreadsId, signal))
      queue = turn.catch(() => undefined)
      return turn
    },
  }
}
