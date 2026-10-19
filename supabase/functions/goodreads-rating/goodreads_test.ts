/**
 * Reading Goodreads' answers and matching a title search to a Book (issue #69),
 * on the recordings in fixtures/. No request leaves the machine.
 *
 *   cd supabase/functions/goodreads-rating && deno test
 */
import { assertEquals, assertThrows } from '@std/assert'
import {
  type AutoCompleteBook,
  coverQueries,
  GoodreadsBlocked,
  goodreadsCoverUrl,
  matchIsbnResult,
  matchTitle,
  normalise,
  parseAutoComplete,
  parseIsbn13,
  parseReviewCounts,
  pickByBookId,
  surname,
  titleForms,
  titleQuery,
} from './goodreads.ts'
import { recording } from './test_support.ts'

Deno.test('an ISBN Goodreads knows: the book id, the work-wide average and counts', () => {
  const { status, body } = recording('review-counts-small-gods')
  assertEquals(parseReviewCounts('9780061803208', status, body), {
    status: 'found',
    matchedBy: 'isbn',
    goodreadsId: '6388978',
    rating: 4.32,
    // work_ratings_count and work_text_reviews_count: all editions, not this one's 4506 / 294.
    ratingsCount: 137875,
    reviewsCount: 6116,
  })
})

Deno.test('an ISBN Goodreads does not know (404) is a miss', () => {
  const { status, body } = recording('review-counts-unknown')
  assertEquals(status, 404)
  assertEquals(parseReviewCounts('9798991234566', status, body), { status: 'not_found' })
})

Deno.test('a stub Goodreads keeps for an ISBN nobody rated is a miss too', () => {
  const { status, body } = recording('review-counts-unrated')
  assertEquals(parseReviewCounts('9790000000001', status, body), { status: 'not_found' })
})

Deno.test('a failing or garbled review counts answer throws, so it is never stored', () => {
  assertThrows(() => parseReviewCounts('9780061803208', 500, 'oops'))
  assertThrows(() => parseReviewCounts('9780061803208', 429, ''))
  assertThrows(() => parseReviewCounts('9780061803208', 200, '<html>'))
  assertThrows(() => parseReviewCounts('9780061803208', 200, '{"nope":1}'))
  assertThrows(() => parseReviewCounts('9780061803208', 200, '{"books":[{"isbn13":"9780061803208"}]}'))
})

Deno.test('blocked: 403, 429, 503, a 202, an empty or non-JSON body, or another JSON shape is a block, not a miss', () => {
  const blocked = (run: () => unknown, status: number, kind: string) => {
    const error = assertThrows(run, GoodreadsBlocked)
    assertEquals([error.status, error.kind], [status, kind])
  }
  for (const status of [403, 429, 503]) {
    blocked(() => parseReviewCounts('9780061803208', status, 'x'), status, 'status')
    blocked(() => parseAutoComplete(status, '[]'), status, 'status')
  }
  blocked(() => parseReviewCounts('9780061803208', 202, '{"books":[]}'), 202, 'empty')
  blocked(() => parseAutoComplete(202, ''), 202, 'empty')
  blocked(() => parseReviewCounts('9780061803208', 200, ''), 200, 'empty')
  blocked(() => parseAutoComplete(200, '  '), 200, 'empty')
  blocked(() => parseReviewCounts('9780061803208', 200, '<html>Are you a robot?</html>'), 200, 'not_json')
  blocked(() => parseAutoComplete(200, '<html>'), 200, 'not_json')
  blocked(() => parseReviewCounts('9780061803208', 200, '{"nope":1}'), 200, 'shape')
  blocked(() => parseReviewCounts('9780061803208', 200, 'null'), 200, 'shape')
  blocked(() => parseAutoComplete(200, '{"nope":1}'), 200, 'shape')
  // Not blocks: a plain miss, an ordinary failure.
  assertEquals(parseReviewCounts('9780061803208', 404, 'No books match those ISBNs.'), { status: 'not_found' })
  assertEquals(parseAutoComplete(200, '[]'), [])
  assertThrows(() => parseAutoComplete(500, 'oops'), Error, 'auto_complete answered 500')
})

