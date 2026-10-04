import { expect, type Page } from '@playwright/test'
import { recordedApple, signedIn, untilStill } from './support'
import { test } from './fixtures'

/**
 * The tab bar on pushed screens (#82, composables/useHideOnScroll.ts): on a
 * book page it slides away while the member scrolls down, comes back on a
 * short scroll up, and is there at the end of the page and at the top. Tab
 * roots keep it. Search opens from a bar that is away (the bar is back in its
 * place for the morph and stays after closing), a sheet brings it back and
 * keeps it, and Back lands with it showing. Apple answers from the recordings
 * (e2e/support.ts); the Library is the real local stack.
 *
 * The page is scrolled one step per frame, so every step is a scroll event of
 * its own, as a finger's would be.
 */

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

const tabs = (page: Page) => page.getByTestId('shell.tabs')

/** Scrolls by `by` px in steps of `step`, one per frame. */
async function scroll(page: Page, by: number, step = 40) {
  await page.evaluate(
    async ({ by, step }) => {
      const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))
      const target = window.scrollY + by
      for (let y = window.scrollY; Math.abs(target - y) > 0; ) {
        y = by > 0 ? Math.min(target, y + step) : Math.max(target, y - step)
        window.scrollTo(0, y)
        await frame()
      }
      await frame()
    },
    { by, step },
  )
}

async function scrollToEnd(page: Page) {
  await page.evaluate(async () => {
    window.scrollTo(0, document.documentElement.scrollHeight)
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
}

async function expectAway(page: Page) {
  await expect(tabs(page)).toHaveAttribute('data-away', 'true')
  // Off the screen once it has slid away, and out of reach.
  const height = page.viewportSize()!.height
  await expect.poll(async () => (await tabs(page).boundingBox())!.y).toBeGreaterThanOrEqual(height)
  await expect(tabs(page)).toHaveCSS('opacity', '0')
}

async function expectShown(page: Page) {
  await expect(tabs(page)).not.toHaveAttribute('data-away')
  await expect(tabs(page)).toHaveCSS('opacity', '1')
  await expect(tabs(page)).toBeInViewport({ ratio: 1 })
}

async function openPiranesi(page: Page) {
  await page.getByTestId('shell.tab.search').click()
  await page.getByTestId('search.query').fill('Piranesi')
  await page
    .getByTestId('search.result')
    .filter({ has: page.getByTestId('search.resultTitle').getByText('Piranesi', { exact: true }) })
    .first()
    .click()
  await expect(page.getByTestId('book.title')).toHaveText('Piranesi')
  await untilStill(page)
}

test('on a book page the tab bar slides away scrolling down and returns scrolling up, at the end and at the top', async ({
  page,
}) => {
  // A short window: the book page scrolls a good way past a screen.
  await page.setViewportSize({ width: 393, height: 360 })
  await signedIn(page)

  // A tab root keeps it, however far it scrolls.
  await page.getByTestId('shell.tab.library').click()
  await untilStill(page)
  await scroll(page, 200)
  await expectShown(page)

  await openPiranesi(page)
  await expectShown(page)

  // A few pixels are not a scroll: it stays.
  await scroll(page, 6, 3)
  await expectShown(page)

  // Down: away.
  await scroll(page, 120)
  await expectAway(page)

  // Up a little, less than the intent: still away. A little more: back.
  await scroll(page, -6, 3)
  await expect(tabs(page)).toHaveAttribute('data-away', 'true')
  await scroll(page, -20, 5)
  await expectShown(page)

  // Down again, then to the very end of the page: back at the end.
  await scroll(page, 60)
  await expectAway(page)
  await scrollToEnd(page)
  await expectShown(page)

  // Away again on the way up from the end? No: up shows. Down from the middle hides, the top shows.
  await scroll(page, -200)
  await expectShown(page)
  await scroll(page, 80)
  await expectAway(page)
  await page.evaluate(() => window.scrollTo(0, 0))
  await expectShown(page)

  // Back with the bar away: the page it lands on has it.
  await scroll(page, 120)
  await expectAway(page)
  await page.goBack()
  await expect(page.getByTestId('library.title')).toBeVisible()
  await expectShown(page)
})

test('search opens from a tab bar that is away, and the bar is back after it closes; a sheet keeps it', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 360 })
  await signedIn(page)
  await openPiranesi(page)

  await scroll(page, 160)
  await expectAway(page)

  // Search, opened while the bar is away (as from a page's own search prompt):
  // the bar is back in its place at once, so the palette grows out of it.
  await page.getByTestId('shell.tab.search').dispatchEvent('click')
  await expect(page.getByTestId('search.query')).toBeFocused()
  await expect(tabs(page)).not.toHaveAttribute('data-away')
  await page.getByTestId('search.cancel').click()
  await expect(page.getByTestId('search.query')).toBeHidden()
  await expectShown(page)

  // Away again, then a sheet: the bar
  // comes back and stays while it is open.
  await scroll(page, -150)
  await scroll(page, 160)
  await expectAway(page)
  await page.getByTestId('book.addToCollection').dispatchEvent('click')
  await expect(page.getByTestId('picker')).toBeVisible()
  await expect(tabs(page)).not.toHaveAttribute('data-away')
  await untilStill(page)
  await expect(tabs(page)).not.toHaveAttribute('data-away')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('picker')).toBeHidden()
  await expectShown(page)
})
