import { expect, test, type Locator, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { isoDay } from '../app/utils/dates'
import { ratingX } from '../app/utils/rating'
import { sql } from '../tests/support/stack'
import { recordedApple, signedIn } from './support'

/**
 * The heart of the loop (#7): a Book on Want to read is started, finished
 * with an end date, 3.75 stars and a review, and found under Finished with
 * its Rating. Apple answers from the recordings; the Library is the real
 * local stack. With docs/parity.md this is the behavioural reference for the
 * book page's actions, the Start and Finish sheets, the rating control and
 * the Library's Currently reading and Finished segments.
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
  const box = await settledBox(control)
  const y = box.y + box.height / 4
  const [size, gap] = [44, 12]
  await page.mouse.move(box.x + size / 2, y)
  await page.mouse.down()
  for (const q of [4, 8, 12, quarters]) await page.mouse.move(box.x + ratingX(q, size, gap) + 1, y, { steps: 4 })
  await page.mouse.up()
}

test('a member starts a book, finishes it with 3.75 stars and a review, and finds it under Finished', async ({ page }) => {
  const member = await signedIn(page)
  const today = isoDay()
  await addPiranesi(page)

  // Want to read: the page offers Start reading.
  await expect(page.getByTestId('book.status')).toHaveText(en.status.want_to_read)
  await expect(page.getByTestId('book.finish')).toBeHidden()
  await page.getByTestId('book.start').click()

  // The Start sheet: started today unless another day is picked.
  await expect(page.getByTestId('start')).toBeVisible()
  await expect(page.getByTestId('start.date')).toHaveValue(today)
  await page.getByTestId('start.submit').click()
  await expect(page.getByTestId('start')).toBeHidden()

  // Currently reading: the lamp is lit, the page offers Finish.
  await expect(page.getByTestId('book.status')).toHaveText(en.status.reading)
  await expect(page.getByTestId('book.since')).toContainText('day 1')
  await expect(page.getByTestId('book.start')).toBeHidden()
  await expect(page.getByTestId('book.finish')).toBeVisible()

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
  await expect(page.getByTestId('book.finish')).toBeHidden()

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

test('a failed start says why and tries again', async ({ page }) => {
  await signedIn(page)
  await addPiranesi(page)
  await page.getByTestId('book.start').click()

  // A day that has not come yet is refused in the sheet, before anything is sent.
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 2)
  await page.getByTestId('start.date').fill(isoDay(tomorrow))
  await page.getByTestId('start.submit').click()
  await expect(page.getByTestId('start.error')).toHaveText(en.library.error.date_in_future)
  await page.getByTestId('start.date').fill(isoDay())

  // The connection fails: the sheet stays, says so, and offers to try again.
  await page.route('**/rest/v1/rpc/start_reading', (route) => route.abort('failed'))
  await page.getByTestId('start.submit').click()
  await expect(page.getByTestId('start.error')).toHaveText(en.library.error.unknown)
  await expect(page.getByTestId('start.submit')).toHaveText(en.start.retry)
  await expect(page.getByTestId('book.status')).toHaveText(en.status.want_to_read)

  await page.unroute('**/rest/v1/rpc/start_reading')
  await page.getByTestId('start.submit').click()
  await expect(page.getByTestId('start')).toBeHidden()
  await expect(page.getByTestId('book.status')).toHaveText(en.status.reading)
})
