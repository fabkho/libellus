import { assertEquals } from '@std/assert'
import { coverIsCacheable } from '../../../web/app/utils/coverSize.ts'
import { byCoverId, coverIdFromLocation, planCover } from './plan.ts'
import { APPLE_BASE, APPLE_URL, GOODREADS_URL, HARDCOVER_URL, REGAL_URL } from './test_support.ts'

Deno.test('Apple: the largest 600x900 WebP is the key, then 360, 240 and 120; the thumbhash probe is the 66x100 JPEG', () => {
  const plan = planCover(APPLE_URL)!
  assertEquals(plan.host, 'apple')
  assertEquals(plan.largest, `${APPLE_BASE}/600x900bb.webp`)
  assertEquals(plan.rest, [`${APPLE_BASE}/360x540bb.webp`, `${APPLE_BASE}/240x360bb.webp`, `${APPLE_BASE}/120x180bb.webp`])
  assertEquals(plan.thumb, `${APPLE_BASE}/66x100bb.jpg`)
  assertEquals(plan.keyed, false)
  // Any size of the artwork stored in books.cover_url plans the same images.
  assertEquals(planCover(`${APPLE_BASE}/100x100bb.jpg`), plan)
  assertEquals(planCover(`${APPLE_BASE}/1200x1200bb.png`), plan)
})

Deno.test('odd Apple addresses are unsupported_url (null), and agree with the app\'s own idea of an Apple cover', () => {
  const odd = [
    'https://is1-ssl.mzstatic.com/image/thumb/x/cover.jpg', // no size segment
    'https://is1-ssl.mzstatic.com/image/thumb/Publication/abc.jpg/600x900.jpg', // not `bb`
    'https://is1-ssl.mzstatic.com/x/600x900bb.jpg', // not under /image/thumb/
    `${APPLE_BASE}/600x900bb.jpg?l=en`, // a query
    `${APPLE_BASE}/600x900bb.jpg#x`,
    'http://is1-ssl.mzstatic.com/image/thumb/Publication/a.jpg/600x900bb.jpg', // not https
    'https://user:pw@is1-ssl.mzstatic.com/image/thumb/Publication/a.jpg/600x900bb.jpg',
    'https://is1-ssl.mzstatic.com:444/image/thumb/Publication/a.jpg/600x900bb.jpg',
    'https://mzstatic.com.evil.example/image/thumb/Publication/a.jpg/600x900bb.jpg',
    'https://evil-mzstatic.com/image/thumb/Publication/a.jpg/600x900bb.jpg',
    'not a url',
    '',
  ]
  for (const url of odd) {
    assertEquals(planCover(url), null, url)
    assertEquals(coverIsCacheable(url), false, url)
  }
  for (const url of [APPLE_URL, `${APPLE_BASE}/120x180bb.webp`, 'https://is3-ssl.mzstatic.com/image/thumb/Features/v4/a/b/c/x.jpeg/60x90bb.png']) {
    assertEquals(planCover(url)?.host, 'apple', url)
    assertEquals(coverIsCacheable(url), true, url)
  }
})

Deno.test('Open Library: -L is the key, then -M, always with ?default=false; the thumbhash is made from the -M bytes', () => {
  const plan = planCover('https://covers.openlibrary.org/b/id/8231856-L.jpg')!
  assertEquals(plan.host, 'openlibrary')
  assertEquals(plan.largest, 'https://covers.openlibrary.org/b/id/8231856-L.jpg?default=false')
  assertEquals(plan.rest, ['https://covers.openlibrary.org/b/id/8231856-M.jpg?default=false'])
  assertEquals(plan.thumb, plan.rest[0])
  assertEquals(plan.keyed, false)
  // Whatever size or query the stored address has, the same plan.
  assertEquals(planCover('https://covers.openlibrary.org/b/id/8231856-S.jpg?default=false'), plan)
  assertEquals(planCover('https://covers.openlibrary.org/b/olid/OL123M-M.jpg')?.keyed, false)
})

Deno.test('Open Library: isbn, oclc and lccn are keyed (paced at 0.3 a second), id and olid are not', () => {
  for (const kind of ['isbn', 'oclc', 'lccn']) assertEquals(planCover(`https://covers.openlibrary.org/b/${kind}/9780000000002-L.jpg`)?.keyed, true, kind)
  for (const kind of ['id', 'olid']) assertEquals(planCover(`https://covers.openlibrary.org/b/${kind}/123-L.jpg`)?.keyed, false, kind)
})

Deno.test('Open Library: other paths and queries are unsupported_url', () => {
  for (const url of [
    'https://covers.openlibrary.org/a/olid/OL1A-L.jpg', // an author photo
    'https://covers.openlibrary.org/b/id/8231856-XL.jpg',
    'https://covers.openlibrary.org/b/id/8231856-L.png',
    'https://covers.openlibrary.org/b/id/8231856-L.jpg?default=true',
    'https://covers.openlibrary.org/b/id/8231856-L.jpg?x=1',
    'https://covers.openlibrary.org/b/title/x-L.jpg',
    'https://openlibrary.org/b/id/8231856-L.jpg',
  ]) assertEquals(planCover(url), null, url)
})

