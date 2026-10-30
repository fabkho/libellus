import { expect, type Page } from '@playwright/test'
import type { BookSnapshot } from '../app/data/books'
import { createLibrary } from '../app/data/library'
import { addDays, daysBetween, isoDay, mondayOf } from '../app/utils/dates'
import { runTitle, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { test } from './fixtures'
import { expectAccessible, openProfile, recordedApple, signedIn, untilStill } from './support'

/**
 * The Profile's chart (WP-08, backlog #11b/#11c), following the year pills: the years under All (one opens its
 * review); under a year the capsule switches Months and Weeks and steps the window (the months' ‹ › move the pill);
 * a bar opens that month's or week's books, the ends stop, and the mode and window survive a trip to a Book and
 * back. The windows' arithmetic (ISO weeks, New Year, week 53, daylight saving, the ends, the pill and the window in
 * step) is tests/stats-chart.test.ts; this is the flow. Reduce Motion is on, so the unfold is instant here.
 */
test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

const today = isoDay()
const thisYear = Number(today.slice(0, 4))

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

test('the chart follows the year pills: years under All, then months and weeks of the year, stepping with the pills', async ({ page }) => {
  await someReads(page)
  await openProfile(page)

  const period = page.getByTestId('profile.chart.period')
  const prev = page.getByTestId('profile.chart.prev')
  const next = page.getByTestId('profile.chart.next')
  const pill = (year: number) => page.getByTestId(`profile.year.${year}`)
  const lastYear = thisYear - 1

  // All, the pill she opens on: a column per year she finished in (last year's and this), no capsule, no figures.
  await expect(page.getByTestId('profile.chart.capsule')).toHaveCount(0)
  await expect(page.getByTestId('profile.chart.figures')).toHaveCount(0)
  await expect(page.getByTestId('profile.columns').locator('button, [role=img]')).toHaveCount(2)
  await expect(page.getByTestId('profile.chart.alt')).toContainText(String(lastYear))

  // A year's column opens that year in review, as before; Back returns to All.
  await page.getByTestId(`profile.columns.${lastYear}`).click()
  await expect(page).toHaveURL(new RegExp(`/profile/${lastYear}/?$`))
  await page.goBack()
  await expect(page.getByTestId('profile.library')).toBeVisible()
  await untilStill(page)

  // This year's pill: the capsule arrives on Months of that year; nothing after today, last year before.
  await pill(thisYear).click()
  await expect(period).toContainText(String(thisYear))
  await expect(page.getByTestId('profile.columns').locator('button, [role=img]')).toHaveCount(12)
  await expect(next).toBeDisabled()
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
  await expect(next).toBeDisabled()

  // Weeks: thirteen of them, the newest window, its dates under the chart.
  await page.getByTestId('profile.chart.mode.weeks').click()
  await expect(period).toContainText(/\d+–\d+ · \d{4}/)
  await expect(page.getByTestId('profile.columns').locator('button, [role=img]')).toHaveCount(13)
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

  // Months again: the year in the pill; All brings the years back and the capsule goes.
  await page.getByTestId('profile.chart.mode.months').click()
  await expect(period).toContainText(String(thisYear))
  await expect(page.getByTestId('profile.chart.caption')).toHaveCount(0)
  await page.getByTestId('profile.year.all').click()
  await expect(page.getByTestId('profile.chart.capsule')).toHaveCount(0)
  await expect(page.getByTestId('profile.columns').locator('button, [role=img]')).toHaveCount(2)
})
