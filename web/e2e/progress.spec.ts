import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import type { BookSnapshot } from '../app/data/books'
import { createLibrary } from '../app/data/library'
import { addDays, isoDay } from '../app/utils/dates'
import { sql, runTitle, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { test } from './fixtures'
import { recordedApple, signedIn, untilStill } from './support'

/**
 * Reading progress (#39, #60; the Update progress sheet of #68, direction D): a
 * member starts a book and sets page 120 on the wheel with + / −, the keyboard
 * and typing; Home's card shows it, Update opens the sheet, a drag turns the
 * wheel, the save offers "+5" and Undo for 5 s; Finish in the sheet saves and
 * finishes; the last page turns the card into "The end." with Finish; a book
 * without a page count counts in percent until she gives it one; her own total
 * is set on the same wheel. The Library is the real local stack; the Books are
 * made through the repository so they have the page counts the recorded Apple
 * answers lack. With docs/parity.md this is the behavioural reference for
 * progress.
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

/** Types a number into a wheel: a tap on its centre, the number, Enter. It then shows `shows`. */
async function typeOn(page: Page, wheel: string, value: number, shows = value) {
  await page.getByTestId(wheel).click()
  await expect(page.getByTestId(`${wheel}Input`)).toBeFocused()
  await page.getByTestId(`${wheel}Input`).fill(String(value))
  await page.getByTestId(`${wheel}Input`).press('Enter')
  await expect(page.getByTestId(wheel)).toHaveAttribute('aria-valuenow', String(shows))
}

/** Drags a wheel by `rows` (up is more), holding still before letting go so it does not fling. */
async function drag(page: Page, wheel: string, rows: number) {
  await untilStill(page)
  const box = (await page.getByTestId(wheel).boundingBox())!
  const row = await page.getByTestId(wheel).evaluate((el) => Number.parseFloat(getComputedStyle(el).getPropertyValue('--size-touch')))
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y - rows * row, { steps: 12 })
  await page.waitForTimeout(200)
  await page.mouse.up()
}

const sessionOf = (email: string) =>
  sql<{ outcome: string | null; progress_page: number | null; progress_percent: number | null; page_count_override: number | null }>(
    `select s.outcome::text, s.progress_page, s.progress_percent, e.page_count_override
       from public.reading_sessions s
       join public.library_entries e on e.id = s.entry_id
       join auth.users u on u.id = e.member_id
      where u.email = $1`,
    [email],
  )

