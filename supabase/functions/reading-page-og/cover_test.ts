/**
 * Which cover addresses the function fetches (security round F18): only the hosts a
 * cover really lives on, over https, and a redirect only to such a host, hop by hop.
 * A stand-in for `fetch` answers; nothing leaves the process.
 *
 *   cd supabase/functions/reading-page-og && deno test
 */
import { assert, assertEquals } from '@std/assert'
import { loadCover } from './render.ts'
import type { PublicBook } from './page.ts'
import { TINY_PNG } from './test_support.ts'

const book = (cover_url: string | null) => ({ cover_url }) as PublicBook

/** A fetch that answers from a table of URL -> Response and remembers what was asked and how. */
function routes(table: Record<string, () => Response>) {
  const asked: { url: string; redirect: string | undefined }[] = []
  const fetch = (input: string, init?: RequestInit) => {
    asked.push({ url: input, redirect: init?.redirect })
    const answer = table[input]
    return Promise.resolve(answer ? answer() : new Response('nothing planned', { status: 404 }))
  }
  return { fetch, asked }
}

const image = () => new Response(TINY_PNG, { headers: { 'content-type': 'image/png' } })
const redirect = (to: string, status = 302) => () => new Response(null, { status, headers: { location: to } })

Deno.test('F18: a cover on a known host is fetched without following redirects on its own', async () => {
  for (const url of [
    'https://covers.openlibrary.org/b/id/1-L.jpg',
    'https://is1-ssl.mzstatic.com/image/thumb/x/600x600bb.jpg',
    'https://books.fabkho.dev/covers/x.jpg',
  ]) {
    const { fetch, asked } = routes({ [url]: image })
    assert((await loadCover(book(url), { fetch }))?.startsWith('data:image/png;base64,'), url)
    assertEquals(asked, [{ url, redirect: 'manual' }])
  }
})

Deno.test('F18: a host off the list is never asked, whatever the database said', async () => {
  for (const url of [
    'https://evil.example/cover.png',
    'https://covers.openlibrary.org.evil.example/x.png',
    'https://evil.example/covers.openlibrary.org/x.png',
    'https://covers.openlibrary.org@evil.example/x.png',
    'https://user:pass@covers.openlibrary.org/x.png',
    'https://covers.openlibrary.org:8443/x.png',
    'https://mzstatic.com/x.png',
    'http://covers.openlibrary.org/x.png',
    'https://169.254.169.254/latest/meta-data',
    'https://localhost/x.png',
    'not a url',
  ]) {
    const { fetch, asked } = routes({})
    assertEquals(await loadCover(book(url), { fetch }), null, url)
    assertEquals(asked, [], url)
  }
  assertEquals(await loadCover(book(null), { fetch: routes({}).fetch }), null)
})

Deno.test('F18: Open Library redirects to the Internet Archive: that is followed, hop by hop, and nothing else', async () => {
  const start = 'https://covers.openlibrary.org/b/id/8739161-L.jpg'
  const archive = 'https://archive.org/download/l_covers_0008/l_covers_0008_73.zip/0008739161-L.jpg'
  const mirror = 'https://ia800000.us.archive.org/9/items/l_covers_0008/x.jpg'
  const { fetch, asked } = routes({ [start]: redirect(archive), [archive]: redirect(mirror, 301), [mirror]: image })
  assert((await loadCover(book(start), { fetch }))?.startsWith('data:image/png'))
  assertEquals(asked.map((a) => a.url), [start, archive, mirror])
  assert(asked.every((a) => a.redirect === 'manual'))
})

Deno.test('F18: a redirect to any other host, to http, with credentials or without a target is not followed', async () => {
  const start = 'https://covers.openlibrary.org/b/id/1-L.jpg'
  for (const target of [
    'https://evil.example/x.png',
    'http://archive.org/x.png',
    'https://169.254.169.254/latest/meta-data',
    'https://archive.org.evil.example/x.png',
    'https://user@archive.org/x.png',
    '//evil.example/x.png',
    null,
  ]) {
    const { fetch, asked } = routes({
      [start]: target === null ? () => new Response(null, { status: 302 }) : redirect(target),
      'https://evil.example/x.png': image,
    })
    assertEquals(await loadCover(book(start), { fetch }), null, String(target))
    assertEquals(asked.map((a) => a.url), [start], String(target))
  }
})

Deno.test('F18: a redirect loop ends after a few hops', async () => {
  const a = 'https://covers.openlibrary.org/a.jpg'
  const b = 'https://archive.org/b.jpg'
  const { fetch, asked } = routes({ [a]: redirect(b), [b]: redirect(a) })
  assertEquals(await loadCover(book(a), { fetch }), null)
  assertEquals(asked.length, 4)
})

Deno.test('F18: what is not an image, or too big, is no cover', async () => {
  const url = 'https://covers.openlibrary.org/x.jpg'
  assertEquals(await loadCover(book(url), { fetch: routes({ [url]: () => new Response('<html>', { headers: { 'content-type': 'text/html' } }) }).fetch }), null)
  assertEquals(
    await loadCover(book(url), { fetch: routes({ [url]: () => new Response(new Uint8Array(5_000_001), { headers: { 'content-type': 'image/png' } }) }).fetch }),
    null,
  )
})