Deno.test('a title search: each book with its id, title, author, average and ratings', () => {
  const { status, body } = recording('auto-complete-we-are-legion')
  assertEquals(parseAutoComplete(status, body), [
    {
      bookId: '32109569',
      title: 'We Are Legion (We Are Bob) (Bobiverse, #1)',
      bookTitleBare: 'We Are Legion (We Are Bob)',
      author: 'Dennis E. Taylor',
      rating: 4.24,
      ratingsCount: 146833,
      coverUrl: 'https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1474344826i/32109569.jpg',
    },
  ])
  assertEquals(parseAutoComplete(200, recording('auto-complete-nothing').body), [])
  assertThrows(() => parseAutoComplete(503, ''))
  assertThrows(() => parseAutoComplete(200, '{"books":[]}'))
})

Deno.test('ISBN-13s as asked for: hyphens and spaces dropped, the check digit checked', () => {
  assertEquals(parseIsbn13('978-0-06-180320-8'), '9780061803208')
  assertEquals(parseIsbn13('9780061803209'), null)
  assertEquals(parseIsbn13('0061803200'), null)
  assertEquals(parseIsbn13(null), null)
})

Deno.test('titles and names compare without case, accents, punctuation or subtitles', () => {
  assertEquals(normalise('Guards! Guards!'), 'guards guards')
  assertEquals(normalise('Preludes & Nocturnes'), 'preludes and nocturnes')
  assertEquals(normalise('Der Report der Magd’s'), 'der report der magds')
  assertEquals(normalise('Solaris — Stanisław Lem'), 'solaris stanislaw lem')
  assertEquals(
    [...titleForms('The Dispossessed: An Ambiguous Utopia')],
    ['the dispossessed an ambiguous utopia', 'the dispossessed'],
  )
  assertEquals([...titleForms('The Way of Kings (The Stormlight Archive, #1)')], [
    'the way of kings the stormlight archive 1',
    'the way of kings',
  ])
  assertEquals(surname('Susanna Clarke'), 'clarke')
  assertEquals(surname('Ursula K. Le Guin'), 'guin')
  assertEquals(surname('Clarke, Susanna'), 'clarke')
  assertEquals(surname('Martin Luther King Jr.'), 'king')
  assertEquals(surname('—'), null)
})

Deno.test('the title search asks for the main title and the first author\'s surname', () => {
  assertEquals(
    titleQuery({ isbn13: '9780000000002', title: 'We Are Legion (We Are Bob)', authors: ['Dennis E. Taylor'] }),
    'We Are Legion Taylor',
  )
  assertEquals(
    titleQuery({ isbn13: '9780000000002', title: 'The Sandman, Vol. 5: A Game of You', authors: ['Neil Gaiman'] }),
    'The Sandman, Vol. 5 Gaiman',
  )
  assertEquals(titleQuery({ isbn13: '9780000000002', title: '  ', authors: [] }), null)
})

Deno.test('a search result matches by title form and author surname, Goodreads\' order deciding', () => {
  const sandman = parseAutoComplete(200, recording('auto-complete-sandman').body)
  const book = { isbn13: '9790000000001', title: 'The Sandman, Vol. 5: A Game of You', authors: ['Neil Gaiman'] }
  // The first result; not "The Absolute Sandman, Volume 5", not the anniversary
  // edition credited to "Unknown Author".
  assertEquals(matchTitle(book, sandman)?.bookId, '25102')

  const legion = parseAutoComplete(200, recording('auto-complete-we-are-legion').body)
  assertEquals(
    matchTitle({ isbn13: '9790000000001', title: 'We Are Legion (We Are Bob)', authors: ['Dennis E. Taylor'] }, legion)
      ?.bookId,
    '32109569',
  )
})