Deno.test('Goodreads and Regal: the one image the address names, and the thumbhash from it', () => {
  const goodreads = planCover(GOODREADS_URL)!
  assertEquals([goodreads.host, goodreads.largest, goodreads.rest, goodreads.thumb], ['goodreads', GOODREADS_URL, [], GOODREADS_URL])
  const regal = planCover(REGAL_URL)!
  assertEquals([regal.host, regal.largest, regal.rest], ['regal', REGAL_URL, []])
  assertEquals(planCover('https://i.gr-assets.com/'), null)
  assertEquals(planCover('https://i.gr-assets.com/a.jpg?x=1'), null)
  assertEquals(planCover('https://i.gr-assets.com.evil.example/a.jpg'), null)
  assertEquals(planCover('https://s.gr-assets.com/a.jpg'), null)
})

Deno.test('Hardcover: the one image the address names, a plain path on the one host, and the thumbhash from it', () => {
  const hardcover = planCover(HARDCOVER_URL)!
  assertEquals([hardcover.host, hardcover.largest, hardcover.rest, hardcover.thumb, hardcover.keyed], ['hardcover', HARDCOVER_URL, [], HARDCOVER_URL, false])
  // A percent-escape in the path is part of a real export's address.
  assertEquals(planCover('https://assets.hardcover.app/edition/1/a%20b.jpeg')?.host, 'hardcover')
  for (const url of [
    'https://assets.hardcover.app/',
    'https://assets.hardcover.app/edition/1/a.jpeg?x=1',
    'https://assets.hardcover.app/edition/1/a.jpeg#x',
    'http://assets.hardcover.app/edition/1/a.jpeg',
    'https://assets.hardcover.app:8443/edition/1/a.jpeg',
    'https://user@assets.hardcover.app/edition/1/a.jpeg',
    'https://assets.hardcover.app.evil.example/edition/1/a.jpeg',
    'https://cdn.hardcover.app/edition/1/a.jpeg',
    'https://hardcover.app/edition/1/a.jpeg',
  ]) assertEquals(planCover(url), null, url)
})

Deno.test('other hosts are unsupported_url, and COVER_STORE_HOSTS drops a host', () => {
  assertEquals(planCover('https://example.com/cover.jpg'), null)
  assertEquals(planCover('https://169.254.169.254/latest/meta-data'), null)
  assertEquals(planCover('https://localhost/cover.jpg'), null)
  assertEquals(planCover(GOODREADS_URL, ['apple', 'openlibrary', 'regal']), null)
  assertEquals(planCover(APPLE_URL, ['goodreads']), null)
  assertEquals(planCover(APPLE_URL, new Set(['apple']))?.host, 'apple')
  assertEquals(planCover('https://covers.openlibrary.org/b/id/1-L.jpg', ['apple']), null)
  assertEquals(planCover(REGAL_URL, ['apple']), null)
  // The takedown switch of the Hardcover host: `COVER_STORE_HOSTS` without it, and its Books are unsupported_url.
  assertEquals(planCover(HARDCOVER_URL, ['apple', 'openlibrary', 'goodreads', 'regal']), null)
  assertEquals(planCover(HARDCOVER_URL, ['hardcover'])?.host, 'hardcover')
})

Deno.test('a keyed redirect that names the cover id: the other size is asked by id', () => {
  assertEquals(coverIdFromLocation('https://archive.org/download/l_covers_0009/l_covers_0009_36.zip/0009363399-L.jpg'), '9363399')
  assertEquals(coverIdFromLocation('https://ia800409.us.archive.org/view_archive.php?archive=/25/items/s_covers_0008/s_covers_0008_23.zip&file=0008231856-S.jpg'), '8231856')
  // It names none, or is not archive.org.
  assertEquals(coverIdFromLocation('https://archive.org/download/foo/bar.jpg'), null)
  assertEquals(coverIdFromLocation('https://evil.example/download/0009363399-L.jpg'), null)
  assertEquals(coverIdFromLocation('https://archive.org.evil.example/0009363399-L.jpg'), null)
  assertEquals(coverIdFromLocation('nonsense'), null)

  const keyed = planCover('https://covers.openlibrary.org/b/isbn/9780441172719-L.jpg')!
  assertEquals(keyed.keyed, true)
  const byId = byCoverId(keyed, '9363399')
  assertEquals(byId.largest, keyed.largest) // the key came from the keyed request: it stays
  assertEquals(byId.rest, ['https://covers.openlibrary.org/b/id/9363399-M.jpg?default=false'])
  assertEquals(byId.thumb, byId.rest[0])
  assertEquals(byId.keyed, false)
})
