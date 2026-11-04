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
import { expectAccessible, expectNoSideScroll, goto, openProfile, recordedApple, signedIn, untilStill } from './support'

/**
 * Progress on an earlier day, the sheet's day switch (docs/plans/backdated-progress.md §3, PR 3 of 5): a member who forgot
 * to update records a day by the pill (Yesterday) or by the platform's date input (any other day), sees the range the
 * wheel may move in and what else changes, saves, and finds Home and the Profile changed; removes the latest day behind
 * a confirm that says her progress goes back. The database's rules are pgTAP's and the pure rules Vitest's
 * (tests/progress-day-*.test.ts); this is the screen. The Library is the real local stack; the read's days are booked the
 * way the database owner would (members cannot write days), on the member's own calendar days.
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
    coverUrl: `https://is1-ssl.mzstatic.com/image/thumb/Progress${title.replace(/\W/g, '')}/600x900bb.jpg`,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

/** The day as the sheet words it ("Fri 30 Oct"; the year only in another year), in English or German. */
function words(day: string, locale: 'en' | 'de' = 'en') {
  const date = parseDay(day)
  const part = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, options).format(date)
  const parts = { weekday: part({ weekday: 'short' }), day: part({ day: 'numeric' }), month: part({ month: 'short' }), year: String(date.getFullYear()) }
  const messages = locale === 'en' ? en : de
  const template = day.slice(0, 4) === today.slice(0, 4) ? messages.book.progress.dayLong : messages.book.progress.dayLongYear
  return template.replace(/\{(\w+)\}/g, (_, key: keyof typeof parts) => parts[key])
}

/** "+8", "−6": a day's amount as the sheet words it in pages. */
const gain = (count: number) => en.book.progress.gainPages.replace('{count}', String(count))

/**
 * A reader of Piranesi (480 pages) begun 20 days ago with three days booked: 6 days ago 0 → 40, 4 days ago 40 → 90 and
 * yesterday 90 → 140, her progress p. 140. Home is on the page.
 */
async function reader(
  page: Page,
  { rows = [[6, null, 40], [4, 40, 90], [1, 90, 140]], current = 140, finished = false }: { rows?: [number, number | null, number][]; current?: number; finished?: boolean } = {},
) {
  const member = await signedIn(page)
  const library = createLibrary(member.client)
  if (finished) {
    // The Profile shows her reading days once she has finished a book.
    const dune = (await library.addToLibrary(book('Dune', 896))).data!
    await sql(`insert into public.reading_sessions (entry_id, started_on, ended_on, outcome) values ($1, $2, $3, 'finished')`, [dune.id, ago(40), ago(30)])
  }
  const entry = (await library.addToLibrary(book('Piranesi', 480), { status: 'reading', startedOn: ago(20) })).data!
  const session = entry.latestSession!.id
  for (const [days, start, end] of rows) {
    await sql('insert into public.reading_progress_days (session_id, day, start_page, end_page) values ($1, $2, $3, $4)', [session, ago(days), start, end])
  }
  await sql('update public.reading_sessions set progress_page = $2, progress_updated_at = now() where id = $1', [session, current])
  await goto(page, '/')
  await expect(page.getByTestId('home.progressValue')).toContainText(String(current))
  return { member, session }
}

/** The read's days, oldest first, as `[days ago, start, end]`. */
async function daysOf(session: string) {
  const rows = await sql<{ day: string; start_page: number | null; end_page: number }>(
    'select to_char(day, \'YYYY-MM-DD\') as day, start_page, end_page from public.reading_progress_days where session_id = $1 order by day',
    [session],
  )
  return rows.map((row) => [Math.round((parseDay(today).getTime() - parseDay(row.day).getTime()) / 86_400_000), row.start_page, row.end_page])
}
const progressOf = async (session: string) => (await sql<{ progress_page: number | null }>('select progress_page from public.reading_sessions where id = $1', [session]))[0]!.progress_page

/** Types a number into the wheel: a tap on its centre, the number, Enter. */
async function typeOn(page: Page, value: number, shows = value) {
  await page.getByTestId('progress.wheel').click()
  await expect(page.getByTestId('progress.wheelInput')).toBeFocused()
  await page.getByTestId('progress.wheelInput').fill(String(value))
  await page.getByTestId('progress.wheelInput').press('Enter')
  await expect(page.getByTestId('progress.wheel')).toHaveAttribute('aria-valuenow', String(shows))
}

async function openSheet(page: Page) {
  await page.getByTestId('home.update').click()
  await expect(page.getByTestId('progress')).toBeVisible()
  await untilStill(page)
}

