/**
 * Records the source answers the tests replay (fixtures/<scenario>.json): runs
 * each scenario of scenarios.ts against the live sources, exactly as the tests
 * will (every author and series fetched as if met the first time), and keeps
 * every answer. Run by hand, rarely; the tests never call a source.
 *
 *   cd supabase/functions/enrich && deno run --allow-net --allow-read --allow-write=fixtures record_fixtures.ts
 *
 * Identified and spaced like the function (http.ts).
 */
import { appleGenres, enrichBook } from './enrich.ts'
import { createHttp, type FetchLike, userAgent } from './http.ts'
import { AUTHORS_FRESH, LANGUAGES, type ScenarioName, SCENARIOS } from './scenarios.ts'
import { createSources } from './sources.ts'
import type { Recorded } from './test_support.ts'

const only = Deno.args as ScenarioName[]
for (const [name, book] of Object.entries(SCENARIOS) as [ScenarioName, (typeof SCENARIOS)[ScenarioName]][]) {
  if (only.length && !only.includes(name)) continue
  const answers: Recorded[] = []
  const recordingFetch: FetchLike = async (url, init) => {
    const response = await fetch(url, init)
    const body = await response.text()
    // Kept minified: the recordings are what they said, without the pretty-printing.
    let kept = body
    try {
      kept = JSON.stringify(JSON.parse(body))
    } catch { /* not JSON: kept as it is */ }
    answers.push({ url, status: response.status, contentType: response.headers.get('content-type'), body: kept })
    return new Response(body, { status: response.status, headers: response.headers })
  }
  const sources = createSources(createHttp({ fetch: recordingFetch, userAgent: userAgent(null, null) }), LANGUAGES)
  const apple = await appleGenres([book], sources)
  const authorFresh = () => Promise.resolve(AUTHORS_FRESH.includes(name))
  await enrichBook(book, { sources, authorFresh, seriesFresh: () => Promise.resolve(false) }, apple.get(book.id) ?? [])
  const file = new URL(`./fixtures/${name}.json`, import.meta.url)
  await Deno.writeTextFile(file, `${JSON.stringify({ recordedAt: new Date().toISOString(), answers }, null, 1)}\n`)
  console.log(name, answers.length, 'answers', Math.round(JSON.stringify(answers).length / 1024), 'KB')
}
