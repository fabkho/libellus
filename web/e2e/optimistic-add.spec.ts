import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { sql } from '../tests/support/stack'
import { expectAccessible, recordedApple, signedIn, untilStill } from './support'
import { test } from './fixtures'

/**
 * Adding a Book from the search palette is optimistic: the + opens the Add sheet
 * (Want to read is what it starts on), and Add does not wait for the network. The
 * add goes into the outbox like an offline write, the entry is on Want to read, the
 * result's mark has flipped and the sheet has closed at once; the outbox sends it
 * and the Library is read again. The write is held on the wire here (a route that
 * answers when the flow says so, never a timer), so "at once" is something the
 * flow can prove: nothing it looks at depends on the answer.
 */

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
  // The Catalogue is shared with every run on this stack: it answers nothing, so the result is the recording's Piranesi.
  await page.route(/\/rest\/v1\/rpc\/search_books/, async (route) => route.fulfill({ response: await route.fetch(), body: '[]' }))
})

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

const SYNC = '**/rest/v1/rpc/sync_write'

/** Holds the line's sends on the wire until the flow lets them through. */
async function holdSends(page: Page) {
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  await page.route(SYNC, async (route) => {
    await gate
    await route.continue().catch(() => undefined)
  })
  return release
}

const waiting = (count: number) => en.sync.chip.replace('{count}', String(count))

const entriesOf = async (memberId: string) =>
  (await sql<{ title: string }>(`select b.title from public.library_entries e join public.books b on b.id = e.book_id where e.member_id = $1`, [memberId])).map(
    (row) => row.title,
  )

/** Search for Piranesi, tap the first result's + and wait for the Add sheet. */
async function openAddFromResults(page: Page) {
  await page.getByTestId('shell.tab.search').click()
  await page.getByTestId('search.query').fill('Piranesi')
  await expect(page.getByTestId('search.result').first()).toBeVisible()
  await expect(page.getByTestId('search.resultStatus')).toHaveCount(0)
  await page.getByTestId('search.add').first().click()
  await expect(page.getByTestId('add')).toBeVisible()
  await expect(page.getByTestId('add.status.want_to_read')).toHaveAttribute('aria-checked', 'true')
  await untilStill(page)
}

test('adding from the palette shows the book at once, with the network held, and the database follows', async ({ page }) => {
  const member = await signedIn(page)
  await page.getByTestId('shell.tab.library').click()
  await expect(page.getByTestId('library.emptyTitle')).toBeVisible()
  const release = await holdSends(page)

  await openAddFromResults(page)
  // A double tap on Add is one add: the second press finds the sheet gone or busy.
  await page.getByTestId('add.submit').dblclick()

  // At once: the sheet is shut, the result says Want to read where the + was.
  await expect(page.getByTestId('add')).toBeHidden()
  await expect(page.getByTestId('search.resultStatus').first()).toHaveText(en.status.want_to_read)
  // The chip tells the truth: one change waits. The database has nothing yet.
  await expect(page.getByTestId('shell.syncLabel')).toHaveText(waiting(1))
  expect(await entriesOf(member.id)).toEqual([])

  // The Library has it on Want to read, under the page key (no temporary id to open a page with).
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('search.overlay')).toBeHidden()
  await expect(page.getByTestId('library.entryTitle')).toHaveText(['Piranesi'])
  await expect(page.getByTestId('library.entry')).toHaveAttribute('href', /\/book\/apple-1504159680$/)

  // Its page opens from the row, as a Book in her Library, while the add still waits.
  await page.getByTestId('library.entry').click()
  await expect(page).toHaveURL(/\/book\/apple-1504159680$/)
  await expect(page.getByTestId('book.title')).toHaveText('Piranesi')
  await expect(page.getByTestId('book.status')).toHaveText(en.status.want_to_read)
  await expect(page.getByTestId('book.notInLibrary')).toBeHidden()
  await page.getByTestId('book.back').click()
  await expect(page.getByTestId('library.entryTitle')).toHaveText(['Piranesi'])

  // The wire answers: one entry in the database, the chip goes, the row is the database's.
  release()
  await expect(page.getByTestId('shell.sync')).toBeHidden()
  await expect.poll(() => entriesOf(member.id)).toEqual(['Piranesi'])
  await expect(page.getByTestId('library.entryTitle')).toHaveText(['Piranesi'])
  await expect(page.getByTestId('library.entry')).toHaveAttribute('href', /\/book\/[0-9a-f]{8}-[0-9a-f]{4}-/)
  // The cover went into the Catalogue resolved, as the Add sheet always did.
  const [stored] = await sql<{ cover_url: string; cover_thumbhash: string | null }>(
    `select b.cover_url, b.cover_thumbhash from public.library_entries e join public.books b on b.id = e.book_id where e.member_id = $1`,
    [member.id],
  )
  expect(stored!.cover_url).toMatch(/\/600x900bb\.jpg$/)
  expect(stored!.cover_thumbhash).toBeTruthy()
})

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`a refused add, ${colorScheme}`, () => {
    test.use({ colorScheme })

    test('undoes itself: the mark and the row go, and the sync sheet says why, once', async ({ page }) => {
      const member = await signedIn(page)
      await page.getByTestId('shell.tab.library').click()
      await expect(page.getByTestId('library.emptyTitle')).toBeVisible()
      let sends = 0
      let release!: () => void
      const gate = new Promise<void>((resolve) => (release = resolve))
      // The database refuses the write by name, as it does a book it cannot keep.
      await page.route(SYNC, async (route) => {
        sends += 1
        await gate
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({ code: 'P0001', message: 'book_invalid', details: null, hint: null }),
        })
      })

      await openAddFromResults(page)
      await page.getByTestId('add.submit').click()
      await expect(page.getByTestId('add')).toBeHidden()
      await expect(page.getByTestId('search.resultStatus').first()).toHaveText(en.status.want_to_read)
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('library.entryTitle')).toHaveText(['Piranesi'])

      // The refusal lands: the Library is read again, nothing is left of it.
      release()
      await expect(page.getByTestId('library.entry')).toHaveCount(0)
      await expect(page.getByTestId('library.emptyTitle')).toBeVisible()
      expect(await entriesOf(member.id)).toEqual([])
      expect(sends).toBe(1)

      // The chip says it once, in the error colour; the sheet names the book and the reason.
      await expect(page.getByTestId('shell.syncLabel')).toHaveText(en.sync.chipFailed.replace('{count}', '1'))
      await page.getByTestId('shell.sync').click()
      await expect(page.getByTestId('sync.failure')).toHaveCount(1)
      await expect(page.getByTestId('sync.failureAbout')).toHaveText('Piranesi')
      await expect(page.getByTestId('sync.failureText')).toHaveText(en.sync.failedItem.replace('{action}', en.sync.action.add_to_library))
      await expect(page.getByTestId('sync.failureReason')).toHaveText(en.library.error.book_invalid)
      await untilStill(page)
      await expectAccessible(page, 'the sync sheet with a refused add')

      // Dismissed, it is gone for good; and the result in search is a + again.
      await page.getByTestId('sync.dismiss').click()
      await expect(page.getByTestId('sync.failure')).toHaveCount(0)
      await page.keyboard.press('Escape')
      await page.getByTestId('shell.tab.search').click()
      await page.getByTestId('search.query').fill('Piranesi')
      await expect(page.getByTestId('search.result').first()).toBeVisible()
      await expect(page.getByTestId('search.resultStatus')).toHaveCount(0)
      await expect(page.getByTestId('search.add').first()).toBeVisible()
    })
  })
}
