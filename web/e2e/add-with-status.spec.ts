import { expect, type Locator, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { addDays, isoDay } from '../app/utils/dates'
import { ratingX } from '../app/utils/rating'
import { sql } from '../tests/support/stack'
import { recordedApple, signedIn } from './support'
import { test } from './fixtures'

/**
 * Adding with any status (#9): the Add sheet and the manual-book sheet offer
 * Want to read, Currently reading and Finished, and create the first read in
 * the same call. A past read goes in as Finished with its dates, 4.25 stars and
 * a review and is found under its year. Apple answers from the recordings
 * (e2e/support.ts); the Library is the real local stack. With docs/parity.md
 * this is the behavioural reference for the status part of both sheets.
 */

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

/** Search for Piranesi, open the first result and its Add sheet. */
async function openAddSheet(page: Page) {
  await page.getByTestId('shell.tab.search').click()
  await page.getByTestId('search.query').fill('Piranesi')
  await page.getByTestId('search.result').first().click()
  await expect(page.getByTestId('book.title')).toHaveText('Piranesi')
  await page.getByTestId('book.add').click()
  await expect(page.getByTestId('add')).toBeVisible()
}

/** Where an element is once the sheet it is in has finished rising. */
async function settledBox(locator: Locator) {
  let last = null as Awaited<ReturnType<Locator['boundingBox']>>
  await expect
    .poll(
      async () => {
        const box = await locator.boundingBox()
        const still = Boolean(box && last && box.y === last.y)
        last = box
        return still
      },
      { intervals: [100] },
    )
    .toBe(true)
  return last!
}

/** A finger (here a mouse) pressed on the stars and dragged to `quarters`. */
async function dragRating(page: Page, control: Locator, quarters: number) {
  await control.scrollIntoViewIfNeeded()
  const box = await settledBox(control)
  const y = box.y + box.height / 4
  const [size, gap] = [44, 12]
  await page.mouse.move(box.x + size / 2, y)
  await page.mouse.down()
  for (const q of [4, 8, 12, quarters]) await page.mouse.move(box.x + ratingX(q, size, gap) + 1, y, { steps: 4 })
  await page.mouse.up()
}

test('a member adds a past read as Finished with dates, 4.25 stars and a review and finds it under its year', async ({ page }) => {
  const member = await signedIn(page)
  const today = isoDay()
  await openAddSheet(page)

  // Want to read is what the sheet starts on, with no dates.
  await expect(page.getByTestId('add.status.want_to_read')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('add.started')).toBeHidden()

  // Finished: no start, ended today, no Rating yet.
  await page.getByTestId('add.status.finished').click()
  await expect(page.getByTestId('add.status.finished')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('add.started')).toHaveValue('')
  await expect(page.getByTestId('add.ended')).toHaveValue(today)
  await expect(page.getByTestId('add.rating')).toHaveAttribute('aria-valuetext', en.rating.none)

  await page.getByTestId('add.started').fill('2021-03-02')
  await page.getByTestId('add.ended').fill('2021-03-19')
  await dragRating(page, page.getByTestId('add.rating'), 17)
  await expect(page.getByTestId('add.rating')).toHaveAttribute('aria-valuenow', '4.25')
  await expect(page.getByTestId('add.rating.value')).toContainText('4.25')
  // The sheet did not take the drag for a swipe down.
  await expect(page.getByTestId('add')).toBeVisible()
  await page.getByTestId('add.review').fill('Slow, then all at once.')
  await page.getByTestId('add.submit').click()
  await expect(page.getByTestId('add')).toBeHidden()

  // The page says so at once: Finished, rated, nothing left to start.
  await expect(page.getByTestId('book.status')).toHaveText(en.status.finished)
  await expect(page.getByTestId('book.rating')).toContainText('4.25')
  await expect(page.getByTestId('book.start')).toBeHidden()

  // In the Library: under Finished, in the year it was finished.
  await page.getByTestId('shell.tab.library').click()
  await expect(page).toHaveURL(/\/library$/)
  await page.getByTestId('library.segment.finished').click()
  await expect(page.getByTestId('library.yearTitle')).toHaveText(['2021'])
  await expect(page.getByTestId('library.entryTitle')).toHaveText(['Piranesi'])
  await expect(page.getByTestId('library.entryRating')).toContainText('4.25')
  await expect(page.getByTestId('library.segment.want_to_read')).not.toContainText('1')

  // One finished session, made with the entry: quarters, both days, the review as typed.
  const rows = await sql<{ status: string; started_on: string; ended_on: string; rating: number; review: string; outcome: string }>(
    `select e.status::text, s.started_on::text, s.ended_on::text, s.rating, s.review, s.outcome::text
       from public.library_entries e join public.reading_sessions s on s.entry_id = e.id
      where e.member_id = $1`,
    [member.id],
  )
  expect(rows).toEqual([
    { status: 'finished', started_on: '2021-03-02', ended_on: '2021-03-19', rating: 17, review: 'Slow, then all at once.', outcome: 'finished' },
  ])
})

test('a member adds a book as Currently reading, started today unless another day is picked', async ({ page }) => {
  const member = await signedIn(page)
  const today = isoDay()
  await openAddSheet(page)

  await page.getByTestId('add.status.reading').click()
  await expect(page.getByTestId('add.started')).toHaveValue(today)
  await expect(page.getByTestId('add.ended')).toBeHidden()
  await expect(page.getByTestId('add.rating')).toBeHidden()

  // A day that has not come yet is told in the sheet, before anything is sent.
  await page.getByTestId('add.started').fill(addDays(today, 2))
  await page.getByTestId('add.submit').click()
  await expect(page.getByTestId('add.error')).toHaveText(en.library.error.date_in_future)

  await page.getByTestId('add.started').fill(addDays(today, -3))
  await page.getByTestId('add.submit').click()
  await expect(page.getByTestId('add')).toBeHidden()
  await expect(page.getByTestId('book.status')).toHaveText(en.status.reading)
  await expect(page.getByTestId('book.finish')).toBeVisible()

  await page.getByTestId('shell.tab.library').click()
  await page.getByTestId('library.segment.reading').click()
  await expect(page.getByTestId('library.readingCard')).toHaveCount(1)
  const [session] = await sql<{ started_on: string; ended_on: string | null }>(
    `select s.started_on::text, s.ended_on::text from public.library_entries e
       join public.reading_sessions s on s.entry_id = e.id where e.member_id = $1`,
    [member.id],
  )
  expect(session).toEqual({ started_on: addDays(today, -3), ended_on: null })
})

test('a member adds a book by hand as Finished and it is under its year', async ({ page }) => {
  const member = await signedIn(page)
  const today = isoDay()

  await page.getByTestId('shell.tab.search').click()
  await page.getByTestId('search.query').fill('qxzvwlmbrt')
  await page.getByTestId('search.addManually').click()
  await expect(page.getByTestId('manual')).toBeVisible()
  await page.getByTestId('manual.title').fill('Meine Notizen')
  await page.getByTestId('manual.author').fill('Ida Beispiel')

  await page.getByTestId('manual.status.finished').click()
  await expect(page.getByTestId('manual.ended')).toHaveValue(today)
  await page.getByTestId('manual.ended').fill('2019-07-20')
  // A start after the end is refused in the sheet.
  await page.getByTestId('manual.started').fill('2019-08-01')
  await page.getByTestId('manual.submit').click()
  await expect(page.getByTestId('manual.error')).toHaveText(en.library.error.ended_before_started)
  await page.getByTestId('manual.started').fill('2019-07-01')
  await page.getByTestId('manual.review').fill('Unvergesslich.')
  await page.getByTestId('manual.submit').click()
  await expect(page.getByTestId('manual')).toBeHidden()

  await expect(page.getByTestId('book.title')).toHaveText('Meine Notizen')
  await expect(page.getByTestId('book.status')).toHaveText(en.status.finished)

  await page.getByTestId('shell.tab.library').click()
  await page.getByTestId('library.segment.finished').click()
  await expect(page.getByTestId('library.yearTitle')).toHaveText(['2019'])
  await expect(page.getByTestId('library.entryTitle')).toHaveText(['Meine Notizen'])

  const [stored] = await sql<{ source: string; started_on: string; ended_on: string; review: string }>(
    `select b.source, s.started_on::text, s.ended_on::text, s.review from public.library_entries e
       join public.books b on b.id = e.book_id
       join public.reading_sessions s on s.entry_id = e.id where e.member_id = $1`,
    [member.id],
  )
  expect(stored).toEqual({ source: 'manual', started_on: '2019-07-01', ended_on: '2019-07-20', review: 'Unvergesslich.' })
})