test('a member starts a book, sets page 120 on the wheel, turns it from Home, undoes a save and finishes in the sheet', async ({ page }) => {
  const member = await signedIn(page)
  const library = createLibrary(member.client)
  await library.addToLibrary(book('Piranesi', 480))

  // Want to read: no progress anywhere yet.
  await page.getByTestId('shell.tab.library').click()
  await page.getByTestId('library.entry').first().click()
  await expect(page.getByTestId('book.progress')).toBeHidden()
  await page.getByTestId('book.start').click()
  await page.getByTestId('start.submit').click()
  await expect(page.getByTestId('start')).toBeHidden()

  // Currently reading, nothing recorded yet (#79, #81): the empty bar and its row with Update progress, which opens the sheet on 0, in pages.
  await expect(page.getByTestId('book.updateProgress')).toBeVisible()
  await expect(page.getByTestId('book.progressBar')).toBeVisible()
  await expect(page.getByTestId('book.progressText')).toHaveText('Not started · 480 pages')
  await expect(page.getByTestId('book.progressFigures')).toBeHidden()
  await page.getByTestId('book.updateProgress').click()
  const wheel = page.getByTestId('progress.wheel')
  await expect(page.getByTestId('progress.sheetTitle')).toHaveText(en.book.progress.title)
  await expect(page.getByTestId('progress.action')).toHaveText(en.book.progress.save)
  await expect(page.getByTestId('progress.mode.page')).toHaveAttribute('aria-pressed', 'true')
  await expect(wheel).toHaveAttribute('role', 'spinbutton')
  await expect(wheel).toHaveAttribute('aria-valuenow', '0')
  await expect(wheel).toHaveAttribute('aria-valuemax', '480')
  await expect(page.getByTestId('progress.total')).toHaveText(en.book.progress.totalOf.replace('{count}', '480'))
  await expect(page.getByTestId('progress.delta')).toBeHidden()

  // + and −, then the keyboard (up is more, Page Up ten), then typing on the centre.
  await page.getByTestId('progress.plus').click()
  await page.getByTestId('progress.plus').click()
  await page.getByTestId('progress.plus').click()
  await page.getByTestId('progress.minus').click()
  await expect(wheel).toHaveAttribute('aria-valuenow', '2')
  await wheel.focus()
  await page.keyboard.press('PageUp')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('PageUp')
  await expect(wheel).toHaveAttribute('aria-valuenow', '22')
  await expect(wheel).toHaveAttribute('aria-valuetext', 'p. 22 of 480')
  await expect(page.getByTestId('progress.delta')).toHaveText(en.book.progress.gainPages.replace('{count}', '22'))
  await typeOn(page, 'progress.wheel', 120)
  await page.getByTestId('progress.action').click()
  await expect(page.getByTestId('progress')).toBeHidden()

  // The book page shows it: the bar, page 120 of 480 and the 25 % it is; stored as a page.
  await expect(page.getByTestId('book.progressValue')).toHaveText('120')
  await expect(page.getByTestId('book.progressPercent')).toHaveText('25 %')
  await expect(page.getByTestId('book.progressBar')).toHaveAttribute('aria-valuenow', '25')
  expect(await sessionOf(member.email)).toEqual([{ outcome: null, progress_page: 120, progress_percent: null, page_count_override: null }])

  // Home's card: the value, a quiet Update; nothing on it edits by itself.
  await page.getByTestId('shell.tab.home').click()
  await expect(page.getByTestId('home.progressValue')).toHaveText('p. 120 of 480')
  await expect(page.getByTestId('home.progressBar')).toHaveAttribute('aria-valuenow', '25')
  await expect(page.getByTestId('home.finish')).toBeHidden()
  await page.getByTestId('home.update').click()
  await expect(wheel).toHaveAttribute('aria-valuenow', '120')

  // A drag turns it: five rows up is five pages on.
  await drag(page, 'progress.wheel', 5)
  await expect(wheel).toHaveAttribute('aria-valuenow', '125')
  await expect(page.getByTestId('progress.delta')).toHaveText(en.book.progress.gainPages.replace('{count}', '5'))
  await page.getByTestId('progress.action').click()
  await expect(page.getByTestId('progress')).toBeHidden()

  // Saved: "+5" and Undo instead of Update; Undo puts it back.
  await expect(page.getByTestId('home.progressValue')).toHaveText('p. 125 of 480')
  await expect(page.getByTestId('home.progressGain')).toContainText(en.book.progress.gainPages.replace('{count}', '5'))
  await expect(page.getByTestId('home.update')).toBeHidden()
  await page.getByTestId('home.undo').click()
  await expect(page.getByTestId('home.progressValue')).toHaveText('p. 120 of 480')
  await expect(page.getByTestId('home.progressGain')).toBeHidden()
  await expect(page.getByTestId('home.update')).toBeVisible()
  expect((await sessionOf(member.email))[0]!.progress_page).toBe(120)

  // Left alone, Undo goes after five seconds.
  await page.getByTestId('home.update').click()
  await typeOn(page, 'progress.wheel', 300)
  await page.getByTestId('progress.action').click()
  await expect(page.getByTestId('home.undo')).toBeVisible()
  await expect(page.getByTestId('home.undo')).toBeHidden({ timeout: 8_000 })
  await expect(page.getByTestId('home.update')).toBeVisible()
  await expect(page.getByTestId('home.progressValue')).toHaveText('p. 300 of 480')

  // Finish in the sheet: the page is saved, then the Finish sheet; the closed read keeps it.
  await page.getByTestId('home.update').click()
  await typeOn(page, 'progress.wheel', 410)
  await expect(page.getByTestId('progress.finishHint')).toHaveText(en.book.progress.finishHint)
  await page.getByTestId('progress.finish').click()
  await expect(page.getByTestId('finish')).toBeVisible()
  await expect(page.getByTestId('progress')).toBeHidden()
  await page.getByTestId('finish.submit').click()
  await expect(page.getByTestId('finish')).toBeHidden()
  await expect(page.getByTestId('home.readingCard')).toHaveCount(0)
  expect(await sessionOf(member.email)).toEqual([{ outcome: 'finished', progress_page: 410, progress_percent: null, page_count_override: null }])
})

