import { expect, type Page } from '@playwright/test'
import { signedIn } from './support'
import { test } from './fixtures'

/**
 * The chrome against the device's edges (#58). A browser tab reports no top
 * inset, so the header's controls row keeps `barTop` off the top edge instead of
 * touching the browser's toolbar; the installed iOS app's status bar inset is
 * larger and wins. Outside iOS the tab bar floats `floatAbove` above the bottom
 * inset — Android's navigation fills it (24 px in Chrome on a Pixel with gesture
 * navigation, e2e/android/smoke.ts) — and its fade and the room under the page
 * follow it. Playwright reports no insets, so the device's are stood in through
 * the `--safe-area-*` properties main.css reads them into. (The iOS placement,
 * `tabBarDrop` into the home-indicator inset, only applies in WebKit on an
 * iPhone: docs/TESTING.md.)
 */

async function insets(page: Page, top: number, bottom: number) {
  await page.addStyleTag({ content: `:root { --safe-area-top: ${top}px; --safe-area-bottom: ${bottom}px; }` })
}

const token = (page: Page, name: string) =>
  page.evaluate((property) => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(property)), name)

const fromBottom = async (page: Page, testid: string) => {
  const box = (await page.getByTestId(testid).boundingBox())!
  return Math.round(page.viewportSize()!.height - (box.y + box.height))
}

const paddingTop = (page: Page, testid: string) =>
  page.getByTestId(testid).evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingTop))

test('the header and the tab bar keep clear of the browser and of Android navigation', async ({ page }) => {
  await signedIn(page)
  const [barTop, floatAbove, tabBar, fadeAbove] = await Promise.all(
    ['--spacing-bar-top', '--spacing-float-above', '--size-tab-bar', '--size-fade-above'].map((name) => token(page, name)),
  )

  // A Chrome tab with gesture navigation: no top inset, a 24 px navigation inset.
  await insets(page, 0, 24)
  expect(await paddingTop(page, 'shell.header')).toBe(barTop)
  await expect.poll(() => fromBottom(page, 'shell.tabs')).toBe(24 + floatAbove)
  const fade = await page.locator('.fade').evaluate((element) => element.getBoundingClientRect().height)
  expect(Math.round(fade)).toBe(24 + floatAbove + tabBar + fadeAbove)

  // The search palette rests where the tab bar was.
  await page.getByTestId('shell.tab.search').click()
  await expect(page.getByTestId('search.overlay')).toBeVisible()
  await expect.poll(() => fromBottom(page, 'search.overlay')).toBe(24 + floatAbove)
  await page.getByTestId('search.cancel').click()

  // Three-button navigation (the page ends above the buttons): floatAbove off the edge.
  await insets(page, 0, 0)
  await expect.poll(() => fromBottom(page, 'shell.tabs')).toBe(floatAbove)

  // Under a status bar taller than barTop (the installed iOS app): the inset wins.
  await insets(page, 59, 0)
  expect(await paddingTop(page, 'shell.header')).toBe(59)
})
