import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import de from '../i18n/locales/de.json' with { type: 'json' }
import en from '../i18n/locales/en.json' with { type: 'json' }
import type { BookSnapshot } from '../app/data/books'
import { createLibrary } from '../app/data/library'
import { addDays, isoDay, parseDay } from '../app/utils/dates'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { test } from './fixtures'
import { expectAccessible, expectNoSideScroll, recordedApple, signedIn, untilStill } from './support'

/**
 * The reading log is the way in to a day she forgot to update (docs/plans/backdated-progress.md §3.3, PR 4 of 5): a row
 * is a button that opens the Update progress sheet on that day, *Add day* opens it on the newest day without an entry, and
 * Remove (the sheet's, behind its confirm) works from a row. A day that went back says "−6", not "+-6". The sheet's own
 * states are e2e/progress-earlier-day.spec.ts; this is the log: rows, Add day, the names, focus, *See all*, offline.
 * The Library is the real local stack; the read's days are booked the way the database owner would (members cannot write
 * days), on the member's own calendar days.
 *
 * `PROGRESS_DAY_SHOTS=<folder>` also writes a screenshot of every state, light and dark, 390 and 360 px wide.
 */

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

const today = isoDay()
const ago = (n: number) => addDays(today, -n)

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
    // Answered by the recorded cover (e2e/support.ts, recordedApple).
    coverUrl: `https://is1-ssl.mzstatic.com/image/thumb/Log${title.replace(/\W/g, '')}/600x900bb.jpg`,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

/** The sheet's day as it words it ("Fri 30 Oct"), English or German. */
function words(day: string, locale: 'en' | 'de' = 'en') {
  const date = parseDay(day)
  const part = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, options).format(date)
  const parts = { weekday: part({ weekday: 'short' }), day: part({ day: 'numeric' }), month: part({ month: 'short' }), year: String(date.getFullYear()) }
  const messages = locale === 'en' ? en : de
  const template = day.slice(0, 4) === today.slice(0, 4) ? messages.book.progress.dayLong : messages.book.progress.dayLongYear
  return template.replace('{weekday}', parts.weekday).replace('{day}', parts.day).replace('{month}', parts.month).replace('{year}', parts.year)
}
/** The log's day word: "Yesterday", a weekday within the week ("Sat"). */
const logDay = (n: number) => (n === 1 ? en.book.progress.dayYesterday : new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(parseDay(ago(n))))

const gain = (count: number) => en.book.progress.gainPages.replace('{count}', String(count))
const loss = (count: number) => en.book.progress.lossPages.replace('{count}', String(count))
/** "Sat +18 p. 188. Edit": what the row shows, then what it does (a name contains the visible text). */
const rowName = (day: string, amount: string, end: number) =>
  en.book.progress.logRowLabel.replace('{day}', day).replace('{amount}', amount).replace('{end}', en.book.progress.logEnd.replace('{page}', String(end)))

/**
 * A reader of Piranesi (480 pages) begun 20 days ago with three days booked: 6 days ago 0 → 40, 4 days ago 40 → 90 and
 * yesterday 90 → 140, her progress p. 140. Home's card is opened, so the log is on the page.
 */
async function reader(page: Page, { rows = [[6, null, 40], [4, 40, 90], [1, 90, 140]], current = 140, startedAgo = 20 }: { rows?: [number, number | null, number][]; current?: number; startedAgo?: number } = {}) {
  const member = await signedIn(page)
  const library = createLibrary(member.client)
  const entry = (await library.addToLibrary(book('Piranesi', 480), { status: 'reading', startedOn: ago(startedAgo) })).data!
  const session = entry.latestSession!.id
  for (const [days, start, end] of rows) {
    await sql('insert into public.reading_progress_days (session_id, day, start_page, end_page) values ($1, $2, $3, $4)', [session, ago(days), start, end])
  }
  await sql('update public.reading_sessions set progress_page = $2, progress_updated_at = now() where id = $1', [session, current])
  await page.reload()
  await expect(page.getByTestId('home.progressValue')).toContainText(String(current))
  await openBook(page)
  return { member, session }
}

