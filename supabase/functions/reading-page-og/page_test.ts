/**
 * What both images read out of a page or a card, without drawing anything:
 * the title, the line under it, which covers are shown and in which order, a
 * Rating as a number, and text cut to a length the image can hold.
 */
import { assertEquals } from '@std/assert'
import { clamp, pageCovers, pageSummary, pageTitle, type PublicReadingPage, ratingValue, statusLine } from './page.ts'
import { readFixture } from './test_support.ts'

const page = () => readFixture('page.json') as PublicReadingPage

Deno.test('the title is hers, or the page without a name', () => {
  assertEquals(pageTitle('Ada'), "Ada's reading")
  assertEquals(pageTitle('  Ada  '), "Ada's reading")
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