/** The range line without its eyebrow's spacing: "Between Fri · p. 90 and yesterday · p. 140". */
const rangeOf = async (page: Page) => (await page.getByTestId('progress.range').innerText()).replace(/\s+/g, ' ').trim()

test('yesterday by the pill, an older day by the date input, the range, the effect, Save, Home and the Profile, and Remove of the latest day', async ({ page }) => {
  const { session } = await reader(page, { finished: true })
  await openSheet(page)

  // Today as it always was, plus the pill row.
  const sheetTitle = page.getByTestId('progress.sheetTitle')
  await expect(sheetTitle).toHaveText(en.book.progress.title)
  const group = page.getByTestId('progress.day')
  await expect(group).toHaveAttribute('role', 'group')
  await expect(group).toHaveAccessibleName(en.book.progress.dayLabel)
  await expect(page.getByTestId('progress.day.today')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('progress.day.yesterday')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('progress.day.pick')).toHaveAccessibleName(en.book.progress.dayPickLabel)
  await expect(page.getByTestId('progress.day.pick')).toHaveAttribute('min', ago(20))
  await expect(page.getByTestId('progress.day.pick')).toHaveAttribute('max', today)
  await expect(page.getByTestId('progress.lastTime')).toBeVisible()
  await expect(page.getByTestId('progress.total')).toBeVisible()
  await expect(page.getByTestId('progress.finishRow')).toBeVisible()
  await expect(page.getByTestId('progress.remove')).toBeHidden()
  await expect(page.getByTestId('progress.wheel')).toHaveAttribute('aria-valuenow', '140')

  // Yesterday: it has a day already, the latest one, so the wheel stands on where it ended and it can be removed.
  await page.getByTestId('progress.day.yesterday').click()
  await expect(sheetTitle).toHaveText(en.book.progress.titleDay.replace('{day}', words(ago(1))))
  await expect(page.getByTestId('progress.day.yesterday')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('progress.day.today')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('progress.wheel')).toHaveAttribute('aria-valuenow', '140')
  await expect(page.getByTestId('progress.wheel')).toHaveAttribute('aria-valuemin', '90')
  await expect(page.getByTestId('progress.wheel')).toHaveAttribute('aria-valuemax', '480')
  await expect(page.getByTestId('progress.delta')).toHaveText(gain(50))
  await expect(page.getByTestId('progress.range')).toContainText(`After`)
  expect(await rangeOf(page)).toContain(`${words(ago(4)).split(' ')[0]} · p. 90`)
  await expect(page.getByTestId('progress.remove')).toBeVisible()
  // What Last time, "of N", Finish and DNF do belongs to Today.
  for (const gone of ['progress.lastTime', 'progress.total', 'progress.finishRow', 'progress.abandonRow']) await expect(page.getByTestId(gone)).toBeHidden()
  await expect(page.getByTestId('progress.announce')).toHaveText(
    en.book.progress.statusDayOpen.replace('{day}', words(ago(1))).replace('{from}', 'p. 90'),
  )
  // The latest day, the days leading her progress: moving it moves her progress, and the line says so.
  await typeOn(page, 150)
  await expect(page.getByTestId('progress.effect')).toHaveText(en.book.progress.effectNow.replace('{value}', 'p. 150'))
  await expect(page.getByTestId('progress.delta')).toHaveText(gain(60))

  // A day by the date input: no entry yet, between two days; the wheel waits on where the day before ended.
  await page.getByTestId('progress.day.pick').fill(ago(2))
  await expect(sheetTitle).toHaveText(en.book.progress.titleDay.replace('{day}', words(ago(2))))
  await expect(page.getByTestId('progress.day.pick')).toHaveAccessibleName(en.book.progress.dayPickNamed.replace('{day}', words(ago(2))))
  await expect(page.getByTestId('progress.day.yesterday')).toHaveAttribute('aria-pressed', 'false')
  expect(await rangeOf(page)).toContain(`${words(ago(4)).split(' ')[0]} · p. 90 and ${en.book.progress.dayYesterdayInline} · p. 140`)
  const wheel = page.getByTestId('progress.wheel')
  await expect(wheel).toHaveAttribute('aria-valuenow', '90')
  await expect(wheel).toHaveAttribute('aria-valuemin', '90')
  await expect(wheel).toHaveAttribute('aria-valuemax', '140')
  await expect(page.getByTestId('progress.delta')).toBeHidden()
  await expect(page.getByTestId('progress.effect')).toHaveText('')
  await expect(page.getByTestId('progress.remove')).toBeHidden()
  await expect(page.getByTestId('progress.announce')).toHaveText(
    en.book.progress.statusDay.replace('{day}', words(ago(2))).replace('{from}', 'p. 90').replace('{to}', 'p. 140'),
  )
  // The wheel stays inside its neighbours: past the top it stops at the next day's end.
  await typeOn(page, 200, 140)
  await typeOn(page, 100)
  await expect(page.getByTestId('progress.delta')).toHaveText(gain(10))
  await expect(page.getByTestId('progress.effect')).toHaveText(
    en.book.progress.effectAdd
      .replace('{day}', words(ago(2)))
      .replace('{next}', en.book.progress.dayYesterday)
      .replace('{amount}', gain(40))
      .replace('{was}', gain(50)),
  )

  // Save: one day added, the one after it starts where this one ends; her progress is where it was.
  await page.getByTestId('progress.action').click()
  await expect(page.getByTestId('progress')).toBeHidden()
  expect(await daysOf(session)).toEqual([[6, null, 40], [4, 40, 90], [2, 90, 100], [1, 100, 140]])
  expect(await progressOf(session)).toBe(140)
  await expect(page.getByTestId('home.progressValue')).toHaveText('p. 140 of 480')
  // No Undo: it would put back a value from before the day.
  await expect(page.getByTestId('home.undo')).toBeHidden()

  // An older day, by the date input again: between the days 6 and 4 days ago.
  await openSheet(page)
  await page.getByTestId('progress.day.pick').fill(ago(5))
  await expect(page.getByTestId('progress.wheel')).toHaveAttribute('aria-valuenow', '40')
  await expect(page.getByTestId('progress.wheel')).toHaveAttribute('aria-valuemax', '90')
  await typeOn(page, 65)
  await expect(page.getByTestId('progress.delta')).toHaveText(gain(25))
  await page.getByTestId('progress.action').click()
  await expect(page.getByTestId('progress')).toBeHidden()
  expect(await daysOf(session)).toEqual([[6, null, 40], [5, 40, 65], [4, 65, 90], [2, 90, 100], [1, 100, 140]])

  // Nothing changed: Save just closes.
  await openSheet(page)
  await page.getByTestId('progress.day.pick').fill(ago(5))
  await expect(page.getByTestId('progress.wheel')).toHaveAttribute('aria-valuenow', '65')
  await expect(page.getByTestId('progress.remove')).toBeVisible()
  await page.getByTestId('progress.action').click()
  await expect(page.getByTestId('progress')).toBeHidden()
  expect(await daysOf(session)).toHaveLength(5)

  // The Profile: both days read are lit in her reading days.
  await openProfile(page)
  await expect(page.getByTestId(`profile.day.${ago(5)}`)).toBeVisible()
  await expect(page.getByTestId(`profile.day.${ago(2)}`)).toBeVisible()

  // Remove the latest day: the confirm says her progress goes back to where it began; Keep it leaves everything.
  await page.getByTestId('shell.tab.home').click()
  await openSheet(page)
  await page.getByTestId('progress.day.yesterday').click()
  await expect(page.getByTestId('progress.wheel')).toHaveAttribute('aria-valuenow', '140')
  await page.getByTestId('progress.remove').click()
  const confirm = page.getByTestId('removeDay')
  await expect(confirm).toBeVisible()
  await expect(confirm).toContainText(en.book.progress.removeDay.title.replace('{day}', words(ago(1))))
  await expect(confirm).toContainText(en.book.progress.removeDay.textLatest.replace('{value}', 'p. 100'))
  await page.getByTestId('removeDay.cancel').click()
  await expect(confirm).toBeHidden()
  await expect(page.getByTestId('progress')).toBeVisible()
  expect(await daysOf(session)).toHaveLength(5)
  await page.getByTestId('progress.remove').click()
  await page.getByTestId('removeDay.confirm').click()
  await expect(confirm).toBeHidden()
  await expect(page.getByTestId('progress')).toBeHidden()
  expect(await daysOf(session)).toEqual([[6, null, 40], [5, 40, 65], [4, 65, 90], [2, 90, 100]])
  expect(await progressOf(session)).toBe(100)
  await expect(page.getByTestId('home.progressValue')).toHaveText('p. 100 of 480')
})