async function openBook(page: Page) {
  await page.getByTestId('home.entry').click()
  await expect(page.getByTestId('book.readingLog')).toBeVisible()
  await untilStill(page)
}

/** The read's days, oldest first, as `[days ago, start, end]`. */
async function daysOf(session: string) {
  const rows = await sql<{ day: string; start_page: number | null; end_page: number }>(
    "select to_char(day, 'YYYY-MM-DD') as day, start_page, end_page from public.reading_progress_days where session_id = $1 order by day",
    [session],
  )
  return rows.map((row) => [Math.round((parseDay(today).getTime() - parseDay(row.day).getTime()) / 86_400_000), row.start_page, row.end_page])
}
const progressOf = async (session: string) => (await sql<{ progress_page: number | null }>('select progress_page from public.reading_sessions where id = $1', [session]))[0]!.progress_page

async function typeOn(page: Page, value: number, shows = value) {
  await page.getByTestId('progress.wheel').click()
  await expect(page.getByTestId('progress.wheelInput')).toBeFocused()
  await page.getByTestId('progress.wheelInput').fill(String(value))
  await page.getByTestId('progress.wheelInput').press('Enter')
  await expect(page.getByTestId('progress.wheel')).toHaveAttribute('aria-valuenow', String(shows))
}

const rows = (page: Page) => page.getByTestId('book.logDay')
const rowOf = (page: Page, daysAgo: number) => page.locator(`[data-testid="book.logDay"][data-day="${ago(daysAgo)}"]`)
async function openRow(page: Page, daysAgo: number) {
  await rowOf(page, daysAgo).click()
  await expect(page.getByTestId('progress')).toBeVisible()
  await untilStill(page)
}

test('a row is a button: it opens the sheet on that day; edited, the log, the page and Home follow', async ({ page }) => {
  const { session } = await reader(page)
  await expect(rows(page)).toHaveCount(3)
  // Newest first, each a button named "day, amount, ends at …. Edit" (the visible words first).
  await expect(rows(page).first().evaluate((el) => el.tagName)).resolves.toBe('BUTTON')
  await expect(rowOf(page, 1)).toHaveAccessibleName(rowName(logDay(1), gain(50), 140))
  await expect(rowOf(page, 4)).toHaveAccessibleName(rowName(logDay(4), gain(50), 90))
  await expect(rowOf(page, 6)).toHaveAccessibleName(rowName(logDay(6), gain(40), 40))
  await expect(rowOf(page, 4).getByTestId('book.logAmount')).toHaveText(gain(50))
  await expect(rowOf(page, 4).getByTestId('book.logEnd')).toHaveText('p. 90')

  // A middle day opens as state 3: its end on the wheel, "+50" against its start, the range, Remove.
  await openRow(page, 4)
  await expect(page.getByTestId('progress.sheetTitle')).toHaveText(en.book.progress.titleDay.replace('{day}', words(ago(4))))
  await expect(page.getByTestId('progress.wheel')).toHaveAttribute('aria-valuenow', '90')
  await expect(page.getByTestId('progress.delta')).toHaveText(gain(50))
  await expect(page.getByTestId('progress.remove')).toBeVisible()
  await expect(page.getByTestId('progress.day.pick')).toHaveAccessibleName(en.book.progress.dayPickNamed.replace('{day}', words(ago(4))))
  // Nothing changed: Save closes, and focus goes back to the row that opened the sheet.
  await page.getByTestId('progress.action').click()
  await expect(page.getByTestId('progress')).toBeHidden()
  await expect(rowOf(page, 4)).toBeFocused()
  expect(await daysOf(session)).toHaveLength(3)

  // Cancel: the same.
  await openRow(page, 6)
  await page.getByTestId('progress.cancel').click()
  await expect(page.getByTestId('progress')).toBeHidden()
  await expect(rowOf(page, 6)).toBeFocused()

  // Edit the middle day: the next one takes the pages (40 → 70 here, yesterday then reads 70).
  await openRow(page, 4)
  await typeOn(page, 70)
  await expect(page.getByTestId('progress.delta')).toHaveText(gain(30))
  await page.getByTestId('progress.action').click()
  await expect(page.getByTestId('progress')).toBeHidden()
  await expect(rowOf(page, 4).getByTestId('book.logEnd')).toHaveText('p. 70')
  await expect(rowOf(page, 4).getByTestId('book.logAmount')).toHaveText(gain(30))
  await expect(rowOf(page, 1).getByTestId('book.logAmount')).toHaveText(gain(70))
  expect(await daysOf(session)).toEqual([[6, null, 40], [4, 40, 70], [1, 70, 140]])
  expect(await progressOf(session)).toBe(140)

  // Edit the latest day: her progress follows it (Home's card and the page).
  await openRow(page, 1)
  await typeOn(page, 120)
  await expect(page.getByTestId('progress.effect')).toHaveText(en.book.progress.effectNow.replace('{value}', 'p. 120'))
  await page.getByTestId('progress.action').click()
  await expect(page.getByTestId('progress')).toBeHidden()
  await expect(rowOf(page, 1).getByTestId('book.logEnd')).toHaveText('p. 120')
  await expect(rowOf(page, 1).getByTestId('book.logAmount')).toHaveText(gain(50))
  await expect(page.getByTestId('book.progressValue')).toHaveText('120')
  expect(await progressOf(session)).toBe(120)
  await page.getByTestId('shell.tab.home').click()
  await expect(page.getByTestId('home.progressValue')).toHaveText('p. 120 of 480')
})

