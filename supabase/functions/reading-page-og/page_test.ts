/**
 * What both images read out of a page or a card, without drawing anything:
 * the title, the line under it, which covers are shown and in which order, a
 * Rating as a number, and text cut to a length the image can hold.
 */
import { assertEquals } from '@std/assert'
import {
  bookTitle,
  clamp,
  isOutside,
  OUTSIDE_CATALOGUE,
  pageCovers,
  pageSummary,
  pageTitle,
  type PublicBook,
  type PublicBookCard,
  type PublicReadingPage,
  ratingValue,
  shownReview,
  statusLine,
} from './page.ts'
import { readFixture } from './test_support.ts'

const page = () => readFixture('page.json') as PublicReadingPage

Deno.test('the title is hers, or the page without a name', () => {
  assertEquals(pageTitle('Ada'), "Ada’s reading")
  assertEquals(pageTitle('  Ada  '), "Ada’s reading")
  assertEquals(pageTitle(null), 'A reading page')
  assertEquals(pageTitle('   '), 'A reading page')
})

Deno.test('the line under it says what the page shows, and never nothing', () => {
  assertEquals(pageSummary(page()), 'Reading Piranesi · 12 books in 2026')
  const sections = { reading: false, year: false, favourites: false, finished: false, shelf: false }
  assertEquals(pageSummary({ name: null, sections }), 'A shelf to look at')
  assertEquals(
    pageSummary({ name: null, sections, year: { ...page().year!, books: 1 } }),
    '1 book in 2026',
  )
})

Deno.test('the covers are what she reads now first, then the rest, each Book once', () => {
  const covers = pageCovers(page(), 5)
  assertEquals(covers.map((book) => book.title), [
    'Piranesi',
    'Small Gods',
    'A Book Nobody Photographed, With A Very Long Title Indeed',
    'The Left Hand of Darkness',
    'Ça & “Ünïcode”',
  ])
  assertEquals(pageCovers(page(), 2).length, 2)
})

Deno.test('a Rating is read in stars, or there is none', () => {
  assertEquals(ratingValue(20), '5')
  assertEquals(ratingValue(18), '4.5')
  assertEquals(ratingValue(15), '3.75')
  assertEquals(ratingValue(null), null)
  assertEquals(ratingValue(0), null)
  assertEquals(ratingValue(21), null)
})

Deno.test('a card without a Rating says where the Book stands', () => {
  const card = { name: null, book: page().reading![0].book, ended_on: null, rating: null, review: null }
  assertEquals(statusLine({ ...card, status: 'reading' }), 'Reading now')
  assertEquals(statusLine({ ...card, status: 'want_to_read' }), 'Wants to read')
  assertEquals(statusLine({ ...card, status: 'finished' }), 'Finished')
})

Deno.test('text is cut at a word, with an ellipsis, and left alone when it fits', () => {
  assertEquals(clamp('Small Gods', 20), 'Small Gods')
  assertEquals(clamp('  Small   Gods ', 20), 'Small Gods')
  assertEquals(clamp('The Left Hand of Darkness', 15), 'The Left Hand…')
  // No word boundary to cut at: the word itself is cut.
  assertEquals(clamp('Donaudampfschifffahrtsgesellschaft', 10), 'Donaudampf…')
})

const card = () => readFixture('card.json') as PublicBookCard

Deno.test('a review folded or flagged for spoilers is never drawn; an ordinary one is (social v2a, finding 2)', () => {
  assertEquals(shownReview({ ...card(), folded: false, spoilers: false }), card().review)
  assertEquals(shownReview({ ...card(), review: null }), null)
  assertEquals(shownReview({ ...card(), review: '   ' }), null)
  assertEquals(shownReview({ ...card(), folded: true, spoilers: true }), null)
  // The image is a visitor without a sign-in, cached for everyone: a flag alone is enough to keep it off.
  assertEquals(shownReview({ ...card(), spoilers: true, folded: false }), null)
  assertEquals(shownReview({ ...card(), spoilers: false, folded: true }), null)
})

Deno.test('an unverified Book is "Outside the catalogue", with no title of its own (social v2a, finding 4)', () => {
  const unverified: PublicBook = {
    id: 'u1',
    title: null,
    authors: null,
    published_year: null,
    cover_url: null,
    cover_thumbhash: null,
    cover_dominant: null,
    cover_secondary: null,
    unverified: true,
  }
  assertEquals(bookTitle(unverified), OUTSIDE_CATALOGUE)
  assertEquals(isOutside(unverified), true)
  assertEquals(isOutside(page().reading![0].book), false)
  assertEquals(bookTitle(page().reading![0].book), 'Piranesi')
  // The line under the page's title never names it, and never reads "Reading null".
  const sections = { reading: true, year: false, favourites: false, finished: false, shelf: false }
  assertEquals(pageSummary({ name: null, sections, reading: [{ book: unverified, started_on: null }] }), 'Reading a book outside the catalogue')
})
