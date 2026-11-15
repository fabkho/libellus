import { expect } from '@playwright/test'
import { sql } from '../tests/support/stack'
import { shelveBook, sharedBook } from '../tests/support/notes'
import { test } from './fixtures'
import { goto, signedIn, untilStill } from './support'

/**
 * The pull request's screenshots (they assert nothing the other flows do not): a Book whose work was first published in
 * 1949, in a 2023 Penguin edition — the facts row at the top, the edition line under About — in both themes.
 *
 * Run by hand, against a **throwaway stack**: it renames and republishes the Book so the shot reads like a real one, which
 * takes it out of the run's sweep (`tests/support/stack.ts`, by publisher and title tag).
 *
 *   SHOTS=1 npx playwright test e2e/first-published-shots.spec.ts --workers=1
 */

const FIRST_YEAR = 1949
const EDITION_YEAR = 2023
const TITLE = 'Nineteen Eighty-Four'

test.skip(!process.env.SHOTS, 'screenshots: SHOTS=1 runs them')

/** The Book's page, a work from 1949 in a 2023 edition, its title and publisher the real ones for the shot. */
async function shelf(member: Awaited<ReturnType<typeof signedIn>>) {
  const bookId = await shelveBook(member, sharedBook('shot'), 'reading')
  await sql('update public.books set title = $2, published_year = $3, publisher = $4, description = $5 where id = $1', [
    bookId,
    TITLE,
    EDITION_YEAR,
    'Penguin',
    'Winston Smith works for the Ministry of Truth, where the past is rewritten daily and the future is a boot in a face, for ever.',
  ])
  const key = `OL${Math.floor(Math.random() * 8_000_000) + 1_000_000}W`
  const [work] = await sql<{ id: string }>(
    `insert into public.works (title, openlibrary_key, first_year) values ($1, $2, $3) returning id`,
    [TITLE, key, FIRST_YEAR],
  )
  await sql(`insert into public.book_works (book_id, work_id, matched_by) values ($1, $2, 'openlibrary')`, [bookId, work!.id])
  return bookId
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme}`, () => {
    test.use({ colorScheme: theme, viewport: { width: 393, height: 852 } })

    test(`the Book page: 1949 in the facts row, "This edition: Penguin, 2023" under About (${theme})`, async ({ page }) => {
      const member = await signedIn(page)
      const bookId = await shelf(member)
      await goto(page, `/book/${bookId}`)
      await expect(page.getByTestId('book.facts')).toContainText(String(FIRST_YEAR))
      await expect(page.getByTestId('book.thisEdition')).toBeVisible()
      await untilStill(page)
      await page.evaluate(() => window.scrollTo(0, 0))
      await untilStill(page)
      await page.screenshot({ path: `../.shots/first-published-${theme}.png` })
    })
  })
}