test('Add day opens the sheet on the newest day without an entry, and the new day joins the log', async ({ page }) => {
  const { session } = await reader(page)
  const add = page.getByTestId('book.logAdd')
  await expect(add).toHaveText(en.book.progress.logAdd)
  await expect(add).toHaveAccessibleName(en.book.progress.logAddLabel)
  await expect(add).toHaveAttribute('aria-haspopup', 'dialog')
  // The name contains the words on it (WCAG 2.5.3).
  expect(en.book.progress.logAddLabel).toContain(en.book.progress.logAdd)

  // Days 6, 4 and 1 ago have an entry: two days ago is the newest one without.
  await add.click()
  await expect(page.getByTestId('progress')).toBeVisible()
  await untilStill(page)
  await expect(page.getByTestId('progress.sheetTitle')).toHaveText(en.book.progress.titleDay.replace('{day}', words(ago(2))))
  await expect(page.getByTestId('progress.wheel')).toHaveAttribute('aria-valuenow', '90')
  await expect(page.getByTestId('progress.remove')).toBeHidden()
  // Cancel gives focus back to Add day.
  await page.getByTestId('progress.cancel').click()
  await expect(page.getByTestId('progress')).toBeHidden()
  await expect(add).toBeFocused()
  expect(await daysOf(session)).toHaveLength(3)

  await add.click()
  await untilStill(page)
  await typeOn(page, 110)
  await expect(page.getByTestId('progress.delta')).toHaveText(gain(20))
  await page.getByTestId('progress.action').click()
  await expect(page.getByTestId('progress')).toBeHidden()
  await expect(rows(page)).toHaveCount(4)
  await expect(rowOf(page, 2)).toHaveAccessibleName(rowName(logDay(2), gain(20), 110))
  await expect(rowOf(page, 1).getByTestId('book.logAmount')).toHaveText(gain(30))
  expect(await daysOf(session)).toEqual([[6, null, 40], [4, 40, 90], [2, 90, 110], [1, 110, 140]])
  expect(await progressOf(session)).toBe(140)
  await expect(add).toBeFocused()

  // The next Add day goes further back: three days ago.
  await add.click()
  await untilStill(page)
  await expect(page.getByTestId('progress.sheetTitle')).toHaveText(en.book.progress.titleDay.replace('{day}', words(ago(3))))
  await page.getByTestId('progress.cancel').click()
})

