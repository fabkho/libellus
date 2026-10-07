/**
 * Replaying recorded answers: a `fetch` that answers the URLs a recording
 * holds and fails any other (so a test can never reach a real source), and a
 * clock that only moves when the code sleeps.
 */
import type { Clock, FetchLike } from './http.ts'
import type { ScenarioName } from './scenarios.ts'

export type Recorded = { url: string; status: number; contentType: string | null; body: string }
export type Recording = { recordedAt: string; answers: Recorded[] }

export function recording(name: ScenarioName): Recording {
  return JSON.parse(Deno.readTextFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)))
}

/** A `fetch` that answers from recordings (and `extra`), and remembers what was asked with which headers. */
export function recordedFetch(names: ScenarioName[], extra: Record<string, () => Response | Promise<Response>> = {}) {
  const byUrl = new Map<string, Recorded>()
  for (const name of names) for (const answer of recording(name).answers) byUrl.set(answer.url, answer)
  const asked: { url: string; headers: Headers }[] = []
  const fetch: FetchLike = async (url, init) => {
    asked.push({ url, headers: new Headers(init.headers) })
    if (extra[url]) return await extra[url]!()
    const found = byUrl.get(url)
    if (!found) throw new Error(`No recording for ${url}`)
    return new Response(found.body, { status: found.status, headers: { 'content-type': found.contentType ?? 'application/json' } })
  }
  return { fetch, asked }
}

/** A clock that only moves when the code sleeps, and says how long it slept. */
export function fakeClock(start = Date.parse('2026-10-11T10:00:00Z')) {
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
  return { clock, slept, now: () => time, advance: (ms: number) => (time += ms) }
}
