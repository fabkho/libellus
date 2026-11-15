import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import type { BookSnapshot } from '../app/data/books'
import { createLibrary } from '../app/data/library'
import { addDays, isoDay } from '../app/utils/dates'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { test } from './fixtures'
import { expectAccessible, recordedApple, signedIn, untilStill } from './support'

/**
 * Her page count in the Edit read sheet (issue #60): the sheet that fixes a finished read's dates,
 * Rating and review carries the count that counts for the entry (`pageCountOf`: her override, else the
 * edition's), and what she types there is her own — `library_entries.page_count_override` through
 * `set_read_total`, never the shared edition's `books.page_count` and never a recorded read. The
 * read's own edit goes first (`update_session`, which has no page count); the count is a second call
 * (`stores/history.ts`, `confirmEdit`), and tests/edit-session-total.test.ts holds that order.
 */
test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

const today = isoDay()
/** Where the screenshots go (docs/TESTING.md: a whole screen, at most 1000 px high). */
const OUT = process.env.EDIT_TOTAL_SHOTS_OUT ?? '/tmp/edit-total'

/** A Book with the edition's page count (The Word for World Is Forest counts 144, as the owner's does). */
function book(title: string, pageCount: number | null = 144): BookSnapshot {
  return {
    title: runTitle(title),
    authors: ['Ursula K. Le Guin'],
    isbn13: null,
    isbn10: null,
    pageCount,
    year: 1972,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: null,
    coverUrl: `https://is1-ssl.mzstatic.com/image/thumb/Publication${title.replace(/\W/g, '')}/600x900bb.jpg`,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

/**
 * One finished read of a Book whose edition says 144 pages, three days ago, rated 4 stars with a
 * review — the read the owner is on when he opens Edit on its sheet.
 */
async function finishedRead(page: Page, title = 'The Word for World Is Forest') {
  const member = await signedIn(page)
  const library = createLibrary(member.client)
  const added = await library.addToLibrary(book(title), {
    status: 'finished',
    startedOn: addDays(today, -9),
    endedOn: addDays(today, -3),
    rating: 16,
    review: 'A forest that answers back.',
  })
  return { member, added }
}

/** The Book page of the read just made, its history read, its Edit sheet open. */
async function openEditSheet(page: Page) {
  await page.getByTestId('shell.tab.library').click()
  await page.getByTestId('library.segment.finished').click()
  await page.getByTestId('library.entry').first().click()
  await expect(page.getByTestId('book.title')).toBeVisible()
  await page.getByTestId('history.edit').first().click()
  await expect(page.getByTestId('editSession')).toBeVisible()
  await untilStill(page)
}

/** The read's entry row as the database has it, and the edition's own count beside it. */
async function stored(memberId: string, title: string) {
  return sql<{ page_count_override: number | null; book_count: number | null }>(
    `select e.page_count_override, b.page_count as book_count
       from public.library_entries e join public.books b on b.id = e.book_id
      where e.member_id = $1 and b.title = $2`,
    [memberId, runTitle(title)],
  )
}

test('the Edit read sheet carries her page count: the field opens on the count that counts, and Save stores her own', async ({ page }) => {
  const { member } = await finishedRead(page)
  await openEditSheet(page)

  // The field is there for a finished read, filled with the count that counts (the edition's 144 here),
  // labelled as hers, and the quiet line says what an empty one leaves.
  const field = page.getByTestId('editSession.pageCount')
  await expect(field).toBeVisible()
  await expect(field).toHaveValue('144')
  await expect(field).toHaveAttribute('type', 'number')
  await expect(field).toHaveAttribute('inputmode', 'numeric')
  await expect(field).toHaveAttribute('min', '1')
  await expect(field).toHaveAttribute('max', '99999')
  await expect(page.getByTestId('editSession')).toContainText('Your page count for this read')
  await expect(page.getByTestId('editSession')).toContainText('Leave it empty to follow the edition’s 144 pages.')
  // A number field with a label: the sheet's scan stays green with it.
  await expectAccessible(page, 'the Edit read sheet with her page count')

  // A count of hers, saved: the same Save that fixes the rating.
  await field.fill('132')
  await page.getByTestId('editSession.submit').click()
  await expect(page.getByTestId('editSession')).toBeHidden()

  // Only her entry's own count moved: the shared edition's 144 is untouched.
  expect(await stored(member.id, 'The Word for World Is Forest')).toEqual([{ page_count_override: 132, book_count: 144 }])

  // Opened again, the field shows her count, not the edition's: the entry the page keeps is the one the
  // count's write answered with (`set_read_total` rereads the row).
  await page.getByTestId('history.edit').first().click()
  await expect(page.getByTestId('editSession')).toBeVisible()
  await untilStill(page)
  await expect(page.getByTestId('editSession.pageCount')).toHaveValue('132')
})

test('the Book page follows her count, and the Profile\'s Pages figure with it', async ({ page }) => {
  const { member } = await finishedRead(page)
  await openEditSheet(page)
  await page.getByTestId('editSession.pageCount').fill('132')
  await page.getByTestId('editSession.submit').click()
  await expect(page.getByTestId('editSession')).toBeHidden()

  // The Book's own count is the edition's, which is not hers to change (book.facts keeps 144).
  // The entry's count is what the Library lists and the Profile's Pages figure count.
  await page.getByTestId('book.back').click()
  await page.getByTestId('shell.avatar').click()
  await expect(page.getByTestId('profile.library')).toBeVisible()
  await untilStill(page)
  // One finished read of 132 pages: the figure sums her own count, and no read is left "without a count".
  await expect(page.getByTestId('profile.pages')).toHaveText('132')
  await expect(page.getByTestId('profile.pagesMissing')).toHaveCount(0)
  expect(await stored(member.id, 'The Word for World Is Forest')).toEqual([{ page_count_override: 132, book_count: 144 }])
})

test('an empty field clears her count back to the edition\'s, and a count refused is said in the sheet', async ({ page }) => {
  const { member } = await finishedRead(page)
  // Her own count first (through the sheet), then the field emptied.
  await openEditSheet(page)
  await page.getByTestId('editSession.pageCount').fill('132')
  await page.getByTestId('editSession.submit').click()
  await expect(page.getByTestId('editSession')).toBeHidden()
  await page.getByTestId('history.edit').first().click()
  await expect(page.getByTestId('editSession')).toBeVisible()

  // Emptied: the edition's count again (the database stores no override).
  await page.getByTestId('editSession.pageCount').fill('')
  await page.getByTestId('editSession.submit').click()
  await expect(page.getByTestId('editSession')).toBeHidden()
  expect(await stored(member.id, 'The Word for World Is Forest')).toEqual([{ page_count_override: null, book_count: 144 }])
})

test('a number the database would refuse is the sheet\'s to say, before anything is sent', async ({ page }) => {
  const { member } = await finishedRead(page)
  await openEditSheet(page)
  // Zero is no page count: said under the field, and Save writes nothing at all.
  await page.getByTestId('editSession.pageCount').fill('0')
  await page.getByTestId('editSession.submit').click()
  await expect(page.getByTestId('editSession.pageCountError')).toHaveText('A page count is a whole number above zero.')
  await expect(page.getByTestId('editSession.pageCount')).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByTestId('editSession')).toBeVisible()
  expect(await stored(member.id, 'The Word for World Is Forest')).toEqual([{ page_count_override: null, book_count: 144 }])
})

const SIZES = [{ name: '390', viewport: { width: 390, height: 844 } }]

for (const size of SIZES) {
  for (const theme of ['light', 'dark'] as const) {
    test.describe(`screenshots, ${size.name} px, ${theme}`, () => {
      test.use({ colorScheme: theme, viewport: size.viewport })

      test('the Edit read sheet with her page count', async ({ page }) => {
        await page.addInitScript(([key, value]) => localStorage.setItem(key!, value!), ['libellus-theme', theme])
        mkdirSync(OUT, { recursive: true })
        const run = `${size.name}-${theme}`
        await finishedRead(page)
        await openEditSheet(page)
        await expect(page.getByTestId('editSession.pageCount')).toBeVisible()
        await untilStill(page)
        await page.screenshot({ path: join(OUT, `edit-total-${run}.jpg`), type: 'jpeg', quality: 80 })
      })
    })
  }
}
