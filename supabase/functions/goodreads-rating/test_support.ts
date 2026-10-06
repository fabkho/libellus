/**
 * The tests' Goodreads: answers from the recordings in fixtures/ (made once by
 * record_fixtures.ts), by URL. A URL nobody recorded fails the test, so no
 * test ever reaches the real Goodreads.
 */
import type { Clock, FetchLike } from './client.ts'

type Recording = { url: string; status: number; contentType: string | null; body: string }

const NAMES = [
  'review-counts-small-gods',
  'review-counts-unrated',
  'review-counts-unknown',
  'auto-complete-we-are-legion',
  'auto-complete-sandman',
  'auto-complete-nothing',
  'book-page-small-gods',
  // Hand-written, not recorded: a page that renders other Books than the one asked for.
  'book-page-no-book',
] as const
export type FixtureName = (typeof NAMES)[number]

export function recording(name: FixtureName): Recording {
  return JSON.parse(Deno.readTextFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)))
}

/** A `fetch` that answers the recorded URLs and remembers what was asked. */
export function recordedFetch(extra: Record<string, () => Response | Promise<Response>> = {}) {
  const byUrl = new Map(NAMES.map((name) => [recording(name).url, recording(name)]))
  const asked: { url: string; headers: Headers }[] = []
  const fetch: FetchLike = async (url, init) => {
    asked.push({ url, headers: new Headers(init.headers) })
    if (extra[url]) return await extra[url]!()
    const found = byUrl.get(url)
    if (!found) throw new Error(`No recording for ${url}`)
    return new Response(found.body, {
      status: found.status,
      headers: { 'content-type': found.contentType ?? 'application/json' },
    })
  }
  return { fetch, asked }
}

/** A clock that only moves when the code sleeps, and says how long it slept. */
export function fakeClock(start = Date.parse('2026-10-04T10:00:00Z')) {
  let time = start
  const slept: number[] = []
  const clock: Clock = {
    now: () => time,
    sleep: (ms) => {
      slept.push(ms)
      time += ms
      return Promise.resolve()
    },
  }
  return { clock, slept, advance: (ms: number) => (time += ms), now: () => time }
}
