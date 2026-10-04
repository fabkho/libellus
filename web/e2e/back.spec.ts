import { expect, type Page } from '@playwright/test'
import { test } from './fixtures'
import { recordedApple, signedIn, untilStill } from './support'

/**
 * Back closes what is open instead of leaving the page (#62): Android's back
 * gesture and button, the browser's Back (here `page.goBack()`). The top-most
 * sheet, dialog, search or menu closes and the page stays; Back again leaves
 * it. Closing something with Cancel leaves no entry behind, so the next Back
 * leaves the page at once, and a change of page closes every sheet: a sheet
 * never stays open over another page. With docs/parity.md (UiSheet) this is
 * the reference for a native port's Back.
 */

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

/** Home, then Piranesi's book page from a search result, added to Want to read. */
async function onPiranesi(page: Page) {
  await page.getByTestId('shell.tab.search').click()
  await page.getByTestId('search.query').fill('Piranesi')
  await page.getByTestId('search.result').first().click()
  await expect(page.getByTestId('book.title')).toHaveText('Piranesi')
  await page.getByTestId('book.add').click()
  await page.getByTestId('add.submit').click()
  await expect(page.getByTestId('add')).toBeHidden()
  await untilStill(page)
}

/** Goes to a page as a link would, while something is open over the current one. */
const navigate = (page: Page, path: string) =>
  page.evaluate(
    (to) => (document.querySelector('#__nuxt') as unknown as { __vue_app__: any }).__vue_app__.config.globalProperties.$router.push(to),
    path,
  )

test('Back closes the open sheet and stays on the page; Back again leaves it', async ({ page }) => {
  await signedIn(page)
  await onPiranesi(page)
  const book = page.url()

  await page.getByTestId('book.options').click()
  await expect(page.getByTestId('bookOptions')).toBeVisible()
  await page.goBack()
  await expect(page.getByTestId('bookOptions')).toBeHidden()
  expect(page.url()).toBe(book)
  await expect(page.getByTestId('book.title')).toHaveText('Piranesi')

  // Closed with Cancel: its entry went with it, so one Back leaves the page.
  await page.getByTestId('book.options').click()
  await expect(page.getByTestId('bookOptions')).toBeVisible()
  await page.getByTestId('bookOptions.cancel').click()
  await expect(page.getByTestId('bookOptions')).toBeHidden()
  await untilStill(page)
  await page.goBack()
  await expect(page.getByTestId('home.title')).toBeVisible()
  await expect(page.getByTestId('bookOptions')).toBeHidden()
})

test('Back closes a confirmation first, then the sheet under it', async ({ page }) => {
  await signedIn(page)
  await onPiranesi(page)
  const book = page.url()
  await page.getByTestId('book.start').click()
  await page.getByTestId('start.submit').click()
  await expect(page.getByTestId('start')).toBeHidden()
  await untilStill(page)

  await page.getByTestId('history.edit').first().click()
  await expect(page.getByTestId('editSession')).toBeVisible()
  await page.getByTestId('editSession.delete').click()
  await expect(page.getByTestId('deleteSession')).toBeVisible()

  await page.goBack()
  await expect(page.getByTestId('deleteSession')).toBeHidden()
  await expect(page.getByTestId('editSession')).toBeVisible()
  await page.goBack()
  await expect(page.getByTestId('editSession')).toBeHidden()
  expect(page.url()).toBe(book)
  await untilStill(page)
  await page.goBack()
  await expect(page.getByTestId('home.title')).toBeVisible()
})

test('Back closes the search and the avatar menu without leaving the page', async ({ page }) => {
  await signedIn(page)
  await onPiranesi(page)
  const book = page.url()

  await page.getByTestId('shell.tab.search').click()
  await expect(page.getByTestId('search.query')).toBeVisible()
  await page.goBack()
  await expect(page.getByTestId('search.overlay')).toBeHidden()
  expect(page.url()).toBe(book)

  await page.goBack()
  await expect(page.getByTestId('home.title')).toBeVisible()
  await page.getByTestId('shell.avatar').click()
  await expect(page.getByTestId('shell.menu')).toBeVisible()
  await page.goBack()
  await expect(page.getByTestId('shell.menu')).toBeHidden()
  await expect(page.getByTestId('home.title')).toBeVisible()
})

test('a change of page closes the open sheet and leaves no entry behind', async ({ page }) => {
  await signedIn(page)
  await onPiranesi(page)
  const book = page.url()

  await page.getByTestId('book.options').click()
  await expect(page.getByTestId('bookOptions')).toBeVisible()
  await navigate(page, '/library')
  await expect(page.getByTestId('library.title')).toBeVisible()
  await expect(page.getByTestId('bookOptions')).toBeHidden()

  // Back is the book page, without its sheet; once more is Home.
  await page.goBack()
  await expect(page.getByTestId('book.title')).toHaveText('Piranesi')
  expect(page.url()).toBe(book)
  await expect(page.getByTestId('bookOptions')).toBeHidden()
  await page.goBack()
  await expect(page.getByTestId('home.title')).toBeVisible()
})
