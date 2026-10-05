import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { isoDay } from '../app/utils/dates'
import { sql } from '../tests/support/stack'
import { recordedApple, signedIn } from './support'
import { test } from './fixtures'

/**
 * Giving a book up, and picking a closed one up again (#10): a Book is started,
 * abandoned with a reason, found under Not finished in the Library, started
 * again and read once more; a finished Book is read again with its history
 * kept. Apple answers from the recordings; the Library is the real local
 * stack. With docs/parity.md this is the behavioural reference for the Abandon
 * sheet, the book page's Abandon / Read again / Start again, and the Not
 * finished filter.
 */

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

/** Search, open the first result, add it to Want to read and start it today. */
async function startPiranesi(page: Page) {
  await page.getByTestId('shell.tab.search').click()
  await page.getByTestId('search.query').fill('Piranesi')
  await page.getByTestId('search.result').first().click()
  await expect(page.getByTestId('book.title')).toHaveText('Piranesi')
  await page.getByTestId('book.add').click()
  await page.getByTestId('add.submit').click()
  await expect(page.getByTestId('add')).toBeHidden()
  await page.getByTestId('book.start').click()
  await page.getByTestId('start.submit').click()
  await expect(page.getByTestId('start')).toBeHidden()
  await expect(page.getByTestId('book.status')).toHaveText(en.status.reading)
}

const sessionsOf = (email: string) =>
  sql<{ outcome: string | null; started_on: string; ended_on: string | null; abandon_reason: string | null }>(
    `select s.outcome::text, s.started_on::text, s.ended_on::text, s.abandon_reason
       from public.reading_sessions s
       join public.library_entries e on e.id = s.entry_id
       join auth.users u on u.id = e.member_id
      where u.email = $1
      order by s.created_at`,
    [email],
  )

test('a member abandons a book with a reason, finds it under Not finished and starts it again', async ({ page }) => {
  const member = await signedIn(page)
  const today = isoDay()
  await startPiranesi(page)

  // Currently reading: Finish, and Abandon beside it.
  await expect(page.getByTestId('book.finish')).toBeVisible()
  await page.getByTestId('book.abandon').click()

  // The Abandon sheet: today, no reason yet.
  await expect(page.getByTestId('abandon')).toBeVisible()
  await expect(page.getByTestId('abandon.date')).toHaveValue(today)
  await expect(page.getByTestId('abandon.reason')).toHaveValue('')

  // A day that has not come yet is refused in the sheet, before anything is sent.
  const later = new Date()
  later.setDate(later.getDate() + 2)
  await page.getByTestId('abandon.date').fill(isoDay(later))
  await page.getByTestId('abandon.submit').click()
  await expect(page.getByTestId('abandon.error')).toHaveText(en.library.error.date_in_future)
  await page.getByTestId('abandon.date').fill(today)

  // The server fails (a connection that answers nothing is queued instead: no-answer.spec.ts):
  // the sheet stays, says so, and offers to try again.
  await page.getByTestId('abandon.reason').fill('The sentences were beautiful, the plot never arrived.')
  await page.route('**/rest/v1/rpc/abandon_reading', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'The server fell over.' }) }))
  await page.getByTestId('abandon.submit').click()
  await expect(page.getByTestId('abandon.error')).toHaveText(en.library.error.unknown)
  await expect(page.getByTestId('abandon.submit')).toHaveText(en.abandon.retry)
  await expect(page.getByTestId('book.status')).toHaveText(en.status.reading)

  await page.unroute('**/rest/v1/rpc/abandon_reading')
  await page.getByTestId('abandon.submit').click()
  await expect(page.getByTestId('abandon')).toBeHidden()

  // Finished, but not finished: no rating, the day, and Start again instead of Finish.
  await expect(page.getByTestId('book.status')).toHaveText(en.status.notFinished)
  await expect(page.getByTestId('book.finish')).toBeHidden()
  await expect(page.getByTestId('book.abandon')).toBeHidden()
  await expect(page.getByTestId('book.readAgain')).toBeHidden()
  await expect(page.getByTestId('book.startAgain')).toHaveText(en.book.startAgain)

  // Stored as one abandoned session with the reason as typed.
  expect(await sessionsOf(member.email)).toEqual([
    {
      outcome: 'abandoned',
      started_on: today,
      ended_on: today,
      abandon_reason: 'The sentences were beautiful, the plot never arrived.',
    },
  ])

  // In the Library it is under Finished, among all of them, and under Not finished.
  await page.getByTestId('shell.tab.library').click()
  await expect(page.getByTestId('library.segment.finished')).toContainText('1')
  await page.getByTestId('library.segment.finished').click()
  await expect(page.getByTestId('library.filter.all')).toContainText('1')
  await expect(page.getByTestId('library.filter.notFinished')).toContainText('1')
  await expect(page.getByTestId('library.entryTitle')).toHaveText(['Piranesi'])
  await expect(page.getByTestId('library.entryNotFinished')).toContainText(en.status.notFinished)
  await expect(page.getByTestId('library.entryRating')).toHaveCount(0)
  await page.getByTestId('library.filter.notFinished').click()
  await expect(page.getByTestId('library.filter.notFinished')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('library.entryTitle')).toHaveText(['Piranesi'])

  // Start again from the book page: the Start sheet in its words, a new session.
  await page.getByTestId('library.entry').click()
  await page.getByTestId('book.startAgain').click()
  await expect(page.getByTestId('start')).toBeVisible()
  await expect(page.getByTestId('start.submit')).toHaveText(en.start.actionRestart)
  await expect(page.getByTestId('start.date')).toHaveValue(today)
  await page.getByTestId('start.submit').click()
  await expect(page.getByTestId('start')).toBeHidden()
  await expect(page.getByTestId('book.status')).toHaveText(en.status.reading)
  await expect(page.getByTestId('book.since')).toContainText('day 1')
  await expect(page.getByTestId('book.startAgain')).toBeHidden()
  await expect(page.getByTestId('book.finish')).toBeVisible()

  // Reading again: it left Finished and Not finished, and sits under Currently reading.
  expect((await sessionsOf(member.email)).map((s) => s.outcome)).toEqual(['abandoned', null])
  await page.getByTestId('shell.tab.library').click()
  await page.getByTestId('library.segment.reading').click()
  await expect(page.getByTestId('library.entryTitle')).toHaveText(['Piranesi'])
  await page.getByTestId('library.segment.finished').click()
  await expect(page.getByTestId('library.segmentEmpty.finished')).toBeVisible()
})

