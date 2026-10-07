import { expect } from '@playwright/test'
import { createCollections } from '../app/data/collections'
import { createLibrary } from '../app/data/library'
import type { BookSnapshot } from '../app/data/books'
import { runTitle, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { test } from './fixtures'
import { expectNoSideScroll, goto, recordedApple, signedIn, untilStill } from './support'

/**
 * The page never scrolls or bounces sideways (docs/DESIGN.md, The page does not scroll
 * sideways). On a phone as narrow as the narrowest in use (360 px) no main screen is wider
 * than the viewport, and the page keeps still when something that is wider is put into it:
 * main.css clips the x axis of `html` and `body`, and the inner rows (the year cards, Regal's
 * shelf row) still scroll sideways inside themselves. The owner's Profile, with her shelf, is
 * in e2e/shelf.spec.ts. Apple answers from the recordings (e2e/support.ts).
 */

test.use({ viewport: { width: 360, height: 800 } })

const WORD = 'Pneumonoultramicroscopicsilicovolcanoconiosis'

const book = (title: string, authors: string[]): BookSnapshot => ({
  title: runTitle(title),
  authors,
  isbn13: null,
  isbn10: null,
  pageCount: 412,
  year: 2024,
  language: 'en',
  publisher: TEST_PUBLISHER,
  description: `${WORD}${WORD} ${'and some words '.repeat(20)}`,
  coverUrl: null,
  coverThumbhash: null,
  coverColors: null,
  source: 'apple',
  appleId: uniqueAppleId(),
  openLibraryEditionKey: null,
  openLibraryWorkKey: null,
})

test('no main screen is wider than a 360 px phone, and the page keeps still under something that is', async ({ page }) => {
  await recordedApple(page)
  const member = await signedIn(page)
  // A Library with every kind of row, one with a title that is a single long word.
  const library = createLibrary(member.client)
  const year = new Date().getFullYear()
  const reading = (await library.addToLibrary(book(`${WORD}${WORD}`, [`${WORD}${WORD}`, 'Mira Holloway']), { status: 'reading', startedOn: `${year}-01-05` })).data!
  await library.addToLibrary(book('A Book to read', ['Mira Holloway']), { status: 'want_to_read' })
  await library.addToLibrary(book('The Glass Orchard', ['Mira Holloway']), { status: 'finished', startedOn: '2025-03-01', endedOn: '2025-03-20', rating: 18 })
  const read = (await library.addToLibrary(book('The Salt Road', ['Ida Marsh']), { status: 'finished', startedOn: `${year}-01-10`, endedOn: `${year}-01-25`, rating: 14, review: `${WORD}${WORD}` })).data!
  const collections = createCollections(member.client)
  const shelf = (await collections.create(`A${WORD}Z`)).data!
  await collections.addEntry(shelf.id, { id: reading.book.id })

  await page.goto('/')
  await expect(page.getByTestId('home.title')).toBeVisible()
  await untilStill(page)
  await expectNoSideScroll(page, 'Home')

  await page.goto('/library')
  await expect(page.getByTestId('library.segment.reading')).toBeVisible()
  await untilStill(page)
  await expectNoSideScroll(page, 'Library')
  await page.getByTestId('library.segment.finished').click()
  await untilStill(page)
  await expectNoSideScroll(page, 'Library, Finished')

  await page.goto('/collections')
  await expect(page.getByTestId('collections.list')).toBeVisible()
  await untilStill(page)
  await expectNoSideScroll(page, 'Collections')
  await page.goto(`/collections/${shelf.id}`)
  await untilStill(page)
  await expectNoSideScroll(page, 'A collection')

  // At rest first (support.ts, goto): a load that starts while the page is still arriving is lost.
  await goto(page, '/')
  await page.getByTestId('shell.tab.search').click()
  await page.getByTestId('search.query').fill('Piranesi')
  await expect(page.getByTestId('search.result').first()).toBeVisible()
  await untilStill(page)
  await expectNoSideScroll(page, 'Search, open')
  await page.keyboard.press('Escape')

  await page.goto(`/book/${reading.book.id}`)
  await expect(page.getByTestId('book.title')).toBeVisible()
  await untilStill(page)
  await expectNoSideScroll(page, 'Book page')
  await page.getByTestId('book.finish').click()
  await untilStill(page)
  await expectNoSideScroll(page, 'Book page, Finish sheet open')

  await page.goto(`/book/${read.book.id}`)
  await expect(page.getByTestId('book.title')).toBeVisible()
  await untilStill(page)
  await expectNoSideScroll(page, 'Book page, finished, with a review')

  await page.goto('/profile')
  await expect(page.getByTestId('profile.yearCards')).toBeVisible()
  await untilStill(page)
  await expectNoSideScroll(page, 'Profile')
  await page.getByTestId('profile.stars.4').click()
  await expect(page.getByTestId('profileReads.sheetTitle')).toBeVisible()
  await untilStill(page)
  await expectNoSideScroll(page, 'Profile, a sheet open')
  await page.keyboard.press('Escape')

  await page.goto(`/profile/${year}`)
  await expect(page.getByTestId('yearInReview.months')).toBeVisible()
  await untilStill(page)
  await expectNoSideScroll(page, 'Year in review')

  // The year cards are wider than the screen and scroll sideways inside themselves; the page stays.
  await page.goto('/profile')
  const cards = page.getByTestId('profile.yearCards').locator('div.overflow-x-auto')
  await expect(cards).toBeVisible()
  await cards.scrollIntoViewIfNeeded()
  expect(await cards.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  await cards.evaluate((el) => el.scrollTo({ left: el.scrollWidth }))
  await expect.poll(() => cards.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
  await expectNoSideScroll(page, 'Profile, year cards scrolled')

  // The net: anything wider than the screen that finds its way into a page is cut off at the
  // screen's edge. The document is not wider and the page does not move sideways.
  await page.evaluate(() => {
    const wide = document.createElement('div')
    wide.style.cssText = 'width: 200vw; height: 4px'
    wide.dataset.testid = 'test.wide'
    document.querySelector('main')!.append(wide)
  })
  const net = await page.evaluate(() => {
    window.scrollTo(120, 0)
    const root = document.documentElement
    return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, scrollX: window.scrollX }
  })
  expect(net.scrollWidth).toBeLessThanOrEqual(net.clientWidth)
  expect(net.scrollX).toBe(0)
  // Overscroll at the page's edge is not the browser's to use sideways; up and down it still is.
  expect(await page.evaluate(() => [getComputedStyle(document.documentElement).overscrollBehaviorX, getComputedStyle(document.documentElement).overscrollBehaviorY])).toEqual(['none', 'auto'])
  // Sticky still holds: `body` clips, it does not become a scroll container.
  expect(await page.evaluate(() => getComputedStyle(document.body).overflowY)).toBe('visible')
})
