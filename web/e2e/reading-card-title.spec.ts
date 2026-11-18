import { expect, type Page } from '@playwright/test'
import { test } from './fixtures'
import { recordedApple, signedIn, untilStill } from './support'

/**
 * The reading card's title takes one line, so every card on the screen is the same height (the owner's requirement,
 * 2026-11-18). `line-clamp-2` let a long title wrap onto a second line and grew that card by a whole line — measured at
 * 178 px against 154 — which left two cards' covers at different heights and made the list ragged.
 *
 * The long title is a recorded Apple result, so nothing is invented for the fixture. The short one alone proves nothing:
 * 'Piranesi' fits any card, so the assertion has to be about the pair.
 */
test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

/** Search a recorded result, add it and start reading it. Returns once the Start sheet has closed. */
async function addAndRead(page: Page, pick: (results: ReturnType<Page['getByTestId']>) => ReturnType<Page['getByTestId']>) {
  await page.getByTestId('shell.tab.search').click()
  await page.getByTestId('search.query').fill('Piranesi')
  await pick(page.getByTestId('search.result')).first().click()
  await page.getByTestId('book.add').click()
  await page.getByTestId('add.submit').click()
  await expect(page.getByTestId('add')).toBeHidden()
  await page.getByTestId('book.start').click()
  await page.getByTestId('start.submit').click()
  await expect(page.getByTestId('start')).toBeHidden()
}

test('two cards being read are the same height, and a long title is one line', async ({ page }) => {
  await signedIn(page)
  // The short one, then the one whose title cannot fit: 'Decline and Fall of the Roman Empire: The Modern Library
  // Collection (Complete and Unabridged)'.
  await addAndRead(page, (results) => results.nth(0))
  await addAndRead(page, (results) => results.filter({ hasText: 'Decline and Fall of the Roman Empire: The Modern' }))

  await page.getByTestId('shell.tab.library').click()
  await page.getByTestId('library.segment.reading').click()
  await untilStill(page)
  const cards = page.getByTestId('library.readingCard')
  await expect(cards).toHaveCount(2)

  // The titles are the two we added, so the measurement is of the pair and not of one card twice.
  const titles = await page.getByTestId('library.entryTitle').allInnerTexts()
  expect(titles.join(' | ')).toContain('Decline and Fall')

  const heights = await Promise.all([0, 1].map(async (i) => Math.round((await cards.nth(i).boundingBox())!.height)))
  expect(heights[0], `the two cards are the same height (${heights.join(' vs ')})`).toBe(heights[1])

  // And the long title is one line box, not two: asked of the box rather than of the class that draws it.
  const long = page.getByTestId('library.entryTitle').filter({ hasText: 'Decline and Fall' })
  const line = await long.evaluate((el) => Number.parseFloat(getComputedStyle(el).lineHeight))
  expect((await long.boundingBox())!.height, 'the long title is one line').toBeLessThanOrEqual(line + 1)
  // Cut with an ellipsis rather than hidden: it overflows its box without wrapping.
  expect(await long.evaluate((el) => el.scrollWidth > el.clientWidth), 'the long title is cut').toBe(true)
})
