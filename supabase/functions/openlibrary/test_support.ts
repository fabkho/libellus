/**
 * The tests' Open Library: answers from the recordings in fixtures/ (public catalogue data,
 * recorded once with a polite User-Agent), by URL. A URL nobody recorded fails the test, so no
 * test ever reaches the real Open Library.
 */
import type { Clock, FetchLike } from './client.ts'

export const fixture = (name: string) => Deno.readTextFileSync(new URL(`./fixtures/${name}.json`, import.meta.url))

const RECORDED: Record<string, string> = {
  'https://openlibrary.org/search.json?q=moby+dick+melville&fields=key,title,author_name,cover_i&limit=1': 'search-moby',
  'https://openlibrary.org/api/books?bibkeys=ISBN%3A9780142437247&jscmd=data&format=json': 'books-moby',
}

/** A URL as the key of a recording: `?fields=key,title` and `?fields=key%2Ctitle` are the same ask. */
const key = (url: string) => {
  const parsed = new URL(url)
  parsed.searchParams.sort()
  return parsed.toString()
}

/** The recordings by their normalised URL. */
const RECORDINGS = new Map(Object.entries(RECORDED).map(([url, name]) => [key(url), name]))

/** A `fetch` that answers the recorded URLs and remembers what was asked. */
export function recordedFetch(extra: Record<string, () => Response | Promise<Response>> = {}) {
  const asked: { url: string; headers: Headers }[] = []
  const stubs = new Map(Object.entries(extra).map(([url, answer]) => [key(url), answer]))
  const fetch: FetchLike = async (url, init) => {
    asked.push({ url, headers: new Headers(init.headers) })
    const answer = stubs.get(key(url))
    if (answer) return await answer()
    const name = RECORDINGS.get(key(url))
    if (!name) throw new Error(`No recording for ${url}`)
    return new Response(fixture(name), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } })
  }
  return { fetch, asked }
}

/** A clock that only moves when the code sleeps, and says how long it slept. */
export function fakeClock(start = Date.parse('2026-10-13T10:00:00Z')) {
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
