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
  releaseDate: '2012-05-03T07:00:00Z',
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
      publisher: null,
      language: null,
      format: 'ebook',
      page_count: null,
      published_year: 2012,
    },
  })
  // A cover off Apple's CDN is left out: the Book keeps the one it has.
  assertEquals(outcomes.get('2222'), {
    status: 'found',
    result: { title: 'Two', authors: ['A', 'B'], description: 'Blurb "one"', publisher: null, language: null, format: 'ebook', page_count: null, published_year: 2012 },
  })
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
    [EDITION]: {
      title: 'Piranesi.',
      authors: [{ key: '/authors/OL7A' }],
      works: [{ key: '/works/OL9W' }],
      covers: [-1, 123],
      publishers: ['Penguin '],
      languages: [{ key: '/languages/eng' }],
      physical_format: 'Paperback',
      number_of_pages: 272,
      publish_date: 'Sep 15, 2020',
    },
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
      publisher: 'Penguin',
      language: 'eng',
      format: 'paperback',
      page_count: 272,
      published_year: 2020,
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
    result: {
      title: 'Emma',
      authors: ['Jane Austen'],
      description: 'Blurb',
      cover_url: 'https://covers.openlibrary.org/b/id/5-L.jpg',
      publisher: null,
      language: null,
      format: null,
      page_count: null,
      published_year: null,
    },
  })
})

Deno.test('Open Library: an edition\'s facts are the source\'s or nothing: pages by pagination, a publisher too long, a format it does not name', async () => {
  const { http } = testHttp({
    [EDITION]: {
      title: 'Facts',
      pagination: '176 p.',
      publishers: ['x'.repeat(201)],
      languages: [{ key: '/languages/ger' }, { key: '/languages/eng' }],
      physical_format: 'CD-ROM',
      publish_date: 'sometime',
    },
  })
  const outcome = await checkBook(http, book({ title: 'Facts', openlibrary_edition_key: 'OL1M' }))
  assertEquals(outcome.status === 'found' ? [outcome.result.page_count, outcome.result.publisher, outcome.result.language, outcome.result.format, outcome.result.published_year] : null, [176, null, 'ger', null, null])
})

Deno.test('the strongest key: the ISBN first, at Open Library; every other key is bookkeeping and stays', async () => {
  const record = { key: '/books/OL1M', title: 'Penguin Classics Emma', isbn_13: [ISBN], isbn_10: ['0141439513'], works: [{ key: '/works/OL9W' }], description: 'd', covers: [1] }
  const full = { isbn13: ISBN, isbn10: '0141439513', openlibrary_edition_key: 'OL1M', openlibrary_work_key: 'OL9W', title: 'Penguin Classics Emma' }
  const ok = testHttp({ [BY_ISBN]: record })
  assertEquals((await checkBook(ok.http, book(full))).status, 'found')
  assertEquals(ok.asked.slice(0, 1), [BY_ISBN], 'by the ISBN, not by the edition key it also stores')

  // Missing is not contradicting: another edition of the ISBN, another work, an ISBN the edition does not list,
  // an ISBN-10 that is not its twin: the Book is found, from the record the ISBN names.
  for (
    const overrides of [
      { openlibrary_edition_key: 'OL2M' },
      { openlibrary_work_key: 'OL8W' },
      { isbn10: '0306406152' },
      { isbn10: null },
      { isbn10: 'ABC', openlibrary_work_key: '/etc/passwd' },
    ]
  ) {
    const { http } = testHttp({ [BY_ISBN]: record, 'https://openlibrary.org/books/OL2M.json': { title: 'Something Else Entirely' } })
    assertEquals((await checkBook(http, book({ ...full, ...overrides }))).status, 'found', JSON.stringify(overrides))
  }
  const unlisted = testHttp({ [BY_ISBN]: { ...record, isbn_13: undefined, isbn_10: undefined } })
  assertEquals((await checkBook(unlisted.http, book(full))).status, 'found', 'an edition that lists no ISBN at all')
})

