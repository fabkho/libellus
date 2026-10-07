import { expect, type Page } from '@playwright/test'
import { sql } from '../tests/support/stack'
import { recordedApple, signedIn, untilStill } from './support'
import { test } from './fixtures'

/**
 * Cumulative Layout Shift on the Library, as Chrome counts it for the field
 * data (Cloudflare Web Analytics, and the app's own `vitals` reports): the
 * shifts nobody's input explains, summed in session windows (at most 1 s apart,
 * 5 s long), the largest window. Chromium only: WebKit has no Layout
 * Instability API. A phone (Android's Chrome) with a Library of real size, on a
 * CPU slowed four times.
 *
 * The Library scored 1.0 in production. Its own screens were stable; the
 * shifts were the search palette's: it grew upwards from the query with every
 * answer, so each answer moved its shadow, its surface and its list by the
 * height they gained (the shadow, `shadow-palette`, the size of the palette,
 * was the largest shift). The palette now keeps its boxes as tall as it may
 * grow and only draws the part its content fills (composables/usePaletteRoom.ts).
 */

test.use({ browserName: 'chromium', viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true })

/** What "good" is for CLS is ≤ 0.1; a screen of ours stays well under it. */
const STABLE = 0.05

const COVER = 'https://is1-ssl.mzstatic.com/image/thumb/Publication/v4/cls/shift/cover.jpg/600x900bb.jpg'

/** Puts a Library of real size on the member: 30 to read and 30 finished over three years, a few matching "Piranesi". */
async function shelve(memberId: string) {
  for (let i = 0; i < 60; i++) {
    const finished = i % 2 === 1
    const title = i % 10 === 0 ? `Piranesi Notebook ${i}` : `Shift ${String(i).padStart(2, '0')}`
    const [book] = await sql<{ id: string }>(
      `insert into public.books (title, authors, source, owner_id, cover_url, cover_dominant)
         values ($1, '{"Ursula K. Le Guin"}', 'manual', $2, $3, '#5b6c8f') returning id`,
      [title, memberId, COVER],
    )
    const [entry] = await sql<{ id: string }>(
      `insert into public.library_entries (member_id, book_id, status, added_at)
         values ($1, $2, $3, now() - make_interval(mins => $4)) returning id`,
      [memberId, book!.id, finished ? 'finished' : 'want_to_read', i],
    )
    if (finished)
      await sql(
        `insert into public.reading_sessions (entry_id, started_on, ended_on, outcome, rating)
           values ($1, $2::date - 9, $2, 'finished', 16)`,
        [entry!.id, `${2026 - (i % 3)}-0${1 + (i % 9)}-1${i % 10}`],
      )
  }
}

/** Every layout shift from the start of each page, kept on `window.__shifts`. */
async function recordShifts(page: Page) {
  await page.addInitScript(() => {
    const shifts: { t: number; value: number; input: boolean }[] = []
    Object.assign(window, { __shifts: shifts })
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[])
          shifts.push({ t: entry.startTime, value: entry.value, input: entry.hadRecentInput })
      }).observe({ type: 'layout-shift', buffered: true })
    } catch {
      // No Layout Instability API: nothing to record.
    }
  })
}

/** The CLS since the last call (or the page's start), as web-vitals computes it; the record starts over. */
async function takeCls(page: Page): Promise<number> {
  const shifts = await page.evaluate(() => {
    const all = (window as unknown as { __shifts: { t: number; value: number; input: boolean }[] }).__shifts
    return all.splice(0, all.length)
  })
  let largest = 0
  let current = 0
  let first = 0
  let last = 0
  for (const shift of shifts.filter((s) => !s.input)) {
    if (current && shift.t - last < 1000 && shift.t - first < 5000) current += shift.value
    else {
      current = shift.value
      first = shift.t
    }
    last = shift.t
    largest = Math.max(largest, current)
  }
  return largest
}

async function slowCpu(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
}

async function onLibrary(page: Page) {
  await recordShifts(page)
  const member = await signedIn(page)
  await shelve(member.id)
  await page.getByTestId('shell.tab.library').click()
  await expect(page.getByTestId('library.entry')).toHaveCount(30)
  await untilStill(page)
  await slowCpu(page)
}

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

test('the Library opens in place: a reload and a return from a book shift nothing', async ({ page }) => {
  await onLibrary(page)

  // A reload (a start into the Library): the first frame is the final layout.
  await page.reload()
  await expect(page.getByTestId('library.entry')).toHaveCount(30)
  await untilStill(page)
  await page.waitForTimeout(1500)
  expect(await takeCls(page)).toBeLessThan(STABLE)

  // Each segment, as the member reads it.
  for (const segment of ['finished', 'want_to_read'] as const) {
    await page.getByTestId(`library.segment.${segment}`).click()
    await untilStill(page)
    await page.waitForTimeout(800)
    expect(await takeCls(page)).toBeLessThan(STABLE)
  }

  // Down the list, into a book and back with the system Back (no tap on the page: nothing excuses a shift).
  await page.evaluate(() => window.scrollTo(0, 1200))
  await untilStill(page)
  await takeCls(page)
  const row = page.getByTestId('library.entry').nth(18)
  await row.click()
  await expect(page.getByTestId('book.hero')).toBeVisible()
  await untilStill(page)
  await page.waitForTimeout(800)
  await takeCls(page)
  await page.goBack()
  await expect(page.getByTestId('library.title')).toBeVisible()
  await untilStill(page)
  await page.waitForTimeout(1500)
  expect(await takeCls(page)).toBeLessThan(STABLE)
  expect(await page.evaluate(() => Math.round(window.scrollY))).toBeGreaterThan(600)
})