Deno.test('no match: another author, another title, no author at all, or nobody rated it', () => {
  const result: AutoCompleteBook = {
    bookId: '1',
    title: 'Piranesi',
    bookTitleBare: 'Piranesi',
    author: 'Susanna Clarke',
    rating: 4.2,
    ratingsCount: 100,
    coverUrl: null,
  }
  const book = { isbn13: '9780000000002', title: 'Piranesi', authors: ['Susanna Clarke'] }
  assertEquals(matchTitle(book, [result])?.bookId, '1')
  assertEquals(matchTitle({ ...book, authors: ['Arthur C. Clarke'] }, [result])?.bookId, '1') // surname only, by design
  assertEquals(matchTitle({ ...book, authors: ['Neil Gaiman'] }, [result]), null)
  assertEquals(matchTitle({ ...book, title: 'Piranesi Returns' }, [result]), null)
  assertEquals(matchTitle({ ...book, authors: [] }, [result]), null)
  assertEquals(matchTitle(book, [{ ...result, ratingsCount: 0 }]), null)
})

// ------------------------------------------------------------------- covers

Deno.test('a cover address: the size token is stripped, the full-size original is linked', () => {
  assertEquals(
    goodreadsCoverUrl('https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1682494830i/131743446._SY75_.jpg'),
    'https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1682494830i/131743446.jpg',
  )
  assertEquals(
    goodreadsCoverUrl('https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1558896137i/10864102._SX50_.jpg'),
    'https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1558896137i/10864102.jpg',
  )
  // Already full size, or with a query: only the path is kept.
  assertEquals(goodreadsCoverUrl('https://i.gr-assets.com/images/x/1.jpg?t=1#a'), 'https://i.gr-assets.com/images/x/1.jpg')
})

Deno.test('a cover address: https at exactly i.gr-assets.com, or no cover', () => {
  const path = '/images/S/compressed.photo.goodreads.com/books/1i/2._SY75_.jpg'
  for (const bad of [
    `http://i.gr-assets.com${path}`,
    `https://s.gr-assets.com${path}`,
    `https://i.gr-assets.com.evil.com${path}`,
    `https://i.gr-assets.com@evil.example${path}`,
    `https://evil.example@i.gr-assets.com${path}`,
    `https://i.gr-assets.com:8443${path}`,
    `https://evil.example/?u=https://i.gr-assets.com${path}`,
    'javascript:alert(1)',
    'not a url',
    '',
    null,
    undefined,
    42,
  ]) {
    assertEquals(goodreadsCoverUrl(bad), null, String(bad))
  }
})

Deno.test('a Goodreads stand-in (nophoto) image is no cover', () => {
  assertEquals(
    goodreadsCoverUrl('https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/nophoto/book/111x148._SX50_.png'),
    null,
  )
  // The recorded search has such hits next to real ones.
  const sandman = parseAutoComplete(200, recording('auto-complete-sandman').body)
  assertEquals(sandman.map((b) => b.coverUrl === null), [false, false, true, true])
})

Deno.test('a result by its Goodreads book id, exactly; none for an unknown or missing id', () => {
  const sandman = parseAutoComplete(200, recording('auto-complete-sandman').body)
  assertEquals(pickByBookId(sandman, '10864102')?.bookId, '10864102')
  assertEquals(pickByBookId(sandman, '999'), null)
  assertEquals(pickByBookId(sandman, null), null)
})

// ----------------------------------------------------- the cover search's queries

Deno.test('cover queries: the ISBN-13, the whole title with the first author, the main title with the surname', () => {
  assertEquals(
    coverQueries({ isbn13: '9783865527127', title: 'Blood & Roses - Buch 1 (Blood & Roses, #1)', authors: ['Callie Hart', 'Someone Else'] }),
    [
      { kind: 'isbn', q: '9783865527127' },
      { kind: 'title', q: 'Blood & Roses - Buch 1 Callie Hart' },
      { kind: 'short', q: 'Blood & Roses Hart' },
    ],
  )
  // No ISBN; a catalogue's "Surname, First" is read in order; a title with nothing to cut is asked once, not twice.
  assertEquals(coverQueries({ isbn13: null, title: 'Piranesi', authors: ['Clarke, Susanna'] }), [
    { kind: 'title', q: 'Piranesi Susanna Clarke' },
    { kind: 'short', q: 'Piranesi Clarke' },
  ])
  assertEquals(coverQueries({ isbn13: null, title: 'Dune', authors: ['Hart'] }).map((q) => q.kind), ['title'])
  assertEquals(coverQueries({ isbn13: null, title: ' ', authors: [] }), [])
})

