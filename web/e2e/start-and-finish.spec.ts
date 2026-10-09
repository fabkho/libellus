import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { isoDay } from '../app/utils/dates'
import { sql } from '../tests/support/stack'
import { test } from './fixtures'
import { dragRating, recordedApple, settledBox, signedIn } from './support'

/**
 * The heart of the loop (#7): a Book on Want to read is started, finished
 * with an end date, 3.75 stars and a review, and found under Finished with
 * its Rating. Apple answers from the recordings; the Library is the real
 * local stack. With docs/parity.md this is the behavioural reference for the
 * book page's actions (one per state: Start reading, then Update progress, whose
 * sheet holds Finish and DNF), the Start and Finish sheets, the rating control
 * and the Library's Currently reading and Finished segments.
 */

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

/** Search, open the first result and add it to Want to read. */
async function addPiranesi(page: Page) {
  await page.getByTestId('shell.tab.search').click()
  await page.getByTestId('search.query').fill('Piranesi')
  await page.getByTestId('search.result').first().click()
  await expect(page.getByTestId('book.title')).toHaveText('Piranesi')
  await page.getByTestId('book.add').click()
  await page.getByTestId('add.submit').click()
  await expect(page.getByTestId('add')).toBeHidden()
}

test('a member starts a book, finishes it with 3.75 stars and a review, and finds it under Finished', async ({ page }) => {
  const member = await signedIn(page)
  const today = isoDay()
  await addPiranesi(page)

  // Want to read: the page offers Start reading, nothing else.
  await expect(page.getByTestId('book.status')).toHaveText(en.status.want_to_read)
  await expect(page.getByTestId('book.updateProgress')).toBeHidden()
  await page.getByTestId('book.start').click()

  // The Start sheet: started today unless another day is picked.
  await expect(page.getByTestId('start')).toBeVisible()
  await expect(page.getByTestId('start.date')).toHaveValue(today)
  await page.getByTestId('start.submit').click()
  await expect(page.getByTestId('start')).toBeHidden()

  // Currently reading: the lamp is lit, the page's one action is Update progress, and Finish
  // and DNF wait in its sheet, not on the page (nor does Read as: it is in the options).
  await expect(page.getByTestId('book.status')).toHaveText(en.status.reading)
  await expect(page.getByTestId('book.since')).toContainText('day 1')
  await expect(page.getByTestId('book.start')).toBeHidden()
  await expect(page.getByTestId('book.updateProgress')).toHaveText(en.book.progress.update)
  await expect(page.getByTestId('book.actions').getByRole('button')).toHaveCount(1)
  await expect(page.getByTestId('book.readAs')).toHaveCount(0)
  await page.getByTestId('book.updateProgress').click()
  await expect(page.getByTestId('progress.finish')).toHaveText(en.book.finish)
  await expect(page.getByTestId('progress.abandon')).toHaveText(en.book.abandon)
  await expect(page.getByTestId('progress.abandonRow')).toContainText(en.book.progress.notFinishing)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('progress')).toBeHidden()

  // In the Library it is a card under Currently reading, with Finish on it.
  await page.getByTestId('shell.tab.library').click()
  await page.getByTestId('library.segment.reading').click()
  await expect(page.getByTestId('library.segment.reading')).toContainText('1')
  await expect(page.getByTestId('library.readingCard')).toHaveCount(1)
  await expect(page.getByTestId('library.entryTitle')).toHaveText(['Piranesi'])
  await page.getByTestId('library.finish').click()

  // The Finish sheet: today, no Rating yet, an empty review.
  const sheet = page.getByTestId('finish')
  const rating = page.getByTestId('finish.rating')
  await expect(sheet).toBeVisible()
  await expect(page.getByTestId('finish.date')).toHaveValue(today)
  await expect(rating).toHaveAttribute('aria-valuetext', en.rating.none)

  // A tap sets whole stars; a drag snaps to quarters; the value shows large.
  const box = await settledBox(rating)
  await page.mouse.click(box.x + 56 + 22, box.y + box.height / 4)
  await expect(rating).toHaveAttribute('aria-valuenow', '2')
  await dragRating(page, rating, 15)
  await expect(rating).toHaveAttribute('aria-valuenow', '3.75')
  await expect(page.getByTestId('finish.rating.value')).toContainText('3.75')
  // The sheet did not take the drag for a swipe down.
  await expect(sheet).toBeVisible()

  await page.getByTestId('finish.review').fill('A house of tides and statues.')
  await page.getByTestId('finish.submit').click()
  await expect(sheet).toBeHidden()

  // Finished: under this year, with its Rating and the day.
  await expect(page.getByTestId('library.readingCard')).toHaveCount(0)
  await page.getByTestId('library.segment.finished').click()
  await expect(page.getByTestId('library.yearTitle')).toHaveText([today.slice(0, 4)])
  await expect(page.getByTestId('library.entryTitle')).toHaveText(['Piranesi'])
  await expect(page.getByTestId('library.entryRating')).toHaveAttribute('aria-label', en.rating.label.replace('{value}', '3.75'))
  await expect(page.getByTestId('library.entryRating')).toContainText('3.75')

  // The book page says so, with no action left until Read again (#10).
  await page.getByTestId('library.entry').click()
  await expect(page.getByTestId('book.status')).toHaveText(en.status.finished)
  await expect(page.getByTestId('book.rating')).toContainText('3.75')
  await expect(page.getByTestId('book.start')).toBeHidden()
  await expect(page.getByTestId('book.updateProgress')).toBeHidden()

  // Stored as one finished session: quarters, not a fraction; the review as typed.
  const [session] = await sql<{ started_on: string; ended_on: string; rating: number; review: string }>(
    `select s.started_on::text, s.ended_on::text, s.rating, s.review
       from public.reading_sessions s
       join public.library_entries e on e.id = s.entry_id
       join auth.users u on u.id = e.member_id
      where u.email = $1`,
    [member.email],
  )
  expect(session).toEqual({ started_on: today, ended_on: today, rating: 15, review: 'A house of tides and statues.' })
})
