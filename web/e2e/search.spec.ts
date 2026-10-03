import { expect, test, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { signUpMember } from '../tests/support/member'
import { emailCooldown, readMailedCode } from '../tests/support/stack'

/**
 * The search overlay's chrome on a phone (WebKit, iPhone size): the tab bar's
 * capsule turns into the palette and back (docs/MOTION.md, Search morph). The
 * flows check where each open and close ends up — which of the two has the
 * chrome, where the focus is, which page is behind — not the frames in between.
 */

/** Signs a fresh member in through the screens and lands on Library. */
async function onLibrary(page: Page) {
  const member = await signUpMember()
  await emailCooldown()
  await page.goto('/sign-in')
  await page.getByTestId('signIn.email').fill(member.email)
  await page.getByTestId('signIn.submit').click()
  await expect(page).toHaveURL(/\/verify$/)
  await page.getByTestId('verify.code').fill(await readMailedCode(member.email, 2))
  await expect(page.getByTestId('home.title')).toBeVisible()
  await page.getByTestId('shell.tab.library').click()
  await expect(page.getByTestId('library.title')).toBeVisible()
}

/** The Search tab opens the palette in the tab bar's place, with the keyboard on the query. */
async function open(page: Page) {
  await page.getByTestId('shell.tab.search').click()
  await expect(page.getByTestId('search.overlay')).toBeVisible()
  await expect(page.getByTestId('search.query')).toBeFocused()
  await expect(page.getByTestId('search.cancel')).toHaveText(en.common.cancel)
  // Once the morph is over the palette has taken the tab bar's place.
  await expect(page.getByTestId('shell.tabs')).toBeHidden()
}

/** Closed: the palette is gone, the tab bar is back as it was and Library is still the page. */
async function expectClosed(page: Page) {
  await expect(page.getByTestId('search.overlay')).toBeHidden()
  await expect(page.getByTestId('search.backdrop')).toBeHidden()
  await expect(page.getByTestId('shell.tabs')).toBeVisible()
  await expect(page.getByTestId('shell.tab.search').locator('svg')).toBeVisible()
  await expect(page.getByTestId('shell.tab.library')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('search.query')).toHaveCount(0)
  await expect(page).toHaveURL(/\/library$/)
  await expect(page.getByTestId('library.title')).toBeVisible()
}

test('the tab bar turns into the search palette and back, by every way out', async ({ page }) => {
  await onLibrary(page)

  // Cancel.
  await open(page)
  await page.getByTestId('search.cancel').click()
  await expectClosed(page)

  // A tap on the page behind.
  await open(page)
  await page.getByTestId('search.backdrop').click({ position: { x: 20, y: 120 } })
  await expectClosed(page)

  // Escape.
  await open(page)
  await page.keyboard.press('Escape')
  await expectClosed(page)

  // With the keyboard down the row shows Home and Library instead of Cancel.
  await open(page)
  await page.getByTestId('search.query').blur()
  await expect(page.getByTestId('search.cancel')).toBeHidden()
  await expect(page.getByTestId('search.tab.library')).toHaveAttribute('aria-current', 'page')
  // A swipe down let go of early settles back open; one that goes far enough closes.
  const from = (await page.getByTestId('search.empty').boundingBox())!
  const x = from.x + from.width / 2
  await page.mouse.move(x, from.y + 4)
  await page.mouse.down()
  await page.mouse.move(x, from.y + 40, { steps: 8 })
  await page.waitForTimeout(400)
  await page.mouse.up()
  await expect(page.getByTestId('search.overlay')).toBeVisible()
  await expect(page.getByTestId('shell.tabs')).toBeHidden()
  // Back where it was before the next drag starts on it.
  await expect.poll(() => page.getByTestId('search.empty').boundingBox()).toEqual(from)
  await page.mouse.move(x, from.y + 4)
  await page.mouse.down()
  await page.mouse.move(x, from.y + 160, { steps: 8 })
  await page.mouse.up()
  await expectClosed(page)
})

test('the morph can be turned around halfway, either way', async ({ page }) => {
  await onLibrary(page)

  // Closed while still opening: it goes back into the tab bar.
  await page.getByTestId('shell.tab.search').click()
  await page.keyboard.press('Escape')
  await expectClosed(page)

  // Opened again while still closing: it ends open, with the keyboard on the query.
  await open(page)
  await page.getByTestId('search.cancel').click()
  await page.getByTestId('shell.tab.search').click()
  await expect(page.getByTestId('search.overlay')).toBeVisible()
  await expect(page.getByTestId('search.query')).toBeFocused()
  await expect(page.getByTestId('shell.tabs')).toBeHidden()
  await page.getByTestId('search.cancel').click()
  await expectClosed(page)
})