Deno.test('an ISBN search result is taken by its author, whatever its title; no author, no match', () => {
  const crown = parseAutoComplete(200, recording('auto-complete-crown-bones-isbn').body)
  const book = { isbn13: '9783453321540', title: 'A Translated Title', authors: ['Jennifer L. Armentrout'] }
  assertEquals(matchIsbnResult(book, crown)?.bookId, '59478256')
  assertEquals(matchIsbnResult({ ...book, authors: ['Somebody Else'] }, crown), null)
  assertEquals(matchIsbnResult({ ...book, authors: [] }, crown), null)
})

Deno.test('the six cover cases: what the main-title search ranks, and what the title rule takes', () => {
  const roses = parseAutoComplete(200, recording('auto-complete-blood-roses-short').body)
  const hart = ['Callie Hart']
  // The English series only: not Buch 2, not Buch 3 (the other volumes' titles never meet).
  assertEquals(matchTitle({ isbn13: null, title: 'Blood & Roses - Buch 2', authors: hart }, roses), null)
  assertEquals(matchTitle({ isbn13: null, title: 'Blood & Roses - Buch 3', authors: hart }, roses), null)
  // Buch 1 against Buch 3's list, and the other way round: another volume is not the book.
  const buch1 = parseAutoComplete(200, recording('auto-complete-blood-roses-buch-1').body)
  const buch2 = parseAutoComplete(200, recording('auto-complete-blood-roses-buch-2').body)
  assertEquals(matchTitle({ isbn13: null, title: 'Blood & Roses - Buch 3', authors: hart }, buch1), null)
  assertEquals(matchTitle({ isbn13: null, title: 'Blood & Roses - Buch 1', authors: hart }, buch2), null)
  assertEquals(matchTitle({ isbn13: null, title: 'Blood & Roses - Buch 2', authors: hart }, buch2)?.bookId, '45730013')
  // The Crown and Bones whole-title list is the English series' books: none is it.
  const crown = parseAutoComplete(200, recording('auto-complete-crown-bones-title').body)
  assertEquals(matchTitle({ isbn13: null, title: 'Crown and Bones', authors: ['Jennifer L. Armentrout'] }, crown), null)
  // The fuzzy rule: a word more, a credit after the title (with the author only).
  const fall = parseAutoComplete(200, recording('auto-complete-fall-to-forgive').body)
  assertEquals(matchTitle({ isbn13: null, title: 'A Fall to Forgive', authors: ['Morgane Moncomble'] }, fall)?.bookId, '244201756')
  assertEquals(matchTitle({ isbn13: null, title: 'A Fall to Forgive', authors: ['Anna Other'] }, fall), null)
  const jingle = parseAutoComplete(200, recording('auto-complete-jingle-bell-mingle').body)
  assertEquals(matchTitle({ isbn13: null, title: 'A Jingle Bell Mingle', authors: ['Julie Murphy'] }, jingle)?.bookId, '253403547')
})

Deno.test('a later volume, a summary and a translation are not the book, in the exact forms either', () => {
  const result = (title: string): AutoCompleteBook => ({
    bookId: '1', title, bookTitleBare: title, author: 'Callie Hart', rating: 4, ratingsCount: 10, coverUrl: null,
  })
  const row = (title: string) => ({ isbn13: null, title, authors: ['Callie Hart'] })
  assertEquals(matchTitle(row('Blood & Roses - Buch 1'), [result('Blood & Roses - Buch 3')]), null)
  assertEquals(matchTitle(row('Blood & Roses'), [result('Blood & Roses - Buch 3')]), null)
  assertEquals(matchTitle(row('Blood & Roses - Buch 3'), [result('Blood & Roses')]), null)
  assertEquals(matchTitle(row('Blood & Roses'), [result('Blood & Roses: Summary')]), null)
  assertEquals(matchTitle(row('Blood & Roses'), [result('Θνητοί Θεοί (Blood & Roses)')]), null)
  assertEquals(matchTitle(row('Blood & Roses - Buch 1'), [result('Blood & Roses - Buch 1')])?.bookId, '1')
})
