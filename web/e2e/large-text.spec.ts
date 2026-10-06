import { expect, type Locator, type Page } from '@playwright/test'
import { createLibrary } from '../app/data/library'
import type { BookSnapshot } from '../app/data/books'
import { runTitle, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { test } from './fixtures'
import { expectNoSideScroll, openProfile, recordedApple, signedIn, untilStill } from './support'

/**
 * Text at 200 % (docs/ACCESSIBILITY.md, Text size): the root font size doubled, as an Android
 * phone's text size does. Chromium's own default font size is set (`defaultFontSize`), so that
 * `rem` and the media queries written in `rem` follow, as they do on a phone; a style on `html`
 * would move the one and not the other. Two things are held: a long figure on the Profile stays
 * inside its cell, and a Book's title in a row takes a second line where the text is large
 * (`title-wrap`, main.css) while its author keeps to one.
 */

const TITLE = 'The Wonderful Wizard of Oz and Its Many Remarkable Sequels'
const AUTHOR = 'Lyman Frank Baum and Several Other Authors of the Time'

const book = (title: string, authors: string[], pages: number): BookSnapshot => ({
  title: runTitle(title),
  authors,
  isbn13: null,
  isbn10: null,
  pageCount: pages,
  year: 1900,
  language: 'en',
  publisher: TEST_PUBLISHER,
  description: null,
  coverUrl: null,
  coverThumbhash: null,
  coverColors: null,
  source: 'apple',
  appleId: uniqueAppleId(),
  openLibraryEditionKey: null,
  openLibraryWorkKey: null,
})

/** How many lines of text a box holds. */
const linesOf = (box: Locator) =>
  box.evaluate((el) => {
    const style = getComputedStyle(el)
    return Math.round(el.getBoundingClientRect().height / parseFloat(style.lineHeight))
  })

async function seed(page: Page, client: Parameters<typeof createLibrary>[0]) {
  const library = createLibrary(client)
  const year = new Date().getFullYear()
  await library.addToLibrary(book(TITLE, [AUTHOR], 300), { status: 'finished', startedOn: `${year}-01-02`, endedOn: `${year}-01-20`, rating: 16 })
  // Pages in the tens of thousands: "29.2K", the widest figure the Profile draws.
  await library.addToLibrary(book('The Long Almanac', ['Ida Marsh'], 28900), { status: 'finished', startedOn: `${year}-02-02`, endedOn: `${year}-02-20`, rating: 14 })
  await library.addToLibrary(book(`${TITLE} (Part II)`, [AUTHOR], 300), { status: 'want_to_read' })
  await page.reload()
  await expect(page.getByTestId('home.title')).toBeVisible()
}

test.use({ browserName: 'chromium', viewport: { width: 412, height: 915 }, launchOptions: { args: ['--blink-settings=defaultFontSize=32'] } })

test('a long figure stays in its cell; a title takes a second line, its author does not', async ({ page }) => {
  await recordedApple(page)
  const member = await signedIn(page)
  await seed(page, member.client)
  expect(await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))).toBe(32)

  // The Profile: no figure is wider than its cell.
  await openProfile(page)
  await expect(page.getByTestId('profile.pages')).toHaveText('29.2K')
  const fits = await page.getByTestId('profile.figures').locator('dd.value').evaluateAll((values) =>
    values.map((dd) => {
      const cell = dd.parentElement!.getBoundingClientRect()
      const range = document.createRange()
      range.selectNodeContents(dd)
      const text = range.getBoundingClientRect()
      return { text: dd.textContent, inside: text.right <= cell.right && text.left >= cell.left }
    }),
  )
  expect(fits.filter((f) => !f.inside), 'figures that leave their cell').toEqual([])
  await expectNoSideScroll(page, 'the Profile at 200 %')

  // The Library: the title takes two lines, the author one (the rest is cut with an ellipsis).
  await page.getByTestId('shell.tab.library').click()
  await page.getByTestId('library.segment.finished').click()
  await untilStill(page)
  const row = page.getByTestId('library.entry').filter({ hasText: TITLE })
  await expect(row.getByTestId('library.entryTitle')).toBeVisible()
  expect(await linesOf(row.getByTestId('library.entryTitle'))).toBe(2)
  expect(await linesOf(row.getByText(AUTHOR))).toBe(1)
  await expectNoSideScroll(page, 'the Library at 200 %')
})
