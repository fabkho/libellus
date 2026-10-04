import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import type { BookSnapshot } from '../app/data/books'
import { createLibrary } from '../app/data/library'
import { isoDay } from '../app/utils/dates'
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

  // Currently reading, nothing recorded yet: Update progress opens the sheet on 0, in pages.
  await expect(page.getByTestId('book.progressValue')).toHaveText(en.book.progress.none)
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

  // The book page shows it: the bar, "p. 120 of 480" and the 25 % it is; stored as a page.
  await expect(page.getByTestId('book.progressValue')).toHaveText('p. 120 of 480')
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
  await expect(page.getByTestId('book.progressValue')).toHaveText('p. 500 of 560')

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
  await expect(page.getByTestId('book.progressValue')).toHaveText('p. 300 of 480')
  expect(await sessionOf(member.email)).toEqual([{ outcome: null, progress_page: 300, progress_percent: null, page_count_override: null }])
})

test('a failed save says why and tries again', async ({ page }) => {
  const member = await signedIn(page)
  await createLibrary(member.client).addToLibrary(book('Retry', 300), { status: 'reading', startedOn: isoDay() })
  await page.reload()

  await page.getByTestId('home.update').click()
  await typeOn(page, 'progress.wheel', 50)
  await page.route('**/rest/v1/rpc/update_progress', (route) => route.abort('failed'))
  await page.getByTestId('progress.action').click()
  await expect(page.getByTestId('progress.failure')).toHaveText(en.library.error.unknown)
  await expect(page.getByTestId('progress.action')).toHaveText(en.book.progress.retry)
  await expect(page.getByTestId('home.progressValue')).toHaveText(en.book.progress.none)

  await page.unroute('**/rest/v1/rpc/update_progress')
  await page.getByTestId('progress.action').click()
  await expect(page.getByTestId('progress')).toBeHidden()
  await expect(page.getByTestId('home.progressValue')).toHaveText('p. 50 of 300')
})

test('offline the wheel still turns, but nothing saves: Save, Finish, Update and Undo say "Offline"', async ({ page }) => {
  const member = await signedIn(page)
  await createLibrary(member.client).addToLibrary(book('Offline', 300), { status: 'reading', startedOn: isoDay() })
  await page.reload()

  // A save first, so Undo is on offer when the connection goes.
  await page.getByTestId('home.update').click()
  await typeOn(page, 'progress.wheel', 30)
  await page.getByTestId('progress.action').click()
  await expect(page.getByTestId('home.undo')).toBeVisible()
  await page.context().setOffline(true)
  await expect(page.getByTestId('home.undo')).toBeDisabled()
  await expect(page.getByTestId('home.undo')).toHaveText(en.common.offline)
  await expect(page.getByTestId('home.update')).toBeDisabled({ timeout: 8_000 })
  await expect(page.getByTestId('home.update')).toHaveText(en.common.offline)

  // The sheet open when the connection went: the wheel turns, Save and Finish say Offline.
  await page.context().setOffline(false)
  await page.getByTestId('home.update').click()
  await page.context().setOffline(true)
  await expect(page.getByTestId('progress.action')).toHaveText(en.common.offline)
  await expect(page.getByTestId('progress.action')).toBeDisabled()
  await expect(page.getByTestId('progress.finish')).toHaveText(en.common.offline)
  await page.getByTestId('progress.plus').click()
  await expect(page.getByTestId('progress.wheel')).toHaveAttribute('aria-valuenow', '31')
  await page.getByTestId('progress.cancel').click()

  // The book page's Update progress too; back online, it opens again.
  await page.context().setOffline(false)
  await page.getByTestId('home.entry').click()
  await expect(page.getByTestId('book.updateProgress')).toBeEnabled()
  await page.context().setOffline(true)
  await expect(page.getByTestId('book.updateProgress')).toBeDisabled()
  await expect(page.getByTestId('book.updateProgress')).toHaveText(en.common.offline)
  await page.context().setOffline(false)
  await expect(page.getByTestId('book.updateProgress')).toBeEnabled()
  expect((await sessionOf(member.email))[0]!.progress_page).toBe(30)
})