test('the Library with filters and a sort set opens in place, and setting them shifts nothing', async ({ page }) => {
  await recordShifts(page)
  const member = await signedIn(page)
  await shelve(member.id)
  // Half of what she wants to read is an ebook: a filter with something to leave out.
  await sql(
    `update public.library_entries set read_as = 'ebook'
      where id in (select id from public.library_entries where member_id = $1 and status = 'want_to_read' order by added_at desc limit 15)`,
    [member.id],
  )
  await page.getByTestId('shell.tab.library').click()
  await expect(page.getByTestId('library.entry')).toHaveCount(30)
  await untilStill(page)
  await slowCpu(page)
  await takeCls(page)

  // Setting a filter and a sort: her taps explain what moves, and nothing else moves.
  await page.getByTestId('library.view.filter').click()
  await page.getByTestId('libraryFilter.readAs.ebook').click()
  await page.getByTestId('libraryFilter.action').click()
  await untilStill(page)
  await expect(page.getByTestId('library.entry')).toHaveCount(15)
  await page.getByTestId('library.segment.finished').click()
  await untilStill(page)
  await page.getByTestId('library.view.filter').click()
  await page.getByTestId('libraryFilter.year').filter({ hasText: '2026' }).click()
  await page.getByTestId('libraryFilter.action').click()
  await untilStill(page)
  await page.getByTestId('library.view.sort').click()
  await page.getByTestId('librarySort.title').click()
  await untilStill(page)
  await page.waitForTimeout(800)
  expect(await takeCls(page)).toBeLessThan(STABLE)

  // A reload: the device remembers both, so the first frame is the filtered, sorted Library.
  await page.reload()
  await expect(page.getByTestId('library.entry')).toHaveCount(15)
  await expect(page.getByTestId('library.view.chip')).toHaveCount(1)
  await untilStill(page)
  await page.waitForTimeout(1500)
  expect(await takeCls(page)).toBeLessThan(STABLE)

  // Finished, filtered and sorted; into a book and back with the system Back: nothing moves on its own.
  await page.getByTestId('library.segment.finished').click()
  await untilStill(page)
  await expect(page.getByTestId('library.view.chip')).toHaveCount(1)
  await page.waitForTimeout(800)
  await takeCls(page)
  await page.getByTestId('library.entry').nth(3).click()
  await expect(page.getByTestId('book.hero')).toBeVisible()
  await untilStill(page)
  await page.waitForTimeout(800)
  await takeCls(page)
  await page.goBack()
  await expect(page.getByTestId('library.title')).toBeVisible()
  await untilStill(page)
  await page.waitForTimeout(1500)
  expect(await takeCls(page)).toBeLessThan(STABLE)
})

test('search over the Library: answers that arrive grow the palette without shifting it', async ({ page }) => {
  // Apple answers a little later, as over a phone's connection: well after the last keystroke, where
  // nothing excuses a shift. The Catalogue (shared by every run on this stack) and OpenLibrary find
  // nothing, so Apple's answer only adds to her own group: a later source re-ranking a list that is
  // already there moves its rows for real, and that is not what this is about.
  await page.route('https://itunes.apple.com/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800))
    await route.fallback()
  })
  await page.route('https://openlibrary.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ numFound: 0, docs: [] }) }),
  )
  await page.route('**/rest/v1/rpc/search_books*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }),
  )
  await onLibrary(page)

  await page.getByTestId('shell.tab.search').click()
  await expect(page.getByTestId('search.query')).toBeFocused()
  await untilStill(page)
  await page.waitForTimeout(600)
  expect(await takeCls(page)).toBeLessThan(STABLE)

  // Her own Books first, then Apple's: the palette grows to the top of the screen.
  await page.keyboard.type('piranesi')
  await expect(page.getByTestId('search.ownResult').first()).toBeVisible()
  await expect(page.getByTestId('search.results').locator('li[data-near-key]').first()).toBeVisible()
  await page.waitForTimeout(1500)
  // The far end of the list (its last item) has climbed into the top half of the screen.
  const top = (await page.getByTestId('search.results').locator(':scope > li').last().boundingBox())!
  expect(top.y).toBeLessThan(450)
  expect(await takeCls(page)).toBeLessThan(STABLE)

  // Nothing found: the palette shrinks back to the query, still without a shift.
  await page.keyboard.type('zz')
  await expect(page.getByTestId('search.noResults')).toBeVisible()
  await page.waitForTimeout(1500)
  expect(await takeCls(page)).toBeLessThan(STABLE)

  // A tap on the page above the palette's content closes it, as before.
  await page.mouse.click(200, 120)
  await expect(page.getByTestId('search.overlay')).toBeHidden()
})