test('Add day with every day since the start recorded opens yesterday, with its entry', async ({ page }) => {
  await reader(page, { rows: [[2, null, 30], [1, 30, 60]], current: 60, startedAgo: 2 })
  await page.getByTestId('book.logAdd').click()
  await untilStill(page)
  await expect(page.getByTestId('progress.sheetTitle')).toHaveText(en.book.progress.titleDay.replace('{day}', words(ago(1))))
  await expect(page.getByTestId('progress.remove')).toBeVisible()
})

test('Remove from a row: the latest day lowers her progress after the confirm, a day in the middle lets the next absorb its pages', async ({ page }) => {
  const { session } = await reader(page)

  // A day in the middle: the confirm says where the pages go; her progress stays.
  await openRow(page, 4)
  await page.getByTestId('progress.remove').click()
  const confirm = page.getByTestId('removeDay')
  await expect(confirm).toBeVisible()
  await expect(confirm).toContainText(
    en.book.progress.removeDay.text.replace('{amount}', '50 pages').replace('{next}', en.book.progress.dayYesterdayInline).replace('{value}', 'p. 140'),
  )
  await page.getByTestId('removeDay.confirm').click()
  await expect(page.getByTestId('progress')).toBeHidden()
  await expect(rows(page)).toHaveCount(2)
  await expect(rowOf(page, 1).getByTestId('book.logAmount')).toHaveText(gain(100))
  await expect(rowOf(page, 1).getByTestId('book.logEnd')).toHaveText('p. 140')
  expect(await daysOf(session)).toEqual([[6, null, 40], [1, 40, 140]])
  expect(await progressOf(session)).toBe(140)
  // The row it came from is gone: focus is on something, Add day.
  await expect(page.getByTestId('book.logAdd')).toBeFocused()

  // The latest day: the confirm says her progress goes back; Keep it leaves everything.
  await openRow(page, 1)
  await page.getByTestId('progress.remove').click()
  await expect(confirm).toContainText(en.book.progress.removeDay.textLatest.replace('{value}', 'p. 40'))
  await page.getByTestId('removeDay.cancel').click()
  await expect(page.getByTestId('progress')).toBeVisible()
  expect(await daysOf(session)).toHaveLength(2)
  await page.getByTestId('progress.remove').click()
  await page.getByTestId('removeDay.confirm').click()
  await expect(page.getByTestId('progress')).toBeHidden()
  await expect(rows(page)).toHaveCount(1)
  expect(await daysOf(session)).toEqual([[6, null, 40]])
  expect(await progressOf(session)).toBe(40)
  await expect(page.getByTestId('book.progressValue')).toHaveText('40')
  await page.getByTestId('shell.tab.home').click()
  await expect(page.getByTestId('home.progressValue')).toHaveText('p. 40 of 480')
})

test('a day that went back reads "−6" in the quiet ink, not "+-6", and can be edited and removed', async ({ page }) => {
  // 6 days ago 0 → 40, 4 days ago 40 → 34 (she re-read), yesterday 34 → 60.
  const { session } = await reader(page, { rows: [[6, null, 40], [4, 40, 34], [1, 34, 60]], current: 60 })
  await expect(rows(page)).toHaveCount(3)
  const amount = rowOf(page, 4).getByTestId('book.logAmount')
  await expect(amount).toHaveText(loss(6))
  await expect(amount).not.toContainText('+')
  await expect(amount).toHaveClass(/text-ink-faint/)
  await expect(rowOf(page, 1).getByTestId('book.logAmount')).toHaveClass(/text-accent-ink/)
  await expect(rowOf(page, 4)).toHaveAccessibleName(rowName(logDay(4), loss(6), 34))

  await openRow(page, 4)
  await expect(page.getByTestId('progress.wheel')).toHaveAttribute('aria-valuenow', '34')
  await expect(page.getByTestId('progress.delta')).toHaveText(loss(6))
  await typeOn(page, 50)
  await page.getByTestId('progress.action').click()
  await expect(page.getByTestId('progress')).toBeHidden()
  await expect(rowOf(page, 4).getByTestId('book.logAmount')).toHaveText(gain(10))
  await expect(rowOf(page, 4).getByTestId('book.logAmount')).toHaveClass(/text-accent-ink/)
  expect(await daysOf(session)).toEqual([[6, null, 40], [4, 40, 50], [1, 50, 60]])
})

