import { assertEquals } from '@std/assert'
import {
  appleCover,
  description,
  keyOf,
  lookupApple,
  lookupOpenLibrary,
  MAX_DESCRIPTION,
  names,
  openLibraryCover,
  plainText,
  splitAuthors,
  title,
} from './check.ts'
import { answer, book, testHttp } from './test_support.ts'

const lookup = (ids: string, country: string) => `https://itunes.apple.com/lookup?id=${ids.replace(',', '%2C')}&country=${country}`
const ART = 'https://is1-ssl.mzstatic.com/image/thumb/Publication/v4/ab/cd/9783641264864.jpg/100x100bb.jpg'

Deno.test('text: tags dropped, entities decoded, control characters gone, capped', () => {
  assertEquals(plainText('<p>One &amp; two</p><p>Three<br>four</p>'), 'One & two\n\nThree\nfour')
  assertEquals(plainText('a\u0000b<script>alert(1)</script>'), 'abalert(1)')
  assertEquals(description({ type: '/type/text', value: 'From the work' }), 'From the work')
  assertEquals(description(42), null)
  assertEquals(description('x'.repeat(MAX_DESCRIPTION + 50))?.length, MAX_DESCRIPTION)
  assertEquals(title('Piranesi.'), 'Piranesi')
  assertEquals(title('Emma /'), 'Emma')
  assertEquals(title('x'.repeat(501)), undefined)
  assertEquals(title(5), undefined)
  assertEquals(names(['Ada', 5, '  ', 'Ada', 'Ben']), ['Ada', 'Ben'])
  assertEquals(names(['x'.repeat(201)]), undefined)
  assertEquals(names(Array.from({ length: 21 }, (_, i) => `Author ${i}`)), undefined)
  assertEquals(splitAuthors('Edward Gibbon, Gian Battista Piranesi & Martin Luther King, Jr.'), [
    'Edward Gibbon',
    'Gian Battista Piranesi',
    'Martin Luther King, Jr.',
  ])
})

Deno.test('covers: only Apple\'s CDN and Open Library\'s covers, over https, at the stored size', () => {
  assertEquals(appleCover(ART), 'https://is1-ssl.mzstatic.com/image/thumb/Publication/v4/ab/cd/9783641264864.jpg/600x900bb.jpg')
  for (
    const bad of [
      'http://is1-ssl.mzstatic.com/a.jpg',
      'https://mzstatic.com/a.jpg',
      'https://mzstatic.com.evil.example/a.jpg',
      'https://evil.example/mzstatic.com/a.jpg',
      'https://is1-ssl.mzstatic.com@evil.example/a.jpg',
      'https://user:pw@is1-ssl.mzstatic.com/a.jpg',
      'https://is1-ssl.mzstatic.com:444/a.jpg',
      'javascript:alert(1)',
      'https://is1-ssl.mzstatic.com/' + 'a'.repeat(500),
      42,
      null,
    ]
  ) assertEquals(appleCover(bad), undefined, String(bad))
  assertEquals(openLibraryCover([-1, 8231856]), 'https://covers.openlibrary.org/b/id/8231856-L.jpg')
  assertEquals(openLibraryCover([-1, 0]), undefined)
  assertEquals(openLibraryCover(['9']), undefined)
  assertEquals(openLibraryCover('12'), undefined)
})

Deno.test('keys: shaped like keys or not used', () => {
  assertEquals(keyOf('OL123M', /(OL\d{1,12}M)$/), 'OL123M')
  assertEquals(keyOf('/books/OL123M', /(OL\d{1,12}M)$/), 'OL123M')
  assertEquals(keyOf('../../etc/passwd', /(OL\d{1,12}M)$/), null)
  assertEquals(keyOf('OL123M/../x', /(OL\d{1,12}M)$/), null)
  assertEquals(keyOf(null, /(OL\d{1,12}M)$/), null)
})

const ITEM = {
  kind: 'ebook',
  trackId: 1111,
  trackName: 'Guards &amp; Guards',
  artistName: 'Terry Pratchett',
  description: '<p>Blurb &quot;one&quot;</p>',
  artworkUrl100: ART,
}

Deno.test('Apple: title, authors, description and cover from the source, ids in one request', async () => {
  const { http, asked } = testHttp({ [lookup('1111,2222', 'us')]: { results: [ITEM, { ...ITEM, trackId: 2222, trackName: 'Two', artistName: 'A, B', artworkUrl100: 'https://evil.example/x.jpg' }] } })
  const outcomes = await lookupApple(http, ['2222', '1111'])
  assertEquals(asked, [lookup('1111,2222', 'us')])
  assertEquals(outcomes.get('1111'), {
    status: 'found',
    result: {
      title: 'Guards & Guards',
      authors: ['Terry Pratchett'],
      description: 'Blurb "one"',
      cover_url: 'https://is1-ssl.mzstatic.com/image/thumb/Publication/v4/ab/cd/9783641264864.jpg/600x900bb.jpg',
    },
  })
  // A cover off Apple's CDN is left out: the Book keeps the one it has.
  assertEquals(outcomes.get('2222'), { status: 'found', result: { title: 'Two', authors: ['A', 'B'], description: 'Blurb "one"' } })
})