Deno.test('the planted row: another Book\'s title under a real ISBN is the one mismatch (the review\'s exploits)', async () => {
  const record = { key: '/books/OL1M', title: 'Emma', isbn_13: [ISBN], works: [{ key: '/works/OL9W' }], description: 'd', covers: [1] }
  // Exploit 2: the ISBN of Emma, the edition key and the title of A Bestseller. The key is not trusted over the ISBN.
  const exploit = testHttp({ [BY_ISBN]: record, 'https://openlibrary.org/books/OL2M.json': { title: 'A Bestseller', description: 'planted', covers: [2] } })
  assertEquals(
    await checkBook(exploit.http, book({ title: 'A Bestseller', isbn13: ISBN, openlibrary_edition_key: 'OL2M', openlibrary_work_key: 'OL2W' })),
    { status: 'mismatch', reason: 'title' },
  )
  // The edition the row names does not list the ISBN, so its title does not stand in for the ISBN's.
  const other = testHttp({ [BY_ISBN]: record, 'https://openlibrary.org/books/OL2M.json': { title: 'A Bestseller', isbn_13: ['9780000000002'] } })
  assertEquals((await checkBook(other.http, book({ title: 'A Bestseller', isbn13: ISBN, openlibrary_edition_key: 'OL2M' }))).status, 'mismatch')
  // A title that is not Emma's at all, by the ISBN alone.
  assertEquals((await checkBook(testHttp({ [BY_ISBN]: record }).http, book({ title: 'A Bestseller', isbn13: ISBN }))).status, 'mismatch')
  assertEquals((await checkBook(testHttp({ [BY_ISBN]: { ...record, title: 'Something Else Entirely' } }).http, book({ title: 'Emma', isbn13: ISBN }))).status, 'mismatch')
})

Deno.test('titles are tolerant: the edition\'s, its subtitle, its work\'s, a leading article, brackets', async () => {
  const edition = { key: '/books/OL1M', title: 'Dune', subtitle: 'Book One', works: [{ key: '/works/OL9W' }], isbn_13: [ISBN] }
  const routes = { [BY_ISBN]: edition, [WORK]: { title: 'Duna' } }
  for (const stored of ['Dune', 'dune', 'Dune: Book One', 'Dune (Dune Chronicles #1)', 'Dune - Book One', 'Duna', 'The Dune']) {
    const outcome = await checkBook(testHttp(routes).http, book({ title: stored, isbn13: ISBN }))
    assertEquals(outcome.status, 'found', stored)
  }
  const article = await checkBook(testHttp({ [BY_ISBN]: { key: '/books/OL1M', title: 'The Hobbit' } }).http, book({ title: 'Hobbit', isbn13: ISBN }))
  assertEquals(article.status, 'found')
  // The title written is the source's own form of the Book's name: the work's when the edition is another language's.
  const reprint = await checkBook(testHttp({ [BY_ISBN]: { key: '/books/OL1M', title: 'Hadrianus un Anilari', works: [{ key: '/works/OL9W' }] }, [WORK]: { title: 'Memoirs of Hadrian' } }).http, book({ title: 'Memoirs of Hadrian', isbn13: ISBN }))
  assertEquals(reprint.status === 'found' ? reprint.result.title : null, 'Memoirs of Hadrian')
  // Dune is not Dune Messiah.
  assertEquals((await checkBook(testHttp({ [BY_ISBN]: { key: '/books/OL1M', title: 'Dune Messiah' } }).http, book({ title: 'Dune', isbn13: ISBN }))).status, 'mismatch')
})

Deno.test('keys that cannot be asked are left out: an ISBN-10 alone is asked as its ISBN-13; with nothing to ask the Book is unknown', async () => {
  const { http, asked } = testHttp({})
  assertEquals(await checkBook(http, book({ isbn13: 'x', isbn10: 'ABC', openlibrary_edition_key: '../../x', openlibrary_work_key: '/etc/passwd', apple_id: '12x' })), { status: 'unknown' })
  assertEquals(await checkBook(http, book()), { status: 'unknown' })
  assertEquals(asked, [])
  const tenOnly = testHttp({ [BY_ISBN]: { key: '/books/OL1M', title: 'A Book' } })
  assertEquals((await checkBook(tenOnly.http, book({ isbn13: null, isbn10: '0141439513' }))).status, 'found')
})