test('older days: fourteen show, See all opens the rest in place', async ({ page }) => {
  // 20 days of +5, the newest yesterday.
  const rowsOf: [number, number | null, number][] = Array.from({ length: 20 }, (_, i) => [20 - i, i === 0 ? null : i * 5, (i + 1) * 5])
  await reader(page, { rows: rowsOf, current: 100, startedAgo: 25 })
  await expect(rows(page)).toHaveCount(14)
  const all = page.getByTestId('book.logAll')
  await expect(all).toHaveText(en.book.progress.logSeeAll.replace('{count}', '20'))
  await expect(all).toHaveAccessibleName(en.book.progress.logSeeAllLabel.replace('{count}', '20'))
  await all.click()
  await expect(rows(page)).toHaveCount(20)
  await expect(all).toBeHidden()
  // Focus goes to the first of the rows that came in.
  await expect(rows(page).nth(14)).toBeFocused()
  // An old one opens the sheet on its day.
  await rowOf(page, 20).click()
  await expect(page.getByTestId('progress.sheetTitle')).toHaveText(en.book.progress.titleDay.replace('{day}', words(ago(20))))
  await expect(page.getByTestId('progress.wheel')).toHaveAttribute('aria-valuenow', '5')
})

test('a read begun today has no Add day, and its row opens Today\'s sheet', async ({ page }) => {
  const member = await signedIn(page)
  const entry = (await createLibrary(member.client).addToLibrary(book('Piranesi', 480), { status: 'reading', startedOn: today })).data!
  await sql('insert into public.reading_progress_days (session_id, day, start_page, end_page) values ($1, $2, $3, $4)', [entry.latestSession!.id, today, null, 30])
  await sql('update public.reading_sessions set progress_page = 30, progress_updated_at = now() where id = $1', [entry.latestSession!.id])
  await page.reload()
  await openBook(page)
  await expect(rows(page)).toHaveCount(1)
  await expect(page.getByTestId('book.logAdd')).toHaveCount(0)
  await rows(page).first().click()
  await expect(page.getByTestId('progress.sheetTitle')).toHaveText(en.book.progress.title)
  await expect(page.getByTestId('progress.wheel')).toHaveAttribute('aria-valuenow', '30')
})

test('offline, Remove waits (the log drops the day at once) and her progress follows after the sync', async ({ page }) => {
  const { session } = await reader(page)
  // The book page is open with its days; the connection goes.
  await page.context().setOffline(true)
  await openRow(page, 1)
  await page.getByTestId('progress.remove').click()
  await expect(page.getByTestId('removeDay')).toBeVisible()
  await page.getByTestId('removeDay.confirm').click()
  await expect(page.getByTestId('progress')).toBeHidden()
  // The overlay: the day is gone from the log at once; the database has not heard and her progress has not moved.
  await expect(rows(page)).toHaveCount(2)
  await expect(rowOf(page, 1)).toHaveCount(0)
  expect(await daysOf(session)).toHaveLength(3)
  expect(await progressOf(session)).toBe(140)
  // The chip on Home says a change waits; the card keeps its value until the sync.
  await page.getByTestId('shell.tab.home').click()
  await expect(page.getByTestId('shell.syncLabel')).toHaveText(en.sync.chip.replace('{count}', '1'))
  await expect(page.getByTestId('home.progressValue')).toHaveText('p. 140 of 480')

  // Back online: it syncs by itself; the day is gone for good and her progress went back.
  await page.context().setOffline(false)
  await expect(page.getByTestId('shell.sync')).toBeHidden()
  await expect.poll(() => daysOf(session)).toEqual([[6, null, 40], [4, 40, 90]])
  expect(await progressOf(session)).toBe(90)
  await expect(page.getByTestId('home.progressValue')).toHaveText('p. 90 of 480')
  await page.getByTestId('home.entry').click()
  await expect(rows(page)).toHaveCount(2)
  await expect(page.getByTestId('book.progressValue')).toHaveText('90')
})

