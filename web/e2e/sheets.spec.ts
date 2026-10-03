import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { test } from './fixtures'
import { recordedApple, settledBox, signedIn } from './support'

/**
 * What every sheet and confirmation does to the rest of the app (issue #49,
 * audit items 11, 13 and 14): while one is open the page is out of reach
 * (`inert`) and does not scroll, focus is inside it, and closing gives focus
 * back to what opened it; a dialog over a sheet shuts the sheet too. A long
 * title truncates centred between Cancel and the action. A sheet with one
 * field opens with the field focused. With docs/parity.md (UiSheet, UiConfirm)
 * this is the reference for a native port's modal behaviour.
 */

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

/** Adds Piranesi to Want to read and stays on its book page. */
async function addPiranesi(page: Page) {
  await page.getByTestId('shell.tab.search').click()
  await page.getByTestId('search.query').fill('Piranesi')
  await page.getByTestId('search.result').first().click()
  await expect(page.getByTestId('book.title')).toHaveText('Piranesi')
  await page.getByTestId('book.add').click()
  await page.getByTestId('add.submit').click()
  await expect(page.getByTestId('add')).toBeHidden()
}

/** Whether focus is inside the element with this test ID. */
const focusIn = (page: Page, testid: string) =>
  page.evaluate((id) => Boolean(document.querySelector(`[data-testid="${id}"]`)?.contains(document.activeElement)), testid)

test('a sheet shuts the page while it is open and gives focus back to what opened it', async ({ page }) => {
  await signedIn(page)
  await addPiranesi(page)
  const app = page.locator('#__nuxt')

  // Opened from the keyboard, so the ⋯ button has focus when it opens.
  await page.getByTestId('book.options').focus()
  await page.keyboard.press('Enter')
  const sheet = page.getByTestId('bookOptions')
  await expect(sheet).toBeVisible()

  // "Options" over the book it is about, not the book's title squeezed in.
  await expect(page.getByTestId('bookOptions.sheetTitle')).toHaveText(en.bookOptions.title)
  await expect(sheet).toContainText('Piranesi')

  // Focus is inside, the page is out of reach and does not scroll.
  await expect.poll(() => focusIn(page, 'bookOptions')).toBe(true)
  await expect(app).toHaveAttribute('inert', '')
  await expect(page.locator('html')).toHaveCSS('overflow', 'hidden')
  // Tab never lands on the page behind it (it stays in the sheet, or leaves for the browser).
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => Boolean(document.getElementById('__nuxt')?.contains(document.activeElement)))).toBe(false)
  }

  // Escape closes it: the page is back and ⋯ has focus again.
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await expect(app).not.toHaveAttribute('inert')
  await expect(page.locator('html')).not.toHaveCSS('overflow', 'hidden')
  await expect(page.getByTestId('book.options')).toBeFocused()
})

test('a confirmation over a sheet shuts the sheet too, and gives it back when it closes', async ({ page }) => {
  await signedIn(page)
  await addPiranesi(page)
  await page.getByTestId('book.start').click()
  await page.getByTestId('start.submit').click()
  await expect(page.getByTestId('start')).toBeHidden()

  // The read's edit sheet, then its Delete confirmation over it.
  await page.getByTestId('history.edit').first().click()
  const sheet = page.getByTestId('editSession')
  await expect(sheet).toBeVisible()
  await page.getByTestId('editSession.delete').click()
  const dialog = page.getByTestId('deleteSession')
  await expect(dialog).toBeVisible()
  await expect.poll(() => focusIn(page, 'deleteSession')).toBe(true)
  await expect(sheet).toHaveAttribute('inert', '')
  await expect(page.locator('#__nuxt')).toHaveAttribute('inert', '')

  // Cancel: the sheet takes part again (the page stays shut under it), focus back on Delete.
  await page.getByTestId('deleteSession.cancel').click()
  await expect(dialog).toBeHidden()
  await expect(sheet).not.toHaveAttribute('inert')
  await expect(page.locator('#__nuxt')).toHaveAttribute('inert', '')
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await expect(page.locator('#__nuxt')).not.toHaveAttribute('inert')
})

test('a long sheet title truncates centred, and a name sheet opens with its field focused', async ({ page }) => {
  await signedIn(page)
  await addPiranesi(page)
  const name = 'Summer by the lake, the long ones I keep meaning to start'

  await page.goto('/collections')
  await page.getByTestId('collections.new').click()
  // The field has focus as the sheet opens (in the tap, so iOS raises the keyboard).
  await expect(page.getByTestId('collectionName.input')).toBeFocused()
  await page.keyboard.type(name)
  await page.keyboard.press('Enter')
  await page.getByTestId('collections.item').first().click()

  await page.getByTestId('collection.more').click()
  const title = page.getByTestId('collectionOptions.sheetTitle')
  await expect(title).toHaveText(name)
  const box = await settledBox(page.getByTestId('collectionOptions'))
  const titleBox = (await title.boundingBox())!
  const cancelBox = (await page.getByTestId('collectionOptions.cancel').boundingBox())!
  // One line, cut short with an ellipsis rather than pushing Cancel aside.
  expect(await title.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  expect(titleBox.x).toBeGreaterThan(cancelBox.x + cancelBox.width)
  // Centred on the sheet, give or take a pixel.
  expect(Math.abs(titleBox.x + titleBox.width / 2 - (box.x + box.width / 2))).toBeLessThanOrEqual(1)
})