Deno.test('Apple: an id the first storefront lacks is asked of the next, alone', async () => {
  const { http, asked } = testHttp({
    [lookup('1111,3333', 'us')]: { results: [ITEM] },
    [lookup('3333', 'de')]: { results: [{ ...ITEM, trackId: 3333, trackName: 'Nur in Deutschland' }] },
  })
  const outcomes = await lookupApple(http, ['1111', '3333'])
  assertEquals(asked, [lookup('1111,3333', 'us'), lookup('3333', 'de')])
  assertEquals((outcomes.get('3333') as { result: { title: string } }).result.title, 'Nur in Deutschland')
})

Deno.test('Apple: unknown to every storefront is a miss; a storefront that failed is no miss', async () => {
  const missing = testHttp({})
  assertEquals((await lookupApple(missing.http, ['9', 'x1', '../x'])).get('9'), { status: 'unknown' })
  assertEquals(missing.asked.length, 3, 'one lookup per storefront, and an id that is not digits is never asked');

  const down = testHttp({ [lookup('9', 'de')]: () => answer(503, 'down') })
  assertEquals((await lookupApple(down.http, ['9'])).get('9')?.status, 'unavailable')
})

Deno.test('Apple: results that are not ebooks, or have no title, are not answers', async () => {
  const { http } = testHttp({ [lookup('1,2', 'us')]: { results: [{ ...ITEM, trackId: 1, kind: 'song' }, { ...ITEM, trackId: 2, trackName: '  ' }] } })
  const outcomes = await lookupApple(http, ['1', '2'])
  assertEquals(outcomes.get('1')?.status, 'unknown')
  assertEquals(outcomes.get('2')?.status, 'unknown')
})

const EDITION = 'https://openlibrary.org/books/OL1M.json'
const WORK = 'https://openlibrary.org/works/OL9W.json'

Deno.test('Open Library: the edition, its authors\' names, the work\'s blurb, the edition\'s cover', async () => {
  const { http, asked } = testHttp({
    [EDITION]: { title: 'Piranesi.', authors: [{ key: '/authors/OL7A' }], works: [{ key: '/works/OL9W' }], covers: [-1, 123] },
    [WORK]: { description: { type: '/type/text', value: 'The work\'s blurb' }, covers: [456] },
    'https://openlibrary.org/authors/OL7A.json': { name: 'Susanna Clarke' },
  })
  const outcome = await lookupOpenLibrary(http, book({ openlibrary_edition_key: 'OL1M' }))
  assertEquals(outcome, {
    status: 'found',
    result: {
      title: 'Piranesi',
      authors: ['Susanna Clarke'],
      description: 'The work\'s blurb',
      cover_url: 'https://covers.openlibrary.org/b/id/123-L.jpg',
    },
  })
  assertEquals(asked, [EDITION, WORK, 'https://openlibrary.org/authors/OL7A.json'])
})

Deno.test('Open Library: a work alone, authors by its author roles', async () => {
  const { http } = testHttp({
    [WORK]: { title: 'Emma /', authors: [{ author: { key: '/authors/OL3A' }, type: { key: '/type/author_role' } }], description: 'Blurb', covers: [5] },
    'https://openlibrary.org/authors/OL3A.json': { name: 'Jane Austen' },
  })
  assertEquals(await lookupOpenLibrary(http, book({ openlibrary_work_key: 'OL9W' })), {
    status: 'found',
    result: { title: 'Emma', authors: ['Jane Austen'], description: 'Blurb', cover_url: 'https://covers.openlibrary.org/b/id/5-L.jpg' },
  })
})

Deno.test('Open Library: a key the source lacks falls through to the ISBN, then the work', async () => {
  const { http, asked } = testHttp({ 'https://openlibrary.org/isbn/9780141439518.json': { title: 'By ISBN', description: 'x', covers: [1] } })
  const outcome = await lookupOpenLibrary(http, book({ openlibrary_edition_key: 'OL1M', isbn13: '9780141439518', openlibrary_work_key: 'OL9W' }))
  assertEquals((outcome as { result: { title: string } }).result.title, 'By ISBN')
  assertEquals(asked, [EDITION, 'https://openlibrary.org/isbn/9780141439518.json'])
})

Deno.test('Open Library: nothing known is a miss; a source that failed is no miss; a later answer wins over an earlier failure', async () => {
  assertEquals(await lookupOpenLibrary(testHttp({}).http, book({ openlibrary_edition_key: 'OL1M', openlibrary_work_key: 'OL9W' })), { status: 'unknown' })
  assertEquals(await lookupOpenLibrary(testHttp({}).http, book()), { status: 'unknown' })
  const down = testHttp({ [EDITION]: () => answer(503, 'down') })
  assertEquals((await lookupOpenLibrary(down.http, book({ openlibrary_edition_key: 'OL1M' }))).status, 'unavailable')
  const later = testHttp({ [EDITION]: () => answer(503, 'down'), [WORK]: { title: 'From the work', description: 'd' } })
  assertEquals((await lookupOpenLibrary(later.http, book({ openlibrary_edition_key: 'OL1M', openlibrary_work_key: 'OL9W' }))).status, 'found')
})

Deno.test('Open Library: a record without a title is no answer; keys that are not keys are never asked', async () => {
  const { http, asked } = testHttp({ [EDITION]: { description: 'Blurb without a title' } })
  assertEquals(await lookupOpenLibrary(http, book({
    openlibrary_edition_key: 'OL1M',
    isbn13: '../../x',
    isbn10: '12345',
    openlibrary_work_key: '/etc/passwd',
  })), { status: 'unknown' })
  assertEquals(asked, [EDITION])
})
