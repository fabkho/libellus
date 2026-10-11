import { assertEquals, assertRejects } from '@std/assert'
import { allowed, HostNotAllowed, safeFetch } from './safe_fetch.ts'
import { answer, routedFetch } from './test_support.ts'

Deno.test('only https on the two source hosts, without credentials or a port', () => {
  assertEquals(allowed('https://itunes.apple.com/lookup?id=1'), true)
  assertEquals(allowed('https://openlibrary.org/books/OL1M.json'), true)
  for (
    const url of [
      'http://openlibrary.org/books/OL1M.json',
      'https://covers.openlibrary.org/b/id/1-L.jpg',
      'https://openlibrary.org.evil.example/x',
      'https://evil.example/openlibrary.org',
      'https://user:pw@openlibrary.org/x',
      'https://openlibrary.org:8443/x',
      'https://itunes.apple.com@evil.example/x',
      'file:///etc/passwd',
      'not a url',
    ]
  ) assertEquals(allowed(url), false, url)
})

Deno.test('a request to another host is refused before it is sent', async () => {
  const { fetch, asked } = routedFetch({})
  await assertRejects(() => safeFetch(fetch)('https://evil.example/x', {}), HostNotAllowed)
  assertEquals(asked, [])
})

Deno.test('a redirect to an allowed host is followed by hand', async () => {
  const { fetch, asked } = routedFetch({
    'https://openlibrary.org/isbn/9780000000001.json': new Response(null, { status: 302, headers: { location: '/books/OL1M.json' } }),
    'https://openlibrary.org/books/OL1M.json': { title: 'Found' },
  })
  const response = await safeFetch(fetch)('https://openlibrary.org/isbn/9780000000001.json', {})
  assertEquals(await response.json(), { title: 'Found' })
  assertEquals(asked, ['https://openlibrary.org/isbn/9780000000001.json', 'https://openlibrary.org/books/OL1M.json'])
})

Deno.test('a redirect to another host, or in circles, is refused', async () => {
  const elsewhere = routedFetch({
    'https://openlibrary.org/a': new Response(null, { status: 302, headers: { location: 'https://evil.example/steal' } }),
  })
  await assertRejects(() => safeFetch(elsewhere.fetch)('https://openlibrary.org/a', {}), HostNotAllowed)
  assertEquals(elsewhere.asked, ['https://openlibrary.org/a'])

  const circle = routedFetch({
    'https://openlibrary.org/a': () => new Response(null, { status: 302, headers: { location: '/a' } }),
  })
  await assertRejects(() => safeFetch(circle.fetch)('https://openlibrary.org/a', {}), HostNotAllowed, 'too many redirects')
  assertEquals(answer(200, {}).status, 200)
})
