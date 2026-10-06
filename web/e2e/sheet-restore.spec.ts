import { expect, type Page } from '@playwright/test'
import { sql } from '../tests/support/stack'
import { recordedApple, signedIn, untilStill } from './support'
import { test } from './fixtures'

/**
 * A sheet that leads to a Book page stays where it was (docs/MOTION.md, "A sheet
 * comes back"): Home's "Read in 2026" and the Profile's rows of Books both open a
 * Book, and Back from it (the system's or the page's own) returns to the page with
 * the sheet open at its resting place, with its scrim, its list scrolled where it
 * was — as if it had stayed open under the Book. It does not rise or fade in
 * again; the cover flies back into its row in the sheet. Opened afresh (the tally
 * tapped again), a sheet still rises.
 *
 * The first frames are read, not a settled page: every frame from the sheet's
 * first on is recorded (`watch`), and none may show it off its place or moving.
 */

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

/** Books read this year, rated five stars: enough rows to scroll the sheet's list. */
async function shelve(memberId: string, count: number) {
  for (let index = 0; index < count; index++) {
    const [book] = await sql<{ id: string }>(
      `insert into public.books (title, authors, source, owner_id) values ($1, '{"Ursula K. Le Guin"}', 'manual', $2) returning id`,
      [`Restore ${String(index).padStart(2, '0')}`, memberId],
    )
    const [entry] = await sql<{ id: string }>(
      `insert into public.library_entries (member_id, book_id, status) values ($1, $2, 'finished') returning id`,
      [memberId, book!.id],
    )
    await sql(
      `insert into public.reading_sessions (entry_id, started_on, ended_on, outcome, rating)
       select $1, ended - 3, ended, 'finished', 20
         from (select greatest(date_trunc('year', current_date)::date, current_date - $2::int) as ended) as day`,
      [entry!.id, index],
    )
  }
}

interface Frame {
  /** The sheet is on screen: its top edge, its transform, and how many animations run on it. */
  panel: { top: number; transform: string; animations: number } | null
  scrim: { opacity: string; animations: number } | null
  scroll: number | null
  /** The cover in the air flies over the sheet. */
  overSheet: boolean
}