test('the last page: the sheet says so, and the card turns into "The end." with Finish', async ({ page }) => {
  const member = await signedIn(page)
  await createLibrary(member.client).addToLibrary(book('Jonathan Strange', 200), { status: 'reading', startedOn: isoDay() })
  await page.reload()

  await page.getByTestId('home.update').click()
  await page.getByTestId('progress.wheel').focus()
  await page.keyboard.press('End')
  await expect(page.getByTestId('progress.wheel')).toHaveAttribute('aria-valuenow', '200')
  await expect(page.getByTestId('progress.finishHint')).toHaveText(en.book.progress.reached)
  await page.getByTestId('progress.action').click()
  await expect(page.getByTestId('progress')).toBeHidden()

  await expect(page.getByTestId('home.theEnd')).toHaveText(en.book.progress.theEnd)
  await expect(page.getByTestId('home.update')).toBeHidden()
  await page.getByTestId('home.finish').click()
  await expect(page.getByTestId('finish')).toBeVisible()
  await page.getByTestId('finish.submit').click()
  await expect(page.getByTestId('finish')).toBeHidden()
  expect(await sessionOf(member.email)).toEqual([{ outcome: 'finished', progress_page: 200, progress_percent: null, page_count_override: null }])
})

test('a book without a page count counts in percent until she gives it one; the toggle carries the place over', async ({ page }) => {
  const member = await signedIn(page)
  await createLibrary(member.client).addToLibrary(book('No pages', null), { status: 'reading', startedOn: isoDay() })
  await page.reload()

  // Percent only: no toggle, 0–100, and "Count in pages".
  await page.getByTestId('home.update').click()
  await expect(page.getByTestId('progress.mode.page')).toBeHidden()
  await expect(page.getByTestId('progress.wheel')).toHaveAttribute('aria-valuemax', '100')
  await expect(page.getByTestId('progress.wheel')).toHaveAttribute('aria-label', en.book.progress.percentLabel)
  // Typed past the end: the end.
  await typeOn(page, 'progress.wheel', 140, 100)
  await typeOn(page, 'progress.wheel', 40)
  await expect(page.getByTestId('progress.total')).toHaveText(en.book.progress.totalCount)

  // The same wheel sets her pages; Done hands back, 40 % being page 100 of 250.
  await page.getByTestId('progress.total').click()
  await expect(page.getByTestId('progress.totalTitle')).toHaveText(en.book.progress.totalTitle)
  await expect(page.getByTestId('progress.action')).toHaveText(en.book.progress.done)
  await expect(page.getByTestId('progress.totalHint')).toHaveText(en.book.progress.totalHint)
  await typeOn(page, 'progress.totalWheel', 250)
  await page.getByTestId('progress.action').click()
  await expect(page.getByTestId('progress.mode.page')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('progress.wheel')).toHaveAttribute('aria-valuenow', '100')
  await expect(page.getByTestId('progress.total')).toHaveText(en.book.progress.totalOf.replace('{count}', '250'))
  await page.getByTestId('progress.action').click()
  await expect(page.getByTestId('progress')).toBeHidden()
  await expect(page.getByTestId('home.progressValue')).toHaveText('p. 100 of 250')
  await expect(page.getByTestId('home.progressBar')).toHaveAttribute('aria-valuenow', '40')
  expect(await sessionOf(member.email)).toEqual([{ outcome: null, progress_page: 100, progress_percent: null, page_count_override: 250 }])

  // Pages | Percent carries the place over both ways.
  await page.getByTestId('home.update').click()
  await page.getByTestId('progress.mode.percent').click()
  await expect(page.getByTestId('progress.wheel')).toHaveAttribute('aria-valuenow', '40')
  await page.getByTestId('progress.mode.page').click()
  await expect(page.getByTestId('progress.wheel')).toHaveAttribute('aria-valuenow', '100')

  // Back to percent: "Use percent" drops her total.
  await page.getByTestId('progress.total').click()
  await page.getByTestId('progress.totalDrop').click()
  await expect(page.getByTestId('progress.mode.page')).toBeHidden()
  await expect(page.getByTestId('progress.wheel')).toHaveAttribute('aria-valuenow', '40')
  await page.getByTestId('progress.action').click()
  await expect(page.getByTestId('home.progressValue')).toHaveText('40 %')
  expect(await sessionOf(member.email)).toEqual([{ outcome: null, progress_page: null, progress_percent: 40, page_count_override: null }])
})