test('removing a day in the middle says where its pages go and leaves her progress alone', async ({ page }) => {
  const { session } = await reader(page)
  await openSheet(page)
  await page.getByTestId('progress.day.pick').fill(ago(4))
  await expect(page.getByTestId('progress.wheel')).toHaveAttribute('aria-valuenow', '90')
  await expect(page.getByTestId('progress.delta')).toHaveText(gain(50))
  // Between the day before it and the one after it, the day after being yesterday.
  expect(await rangeOf(page)).toContain(`${words(ago(6)).split(' ')[0]} · p. 40 and ${en.book.progress.dayYesterdayInline} · p. 140`)
  await page.getByTestId('progress.remove').click()
  await expect(page.getByTestId('removeDay')).toContainText(
    en.book.progress.removeDay.text.replace('{amount}', '50 pages').replace('{next}', en.book.progress.dayYesterdayInline).replace('{value}', 'p. 140'),
  )
  await page.getByTestId('removeDay.confirm').click()
  await expect(page.getByTestId('progress')).toBeHidden()
  // The day after absorbs the pages: 40 → 140.
  expect(await daysOf(session)).toEqual([[6, null, 40], [1, 40, 140]])
  expect(await progressOf(session)).toBe(140)
  await expect(page.getByTestId('home.progressValue')).toHaveText('p. 140 of 480')
})