test('a member abandons without a reason, and reads a finished book again', async ({ page }) => {
  const member = await signedIn(page)
  const today = isoDay()
  await startPiranesi(page)

  // No reason typed: the reason is optional.
  await page.getByTestId('book.abandon').click()
  await page.getByTestId('abandon.submit').click()
  await expect(page.getByTestId('abandon')).toBeHidden()
  await expect(page.getByTestId('book.status')).toHaveText(en.status.notFinished)
  expect((await sessionsOf(member.email)).map((s) => s.abandon_reason)).toEqual([null])

  // Start again, then finish it this time: Finished, with Read again.
  await page.getByTestId('book.startAgain').click()
  await page.getByTestId('start.submit').click()
  await expect(page.getByTestId('start')).toBeHidden()
  await page.getByTestId('book.finish').click()
  await page.getByTestId('finish.submit').click()
  await expect(page.getByTestId('finish')).toBeHidden()
  await expect(page.getByTestId('book.status')).toHaveText(en.status.finished)
  await expect(page.getByTestId('book.startAgain')).toBeHidden()

  // A finished read is no longer under Not finished: the latest session decides.
  await page.getByTestId('shell.tab.library').click()
  await page.getByTestId('library.segment.finished').click()
  await expect(page.getByTestId('library.filter.all')).toContainText('1')
  await expect(page.getByTestId('library.filter.notFinished')).toContainText('0')
  await expect(page.getByTestId('library.entryNotFinished')).toHaveCount(0)
  await page.getByTestId('library.filter.notFinished').click()
  await expect(page.getByTestId('library.filterEmpty')).toBeVisible()
  await page.getByTestId('library.filter.all').click()

  // Read again: its words, a new session, history kept.
  await page.getByTestId('library.entry').click()
  await page.getByTestId('book.readAgain').click()
  await expect(page.getByTestId('start.submit')).toHaveText(en.start.actionAgain)
  await page.getByTestId('start.submit').click()
  await expect(page.getByTestId('start')).toBeHidden()
  await expect(page.getByTestId('book.status')).toHaveText(en.status.reading)
  expect((await sessionsOf(member.email)).map((s) => [s.outcome, s.started_on])).toEqual([
    ['abandoned', today],
    ['finished', today],
    [null, today],
  ])
})
