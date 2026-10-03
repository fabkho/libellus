import { expect, test } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { sql } from '../tests/support/stack'
import { recordedApple, signedIn } from './support'

/**
 * Manual books (#13): a search that finds nothing links to the manual-book
 * form; the Book it makes is the member's own, on Want to read, with a
 * generated cover. Apple answers from the recordings (e2e/support.ts); the
 * Library is the real local stack.
 */

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

test('a member adds a book by hand when search finds nothing and sees it in the Library', async ({ page }) => {
  const member = await signedIn(page)
  const query = 'qxzvwlmbrt'

  await page.getByTestId('shell.tab.library').click()
  // On the Library before searching: a route change closes the search.
  await expect(page).toHaveURL(/\/library$/)
  await page.getByTestId('shell.tab.search').click()
  await page.getByTestId('search.query').fill(query)
  await expect(page.getByTestId('search.noResults')).toContainText(en.search.noResultsTitle)

  // The way out of the dead end: the form opens with what was typed as the title.
  await page.getByTestId('search.addManually').click()
  await expect(page.getByTestId('manual')).toBeVisible()
  await expect(page.getByTestId('manual.title')).toHaveValue(query)
  await expect(page.getByTestId('manual.private')).toHaveText(en.manual.private)

  // Title and author are required; a wrong ISBN or page count is named, nothing is sent.
  await page.getByTestId('manual.submit').click()
  await expect(page.getByTestId('manual.invalid')).toHaveText(en.manual.invalid.author)
  await page.getByTestId('manual.author').fill('Ida Beispiel')
  await page.getByTestId('manual.isbn').fill('9783161484101')
  await page.getByTestId('manual.submit').click()
  await expect(page.getByTestId('manual.invalid')).toHaveText(en.manual.invalid.isbn)
  await page.getByTestId('manual.isbn').fill('978-3-16-148410-0')
  await page.getByTestId('manual.pageCount').fill('312')
  await expect(page.getByTestId('manual.invalid')).toBeHidden()

  // The title can be changed, and the preview cover follows it.
  await page.getByTestId('manual.title').fill('Meine Notizen')
  await expect(page.getByTestId('manual.cover').getByRole('img', { name: 'Meine Notizen' })).toBeVisible()

  await page.getByTestId('manual.action').click()
  await expect(page.getByTestId('manual')).toBeHidden()

  // Its page opens, the search is over, and the book is on Want to read.
  await expect(page).toHaveURL(/\/book\/[0-9a-f-]{36}$/)
  await expect(page.getByTestId('search.overlay')).toBeHidden()
  await expect(page.getByTestId('book.title')).toHaveText('Meine Notizen')
  await expect(page.getByTestId('book.authors')).toHaveText('Ida Beispiel')
  await expect(page.getByTestId('book.status')).toHaveText(en.status.want_to_read)

  await page.getByTestId('book.back').click()
  await expect(page).toHaveURL(/\/library$/)
  await expect(page.getByTestId('library.entryTitle')).toHaveText(['Meine Notizen'])
  // No image: the entry wears the generated cover, title and author on cloth.
  const cover = page.getByTestId('library.entry').getByRole('img', { name: 'Meine Notizen' })
  await expect(cover).toBeVisible()
  await expect(cover).toContainText('Ida Beispiel')

  // It is the member's own Manual book, and in nobody's Catalogue.
  const [stored] = await sql<{ source: string; owner_id: string; isbn13: string; page_count: number }>(
    `select b.source, b.owner_id, b.isbn13, b.page_count from public.library_entries e
       join public.books b on b.id = e.book_id where e.member_id = $1`,
    [member.id],
  )
  expect(stored).toEqual({ source: 'manual', owner_id: member.id, isbn13: '9783161484100', page_count: 312 })
})

test('an ISBN that finds nothing fills the ISBN of the form', async ({ page }) => {
  await signedIn(page)
  await page.getByTestId('shell.tab.search').click()
  await page.getByTestId('search.query').fill('9783161484100')
  await page.getByTestId('search.addManually').click()
  await expect(page.getByTestId('manual.isbn')).toHaveValue('9783161484100')
  await expect(page.getByTestId('manual.title')).toHaveValue('')

  // Cancel leaves the search as it was.
  await page.getByTestId('manual.cancel').click()
  await expect(page.getByTestId('manual')).toBeHidden()
  await expect(page.getByTestId('search.query')).toHaveValue('9783161484100')
})