test('a refusal stays in the sheet and Save tries again, a refused Remove stays in its confirm', async ({ page }) => {
  const { session } = await reader(page)
  await openSheet(page)
  await page.getByTestId('progress.day.yesterday').click()
  await typeOn(page, 170)
  // The read ended on another device meanwhile: the database refuses.
  await sql(`update public.reading_sessions set outcome = 'abandoned', ended_on = current_date where id = $1`, [session])
  await page.getByTestId('progress.action').click()
  await expect(page.getByTestId('progress.failure')).toHaveText(en.library.error.not_reading)
  await expect(page.getByTestId('progress')).toBeVisible()
  await expect(page.getByTestId('progress.action')).toHaveText(en.book.progress.retry)
  // A new number is a new try.
  await page.getByTestId('progress.plus').click()
  await expect(page.getByTestId('progress.failure')).toBeHidden()
  // A refused Remove stays in its confirm, with the reason, and the same button tries again.
  await page.getByTestId('progress.remove').click()
  await page.getByTestId('removeDay.confirm').click()
  await expect(page.getByTestId('removeDay.error')).toHaveText(en.library.error.not_reading)
  await expect(page.getByTestId('removeDay')).toBeVisible()
  await expect(page.getByTestId('removeDay.confirm')).toBeEnabled()
  await page.getByTestId('removeDay.cancel').click()
  await expect(page.getByTestId('removeDay')).toBeHidden()
  expect(await daysOf(session)).toHaveLength(3)
  await page.getByTestId('progress.cancel').click()
  await expect(page.getByTestId('progress')).toBeHidden()
})

test('the read\'s days not loaded: the sheet offers no day', async ({ page }) => {
  const member = await signedIn(page)
  const library = createLibrary(member.client)
  await library.addToLibrary(book('Piranesi', 480), { status: 'reading', startedOn: ago(20) })
  await page.route('**/rest/v1/reading_progress_days*', (route) => route.abort('failed'))
  await goto(page, '/')
  await expect(page.getByTestId('home.update')).toBeVisible()
  await openSheet(page)
  await expect(page.getByTestId('progress.day')).toHaveCount(0)
  // Today as it was.
  await expect(page.getByTestId('progress.sheetTitle')).toHaveText(en.book.progress.title)
  await expect(page.getByTestId('progress.total')).toBeVisible()
})

test('a read begun today has no earlier day to record', async ({ page }) => {
  const member = await signedIn(page)
  await createLibrary(member.client).addToLibrary(book('Piranesi', 480), { status: 'reading', startedOn: today })
  await goto(page, '/')
  await expect(page.getByTestId('home.update')).toBeVisible()
  await openSheet(page)
  await expect(page.getByTestId('progress.day')).toHaveCount(0)
})

test.describe('accessibility, dark', { tag: '@full' }, () => {
  test.use({ colorScheme: 'dark', viewport: { width: 412, height: 915 } })

  test('the day pills, an earlier day with and without an entry, and the confirm', async ({ page }) => {
    await reader(page)
    await openSheet(page)
    await expectAccessible(page, 'Update progress with the day pills')
    await page.getByTestId('progress.day.pick').fill(ago(2))
    await expect(page.getByTestId('progress.range')).toBeVisible()
    await typeOn(page, 100)
    await expect(page.getByTestId('progress.effect')).not.toHaveText('')
    await expectAccessible(page, 'Progress on an earlier day, no entry yet')
    await page.getByTestId('progress.day.pick').fill(ago(4))
    await expect(page.getByTestId('progress.remove')).toBeVisible()
    await expectAccessible(page, 'Progress on an earlier day, with an entry')
    await page.getByTestId('progress.remove').click()
    await expect(page.getByTestId('removeDay')).toBeVisible()
    await expectAccessible(page, 'Remove this day')
  })
})

