import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { isoDay } from '../app/utils/dates'
import { sql } from '../tests/support/stack'
import { endFromBook, recordedApple, signedIn } from './support'
import { test } from './fixtures'

/**
 * Giving a book up, and picking a closed one up again (#10): a Book is started,
 * abandoned with a reason, found under Not finished in the Library, started
 * again and read once more; a finished Book is read again with its history
 * kept. Apple answers from the recordings; the Library is the real local
 * stack. With docs/parity.md this is the behavioural reference for the Abandon
 * sheet, DNF in the Update progress sheet (the book page carries no Finish or
 * DNF of its own), the book page's Read again / Start again, and the Not
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
  sql<{ outcome: string | null; started_on: string; ended_on: string | null; abandon_reason: string | null; progress: number | null }>(
    `select s.outcome::text, s.started_on::text, s.ended_on::text, s.abandon_reason,
            coalesce(s.progress_page, s.progress_percent)::int as progress
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

  // Currently reading: the page has Update progress, and DNF is in its sheet, under Finish. Where
  // she put it down is saved first (the read keeps it), then the DNF sheet takes over.
  await expect(page.getByTestId('book.updateProgress')).toBeVisible()
  await page.getByTestId('book.updateProgress').click()
  await expect(page.getByTestId('progress.abandonHint')).toHaveText(en.book.progress.abandonHint)
  for (let i = 0; i < 3; i++) await page.getByTestId('progress.plus').click()
  await page.getByTestId('progress.abandon').click()
  await expect(page.getByTestId('progress')).toBeHidden()

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

  // Finished, but not finished: no rating, the day, and Start again instead of Update progress.
  await expect(page.getByTestId('book.status')).toHaveText(en.status.notFinished)
  await expect(page.getByTestId('book.updateProgress')).toBeHidden()
  await expect(page.getByTestId('book.readAgain')).toBeHidden()
  await expect(page.getByTestId('book.startAgain')).toHaveText(en.book.startAgain)

  // Stored as one abandoned session with the reason as typed and where it was put down (3: pages, or percent without a page count).
  expect(await sessionsOf(member.email)).toEqual([
    {
      outcome: 'abandoned',
      started_on: today,
      ended_on: today,
      abandon_reason: 'The sentences were beautiful, the plot never arrived.',
      progress: 3,
    },
  ])

  // In the Library it is under Finished, among all of them, and under Not finished.
  await page.getByTestId('shell.tab.library').click()
  await expect(page.getByTestId('library.segment.finished')).toContainText('1')
  await page.getByTestId('library.segment.finished').click()
  await expect(page.getByTestId('library.view.count')).toHaveText('1 book')
  await expect(page.getByTestId('library.entryTitle')).toHaveText(['Piranesi'])
  await expect(page.getByTestId('library.entryNotFinished')).toContainText(en.status.notFinished)
  await expect(page.getByTestId('library.entryRating')).toHaveCount(0)
  await page.getByTestId('library.view.filter').click()
  await page.getByTestId('libraryFilter.status.notFinished').click()
  await page.getByTestId('libraryFilter.action').click()
  await expect(page.getByTestId('libraryFilter')).toBeHidden()
  await expect(page.getByTestId('library.view.chip')).toHaveText([en.library.view.status.notFinished])
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
  await expect(page.getByTestId('book.updateProgress')).toBeVisible()

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

  // No reason typed: the reason is optional. The wheel left alone: nothing is saved before it.
  await endFromBook(page, 'abandon')
  await page.getByTestId('abandon.submit').click()
  await expect(page.getByTestId('abandon')).toBeHidden()
  await expect(page.getByTestId('book.status')).toHaveText(en.status.notFinished)
  expect((await sessionsOf(member.email)).map((s) => [s.abandon_reason, s.progress])).toEqual([[null, null]])

  // Start again, then finish it this time: Finished, with Read again.
  await page.getByTestId('book.startAgain').click()
  await page.getByTestId('start.submit').click()
  await expect(page.getByTestId('start')).toBeHidden()
  await endFromBook(page, 'finish')
  await page.getByTestId('finish.submit').click()
  await expect(page.getByTestId('finish')).toBeHidden()
  await expect(page.getByTestId('book.status')).toHaveText(en.status.finished)
  await expect(page.getByTestId('book.startAgain')).toBeHidden()

  // A finished read is no longer under Not finished: the latest session decides.
  await page.getByTestId('shell.tab.library').click()
  await page.getByTestId('library.segment.finished').click()
  await expect(page.getByTestId('library.entryNotFinished')).toHaveCount(0)
  // Not finished is only offered in the Filter sheet while something was given up.
  await page.getByTestId('library.view.filter').click()
  await expect(page.getByTestId('libraryFilter')).toBeVisible()
  await expect(page.getByTestId('libraryFilter.section.status')).toHaveCount(0)
  await page.getByTestId('libraryFilter.cancel').click()
  await expect(page.getByTestId('libraryFilter')).toBeHidden()

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