test('her own total: "of 480" turns the wheel into the pages of her copy, and the edition\'s comes back', async ({ page }) => {
  const member = await signedIn(page)
  await createLibrary(member.client).addToLibrary(book('Ebook', 480), { status: 'reading', startedOn: isoDay() })
  await page.reload()

  await page.getByTestId('home.update').click()
  await page.getByTestId('progress.total').click()
  await expect(page.getByTestId('progress.totalWheel')).toHaveAttribute('aria-valuenow', '480')
  await expect(page.getByTestId('progress.totalDrop')).toBeHidden()
  await typeOn(page, 'progress.totalWheel', 560)
  await page.getByTestId('progress.action').click()
  await expect(page.getByTestId('progress.total')).toHaveText(en.book.progress.totalOf.replace('{count}', '560'))
  await expect(page.getByTestId('progress.wheel')).toHaveAttribute('aria-valuemax', '560')
  await typeOn(page, 'progress.wheel', 500)
  await page.getByTestId('progress.action').click()
  await expect(page.getByTestId('progress')).toBeHidden()

  // Home, the book page and the database all use it.
  await expect(page.getByTestId('home.progressValue')).toHaveText('p. 500 of 560')
  await expect(page.getByTestId('home.progressBar')).toHaveAttribute('aria-valuenow', '89')
  expect(await sessionOf(member.email)).toEqual([{ outcome: null, progress_page: 500, progress_percent: null, page_count_override: 560 }])
  await page.getByTestId('home.entry').click()
  await expect(page.getByTestId('book.progressValue')).toHaveText('500')
  await expect(page.getByTestId('book.progressTotal')).toHaveText(en.book.progress.totalOf.replace('{count}', '560'))

  // "Edition's 480": the page is cut back to it, then set lower and saved without her total.
  await page.getByTestId('book.updateProgress').click()
  await expect(page.getByTestId('progress.total')).toHaveText(en.book.progress.totalOf.replace('{count}', '560'))
  await page.getByTestId('progress.total').click()
  await expect(page.getByTestId('progress.totalWheel')).toHaveAttribute('aria-valuenow', '560')
  await page.getByTestId('progress.totalDrop').click()
  await expect(page.getByTestId('progress.total')).toHaveText(en.book.progress.totalOf.replace('{count}', '480'))
  await expect(page.getByTestId('progress.wheel')).toHaveAttribute('aria-valuenow', '480')
  await typeOn(page, 'progress.wheel', 300)
  await page.getByTestId('progress.action').click()
  await expect(page.getByTestId('progress')).toBeHidden()
  await expect(page.getByTestId('book.progressValue')).toHaveText('300')
  await expect(page.getByTestId('book.progressTotal')).toHaveText(en.book.progress.totalOf.replace('{count}', '480'))
  expect(await sessionOf(member.email)).toEqual([{ outcome: null, progress_page: 300, progress_percent: null, page_count_override: null }])
})

test('a failed save says why and tries again', async ({ page }) => {
  const member = await signedIn(page)
  await createLibrary(member.client).addToLibrary(book('Retry', 300), { status: 'reading', startedOn: isoDay() })
  await page.reload()

  await page.getByTestId('home.update').click()
  await typeOn(page, 'progress.wheel', 50)
  // The server fails (a connection that answers nothing is queued instead: no-answer.spec.ts).
  await page.route('**/rest/v1/rpc/update_progress', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'The server fell over.' }) }))
  await page.getByTestId('progress.action').click()
  await expect(page.getByTestId('progress.failure')).toHaveText(en.library.error.unknown)
  await expect(page.getByTestId('progress.action')).toHaveText(en.book.progress.retry)
  await expect(page.getByTestId('home.progressValue')).toHaveText(en.book.progress.none)

  await page.unroute('**/rest/v1/rpc/update_progress')
  await page.getByTestId('progress.action').click()
  await expect(page.getByTestId('progress')).toBeHidden()
  await expect(page.getByTestId('home.progressValue')).toHaveText('p. 50 of 300')
})