test.describe('accessibility, dark', { tag: '@full' }, () => {
  test.use({ colorScheme: 'dark', viewport: { width: 412, height: 915 } })

  test('the reading log with Add day and its rows, and the sheet a row opens', async ({ page }) => {
    await reader(page, { rows: [[6, null, 40], [4, 40, 34], [1, 34, 60]], current: 60 })
    await expectAccessible(page, 'The reading log with Add day and a day that went back')
    await openRow(page, 4)
    await expectAccessible(page, 'Progress on an earlier day, opened from a log row')
  })

  test('the log with See all', async ({ page }) => {
    const rowsOf: [number, number | null, number][] = Array.from({ length: 20 }, (_, i) => [20 - i, i === 0 ? null : i * 5, (i + 1) * 5])
    await reader(page, { rows: rowsOf, current: 100, startedAgo: 25 })
    await expect(page.getByTestId('book.logAll')).toBeVisible()
    await expectAccessible(page, 'The reading log, fourteen days and See all')
  })
})

// ------------------------------------------------------------------------------------------------ widths and the shots

/** The log at a narrow phone: nothing sticks out, the head holds on one row, the touch boxes are 44 pt, the rows 48. */
async function expectLogFits(page: Page, where: string) {
  await expectNoSideScroll(page, where)
  const head = await page.getByTestId('book.logAdd').evaluate((add) => {
    const section = add.closest('section')!
    const title = section.querySelector('h2')!.getBoundingClientRect()
    const pill = add.getBoundingClientRect()
    return { sameRow: Math.abs(title.y + title.height / 2 - (pill.y + pill.height / 2)) < 4, pillHeight: pill.height, pillRight: pill.right, section: section.getBoundingClientRect().right }
  })
  expect.soft(head.sameRow, `${where}: Add day is on the heading's row`).toBe(true)
  expect.soft(head.pillHeight, `${where}: the drawn pill`).toBeGreaterThanOrEqual(32)
  const small = await rows(page).evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height).filter((h) => h < 48))
  expect.soft(small, `${where}: a row under 48 px`).toEqual([])
  // No amount or end is cut off by the row's truncation.
  const cut = await page.evaluate(() => [...document.querySelectorAll('[data-testid="book.logDay"] span')].filter((el) => el.scrollWidth > el.clientWidth + 1).length)
  expect.soft(cut, `${where}: a row's figures are cut off`).toBe(0)
}

const OUT = process.env.PROGRESS_DAY_SHOTS
const SIZES = [
  { name: '390', viewport: { width: 390, height: 844 } },
  { name: '360', viewport: { width: 360, height: 780 } },
]
// A pull request's flow checks the narrow phone in English (dark) and in German (light); the whole matrix is for the screenshots.
const PASSES = (locale: string, theme: string, size: string) => Boolean(OUT) || (size === '360' && ((locale === 'en' && theme === 'dark') || (locale === 'de' && theme === 'light')))

