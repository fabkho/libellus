/**
 * The tests' German National Library: answers from the recordings in fixtures/ (SRU `oai_dc`
 * answers, CC0 data), by query. A query nobody recorded fails the test, so no test ever reaches
 * the real DNB.
 */
import { isbnQuery, sruUrl, titleQuery } from '../../../web/app/data/dnbRecord.ts'
import type { Clock, FetchLike } from './client.ts'

export const fixture = (name: string) => Deno.readTextFileSync(new URL(`./fixtures/${name}.xml`, import.meta.url))

const RECORDED: Record<string, string> = {
  [sruUrl(isbnQuery('9783499267017'), 5)]: 'isbn-bergman',
  [sruUrl(isbnQuery('9780000000002'), 5)]: 'isbn-none',
  [sruUrl(titleQuery('Der Schwarm', 'Frank Schätzing')!, 30)]: 'title-schwarm',
  [sruUrl(titleQuery('Tödliche Spiele', 'Suzanne Collins')!, 30)]: 'title-panem',
}

/** A `fetch` that answers the recorded queries and remembers what was asked. */
export function recordedFetch(extra: Record<string, () => Response | Promise<Response>> = {}) {
  const asked: { url: string; headers: Headers }[] = []
  const fetch: FetchLike = async (url, init) => {
    asked.push({ url, headers: new Headers(init.headers) })
    if (extra[url]) return await extra[url]!()
    const name = RECORDED[url]
    if (!name) throw new Error(`No recording for ${url}`)
    return new Response(fixture(name), { status: 200, headers: { 'content-type': 'text/xml' } })
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
  return { clock, slept, advance: (ms: number) => (time += ms), now: () => time }
}