/** The sheet on an earlier day at a narrow phone: nothing sticks out, the pills share one row, the range line is whole. */
async function expectFits(page: Page, where: string) {
  await expectNoSideScroll(page, where)
  await untilStill(page)
  const centres = await page.evaluate((ids) => ids.map((id) => { const box = document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect(); return box.y + box.height / 2 }), [
    'progress.day.today',
    'progress.day.yesterday',
    'progress.day.pick',
  ])
  // One row: the centres of the three boxes are the same (the date input is the pill's 44 pt box, the buttons the drawn 32).
  expect.soft(Math.max(...centres) - Math.min(...centres), `${where}: the pills wrap`).toBeLessThan(2)
  if (!(await page.getByTestId('progress.range').count())) return
  const cut = await page.getByTestId('progress.range').evaluate((el) => [...el.querySelectorAll('*'), el].some((node) => node.scrollWidth > node.clientWidth + 1))
  expect.soft(cut, `${where}: the range line is cut off`).toBe(false)
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
      test.describe(`the states, ${locale}, ${theme}, ${size.name}`, () => {
        test.use({ locale: locale === 'de' ? 'de-DE' : 'en-US', colorScheme: theme, viewport: size.viewport })
        // English at 390 is what the mocks show; the other widths and German are the narrow-width and German passes.
        test(`fits and, with PROGRESS_DAY_SHOTS, is drawn`, async ({ page }) => {
          test.setTimeout(120_000)
          if (OUT) mkdirSync(join(OUT, 'shots'), { recursive: true })
          await page.addInitScript((value) => localStorage.setItem('libellus-theme', value), theme)
          const messages = locale === 'de' ? de : en
          await reader(page)
          const shot = async (state: string) => {
            await untilStill(page)
            if (!OUT) return
            // What still moves (a dialog fading in over its scrim) has landed.
            await page.evaluate(async () => {
              for (let round = 0; round < 50 && document.getAnimations().some((a) => a.effect?.getTiming().iterations !== Infinity); round++) await new Promise((resolve) => setTimeout(resolve, 50))
            })
            await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
            await page.waitForTimeout(300)
            await page.screenshot({ path: join(OUT, 'shots', `${state}-${locale}-${theme}-${size.name}.png`) })
          }
          await openSheet(page)
          await expect(page.getByTestId('progress.sheetTitle')).toHaveText(messages.book.progress.title)
          await expectFits(page, `Today (${locale}, ${size.name})`)
          await shot('1-today')

          await page.getByTestId('progress.day.pick').fill(ago(2))
          await expect(page.getByTestId('progress.sheetTitle')).toHaveText(messages.book.progress.titleDay.replace('{day}', words(ago(2), locale)))
          await typeOn(page, 100)
          await expect(page.getByTestId('progress.effect')).not.toHaveText('')
          await expectFits(page, `Earlier day, no entry (${locale}, ${size.name})`)
          await shot('2-earlier-no-entry')

          await page.getByTestId('progress.day.pick').fill(ago(4))
          await expect(page.getByTestId('progress.remove')).toBeVisible()
          await expect(page.getByTestId('progress.remove')).toHaveText(messages.book.progress.dayRemove)
          await expectFits(page, `Earlier day, with an entry (${locale}, ${size.name})`)
          await shot('3-earlier-entry')

          await page.getByTestId('progress.day.yesterday').click()
          await expect(page.getByTestId('progress.range')).toBeVisible()
          await expectFits(page, `Yesterday, the latest day (${locale}, ${size.name})`)
          await typeOn(page, 150)
          await expect(page.getByTestId('progress.effect')).not.toHaveText('')
          await shot('4-latest-day')

          await page.getByTestId('progress.remove').click()
          await expect(page.getByTestId('removeDay')).toBeVisible()
          await expect(page.getByTestId('removeDay.confirm')).toHaveText(messages.book.progress.removeDay.action)
          await expectNoSideScroll(page, `Remove (${locale}, ${size.name})`)
          await shot('5-remove-confirm')
          await page.getByTestId('removeDay.cancel').click()

          // Large text (200 %): the pills wrap, nothing runs out of the screen.
          await page.addStyleTag({ content: 'html { font-size: 200% !important }' })
          await untilStill(page)
          await expectNoSideScroll(page, `200 % text (${locale}, ${size.name})`)
          await shot('6-large-text')
        })
      })
    }
  }
}