for (const locale of ['en', 'de'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    for (const size of SIZES) {
      if (!PASSES(locale, theme, size.name)) continue
      test.describe(`the log, ${locale}, ${theme}, ${size.name}`, () => {
        test.use({ locale: locale === 'de' ? 'de-DE' : 'en-US', colorScheme: theme, viewport: size.viewport })
        test('fits and, with PROGRESS_DAY_SHOTS, is drawn', async ({ page }) => {
          test.setTimeout(120_000)
          if (OUT) mkdirSync(join(OUT, 'shots'), { recursive: true })
          await page.addInitScript((value) => localStorage.setItem('libellus-theme', value), theme)
          const messages = locale === 'de' ? de : en
          // The plan's mock numbers (96, 120, 151, 170, 188), one day that went back, 17 days: fourteen show and See all.
          let end = 0
          const deltas = [30, 28, 38, 24, 31, 19, 18, -6, 22, 17, 25, 19, 26, 20, 18, 18, 44]
          const chain = deltas.map((delta, i): [number, number | null, number] => {
            const start = i === 0 ? null : end
            end += delta
            return [deltas.length - i, start, end]
          })
          await reader(page, { rows: chain, current: end, startedAgo: 30 })
          const shot = async (state: string) => {
            await untilStill(page)
            if (!OUT) return
            await page.evaluate(async () => {
              for (let round = 0; round < 50 && document.getAnimations().some((a) => a.effect?.getTiming().iterations !== Infinity); round++) await new Promise((resolve) => setTimeout(resolve, 50))
            })
            await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
            await page.waitForTimeout(300)
            await page.screenshot({ path: join(OUT, 'shots', `${state}-${locale}-${theme}-${size.name}.png`) })
          }
          await expect(page.getByTestId('book.logAdd')).toHaveText(messages.book.progress.logAdd)
          await page.getByTestId('book.readingLog').scrollIntoViewIfNeeded()
          await page.getByTestId('book.readingLog').evaluate((el) => el.scrollIntoView({ block: 'start' }))
          await expectLogFits(page, `The log (${locale}, ${size.name})`)
          await shot('7-log')
          await page.getByTestId('book.logAll').evaluate((el) => el.scrollIntoView({ block: 'center' }))
          await expect(page.getByTestId('book.logAll')).toHaveText(messages.book.progress.logSeeAll.replace('{count}', String(deltas.length)))
          await expectLogFits(page, `The log with See all (${locale}, ${size.name})`)
          await shot('7b-log-see-all')
          await page.getByTestId('book.logAll').click()
          await expect(rows(page)).toHaveCount(deltas.length)
          await shot('7c-log-all-open')
          await page.getByTestId('book.readingLog').evaluate((el) => el.scrollIntoView({ block: 'start' }))

          // A row opens the sheet on its day: state 3 of the sheet.
          await openRow(page, 5)
          await expect(page.getByTestId('progress.remove')).toBeVisible()
          await shot('8-log-row-editor')
          await page.getByTestId('progress.remove').click()
          await expect(page.getByTestId('removeDay')).toBeVisible()
          await expectNoSideScroll(page, `Remove from a row (${locale}, ${size.name})`)
          await shot('9-log-remove-confirm')
          await page.getByTestId('removeDay.cancel').click()
          await page.getByTestId('progress.cancel').click()
          await expect(page.getByTestId('progress')).toBeHidden()

          await page.getByTestId('book.logAdd').click()
          await expect(page.getByTestId('progress')).toBeVisible()
          await expect(page.getByTestId('progress.remove')).toBeHidden()
          await shot('10-log-add-day')
          await page.getByTestId('progress.cancel').click()
          await expect(page.getByTestId('progress')).toBeHidden()

          // Large text (200 %): the head and the rows reflow.
          await page.addStyleTag({ content: 'html { font-size: 200% !important }' })
          await untilStill(page)
          await page.getByTestId('book.readingLog').evaluate((el) => el.scrollIntoView({ block: 'start' }))
          // The log itself (the page's other lines at 200 % are not this screen's): nothing leaves the screen, the pill holds its words.
          const out = await page.getByTestId('book.readingLog').evaluate((log) =>
            [...log.querySelectorAll('*')]
              .map((el) => [el.getAttribute('data-testid') ?? el.tagName, el.getBoundingClientRect()] as const)
              .filter(([, box]) => box.width > 1 && (box.right > innerWidth + 0.5 || box.left < -0.5))
              .map(([name, box]) => `${name} ${Math.round(box.left)}…${Math.round(box.right)}`),
          )
          expect.soft(out, `The log at 200 % text (${locale}, ${size.name}): elements leave the screen`).toEqual([])
          const pill = await page.getByTestId('book.logAdd').evaluate((el) => ({ scroll: el.scrollWidth - el.clientWidth, height: el.getBoundingClientRect().height }))
          expect.soft(pill.scroll, `The log at 200 % text (${locale}, ${size.name}): Add day's words run out of it`).toBeLessThanOrEqual(1)
          await shot('11-log-large-text')
        })
      })
    }
  }
}
