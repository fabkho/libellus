import { expect, type Page } from '@playwright/test'
import { sql } from '../tests/support/stack'
import { recordedApple, signedIn, untilStill } from './support'
import { test } from './fixtures'

/**
 * Coming back to the Library (docs/MOTION.md, "Move only what changed"): the tab is kept alive,
 * so the segment the member chose is still there, and its list must be on screen in place from
 * the first frame. Nothing opens its room, moves or fades in; a list only moves when it changes
 * (a Book added, finished, removed) or the member chooses another segment.
 *
 * Finished used to slide in from the top of the page. A re-render while the Library sat off the
 * document measured its rows at 0,0, and `UiListMotion` moved them from there once it was back.
 * Only Finished showed it: its lists live inside the year sections, whose slots the compiler
 * cannot prove stable, so the lists re-rendered with the page.
 */

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

/** Books on the member's Library: some Want to read, and some Finished over two years. */
async function shelve(memberId: string) {
  const reads = [
    ['Return 01', 'finished', '2025-11-20'],
    ['Return 02', 'finished', '2025-06-02'],
    ['Return 03', 'finished', '2024-12-30'],
    ['Return 04', 'finished', '2024-03-04'],
    ['Return 05', 'want_to_read', null],
    ['Return 06', 'want_to_read', null],
    ['Return 07', 'want_to_read', null],
  ] as const
  for (const [index, [title, status, ended]] of reads.entries()) {
    const [book] = await sql<{ id: string }>(
      `insert into public.books (title, authors, source, owner_id) values ($1, '{"Ursula K. Le Guin"}', 'manual', $2) returning id`,
      [title, memberId],
    )
    const [entry] = await sql<{ id: string }>(
      `insert into public.library_entries (member_id, book_id, status, added_at) values ($1, $2, $3, now() - make_interval(mins => $4)) returning id`,
      [memberId, book!.id, status, index],
    )
    if (ended)
      await sql(
        `insert into public.reading_sessions (entry_id, started_on, ended_on, outcome, rating) values ($1, $2::date - 9, $2, 'finished', 16)`,
        [entry!.id, ended],
      )
  }
}

/**
 * Watches every frame of the Library from now on: any entry that is moved by a transform, runs
 * a transition or an animation, has a room that is not its own (an inline height) or is not
 * fully opaque is written to `window.__motion`. Armed on the page that is about to show, so the
 * first frame of the Library counts.
 */
async function watchEntries(page: Page) {
  await page.evaluate(() => {
    const seen: string[] = []
    Object.assign(window, { __motion: seen })
    const frame = () => {
      for (const el of document.querySelectorAll('[data-testid="library.entry"]')) {
        const style = getComputedStyle(el)
        const why = [
          style.transform !== 'none' && `transform ${style.transform}`,
          el.getAnimations().length > 0 && `${el.getAnimations().length} animations`,
          style.opacity !== '1' && `opacity ${style.opacity}`,
          (el as HTMLElement).style.height && `height ${(el as HTMLElement).style.height}`,
        ].filter(Boolean)
        if (why.length) seen.push(`${el.textContent?.slice(0, 12)}: ${why.join(', ')}`)
      }
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
}

const motion = (page: Page) => page.evaluate(() => (window as unknown as { __motion: string[] }).__motion)

for (const [segment, list] of [
  ['finished', 'library.finished'],
  ['want_to_read', 'library.wantToRead'],
] as const) {
  test(`the ${segment} list is there in place when the member comes back to the Library`, async ({ page }) => {
    const member = await signedIn(page)
    await shelve(member.id)
    await page.getByTestId('shell.tab.library').click()
    await page.getByTestId(`library.segment.${segment}`).click()
    await expect(page.getByTestId(list)).toBeVisible()
    await untilStill(page)

    await page.getByTestId('shell.tab.home').click()
    await expect(page.getByTestId('home.title')).toBeVisible()
    await untilStill(page)

    await watchEntries(page)
    await page.getByTestId('shell.tab.library').click()
    await expect(page.getByTestId(list)).toBeVisible()
    await page.waitForTimeout(800)

    expect(await motion(page)).toEqual([])
    await expect(page.locator('[data-moving]')).toHaveCount(0)
  })
}