Deno.test('Apple: an ISBN with several editions; the id the row names is bookkeeping, a title that is not the row\'s is the mismatch', async () => {
  const item = { ...ITEM, trackId: 7777, trackName: 'Emma' }
  const lookupIsbn = { [apple(ISBN, 'us')]: { results: [item] } }
  // Another id for the same Book under the ISBN: found, written from the record of the ISBN; the id stays.
  const other = await checkBook(testHttp(lookupIsbn).http, book({ title: 'Emma', isbn13: ISBN, apple_id: '1111', source: 'apple' }))
  assertEquals(other.status, 'found')
  // The id is among them: that edition is used.
  const ok = testHttp({ [apple(ISBN, 'us')]: { results: [{ ...item, trackId: 1111, trackName: 'Emma (Annotated)' }, item] } })
  assertEquals((await checkBook(ok.http, book({ title: 'Emma', isbn13: ISBN, apple_id: '7777', source: 'apple' }))).status, 'found')
  assertEquals(ok.asked, [apple(ISBN, 'us')])
  // The review's first exploit: the ISBN of Emma with another Book's id and title.
  const exploit = testHttp({ ...lookupIsbn, [lookup('1111', 'us')]: { results: [{ ...ITEM, trackId: 1111 }] } })
  assertEquals(await checkBook(exploit.http, book({ title: 'Guards & Guards', isbn13: ISBN, apple_id: '1111', source: 'apple' })), { status: 'mismatch', reason: 'title' })
  assertEquals(exploit.asked, [apple(ISBN, 'us'), apple(ISBN, 'de'), apple(ISBN, 'gb')], 'only the ISBN, in the storefronts: neither the id nor Open Library is tried after it')

  // An ISBN Apple does not sell in any storefront is unknown, never a miss while a storefront is down.
  assertEquals(await checkBook(testHttp({}).http, book({ isbn13: ISBN, apple_id: '7777' })), { status: 'unknown' })
  const down = testHttp({ [apple(ISBN, 'de')]: () => answer(503, 'down') })
  assertEquals((await checkBook(down.http, book({ isbn13: ISBN, apple_id: '7777' }))).status, 'unavailable')
})

Deno.test('Apple id alone: found; Open Library keys stored with it are bookkeeping; another title is a mismatch', async () => {
  const item = { ...ITEM, trackName: 'Emma' }
  const alone = testHttp({ [lookup('1111', 'us')]: { results: [item] } })
  assertEquals((await checkBook(alone.http, book({ title: 'Emma', apple_id: '1111' }))).status, 'found')
  assertEquals(alone.asked, [lookup('1111', 'us')])

  const withKeys = testHttp({ [lookup('1111', 'us')]: { results: [item] } })
  assertEquals((await checkBook(withKeys.http, book({ title: 'Emma', apple_id: '1111', openlibrary_edition_key: 'OL1M', openlibrary_work_key: 'OL9W' }))).status, 'found')
  assertEquals(withKeys.asked, [lookup('1111', 'us')], 'nothing at Open Library is asked')
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

// private.cover_allowed (supabase/migrations/20261022010000_catalogue_input.sql), the one list the database checks every cover by.
const COVER_ALLOWED = /^https:\/\/(covers\.openlibrary\.org|books\.fabkho\.dev|([a-z0-9-]+\.)+mzstatic\.com)(\/|$)/i

Deno.test('a cover the function writes is always on the database\'s allow-list; any other host is no cover', async () => {
  const hosts = [
    'https://is1-ssl.mzstatic.com/image/thumb/a/b.jpg/100x100bb.jpg',
    'https://is5-ssl.mzstatic.com/image/thumb/a/b.jpg/100x100bb.jpg',
  ]
  for (const url of hosts) {
    const cover = appleCover(url)
    assertEquals(cover !== undefined && COVER_ALLOWED.test(cover), true, url)
  }
  for (const id of [1, 8231856, 12]) assertEquals(COVER_ALLOWED.test(openLibraryCover([id])!), true)
  for (
    const hostile of [
      'https://evil.example/a.jpg',
      'https://covers.openlibrary.org.evil.example/a.jpg',
      'https://is1-ssl.mzstatic.com.evil.example/a.jpg',
      'https://books.fabkho.dev/a.jpg',
      'http://is1-ssl.mzstatic.com/a.jpg',
    ]
  ) {
    const { http } = testHttp({ [lookup('1111', 'us')]: { results: [{ ...ITEM, artworkUrl100: hostile }] } })
    const outcome = await checkBook(http, book({ title: 'Guards & Guards', apple_id: '1111' }))
    assertEquals(outcome.status, 'found', hostile)
    assertEquals(outcome.status === 'found' ? 'cover_url' in outcome.result : null, false, `${hostile}: no cover is written`)
  }
})