test('offline the progress still saves: it waits to sync, Undo works, and it syncs once online (#93)', async ({ page }) => {
  const member = await signedIn(page)
  await createLibrary(member.client).addToLibrary(book('Offline', 300), { status: 'reading', startedOn: isoDay() })
  await page.reload()

  // A save online first.
  await page.getByTestId('home.update').click()
  await typeOn(page, 'progress.wheel', 30)
  await page.getByTestId('progress.action').click()
  await expect(page.getByTestId('home.undo')).toBeVisible()
  await expect(page.getByTestId('home.undo')).toBeHidden({ timeout: 8_000 })

  // Offline the card and the sheet work as before; the save waits to sync and says so.
  await page.context().setOffline(true)
  await expect(page.getByTestId('home.update')).toBeEnabled()
  await page.getByTestId('home.update').click()
  await expect(page.getByTestId('progress.action')).toHaveText(en.book.progress.save)
  await expect(page.getByTestId('progress.finish')).toContainText(en.book.finish)
  await typeOn(page, 'progress.wheel', 45)
  await page.getByTestId('progress.action').click()
  await expect(page.getByTestId('progress')).toBeHidden()
  await expect(page.getByTestId('home.progressValue')).toHaveText('p. 45 of 300')
  await expect(page.getByTestId('shell.syncLabel')).toHaveText(en.sync.chip.replace('{count}', '1'))

  // Undo, offline too.
  await page.getByTestId('home.undo').click()
  await expect(page.getByTestId('home.progressValue')).toHaveText('p. 30 of 300')
  await expect(page.getByTestId('shell.syncLabel')).toHaveText(en.sync.chip.replace('{count}', '2'))

  // Nothing reached the database yet.
  expect((await sessionOf(member.email))[0]!.progress_page).toBe(30)

  // Back online: both sync, in order; nothing waits any more.
  await page.context().setOffline(false)
  await expect(page.getByTestId('shell.sync')).toBeHidden()
  await expect.poll(async () => (await sessionOf(member.email))[0]!.progress_page).toBe(30)
  expect(
    await sql<{ day: string }>(
      `select d.day::text from public.reading_progress_days d
         join public.reading_sessions s on s.id = d.session_id
         join public.library_entries e on e.id = s.entry_id
         join auth.users u on u.id = e.member_id
        where u.email = $1 and d.end_page = 45`,
      [member.email],
    ),
  ).toEqual([])
})

/** Gives the read days of reading before today, as #68 books them (the database takes only a day either side of now). */
async function history(email: string, steps: [ago: number, amount: number][], kind: 'page' | 'percent' = 'page') {
  let at = 0
  for (const [ago, amount] of steps) {
    const from = at
    at += amount
    await sql(
      `insert into public.reading_progress_days (session_id, day, start_${kind}, end_${kind})
       select s.id, $2::date, $3, $4
         from public.reading_sessions s
         join public.library_entries e on e.id = s.entry_id
         join auth.users u on u.id = e.member_id
        where u.email = $1 and s.outcome is null`,
      [email, addDays(isoDay(), -ago), from, at],
    )
  }
  await sql(
    `update public.reading_sessions s set progress_${kind} = $2, progress_updated_at = now()
       from public.library_entries e join auth.users u on u.id = e.member_id
      where e.id = s.entry_id and u.email = $1 and s.outcome is null`,
    [email, at],
  )
}

