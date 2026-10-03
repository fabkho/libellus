import { expect, type Page } from '@playwright/test'
import { signedIn } from './support'
import { test } from './fixtures'

/**
 * The tabs keep their place, as on iOS (utils/tabPlaces.ts, app/router.options.ts):
 * Home and Library each open where the member left them, back still returns to
 * where the browser saved, and the tab already showing, tapped again, goes back
 * to its top. A short window makes a new member's empty pages scrollable.
 */

const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY))

/** Scrolls the page as far down as it goes (and settles); returns where it ended. */
async function scrollToEnd(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect.poll(() => scrollY(page)).toBeGreaterThan(40)
  return scrollY(page)
}

test('each tab opens where it was left, and the current tab tapped again goes to its top', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 420 })
  await signedIn(page)
  await expect(page.getByTestId('home.emptyTitle')).toBeVisible()

  const home = await scrollToEnd(page)

  // Library has not been scrolled yet: it opens at its top.
  await page.getByTestId('shell.tab.library').click()
  await expect(page.getByTestId('library.title')).toBeVisible()
  await expect.poll(() => scrollY(page)).toBe(0)
  const library = await scrollToEnd(page)

  // Home again: where it was left.
  await page.getByTestId('shell.tab.home').click()
  await expect(page.getByTestId('home.title')).toBeVisible()
  await expect.poll(() => scrollY(page)).toBe(home)

  // Home tapped while it is showing: back to the top, still on Home.
  await page.getByTestId('shell.tab.home').click()
  await expect.poll(() => scrollY(page)).toBe(0)
  await expect(page).toHaveURL(/\/$/)

  // Library: where it was left, even though Home moved since.
  await page.getByTestId('shell.tab.library').click()
  await expect(page.getByTestId('library.title')).toBeVisible()
  await expect.poll(() => scrollY(page)).toBe(library)

  // Back returns to Home where the browser saved it (its top, after the tap).
  await page.goBack()
  await expect(page.getByTestId('home.title')).toBeVisible()
  await expect.poll(() => scrollY(page)).toBe(0)
})
