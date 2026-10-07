/**
 * The polite client: identified, one request at a time per host and spaced,
 * retried on 429/5xx (Retry-After honoured), a 404 is "nothing", failures are
 * never cached.
 */
import { assertEquals, assertRejects } from '@std/assert'
import { createHttp, type FetchLike, SourceUnavailable } from './http.ts'
import { fakeClock } from './test_support.ts'

function counting(answer: (url: string, n: number) => Response) {
  const asked: { url: string; headers: Headers; at: number }[] = []
  let now = () => 0
  const fetch: FetchLike = (url, init) => {
    asked.push({ url, headers: new Headers(init.headers), at: now() })
    return Promise.resolve(answer(url, asked.filter((a) => a.url === url).length))
  }
  return { fetch, asked, setClock: (fn: () => number) => (now = fn) }
}

Deno.test('requests to one host are spaced; another host does not wait', async () => {
  const time = fakeClock()
  const source = counting(() => Response.json({ ok: true }))
  source.setClock(time.now)
  const http = createHttp({ fetch: source.fetch, userAgent: 'UA', clock: time.clock })
  await http.json('https://openlibrary.org/a.json')
  await http.json('https://openlibrary.org/b.json')
  await http.json('https://www.wikidata.org/c')
  await http.json('https://openlibrary.org/c.json')
  const at = source.asked.map((a) => [new URL(a.url).host, a.at - Date.parse('2026-10-11T10:00:00Z')])
  assertEquals(at, [['openlibrary.org', 0], ['openlibrary.org', 1000], ['www.wikidata.org', 1000], ['openlibrary.org', 2000]])
  assertEquals(source.asked[0]!.headers.get('user-agent'), 'UA')
})

Deno.test('a 503 is retried after its Retry-After, then answered', async () => {
  const time = fakeClock()
  const source = counting((_, n) =>
    n === 1 ? new Response('busy', { status: 503, headers: { 'retry-after': '3' } }) : Response.json({ n })
  )
  const http = createHttp({ fetch: source.fetch, userAgent: 'UA', clock: time.clock })
  assertEquals(await http.json('https://query.wikidata.org/sparql?q'), { n: 2 })
  assertEquals(time.slept.includes(3000), true)
})

Deno.test('a 404 is nothing; a source that keeps failing throws and is asked again next time', async () => {
  const time = fakeClock()
  let fail = true
  const source = counting((url) =>
    url.endsWith('missing.json') ? new Response('', { status: 404 }) : fail ? new Response('down', { status: 500 }) : Response.json({ up: true })
  )
  const http = createHttp({ fetch: source.fetch, userAgent: 'UA', clock: time.clock })
  assertEquals(await http.json('https://openlibrary.org/missing.json'), null)
  await assertRejects(() => http.json('https://openlibrary.org/flaky.json'), SourceUnavailable)
  assertEquals(source.asked.filter((a) => a.url.endsWith('flaky.json')).length, 3)
  fail = false
  assertEquals(await http.json('https://openlibrary.org/flaky.json'), { up: true })
})

Deno.test('an answer is kept for a while: the same URL is asked once', async () => {
  const time = fakeClock()
  const source = counting(() => Response.json({ ok: true }))
  const http = createHttp({ fetch: source.fetch, userAgent: 'UA', clock: time.clock })
  await http.json('https://openlibrary.org/authors/OL1A.json')
  await http.json('https://openlibrary.org/authors/OL1A.json')
  assertEquals(source.asked.length, 1)
})

Deno.test('a 400 is not retried', async () => {
  const time = fakeClock()
  const source = counting(() => new Response('bad query', { status: 400 }))
  const http = createHttp({ fetch: source.fetch, userAgent: 'UA', clock: time.clock })
  await assertRejects(() => http.json('https://query.wikidata.org/sparql?bad'), SourceUnavailable)
  assertEquals(source.asked.length, 1)
})
