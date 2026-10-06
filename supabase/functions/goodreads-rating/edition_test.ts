/**
 * Reading one edition out of its Goodreads book page (issue #111), on the
 * recordings in fixtures/. No request leaves the machine.
 *
 *   cd supabase/functions/goodreads-rating && deno test
 */
import { assertEquals, assertThrows } from '@std/assert'
import { bookPageUrl, isValidIsbn10, languageCode, parseEdition, parseGoodreadsId } from './edition.ts'
import { recording } from './test_support.ts'

Deno.test('the edition the export names: its ISBNs, ASIN, language, pages, binding, publisher, year', () => {
  const { status, body } = recording('book-page-small-gods')
  assertEquals(parseEdition('6388978', status, body), {
    status: 'found',
    goodreadsId: '6388978',
    // Not `titleComplete`, which carries the series: "Small Gods (Discworld, #13)".
    title: 'Small Gods',
    isbn13: '9780061803208',
    isbn10: '0061803200',
    asin: 'B000QTEA3I',
    language: 'en',
    pageCount: 26,
    format: 'Kindle Edition',
    publisher: 'HarperCollins ebooks',
    // publicationTime 1237273200000, read in UTC.
    year: 2009,
  })
})

Deno.test('the page holds other Books too: the legacyId decides which one is the edition', () => {
  const { status, body } = recording('book-page-small-gods')
  // The first `Book:` entry of the page is a stub for another book (34484).
  // Taking it for the edition would answer Small Gods with nothing at all.
  const stub = parseEdition('34484', status, body)
  assertEquals(stub.status, 'found')
  assertEquals(stub.status === 'found' && stub.title, null)
})

Deno.test('a page without the Book that was asked for is a miss', () => {
  const { status, body } = recording('book-page-no-book')
  assertEquals(parseEdition('1111111', status, body), { status: 'not_found' })
})

Deno.test('a Book Id Goodreads has no page for (404) is a miss', () => {
  assertEquals(parseEdition('99999999', 404, '<html>Page not found</html>'), { status: 'not_found' })
})

Deno.test('a failing or garbled book page throws, so it is never stored as a miss', () => {
  assertThrows(() => parseEdition('6388978', 500, 'oops'))
  assertThrows(() => parseEdition('6388978', 429, ''))
  // A page Goodreads rendered differently: unreadable, not an answer.
  assertThrows(() => parseEdition('6388978', 200, '<html><body>Small Gods</body></html>'))
  assertThrows(() =>
    parseEdition('6388978', 200, '<script id="__NEXT_DATA__" type="application/json">{nope</script>')
  )
  assertThrows(() =>
    parseEdition('6388978', 200, '<script id="__NEXT_DATA__" type="application/json">{"props":{}}</script>')
  )
})

Deno.test('an edition Goodreads knows nothing else about is still found', () => {
  const page = (book: unknown) =>
    `<script id="__NEXT_DATA__" type="application/json">${
      JSON.stringify({ props: { pageProps: { apolloState: { 'Book:kca://book/x': book } } } })
    }</script>`
  // No details at all: everything but the id is unknown, and that is an answer.
  assertEquals(parseEdition('7', 200, page({ legacyId: 7, title: 'Bare' })), {
    status: 'found',
    goodreadsId: '7',
    title: 'Bare',
    isbn13: null,
    isbn10: null,
    asin: null,
    language: null,
    pageCount: null,
    format: null,
    publisher: null,
    year: null,
  })
  // Goodreads keeps broken ISBNs and languages nobody mapped: dropped, not passed on.
  const odd = parseEdition(
    '7',
    200,
    page({
      legacyId: 7,
      title: '',
      titleComplete: 'Odd (Series, #2)',
      details: {
        isbn: '0061803201',
        isbn13: '9780061803209',
        numPages: 0,
        language: { name: 'Klingon' },
        publicationTime: null,
      },
    }),
  )
  assertEquals(odd, {
    status: 'found',
    goodreadsId: '7',
    title: 'Odd (Series, #2)',
    isbn13: null,
    isbn10: null,
    asin: null,
    language: null,
    pageCount: null,
    format: null,
    publisher: null,
    year: null,
  })
})

Deno.test('a printed edition with only an ASIN: the ASIN is its ISBN-10, and gives the ISBN-13', () => {
  const page = (details: unknown) =>
    `<script id="__NEXT_DATA__" type="application/json">${
      JSON.stringify({ props: { pageProps: { apolloState: { 'Book:kca://book/x': { legacyId: 8, title: 'Print', details } } } } })
    }</script>`
  const print = parseEdition('8', 200, page({ asin: '0061803200', format: 'Paperback' }))
  assertEquals(print.status === 'found' && [print.isbn10, print.isbn13, print.asin], ['0061803200', '9780061803208', '0061803200'])
  // A Kindle ASIN is no ISBN.
  const kindle = parseEdition('8', 200, page({ asin: 'B000QTEA3I', format: 'Kindle Edition' }))
  assertEquals(kindle.status === 'found' && [kindle.isbn10, kindle.isbn13], [null, null])
})

Deno.test('a Goodreads Book Id is up to twelve digits and nothing else', () => {
  assertEquals(parseGoodreadsId('6388978'), '6388978')
  assertEquals(parseGoodreadsId(' 6388978 '), '6388978')
  assertEquals(parseGoodreadsId('0'), '0')
  assertEquals(parseGoodreadsId('1234567890123'), null)
  assertEquals(parseGoodreadsId('6388978-small-gods'), null)
  assertEquals(parseGoodreadsId('kca://book/x'), null)
  assertEquals(parseGoodreadsId(''), null)
  assertEquals(parseGoodreadsId(null), null)
  assertEquals(bookPageUrl('6388978'), 'https://www.goodreads.com/book/show/6388978')
})

Deno.test('Goodreads names a language, the app keeps a code', () => {
  assertEquals(languageCode('English'), 'en')
  assertEquals(languageCode('german'), 'de')
  assertEquals(languageCode('Japanese'), 'ja')
  assertEquals(languageCode('Klingon'), null)
  assertEquals(languageCode(undefined), null)
})

Deno.test('an ISBN-10 is nine digits and a check digit that adds up', () => {
  assertEquals(isValidIsbn10('0061803200'), true)
  // X, the one letter an ISBN-10 has, stands for a check digit of ten.
  assertEquals(isValidIsbn10('043942089X'), true)
  assertEquals(isValidIsbn10('0061803201'), false)
  assertEquals(isValidIsbn10('006180320'), false)
  assertEquals(isValidIsbn10('9780061803208'), false)
})
