import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import type { BookSnapshot } from '../app/data/books'
import { createLibrary } from '../app/data/library'
import { addDays, isoDay } from '../app/utils/dates'
import { sql, runTitle, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { test } from './fixtures'
import { recordedApple, settledBox, signedIn, untilStill } from './support'

/**
 * The book page before any progress was tracked (issue #79). A read with no value
 * and no `reading_progress_days` row shows only Update progress; the first save
 * opens the four figures, the chart and the reading log in with a fade; a value
 * without a day row (set long after the start, or a percent-only book) shows the
 * bar and figures but no chart or log. The rule is `progressShownOf`
 * (data/progressDays.ts, tests/progress-days.test.ts).
 *
 * Issue #81: before any progress the page already has the tracked layout's
 * skeleton, the empty bar and a row with the value in words (the page count) at
 * the left and Update progress at the right; the first save only changes the
 * words and the bar's fill and fades the rest in below, so the bar, the row and
 * the button stay where they are.
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

/** The bar and its row, nothing else (what a read never tracked shows): `words` is the row's text. */
async function expectNeverTracked(page: Page, words: string) {
  await expect(page.getByTestId('book.updateProgress')).toBeVisible()
  await expect(page.getByTestId('book.progressBar')).toBeVisible()
  await expect(page.getByTestId('book.progressBar')).toHaveAttribute('aria-valuenow', '0')
  await expect(page.getByTestId('book.progressText')).toHaveText(words)
  for (const id of ['book.progressStats', 'book.progressFigures', 'book.progressChart', 'book.lastTime', 'book.readingLog']) {
    await expect(page.getByTestId(id)).toHaveCount(0)
  }
}

/** Where the skeleton's parts are on the page (the page is scrolled to the top, so the viewport's box does for it). */
async function skeleton(page: Page) {
  const boxes: Record<string, { x: number; y: number; width: number; height: number }> = {}
  for (const id of ['book.status', 'book.progressBar', 'book.progressText', 'book.updateProgress']) boxes[id] = (await page.getByTestId(id).boundingBox())!
  return boxes
}

async function openBook(page: Page) {
  await page.getByTestId('home.entry').click()
  await expect(page.getByTestId('book.updateProgress')).toBeVisible()
}

test('never tracked: the empty bar and its row; the first save changes the words and brings the figures, chart and log in below; Undo takes them back', async ({ page }) => {
  // With motion (the config has Reduce Motion on): the figures come in below; the next test is the same without.
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const member = await signedIn(page)
  await createLibrary(member.client).addToLibrary(book('Piranesi', 480), { status: 'reading', startedOn: isoDay() })
  await page.reload()
  await openBook(page)
  await expectNeverTracked(page, 'Not started · 480 pages')
  await untilStill(page)

  // Finish sits under the row; remember how far it is from the status line (the page may scroll).
  const gap = async () =>
    (await page.getByTestId('book.finish').boundingBox())!.y - (await page.getByTestId('book.status').boundingBox())!.y
  const before = await gap()
  const bare = await skeleton(page)

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
  await expect(page.getByTestId('book.progressText')).toHaveText('p. 3 of 480')
  // They opened a room under the row: Finish moved down, once, and stayed; the bar, the row and the button did not move at all.
  await untilStill(page)
  expect(await gap()).toBeGreaterThan(before + 60)
  const tracked = await skeleton(page)
  for (const id of ['book.status', 'book.progressBar', 'book.updateProgress']) expect(tracked[id], id).toEqual(bare[id])
  expect(tracked['book.progressText']!.x).toBe(bare['book.progressText']!.x)
  expect(tracked['book.progressText']!.y).toBe(bare['book.progressText']!.y)
  await expect(page.getByTestId('book.progressStats')).toHaveCSS('opacity', '1')
  await expect(page.getByTestId('book.progressStats')).not.toHaveAttribute('data-moving')

  // Undo on Home puts the read back to nothing tracked: the book page is bare again.
  await page.getByTestId('shell.tab.home').click()
  await page.getByTestId('home.undo').click()
  await page.getByTestId('home.entry').click()
  await expectNeverTracked(page, 'Not started · 480 pages')
  // In the database it is none again, not page 0 (#104).
  const [stored] = await sql<{ progress_page: number | null; progress_percent: number | null; progress_updated_at: string | null }>(
    `select s.progress_page, s.progress_percent, s.progress_updated_at
       from public.reading_sessions s
       join public.library_entries e on e.id = s.entry_id
       join auth.users u on u.id = e.member_id
      where u.email = $1 and s.outcome is null`,
    [member.email],
  )
  expect(stored).toEqual({ progress_page: null, progress_percent: null, progress_updated_at: null })
})

test('Reduce Motion: the first save still brings everything in, with no travel', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const member = await signedIn(page)
  await createLibrary(member.client).addToLibrary(book('Piranesi', 480), { status: 'reading', startedOn: isoDay() })
  await page.reload()
  await openBook(page)
  await expectNeverTracked(page, 'Not started · 480 pages')
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
  await expect(page.getByTestId('book.lastTime')).toHaveCount(0)

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

test('a value without a day holds no room for a chart while the days load: nothing moves when they turn out to be none (#104)', async ({ page }) => {
  const member = await signedIn(page)
  await createLibrary(member.client).addToLibrary(book('Piranesi', 480), { status: 'reading', startedOn: addDays(isoDay(), -30) })
  await setValue(member.email, 'page', 212)
  // The days come late, as on a slow cold open.
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => (release = resolve))
  await page.route('**/rest/v1/reading_progress_days*', async (route) => {
    await held
    await route.continue()
  })
  await page.reload()
  await openBook(page)
  await expect(page.getByTestId('book.progressValue')).toHaveText('212')
  const before = await settledBox(page.getByTestId('book.finish'))
  expect(await page.getByTestId('book.progressChart').count()).toBe(0)

  release()
  await page.waitForResponse((response) => response.url().includes('reading_progress_days'))
  await expect(page.getByTestId('book.progressChart')).toHaveCount(0)
  const after = await settledBox(page.getByTestId('book.finish'))
  expect(after.y).toBe(before.y)
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

test('a value of 0 is nothing tracked: the empty bar and its row', async ({ page }) => {
  const member = await signedIn(page)
  await createLibrary(member.client).addToLibrary(book('Piranesi', 480), { status: 'reading', startedOn: isoDay() })
  await setValue(member.email, 'page', 0)
  await page.reload()
  await openBook(page)
  await expectNeverTracked(page, 'Not started · 480 pages')
})

test('a book without a page count, never tracked: the row says so; the first save fills in the percent', async ({ page }) => {
  const member = await signedIn(page)
  await createLibrary(member.client).addToLibrary(book('Small Gods', null), { status: 'reading', startedOn: isoDay() })
  await page.reload()
  await openBook(page)
  await expectNeverTracked(page, en.book.progress.notStartedNoCount)
  await page.getByTestId('book.updateProgress').click()
  await page.getByTestId('progress.plus').click()
  await page.getByTestId('progress.action').click()
  await expect(page.getByTestId('progress')).toBeHidden()
  await expect(page.getByTestId('book.progressText')).toHaveText('1 %')
  await expect(page.getByTestId('book.progressFigures')).toBeVisible()
})
