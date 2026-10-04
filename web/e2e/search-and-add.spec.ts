import { expect } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { sql } from '../tests/support/stack'
import { goto, recordedApple, signedIn, untilStill } from './support'
import { test } from './fixtures'

/**
 * The first end-to-end path (#6): search Apple Books, open a result, add it,
 * find it in Library → Want to read. Apple answers from the recordings
 * (e2e/support.ts); the Library is the real local stack. With docs/parity.md
 * this is the behavioural reference for Search, Book, the Add sheet and
 * Library.
 */

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

test('a member finds a book, opens it, adds it and sees it on Want to read', async ({ page }) => {
  // The Catalogue is shared with every other run on this stack, which may have
  // added another edition of Piranesi just now; this flow is about a Book
  // found on Apple Books, so the Catalogue answers nothing here
  // (full-search.spec.ts drives it).
  await page.route(/\/rest\/v1\/rpc\/search_books/, async (route) =>
    route.fulfill({ response: await route.fetch(), body: '[]' }),
  )
  const member = await signedIn(page)

  // An empty Library says so, with the way to search.
  await page.getByTestId('shell.tab.library').click()
  await expect(page.getByTestId('library.emptyTitle')).toHaveText(en.library.emptyTitle)

  // Search opens over the Library and asks nothing until the query is long enough.
  await page.getByTestId('shell.tab.search').click()
  await expect(page.getByTestId('search.empty')).toHaveText(en.search.empty)
  await page.getByTestId('search.query').fill('P')
  await expect(page.getByTestId('search.empty')).toBeVisible()

  // Typing on: the results arrive, best match nearest the query.
  await page.getByTestId('search.query').fill('Piranesi')
  const results = page.getByTestId('search.result')
  await expect(results.first()).toBeVisible()
  await expect(page.getByTestId('search.resultTitle').first()).toHaveText('Piranesi')
  // Both rows read in one look: the list may still re-render between two.
  const [best, second] = await results.evaluateAll((rows) => rows.slice(0, 2).map((row) => row.getBoundingClientRect().top))
  expect(best).toBeGreaterThan(second!)
  await expect(page).toHaveURL(/\/library$/)

  // Tapping the result opens its book page and closes the search.
  await results.first().click()
  await expect(page).toHaveURL(/\/book\/apple-1504159680$/)
  await expect(page.getByTestId('search.overlay')).toBeHidden()
  await expect(page.getByTestId('book.title')).toHaveText('Piranesi')
  await expect(page.getByTestId('book.authors')).toHaveText('Susanna Clarke')
  await expect(page.getByTestId('book.facts')).toContainText('2020')
  await expect(page.getByTestId('book.description')).toContainText('Piranesi')
  await expect(page.getByTestId('book.notInLibrary')).toHaveText(en.book.notInLibrary)

  // Add → the sheet offers Want to read → added; the page shows the status.
  await page.getByTestId('book.add').click()
  await expect(page.getByTestId('add')).toBeVisible()
  await expect(page.getByTestId('add.status.want_to_read')).toHaveAttribute('aria-checked', 'true')
  await page.getByTestId('add.submit').click()
  await expect(page.getByTestId('add')).toBeHidden()
  await expect(page.getByTestId('book.status')).toHaveText(en.status.want_to_read)
  await expect(page.getByTestId('book.add')).toBeHidden()

  // The cover went into the Catalogue as a large image with its thumbhash and colours.
  const [stored] = await sql<{ cover_url: string; cover_thumbhash: string | null; cover_dominant: string | null }>(
    `select b.cover_url, b.cover_thumbhash, b.cover_dominant from public.library_entries e
       join public.books b on b.id = e.book_id where e.member_id = $1`,
    [member.id],
  )
  expect(stored!.cover_url).toMatch(/\/600x900bb\.jpg$/)
  expect(stored!.cover_thumbhash).toBeTruthy()
  expect(stored!.cover_dominant).toMatch(/^#[0-9a-f]{6}$/)

  // Back to the Library, where it waits on Want to read.
  await page.getByTestId('book.back').click()
  await expect(page).toHaveURL(/\/library$/)
  await expect(page.getByTestId('library.segment.want_to_read')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('library.entryTitle')).toHaveText(['Piranesi'])

  // In search it now shows its status instead of the +.
  await page.getByTestId('shell.tab.search').click()
  await page.getByTestId('search.query').fill('Piranesi')
  await expect(page.getByTestId('search.resultStatus').first()).toHaveText(en.status.want_to_read)

  // A result's + opens the Add sheet right there; the second add lands on top.
  await page.getByTestId('search.add').first().click()
  await expect(page.getByTestId('add')).toBeVisible()
  await page.getByTestId('add.submit').click()
  await expect(page.getByTestId('add')).toBeHidden()
  // The sheet took the keyboard down (no Cancel then); Escape closes the search.
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('library.entryTitle')).toHaveCount(2)
  await expect(page.getByTestId('library.entryTitle').last()).toHaveText('Piranesi')

  // Going back keeps the place: the Library is kept alive and its scroll
  // position restored (a short screen, so two Books scroll). Once the second
  // Book has opened its room: it comes in after the sheet has left, and a
  // scroll measured mid-way is not where the page ends.
  await untilStill(page)
  await page.setViewportSize({ width: 393, height: 360 })
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  const scrolled = await page.evaluate(() => window.scrollY)
  expect(scrolled).toBeGreaterThan(0)
  await page.getByTestId('library.entry').last().click()
  await expect(page.getByTestId('book.status')).toHaveText(en.status.want_to_read)
  await page.getByTestId('book.back').click()
  await expect(page).toHaveURL(/\/library$/)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrolled)

  // The other segments explain themselves.
  await page.getByTestId('library.segment.reading').click()
  await expect(page.getByTestId('library.segmentEmpty.reading')).toBeVisible()
})

test('a search that finds nothing says so', async ({ page }) => {
  await signedIn(page)
  await page.getByTestId('shell.tab.search').click()
  await page.getByTestId('search.query').fill('qxzvwlmbrt')
  await expect(page.getByTestId('search.noResults')).toContainText(en.search.noResultsTitle)
})

test('a book page opened from a link asks for the book again', async ({ page }) => {
  await signedIn(page)
  await goto(page, '/book/apple-1504159680')
  await expect(page.getByTestId('book.title')).toHaveText('Piranesi')
  await page.getByTestId('book.back').click()
  await expect(page).toHaveURL(/\/library$/)
})
