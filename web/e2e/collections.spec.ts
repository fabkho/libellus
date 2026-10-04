import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { sql } from '../tests/support/stack'
import { goto, recordedApple, signedIn } from './support'
import { test } from './fixtures'

/**
 * Collections (#14): a Book from search goes on a new Collection from its page
 * (and into the Library with it), a second one joins it, the two swap places
 * by dragging and by the keyboard, and the Collection is renamed and deleted
 * while the Books stay in the Library. Apple answers from the recordings
 * (e2e/support.ts); the Library is the real local stack.
 */

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

async function openResult(page: Page, title: string | RegExp) {
  await page.getByTestId('shell.tab.search').click()
  await page.getByTestId('search.query').fill('Piranesi')
  await page.getByTestId('search.result').filter({ has: page.getByTestId('search.resultTitle').getByText(title, { exact: true }) }).first().click()
  await expect(page.getByTestId('book.title')).toHaveText(title)
}

const titles = (page: Page) => page.getByTestId('collection.entryTitle')

test('a member makes a collection from a book page, orders it, renames and deletes it', async ({ page }) => {
  const member = await signedIn(page)

  // From search, a Book not in the Library: its page offers Add to collection.
  await openResult(page, 'Piranesi')
  await expect(page.getByTestId('book.notInLibrary')).toBeVisible()
  await page.getByTestId('book.addToCollection').click()
  await expect(page.getByTestId('picker')).toBeVisible()
  await expect(page.getByTestId('picker.addsToLibrary')).toHaveText(en.collections.addsToLibrary)

  // A new collection right there, with the Book on it.
  await page.getByTestId('picker.new').click()
  await page.getByTestId('picker.newName').fill('Sci-fi')
  await page.getByTestId('picker.create').click()
  const scifi = page.getByTestId('picker.collection').filter({ hasText: 'Sci-fi' })
  await expect(scifi).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('picker.addsToLibrary')).toBeHidden()
  await page.getByTestId('picker.action').click()
  await expect(page.getByTestId('picker')).toBeHidden()

  // In the same call it went into the Library, on Want to read.
  await expect(page.getByTestId('book.status')).toHaveText(en.status.want_to_read)
  await expect(page.getByTestId('book.collection')).toHaveText(['Sci-fi'])
  // It entered the Catalogue the way the Add sheet puts a Book there: with its thumbhash and colours.
  const [stored] = await sql<{ cover_thumbhash: string | null; cover_dominant: string | null }>(
    `select b.cover_thumbhash, b.cover_dominant from public.library_entries e
       join public.books b on b.id = e.book_id where e.member_id = $1`,
    [member.id],
  )
  expect(stored!.cover_thumbhash).toBeTruthy()
  expect(stored!.cover_dominant).toMatch(/^#[0-9a-f]{6}$/)

  // A second Book joins the same Collection.
  await openResult(page, 'Piranesi: Drawings Colour Plates')
  await page.getByTestId('book.addToCollection').click()
  await page.getByTestId('picker.collection').filter({ hasText: 'Sci-fi' }).click()
  await expect(page.getByTestId('picker.collection').filter({ hasText: 'Sci-fi' })).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('book.collection')).toHaveText(['Sci-fi'])

  // Library → Collections: the Collection with its two covers.
  await page.getByTestId('shell.tab.library').click()
  await expect(page.getByTestId('library.collectionsCount')).toHaveText('1')
  await expect(page.getByTestId('library.entryTitle')).toHaveCount(2)
  await page.getByTestId('library.collections').click()
  await expect(page).toHaveURL(/\/collections$/)
  await expect(page.getByTestId('collections.itemName')).toHaveText(['Sci-fi'])
  await expect(page.getByTestId('collections.itemCount')).toHaveText(['2 books'])
  await page.getByTestId('collections.item').click()

  // Her order: as added. Dragging the second grip above the first swaps them.
  await expect(page.getByTestId('collection.title')).toHaveText('Sci-fi')
  await expect(titles(page)).toHaveText(['Piranesi', 'Piranesi: Drawings Colour Plates'])
  const grips = page.getByTestId('collection.grip')
  const from = (await grips.nth(1).boundingBox())!
  const to = (await grips.nth(0).boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  for (let step = 1; step <= 8; step++) {
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + ((to.y - from.y - 12) * step) / 8)
  }
  await expect(page.locator('.lifted')).toHaveCount(1)
  await page.mouse.up()
  await expect(titles(page)).toHaveText(['Piranesi: Drawings Colour Plates', 'Piranesi'])

  // The order is kept: in the database, and after a reload.
  await expect
    .poll(async () =>
      (
        await sql<{ title: string }>(
          `select b.title from public.collection_entries ce
             join public.collections c on c.id = ce.collection_id
             join public.library_entries e on e.id = ce.entry_id
             join public.books b on b.id = e.book_id
            where c.member_id = $1 order by ce.position`,
          [member.id],
        )
      ).map((row) => row.title),
    )
    .toEqual(['Piranesi: Drawings Colour Plates', 'Piranesi'])
  await page.reload()
  await expect(titles(page)).toHaveText(['Piranesi: Drawings Colour Plates', 'Piranesi'])

  // The keyboard way: the grip takes the arrow keys and says where the Book went.
  await page.getByTestId('collection.grip').nth(0).focus()
  await page.keyboard.press('ArrowDown')
  await expect(titles(page)).toHaveText(['Piranesi', 'Piranesi: Drawings Colour Plates'])
  await expect(page.getByTestId('collection.announcement')).toContainText('place 2 of 2')
  await expect(page.getByTestId('collection.grip').nth(1)).toBeFocused()
  await page.reload()
  await expect(titles(page)).toHaveText(['Piranesi', 'Piranesi: Drawings Colour Plates'])

  // Rename.
  await page.getByTestId('collection.more').click()
  await page.getByTestId('collectionOptions.rename').click()
  await expect(page.getByTestId('collectionName.input')).toHaveValue('Sci-fi')
  await page.getByTestId('collectionName.input').fill('Science fiction')
  await page.getByTestId('collectionName.action').click()
  await expect(page.getByTestId('collectionName')).toBeHidden()
  await expect(page.getByTestId('collection.title')).toHaveText('Science fiction')

  // Delete: the Collection goes, the Books stay in the Library.
  await page.getByTestId('collection.more').click()
  await page.getByTestId('collectionOptions.delete').click()
  await expect(page.getByTestId('collectionOptions.confirmText')).toContainText('Science fiction')
  await page.getByTestId('collectionOptions.confirmDelete').click()
  await expect(page).toHaveURL(/\/collections$/)
  await expect(page.getByTestId('collections.emptyTitle')).toHaveText(en.collections.emptyTitle)
  await page.getByTestId('collections.back').click()
  await expect(page).toHaveURL(/\/library$/)
  await expect(page.getByTestId('library.collectionsCount')).toHaveText('0')
  await expect(page.getByTestId('library.entryTitle')).toHaveCount(2)
})

test('a collection is created from the Collections screen, and a name she already uses is refused', async ({ page }) => {
  await signedIn(page)
  await openResult(page, 'Piranesi')
  await page.getByTestId('book.add').click()
  await page.getByTestId('add.submit').click()
  await expect(page.getByTestId('book.status')).toBeVisible()

  await goto(page, '/collections')
  await expect(page.getByTestId('collections.emptyTitle')).toBeVisible()
  await page.getByTestId('collections.new').click()
  await page.getByTestId('collectionName.input').fill('Favourites')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('collections.itemName')).toHaveText(['Favourites'])
  await expect(page.getByTestId('collections.itemCount')).toHaveText(['0 books'])

  await page.getByTestId('collections.newTop').click()
  await page.getByTestId('collectionName.input').fill('favourites')
  await page.getByTestId('collectionName.action').click()
  await expect(page.getByTestId('collectionName.error')).toHaveText(en.collections.error.name_taken)
  await page.keyboard.press('Escape')

  // An empty Collection says how Books get onto it.
  await page.getByTestId('collections.item').click()
  await expect(page.getByTestId('collection.emptyTitle')).toHaveText(en.collection.emptyTitle)
})