/** Records every frame from now on (in `window.__frames`) of the sheet `testid`. */
async function watch(page: Page, testid: string) {
  await page.evaluate((id) => {
    const frames: Frame[] = []
    Object.assign(window, { __frames: frames })
    const tick = () => {
      const panel = document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
      const scrim = document.querySelector<HTMLElement>(`[data-testid="${id}.scrim"]`)
      const shown = panel && getComputedStyle(panel).display !== 'none'
      frames.push({
        panel: shown
          ? { top: Math.round(panel.getBoundingClientRect().top), transform: getComputedStyle(panel).transform, animations: panel.getAnimations().length }
          : null,
        scrim: scrim ? { opacity: getComputedStyle(scrim).opacity, animations: scrim.getAnimations().length } : null,
        scroll: panel?.querySelector('[data-sheet-body]')?.scrollTop ?? null,
        overSheet: Boolean(document.querySelector('[data-over-sheet]:not(:empty)')),
      })
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, testid)
}

const framesOf = (page: Page) => page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames)

/** The sheet's first frame on, nothing of it moves: resting place, no transform, no animation, scrim full. */
function expectAtRest(frames: Frame[], scroll: number) {
  const shown = frames.filter((frame) => frame.panel)
  expect(shown.length).toBeGreaterThan(5)
  const rest = shown.at(-1)!.panel!.top
  for (const frame of shown) {
    expect(frame.panel).toEqual({ top: rest, transform: 'none', animations: 0 })
    expect(frame.scrim).toEqual({ opacity: '1', animations: 0 })
    expect(frame.scroll).toBeCloseTo(scroll, 0)
  }
}

const sheets = [
  {
    name: "Home's Read in tally",
    testid: 'homeTally',
    async open(page: Page) {
      await page.getByTestId('home.tally').click()
    },
    reopen: (page: Page) => page.getByTestId('home.tally').click(),
    async close(page: Page) {
      await page.getByTestId('homeTally.cancel').click()
    },
    async away(page: Page) {
      await page.getByTestId('shell.tab.library').click()
      await page.getByTestId('shell.tab.home').click()
    },
  },
  {
    name: "the Profile's star row",
    testid: 'profileReads',
    async open(page: Page) {
      await page.getByTestId('shell.avatar').click()
      await page.getByTestId('profile.stars.5').click()
    },
    reopen: (page: Page) => page.getByTestId('profile.stars.5').click(),
    async close(page: Page) {
      await page.getByTestId('profileReads.cancel').click()
    },
    async away(page: Page) {
      await page.getByTestId('profile.back').click()
      await page.getByTestId('shell.avatar').click()
    },
  },
]

for (const sheet of sheets) {
  for (const way of ['system', 'page'] as const) {
    test(`${sheet.name}: Back from a Book (${way} Back) finds it open where it was, with no rise and no fade`, async ({ page }) => {
      const member = await signedIn(page)
      await shelve(member.id, 14)
      // Home loaded before the Books were there.
      await page.reload()
      await expect(page.getByTestId('home.tallyCount')).toHaveText('14')
      const id = sheet.testid

      // A fresh opening rises: the sheet is off its place and moving in some frame.
      await watch(page, id)
      await sheet.open(page)
      await expect(page.getByTestId(`${id}.sheetTitle`)).toBeVisible()
      await untilStill(page)
      const rising = (await framesOf(page)).filter((frame) => frame.panel && frame.panel.transform !== 'none')
      expect(rising.length).toBeGreaterThan(0)

      // Scrolled, and a Book from the middle of the list.
      const body = page.getByTestId(`${id}.list`).locator('xpath=ancestor::*[@data-sheet-body]')
      await body.evaluate((el) => (el.scrollTop = 160))
      const row = page.getByTestId(`${id}.read`).nth(6)
      await row.scrollIntoViewIfNeeded()
      const scroll = await body.evaluate((el) => el.scrollTop)
      expect(scroll).toBeGreaterThan(0)
      const title = (await row.getByTestId('profile.readTitle').textContent())!
      await row.click()
      await expect(page.getByTestId('book.title')).toHaveText(title)
      await untilStill(page)

      // Back: from its first frame the sheet is there, still, scrolled as it was.
      await watch(page, id)
      if (way === 'system') await page.goBack()
      else await page.getByTestId('book.back').click()
      await expect(page.getByTestId(`${id}.sheetTitle`)).toBeVisible()
      await untilStill(page)
      await expect(page.getByTestId('shell.flightCover')).toHaveCount(0)
      await expect(page.getByTestId(`${id}.read`).nth(6).locator('[data-flight-hidden]')).toHaveCount(0)
      const frames = await framesOf(page)
      expectAtRest(frames, scroll)
      // The cover flew back over the sheet, into its row.
      expect(frames.some((frame) => frame.overSheet)).toBe(true)
      await expect(page.locator('[data-over-sheet]')).toHaveCount(0)

      // It is a sheet like any: the system Back closes it (the page stays), and it is not there the next time.
      await page.goBack()
      await expect(page.getByTestId(id)).toBeHidden()
      await expect(page.getByTestId(`${id}.sheetTitle`)).toHaveCount(0)

      // Opened again by hand, it rises as a fresh sheet does.
      await watch(page, id)
      await sheet.reopen(page)
      await expect(page.getByTestId(`${id}.sheetTitle`)).toBeVisible()
      await untilStill(page)
      expect((await framesOf(page)).some((frame) => frame.panel && frame.panel.transform !== 'none')).toBe(true)

      // Closed for good, away and back: no sheet (it only returns from its Book).
      await sheet.close(page)
      await expect(page.getByTestId(id)).toBeHidden()
      await sheet.away(page)
      await expect(page.getByTestId(id)).toBeHidden()
    })
  }
}
