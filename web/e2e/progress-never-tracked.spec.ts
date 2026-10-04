import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import type { BookSnapshot } from '../app/data/books'
import { createLibrary } from '../app/data/library'
import { addDays, isoDay } from '../app/utils/dates'
import { sql, runTitle, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { test } from './fixtures'
import { recordedApple, signedIn, untilStill } from './support'

/**
 * The book page before any progress was tracked (issue #79). A read with no value
 * and no `reading_progress_days` row shows only Update progress; the first save
 * opens the four figures, the chart and the reading log in with a fade; a value
 * without a day row (set long after the start, or a percent-only book) shows the
 * bar and figures but no chart or log. The rule is `progressShownOf`
 * (data/progressDays.ts, tests/progress-days.test.ts).
 */

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

function book(title: string, pageCount: number | null): BookSnapshot {
  return {
    title: runTitle(title),
    authors: ['Susanna Clarke'],
    isbn13: null,
    isbn10: null,
    pageCount,
    year: 2020,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: null,
    coverUrl: `https://is1-ssl.mzstatic.com/image/thumb/Never${title.replace(/\W/g, '')}/600x900bb.jpg`,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

/** Sets the open read's value straight in the database, booking no day (what a late first value does). */
const setValue = (email: string, kind: 'page' | 'percent', value: number) =>
  sql(
    `update public.reading_sessions s set progress_${kind} = $2, progress_updated_at = now()
       from public.library_entries e join auth.users u on u.id = e.member_id
      where e.id = s.entry_id and u.email = $1 and s.outcome is null`,
    [email, value],
  )

async function expectOnlyUpdate(page: Page) {
  await expect(page.getByTestId('book.updateProgress')).toBeVisible()
  for (const id of ['book.progressStats', 'book.progressBar', 'book.progressFigures', 'book.progressChart', 'book.lastTime', 'book.readingLog']) {
    if (id === 'book.lastTime') await expect(page.getByTestId(id)).toHaveText('')
    else await expect(page.getByTestId(id)).toHaveCount(0)
  }
}

async function openBook(page: Page) {
  await page.getByTestId('home.entry').click()
  await expect(page.getByTestId('book.updateProgress')).toBeVisible()
}

test('never tracked: only Update progress; the first save brings the figures, chart and log in; Undo takes them back', async ({ page }) => {
  const member = await signedIn(page)
  await createLibrary(member.client).addToLibrary(book('Piranesi', 480), { status: 'reading', startedOn: isoDay() })
  await page.reload()
  await openBook(page)
  await expectOnlyUpdate(page)

  // Finish sits right under the button; remember how far it is from the status line (the page may scroll).
  const gap = async () =>
    (await page.getByTestId('book.finish').boundingBox())!.y - (await page.getByTestId('book.status').boundingBox())!.y
  const before = await gap()

  await page.getByTestId('book.updateProgress').click()
  await page.getByTestId('progress.plus').click()
  await page.getByTestId('progress.plus').click()
  await page.getByTestId('progress.plus').click()
  await page.getByTestId('progress.action').click()
  await expect(page.getByTestId('progress')).toBeHidden()

  // Everything is in: the bar, the four figures, three weeks of bars, today's day in the log.
  await expect(page.getByTestId('book.progressValue')).toHaveText('3')
  await expect(page.getByTestId('book.progressBar')).toHaveAttribute('aria-valuetext', 'p. 3 of 480')
  await expect(page.getByTestId('book.progressChart').locator('.col')).toHaveCount(21)
  await expect(page.getByTestId('book.logDay')).toHaveCount(1)
  await expect(page.getByTestId('book.logAmount').first()).toHaveText('+3')
  // They opened a room: what sat under the button moved down, once, and stayed.
  await untilStill(page)
  expect(await gap()).toBeGreaterThan(before + 60)
  await expect(page.getByTestId('book.progressStats')).toHaveCSS('opacity', '1')
  await expect(page.getByTestId('book.progressStats')).not.toHaveAttribute('data-moving')

  // Undo on Home puts the read back to nothing tracked: the book page is bare again.
  await page.getByTestId('shell.tab.home').click()
  await page.getByTestId('home.undo').click()
  await page.getByTestId('home.entry').click()
  await expect(page.getByTestId('book.updateProgress')).toBeVisible()
  await expect(page.getByTestId('book.progressStats')).toHaveCount(0)
  await expect(page.getByTestId('book.readingLog')).toHaveCount(0)
})

test('Reduce Motion: the first save still brings everything in, with no travel', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const member = await signedIn(page)
  await createLibrary(member.client).addToLibrary(book('Piranesi', 480), { status: 'reading', startedOn: isoDay() })
  await page.reload()
  await openBook(page)
  await expectOnlyUpdate(page)
  await page.getByTestId('book.updateProgress').click()
  await page.getByTestId('progress.plus').click()
  await page.getByTestId('progress.action').click()
  await expect(page.getByTestId('progress')).toBeHidden()
  await expect(page.getByTestId('book.progressFigures')).toBeVisible()
  await expect(page.getByTestId('book.progressChart')).toBeVisible()
  await expect(page.getByTestId('book.readingLog')).toBeVisible()
})

test('a value without a day: the bar and figures, no chart and no log, until a day is booked', async ({ page }) => {
  const member = await signedIn(page)
  // Begun a month ago, first value set today: #68 books no day for it.
  await createLibrary(member.client).addToLibrary(book('Piranesi', 480), { status: 'reading', startedOn: addDays(isoDay(), -30) })
  await setValue(member.email, 'page', 212)
  await page.reload()
  await openBook(page)
  await expect(page.getByTestId('book.progressBar')).toHaveAttribute('aria-valuetext', 'p. 212 of 480')
  await expect(page.getByTestId('book.progressValue')).toHaveText('212')
  await expect(page.getByTestId('book.progressPercent')).toHaveText('44 %')
  await expect(page.getByTestId('book.progressPace')).toHaveText(en.book.progress.figureNone)
  await expect(page.getByTestId('book.progressChart')).toHaveCount(0)
  await expect(page.getByTestId('book.readingLog')).toHaveCount(0)
  await expect(page.getByTestId('book.lastTime')).toHaveText('')

  // The next save books today's day: the chart and the log come in.
  await page.getByTestId('book.updateProgress').click()
  await page.getByTestId('progress.plus').click()
  await page.getByTestId('progress.action').click()
  await expect(page.getByTestId('progress')).toBeHidden()
  await expect(page.getByTestId('book.progressValue')).toHaveText('213')
  await expect(page.getByTestId('book.progressChart').locator('.col')).toHaveCount(21)
  await expect(page.getByTestId('book.logDay')).toHaveCount(1)
  await expect(page.getByTestId('book.logAmount').first()).toHaveText('+1')
})

test('a book without a page count, in percent, with a value but no day: the same', async ({ page }) => {
  const member = await signedIn(page)
  await createLibrary(member.client).addToLibrary(book('Small Gods', null), { status: 'reading', startedOn: addDays(isoDay(), -30) })
  await setValue(member.email, 'percent', 44)
  await page.reload()
  await openBook(page)
  await expect(page.getByTestId('book.progressValue')).toHaveText('44 %')
  await expect(page.getByTestId('book.progressPercent')).toHaveText('56 %')
  await expect(page.getByTestId('book.progressTotal')).toHaveText(en.book.progress.figureAddPages)
  await expect(page.getByTestId('book.progressChart')).toHaveCount(0)
  await expect(page.getByTestId('book.readingLog')).toHaveCount(0)
})

test('a value of 0 is nothing tracked: only Update progress', async ({ page }) => {
  const member = await signedIn(page)
  await createLibrary(member.client).addToLibrary(book('Piranesi', 480), { status: 'reading', startedOn: isoDay() })
  await setValue(member.email, 'page', 0)
  await page.reload()
  await openBook(page)
  await expectOnlyUpdate(page)
})
