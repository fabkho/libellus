import { expect, type Page } from '@playwright/test'
import type { BookSnapshot } from '../app/data/books'
import { createLibrary } from '../app/data/library'
import { addDays, daysBetween, mondayOf } from '../app/utils/dates'
import { runTitle, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { test } from './fixtures'
import { expectAccessible, openProfile, recordedApple, signedIn, untilStill } from './support'

/**
 * The Profile's chart (WP-08, backlog #11b/#11c), following the year pills; the capsule is there under every pill.
 * Under All it reads "All years" and the chart is the years (one opens its review); ‹ › walk the pills along time (All,
 * the newest year, older ones: the overview after the newest year), Weeks picked under All open on the newest year.
 * Under a year the capsule switches Months and Weeks and steps the window (the months' ‹ › move the pill);
 * a bar opens that month's or week's books, the ends stop, and the mode and window survive a trip to a Book and
 * back. The windows' arithmetic (ISO weeks, New Year, week 53, daylight saving, the ends, the pill and the window in
 * step) is tests/stats-chart.test.ts; this is the flow. Reduce Motion is on, so the unfold is instant here.
 *
 * The flows run on one day, `today`, in the browser (its clock) and in the reads they seed. On the real day the walk
 * held only from late July to December: before that, 200 days back is last year's and the weeks have fewer than three
 * windows behind the newest (in January also 420 days back is the year before and 3 days back last year's), so every
 * run from 1 January would have failed. The day is in the past, so no seeded read lies in the stack's future.
 *
 * Three flows, not one: the walk took 50–60 s on the release run's runner (Linux WebKit, three workers on four cores)
 * against a 60 s budget, and timed out wherever the budget ran out (release 1.31.0, pull request #457).
 */
const today = '2026-10-28'
const thisYear = Number(today.slice(0, 4))
const lastYear = thisYear - 1

test.beforeEach(async ({ page }) => {
  // Noon UTC: the same day wherever the browser is.
  await page.clock.install({ time: new Date(`${today}T12:00:00Z`) })
  await recordedApple(page)
})

function book(title: string): BookSnapshot {
  return {
    title: runTitle(title),
    authors: ['Susanna Clarke'],
    isbn13: null,
    isbn10: null,
    pageCount: 272,
    year: 2020,
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

/** Finished reads 3, 10 (two), 45, 200 and 420 days ago: this week or the last, an older week, a month, last year's. */
async function someReads(page: Page) {
  const member = await signedIn(page)
  const library = createLibrary(member.client)
  const reads = [
    ['Piranesi', -3],
    ['Dune', -10],
    ['Emma', -10],
    ['Kafka on the Shore', -45],
    ['Middlemarch', -200],
    ['Beloved', -420],
  ] as const
  for (const [title, back] of reads) {
    await library.addToLibrary(book(title), { status: 'finished', startedOn: addDays(today, back - 7), endedOn: addDays(today, back) })
  }
  return member
}

/** Her Profile on the reads above, at rest, and the chart's controls. */
async function chart(page: Page) {
  await someReads(page)
  await openProfile(page)
  return {
    period: page.getByTestId('profile.chart.period'),
    prev: page.getByTestId('profile.chart.prev'),
    next: page.getByTestId('profile.chart.next'),
    pill: (year: number | 'all') => page.getByTestId(`profile.year.${year}`),
    columns: page.getByTestId('profile.columns').locator('button, [role=img]'),
  }
}

test('under All the chart is the years, and ‹ › walk All and the years with the pills', async ({ page }) => {
  const { period, prev, next, pill, columns } = await chart(page)

  // All, the pill she opens on: the capsule reads "All years" and a column per year she finished in (last year's and this), no figures.
  await expect(page.getByTestId('profile.chart.capsule')).toBeVisible()
  await expect(period).toContainText('All years')
  await expect(next).toBeDisabled()
  await expect(prev).toBeEnabled()
  await expect(page.getByTestId('profile.chart.caption')).toHaveCount(0)
  await expect(page.getByTestId('profile.chart.figures')).toHaveCount(0)
  await expect(columns).toHaveCount(2)
  await expect(page.getByTestId('profile.chart.alt')).toContainText(String(lastYear))
  await expectAccessible(page, 'the chart under All')

  // A year's column opens that year in review, as before; Back returns to All.
  await page.getByTestId(`profile.columns.${lastYear}`).click()
  await expect(page).toHaveURL(new RegExp(`/profile/${lastYear}/?$`))
  await page.goBack()
  await expect(page.getByTestId('profile.library')).toBeVisible()
  await untilStill(page)

  // ‹ from All goes to the newest year and moves the pill; › comes back to All, where it stops.
  await prev.click()
  await expect(period).toContainText(String(thisYear))
  await expect(pill(thisYear)).toHaveAttribute('aria-pressed', 'true')
  await expect(pill('all')).toHaveAttribute('aria-pressed', 'false')
  await expect(columns).toHaveCount(12)
  await expect(next).toBeEnabled()
  await next.click()
  await expect(period).toContainText('All years')
  await expect(pill('all')).toHaveAttribute('aria-pressed', 'true')
  await expect(next).toBeDisabled()

  // This year's pill: the capsule arrives on Months of that year; › is the overview, last year before.
  await pill(thisYear).click()
  await expect(period).toContainText(String(thisYear))
  await expect(columns).toHaveCount(12)
  await expect(next).toBeEnabled()
  await expect(prev).toBeEnabled()
  await expect(page.getByTestId('profile.chart.caption')).toHaveCount(0)
  await expect(page.getByTestId('profile.chart.figures')).toHaveCount(0)

  // ‹ steps the year and the pill with it, to the one holding her first finish, where it stops; › comes back.
  await prev.click()
  await expect(period).toContainText(String(lastYear))
  await expect(pill(lastYear)).toHaveAttribute('aria-pressed', 'true')
  await expect(pill(thisYear)).toHaveAttribute('aria-pressed', 'false')
  await expect(prev).toBeDisabled()
  await expect(next).toBeEnabled()
  // And the other way round: a pill moves the chart.
  await pill(thisYear).click()
  await expect(period).toContainText(String(thisYear))
  await expect(next).toBeEnabled()
})

test('Weeks open on the newest thirteen weeks with their figures; a bar opens its books, and the window survives a trip to a Book', async ({ page }) => {
  const { period, next, prev, pill, columns } = await chart(page)

  // Weeks picked under All open on the newest year's weeks and move the pill there; Months bring the year back, › the overview.
  await page.getByTestId('profile.chart.mode.weeks').click()
  await expect(pill(thisYear)).toHaveAttribute('aria-pressed', 'true')
  await expect(period).toContainText(/\d+–\d+ · \d{4}/)
  await expect(columns).toHaveCount(13)
  await expect(page.getByTestId('profile.chart.caption')).toBeVisible()
  await page.getByTestId('profile.chart.mode.months').click()
  await expect(period).toContainText(String(thisYear))
  await page.waitForTimeout(450) // an arrow tapped within 400 ms of a mode switch is a double tap, which the capsule ignores
  await next.click()
  await expect(period).toContainText('All years')

  // Weeks: thirteen of them, the newest window, its dates under the chart.
  await page.getByTestId('profile.chart.mode.weeks').click()
  await expect(pill(thisYear)).toHaveAttribute('aria-pressed', 'true')
  await expect(period).toContainText(/\d+–\d+ · \d{4}/)
  await expect(columns).toHaveCount(13)
  await expect(page.getByTestId('profile.chart.caption')).toBeVisible()
  await expect(next).toBeDisabled()
  await expect(prev).toBeEnabled()
  await expect(page.getByTestId('profile.chart.alt')).toContainText('Week')
  await expectAccessible(page, 'the chart by week')

  // The figures under the chart follow the window: the reads of the last 13 weeks (91 days) are 4 of the 6.
  await expect(page.getByTestId('profile.chart.figure.books')).toHaveText('4')

  // The week 10 days ago holds Dune and Emma: its bar opens them.
  const monday = mondayOf(addDays(today, -10))
  const key = 13 - daysBetween(monday, mondayOf(today)) / 7
  await page.getByTestId(`profile.columns.${key}`).click()
  await expect(page.getByTestId('profileReads.row')).toHaveCount(2)
  await expect(page.getByTestId('profileReads.sheetTitle')).toContainText(/^Week of /)
  await untilStill(page)

  // A Book opened from the sheet, and back: the chart is still by week, on the same window.
  await page.getByTestId('profileReads.read').first().click()
  await expect(page.getByTestId('book.title')).toBeVisible()
  await page.goBack()
  await expect(page.getByTestId('profileReads.row')).toHaveCount(2)
  await page.getByTestId('profileReads.cancel').click()
  await untilStill(page)
  await expect(page.getByTestId('profile.chart.caption')).toBeVisible()
  await expect(next).toBeDisabled()
  await expect(page.getByTestId('profile.chart.figure.books')).toHaveText('4')
})

test('the weeks step within the year and stop at its ends; the All pill brings the years and Months back', async ({ page }) => {
  const { period, prev, next, pill, columns } = await chart(page)

  await page.getByTestId('profile.chart.mode.weeks').click()
  await expect(pill(thisYear)).toHaveAttribute('aria-pressed', 'true')
  await expect(next).toBeDisabled()
  await expect(page.getByTestId('profile.chart.figure.books')).toHaveText('4')
  await page.waitForTimeout(450) // an arrow tapped within 400 ms of a mode switch is a double tap, which the capsule ignores

  // The pill stays on this year all through the weeks: a quarter back holds none of them, two back holds Middlemarch
  // (200 days ago); › comes back to the newest.
  await prev.click()
  await expect(next).toBeEnabled()
  await expect(page.getByTestId('profile.chart.figure.books')).toHaveText('0')
  await prev.click()
  await expect(page.getByTestId('profile.chart.figure.books')).toHaveText('1')
  await next.click()
  await next.click()
  await expect(next).toBeDisabled()
  await expect(page.getByTestId('profile.chart.figure.books')).toHaveText('4')

  // The windows stop where this year does: ‹ goes on to the one holding 1 January's week and no further.
  while (await prev.isEnabled()) await prev.click()
  await expect(page.getByTestId('profile.chart.alt')).toContainText(String(thisYear))
  await expect(next).toBeEnabled()
  await expect(pill(thisYear)).toHaveAttribute('aria-pressed', 'true')

  // Months again: the year in the pill; All brings the years back, the capsule stays on its overview; from the weeks, the All pill brings Months with it.
  await page.getByTestId('profile.chart.mode.months').click()
  await expect(period).toContainText(String(thisYear))
  await expect(page.getByTestId('profile.chart.caption')).toHaveCount(0)
  await page.getByTestId('profile.chart.mode.weeks').click()
  await expect(page.getByTestId('profile.chart.caption')).toBeVisible()
  await page.getByTestId('profile.year.all').click()
  await expect(page.getByTestId('profile.chart.capsule')).toBeVisible()
  await expect(period).toContainText('All years')
  await expect(page.getByTestId('profile.chart.caption')).toHaveCount(0)
  await expect(columns).toHaveCount(2)
  await pill(lastYear).click()
  await expect(period).toContainText(String(lastYear)) // Months: the overview took the weeks back
})