test('progress by day: the card\'s pace, the book page\'s figures, chart, Last time and log, the Finish summary', async ({ page }) => {
  const member = await signedIn(page)
  await createLibrary(member.client).addToLibrary(book('East of Eden', 608), { status: 'reading', startedOn: addDays(isoDay(), -11) })
  // Twelve days in, 212 pages, yesterday 24 of them.
  await history(member.email, [[11, 14], [10, 22], [9, 30], [8, 12], [6, 40], [5, 26], [4, 18], [2, 26], [1, 24]])
  await page.reload()

  // Home: the pace instead of the since line, no chart on the card.
  await expect(page.getByTestId('home.pace')).toHaveText('18 a day · 22 days')
  await expect(page.getByTestId('home.entrySince')).toBeHidden()
  await expect(page.getByTestId('home.spark')).toHaveCount(0)

  // The sheet says what she read last time; 24 more today.
  await page.getByTestId('home.update').click()
  await expect(page.getByTestId('progress.lastTime')).toContainText(`${en.book.progress.dayYesterday} · 24 pages`)
  await typeOn(page, 'progress.wheel', 236)
  await page.getByTestId('progress.action').click()
  await expect(page.getByTestId('progress')).toBeHidden()
  await expect(page.getByTestId('home.pace')).toHaveText('20 a day · 19 days')

  // Undo takes today's day back too.
  await page.getByTestId('home.undo').click()
  await expect(page.getByTestId('home.pace')).toHaveText('18 a day · 22 days')
  await page.getByTestId('home.update').click()
  await typeOn(page, 'progress.wheel', 236)
  await page.getByTestId('progress.action').click()
  await expect(page.getByTestId('home.pace')).toHaveText('20 a day · 19 days')

  // The book page: four figures, three weeks of bars, Last time, the reading log.
  await page.getByTestId('home.entry').click()
  await expect(page.getByTestId('book.progressValue')).toHaveText('236')
  await expect(page.getByTestId('book.progressTotal')).toHaveText(en.book.progress.totalOf.replace('{count}', '608'))
  await expect(page.getByTestId('book.progressPercent')).toHaveText('39 %')
  await expect(page.getByTestId('book.progressPace')).toHaveText('20')
  await expect(page.getByTestId('book.progressToGo')).toHaveText('19')
  await expect(page.getByTestId('book.progressChart').locator('.col')).toHaveCount(21)
  await expect(page.getByTestId('book.progressChart').locator('.col').last()).toHaveAttribute('data-amount', '24')
  await expect(page.getByTestId('book.lastTime')).toContainText(`${en.book.progress.dayYesterday} · 24 pages`)
  await expect(page.getByTestId('book.logDay')).toHaveCount(10)
  await expect(page.getByTestId('book.logDay').first()).toContainText(en.book.progress.dayToday)
  await expect(page.getByTestId('book.logAmount').first()).toHaveText('+24')
  await expect(page.getByTestId('book.logEnd').first()).toHaveText('p. 236')

  // Finishing: how the read went.
  await page.getByTestId('book.finish').click()
  await expect(page.getByTestId('finish.summary')).toHaveText('Read in 12 days · 51 pages a day')
  const [days] = await sql<{ count: string }>(
    `select count(*) from public.reading_progress_days d
       join public.reading_sessions s on s.id = d.session_id
       join public.library_entries e on e.id = s.entry_id
       join auth.users u on u.id = e.member_id
      where u.email = $1`,
    [member.email],
  )
  expect(Number(days!.count)).toBe(10)
})

test('a book without a page count: its days in percent', async ({ page }) => {
  const member = await signedIn(page)
  await createLibrary(member.client).addToLibrary(book('Small Gods', null), { status: 'reading', startedOn: addDays(isoDay(), -5) })
  await history(member.email, [[5, 12], [4, 9], [2, 15], [1, 8]], 'percent')
  await page.reload()

  await expect(page.getByTestId('home.pace')).toHaveText('7 % a day · 8 days')
  await page.getByTestId('home.entry').click()
  await expect(page.getByTestId('book.progressValue')).toHaveText('44 %')
  await expect(page.getByTestId('book.progressTotal')).toHaveText(en.book.progress.figureAddPages)
  await expect(page.getByTestId('book.progressPercent')).toHaveText('56 %')
  await expect(page.getByTestId('book.lastTime')).toContainText(`${en.book.progress.dayYesterday} · 8 %`)
  await expect(page.getByTestId('book.logEnd').first()).toHaveText('44 %')
  // "Add pages" opens the sheet on the total wheel.
  await page.getByTestId('book.progressTotal').click()
  await expect(page.getByTestId('progress.totalWheel')).toBeVisible()
})
