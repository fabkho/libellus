import { assertEquals } from '@std/assert'
import {
  appleCover,
  checkBook,
  isbn10To13,
  description,
  keyOf,
  lookupApple,
  MAX_DESCRIPTION,
  names,
  openLibraryCover,
  plainText,
  splitAuthors,
  title,
  titleKey,
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
const ISBN = '9780141439518'
const BY_ISBN = `https://openlibrary.org/isbn/${ISBN}.json`
const apple = (isbn: string, country: string) => `https://itunes.apple.com/lookup?isbn=${isbn}&country=${country}`

Deno.test('titles are compared by the app\'s work key: brackets, the part after a colon, accents and punctuation do not count', () => {
  assertEquals(titleKey('Dune (Dune Chronicles, #1)'), titleKey('Dune'))
  assertEquals(titleKey('The Hobbit: Or There and Back Again'), titleKey('The Hobbit'))
  assertEquals(titleKey('Piranesi.'), titleKey('PIRANESI'))
  assertEquals(titleKey('Émile'), titleKey('Emile'))
  assertEquals(titleKey('Dune') === titleKey('Dune Messiah'), false)
  assertEquals(isbn10To13('0141439513'), ISBN)
})

Deno.test('Open Library: the edition, its authors\' names, the work\'s blurb, the edition\'s cover', async () => {
  const { http, asked } = testHttp({
    [EDITION]: { title: 'Piranesi.', authors: [{ key: '/authors/OL7A' }], works: [{ key: '/works/OL9W' }], covers: [-1, 123] },
    [WORK]: { description: { type: '/type/text', value: 'The work\'s blurb' }, covers: [456] },
    'https://openlibrary.org/authors/OL7A.json': { name: 'Susanna Clarke' },
  })
  const outcome = await checkBook(http, book({ title: 'Piranesi', openlibrary_edition_key: 'OL1M' }))
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
  assertEquals(await checkBook(http, book({ title: 'Emma', openlibrary_work_key: 'OL9W' })), {
    status: 'found',
    result: { title: 'Emma', authors: ['Jane Austen'], description: 'Blurb', cover_url: 'https://covers.openlibrary.org/b/id/5-L.jpg' },
  })
})

Deno.test('one key: the ISBN first, at Open Library; the other keys of the row must agree with the edition it names', async () => {
  const record = { key: '/books/OL1M', title: 'Penguin Classics Emma', isbn_13: [ISBN], isbn_10: ['0141439513'], works: [{ key: '/works/OL9W' }], description: 'd', covers: [1] }
  const full = { isbn13: ISBN, isbn10: '0141439513', openlibrary_edition_key: 'OL1M', openlibrary_work_key: 'OL9W', title: 'Penguin Classics Emma' }
  const ok = testHttp({ [BY_ISBN]: record })
  assertEquals((await checkBook(ok.http, book(full))).status, 'found')
  assertEquals(ok.asked, [BY_ISBN], 'by the ISBN, not by the edition key it also stores')

  // The review's second exploit: a real ISBN with another edition's key (which is tried first by key). Nothing else is asked.
  const exploit = testHttp({ [BY_ISBN]: record, 'https://openlibrary.org/books/OL2M.json': { title: 'A Bestseller', description: 'planted', covers: [2] } })
  assertEquals(await checkBook(exploit.http, book({ ...full, openlibrary_edition_key: 'OL2M' })), { status: 'mismatch', reason: 'edition_key' })
  assertEquals(exploit.asked, [BY_ISBN])

  for (
    const [reason, overrides, answer_] of [
      ['work_key', { openlibrary_work_key: 'OL8W' }, record],
      ['isbn', { isbn13: '9780000000002', isbn10: null }, { ...record }],
      ['title', { title: 'A Bestseller' }, record],
      ['title', {}, { ...record, title: 'Something Else Entirely' }],
    ] as const
  ) {
    const { http, asked } = testHttp({ [BY_ISBN]: answer_, [`https://openlibrary.org/isbn/9780000000002.json`]: answer_ })
    const outcome = await checkBook(http, book({ ...full, ...overrides }))
    assertEquals(outcome, { status: 'mismatch', reason }, reason)
    assertEquals(asked.length, 1, 'a mismatch asks nothing more')
  }
})

Deno.test('one key: an ISBN-10 that is not the ISBN-13 of the row, or keys that are not keys, are a mismatch before anything is asked', async () => {
  const { http, asked } = testHttp({})
  assertEquals(await checkBook(http, book({ isbn13: ISBN, isbn10: 'ABC' })), { status: 'mismatch', reason: 'isbn10_malformed' })
  assertEquals(await checkBook(http, book({ isbn13: ISBN, isbn10: '0306406152' })), { status: 'mismatch', reason: 'isbn10_disagrees_with_isbn13' })
  assertEquals(await checkBook(http, book({ openlibrary_edition_key: '../../x' })), { status: 'mismatch', reason: 'edition_key_malformed' })
  assertEquals(await checkBook(http, book({ openlibrary_edition_key: 'OL1M', openlibrary_work_key: '/etc/passwd' })), { status: 'mismatch', reason: 'work_key_malformed' })
  assertEquals(await checkBook(http, book({ apple_id: '12x' })), { status: 'mismatch', reason: 'apple_id_malformed' })
  assertEquals(await checkBook(http, book({ isbn13: '12345' })), { status: 'mismatch', reason: 'isbn13_malformed' })
  assertEquals(await checkBook(http, book()), { status: 'mismatch', reason: 'no_key' })
  assertEquals(asked, [])
})

Deno.test('one key: an ISBN with an Apple id asks Apple for the ISBN; another edition of the ISBN does not vouch for the id (the first exploit)', async () => {
  const item = { ...ITEM, trackId: 7777, trackName: 'Emma' }
  const exploit = testHttp({ [apple(ISBN, 'us')]: { results: [item] }, [lookup('1111', 'us')]: { results: [{ ...ITEM, trackId: 1111 }] } })
  assertEquals(await checkBook(exploit.http, book({ title: 'Emma', isbn13: ISBN, apple_id: '1111', source: 'apple' })), { status: 'mismatch', reason: 'apple_id_not_this_isbn' })
  assertEquals(exploit.asked, [apple(ISBN, 'us'), apple(ISBN, 'de'), apple(ISBN, 'gb')], 'only the ISBN, in the storefronts: neither the id nor Open Library is tried after it')

  // The same title under the ISBN, by its own id: found, and written from Apple's record of that id.
  const ok = testHttp({ [apple(ISBN, 'us')]: { results: [{ ...item, trackId: 1111 }, item] } })
  const outcome = await checkBook(ok.http, book({ title: 'Emma', isbn13: ISBN, apple_id: '7777', source: 'apple' }))
  assertEquals(outcome.status, 'found')
  assertEquals(ok.asked, [apple(ISBN, 'us')])
  assertEquals((outcome as { result: { title: string } }).result.title, 'Emma')

  // The record has this id, under another title: the row's title is the member's.
  const planted = testHttp({ [apple(ISBN, 'us')]: { results: [{ ...item, trackName: 'A Bestseller' }] } })
  assertEquals(await checkBook(planted.http, book({ title: 'Emma', isbn13: ISBN, apple_id: '7777' })), { status: 'mismatch', reason: 'title' })

  // An ISBN Apple does not sell in any storefront is unknown, never a miss while a storefront is down.
  assertEquals(await checkBook(testHttp({}).http, book({ isbn13: ISBN, apple_id: '7777' })), { status: 'unknown' })
  const down = testHttp({ [apple(ISBN, 'de')]: () => answer(503, 'down') })
  assertEquals((await checkBook(down.http, book({ isbn13: ISBN, apple_id: '7777' }))).status, 'unavailable')
})

Deno.test('one key: an Apple id alone; Open Library keys stored with it must name the same Book there', async () => {
  const item = { ...ITEM, trackName: 'Emma' }
  const alone = testHttp({ [lookup('1111', 'us')]: { results: [item] } })
  assertEquals((await checkBook(alone.http, book({ title: 'Emma', apple_id: '1111' }))).status, 'found')
  assertEquals(alone.asked, [lookup('1111', 'us')])

  const edition = { title: 'Emma', isbn_13: [ISBN], works: [{ key: '/works/OL9W' }] }
  const both = testHttp({ [lookup('1111', 'us')]: { results: [item] }, [EDITION]: edition })
  assertEquals((await checkBook(both.http, book({ title: 'Emma', apple_id: '1111', openlibrary_edition_key: 'OL1M', openlibrary_work_key: 'OL9W' }))).status, 'found')

  const wrongWork = testHttp({ [lookup('1111', 'us')]: { results: [item] }, [EDITION]: edition })
  assertEquals(await checkBook(wrongWork.http, book({ title: 'Emma', apple_id: '1111', openlibrary_edition_key: 'OL1M', openlibrary_work_key: 'OL8W' })), {
    status: 'mismatch',
    reason: 'work_key_not_in_edition',
  })
  const wrongEdition = testHttp({ [lookup('1111', 'us')]: { results: [item] }, [EDITION]: { ...edition, title: 'A Bestseller' } })
  assertEquals(await checkBook(wrongEdition.http, book({ title: 'Emma', apple_id: '1111', openlibrary_edition_key: 'OL1M' })), { status: 'mismatch', reason: 'edition_key_title' })
  const noEdition = testHttp({ [lookup('1111', 'us')]: { results: [item] } })
  assertEquals(await checkBook(noEdition.http, book({ title: 'Emma', apple_id: '1111', openlibrary_edition_key: 'OL1M' })), { status: 'mismatch', reason: 'edition_key_unknown' })
  const titleOfApple = testHttp({ [lookup('1111', 'us')]: { results: [item] } })
  assertEquals(await checkBook(titleOfApple.http, book({ title: 'A Bestseller', apple_id: '1111' })), { status: 'mismatch', reason: 'title' })
})

Deno.test('one key: a row with an Apple id is resolved at Apple, never at Open Library on trust of the id', async () => {
  const { http, asked } = testHttp({ [EDITION]: { key: '/books/OL1M', title: 'Emma', description: 'd', covers: [1] } })
  assertEquals(await checkBook(http, book({ title: 'Emma', openlibrary_edition_key: 'OL1M', apple_id: '1111' })), { status: 'unknown' })
  assertEquals(asked, [lookup('1111', 'us'), lookup('1111', 'de'), lookup('1111', 'gb')])
})

Deno.test('one key: a key the source lacks is unknown, and no other key is tried', async () => {
  const { http, asked } = testHttp({ [WORK]: { title: 'A Book', description: 'd' }, [BY_ISBN]: { title: 'A Book' } })
  assertEquals(await checkBook(http, book({ openlibrary_edition_key: 'OL1M', openlibrary_work_key: 'OL9W' })), { status: 'unknown' })
  assertEquals(asked, [EDITION], 'the work, which the source has, is never tried')
})

Deno.test('Open Library: nothing known is unknown; a source that failed is no miss; a record without a title is no answer', async () => {
  assertEquals(await checkBook(testHttp({}).http, book({ openlibrary_edition_key: 'OL1M' })), { status: 'unknown' })
  const down = testHttp({ [EDITION]: () => answer(503, 'down') })
  assertEquals((await checkBook(down.http, book({ openlibrary_edition_key: 'OL1M' }))).status, 'unavailable')
  const untitled = testHttp({ [EDITION]: { description: 'Blurb without a title' } })
  assertEquals(await checkBook(untitled.http, book({ openlibrary_edition_key: 'OL1M' })), { status: 'unknown' })
})

Deno.test('an ISBN with no source id asks the Book\'s own source first, then the other', async () => {
  const fromApple = testHttp({ [apple(ISBN, 'us')]: { results: [{ ...ITEM, trackName: 'A Book' }] } })
  assertEquals((await checkBook(fromApple.http, book({ isbn13: ISBN, source: 'apple' }))).status, 'found')
  assertEquals(fromApple.asked, [apple(ISBN, 'us')])
  const fallsBack = testHttp({ [BY_ISBN]: { key: '/books/OL1M', title: 'A Book', isbn_13: [ISBN] } })
  assertEquals((await checkBook(fallsBack.http, book({ isbn13: ISBN, source: 'apple' }))).status, 'found')
  assertEquals(fallsBack.asked, [apple(ISBN, 'us'), apple(ISBN, 'de'), apple(ISBN, 'gb'), BY_ISBN])
})
