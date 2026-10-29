import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { friendPath, friendWithSharedBooks } from './bothRead'
import { signedIn } from './support'

/**
 * "You both read" in 3D (docs/plans/shared-books-slideshow.md, H): Regal's reel, on a member's page, with the
 * owner's decisions as the flow meets them.
 *
 * - It plays one round by itself when it comes in view; a registered swipe takes it over (Manual), the arc
 *   follows the finger, and it stays manual for the visit: Play is the only way back (H, defaults 1–2).
 * - A tap on the Book in front takes it out mid-play too, into the Stack's sheet: her stars and yours,
 *   Show back / Put back / Open book, no blurb. Back closes it and never leaves her page; Open book puts the
 *   Book back and pushes its page.
 *
 * It reads Regal's own reading of its state off the page (`.reel-card`'s `data-mode`, `data-picked`,
 * `data-front`, `data-book-count`, and the pause button's name) rather than its internals, so a change in
 * Regal's markup and wording is what a failure here means.
 *
 * It is in place from its first frame (Regal's own, in the page as soon as the component is: the Books at the
 * places the canvas draws them), the canvas takes over in the same pixels and the card does not change size; the
 * section draws no poster of its own (the owner's rule: never covers or positions that are not the final rendering).
 *
 * Chromium with motion: the suite's WebKit at Reduce Motion never mounts the live reel (that is
 * e2e/both-read.spec.ts's still). It skips itself where the flows' build has no Regal (LIBELLUS_REGAL, the
 * variable e2e/build.ts is told) or the browser no WebGL, where Regal's still is the right answer.
 */

test.use({ browserName: 'chromium', reducedMotion: 'no-preference' })

const REEL = '.reel-card'
const BUILD_HAS_REGAL = /^(1|true)$/i.test(process.env.LIBELLUS_REGAL?.trim() ?? '')

/**
 * A tap on the Book in front, as a member gives it: the arc is between two Books for part of every beat, and a
 * tap that lands there takes the reel over (Manual) instead of opening the sheet — so a tap that did not open
 * it is followed by another, the way a member taps again when nothing happened.
 */
async function tapFrontBook(page: import('@playwright/test').Page) {
  const reel = page.locator(REEL)
  const box = (await page.locator('.reel-card__view').boundingBox())!
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    try {
      await expect(reel).toHaveAttribute('data-mode', 'detail', { timeout: 3000 })
      return
    } catch {
      // The reel was moving: it is Manual now, and it stands still for the next tap. A tap that lands between two Books
      // (it hit no Book) takes the reel over where it is, which can be halfway between two (Regal's `takeOver`, no snap):
      // an arrow key steps it onto a Book, as a member would swipe it.
      await page.waitForTimeout(600)
      await reel.focus()
      await page.keyboard.press('ArrowRight')
      await page.waitForTimeout(1200)
    }
  }
  await expect(reel).toHaveAttribute('data-mode', 'detail')
  // The sheet's own content settles once: while the caption morphs into its title Regal draws it twice.
}

async function reelPossible(page: Page): Promise<boolean> {
  if (!BUILD_HAS_REGAL) return false
  return page.evaluate(
    "(() => { try { const canvas = document.createElement('canvas'); return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl')) } catch { return false } })()",
  )
}

test.describe('You both read, in 3D', () => {
  test('it is in place from the first frame and the card keeps its size when the canvas takes over', async ({ page }) => {
    test.slow()
    // Sampled every frame from before the app starts: what the reel's first frame is (its Books, the card's height)
    // and what it is once the canvas has taken over.
    await page.addInitScript(() => {
      type Sample = { height: number; books: string[]; sectionHeight: number }
      const w = window as unknown as { __reel: { first?: Sample; ready?: Sample; sawOwnPoster: boolean } }
      w.__reel = { sawOwnPoster: false }
      const sample = (): Sample => ({
        height: document.querySelector('.regal-books-reel')!.getBoundingClientRect().height,
        books: [...document.querySelectorAll('[data-reel-poster] [data-book]')].map((el) => el.getAttribute('data-book') ?? ''),
        sectionHeight: document.querySelector('[data-testid="member.bothRead"]')!.getBoundingClientRect().height,
      })
      const tick = () => {
        if (document.querySelector('[data-testid="member.bothRead.poster"]')) w.__reel.sawOwnPoster = true
        if (!w.__reel.first && document.querySelector('.regal-books-reel [data-reel-poster] [data-book]')) w.__reel.first = sample()
        if (!w.__reel.ready && document.querySelector('.reel-card--ready')) w.__reel.ready = sample()
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    const viewer = await signedIn(page)
    const friend = await friendWithSharedBooks(viewer, 12)
    await page.goto(friendPath(friend))
    await expect(page.getByTestId('member.bothRead')).toBeVisible()
    if (!(await reelPossible(page))) test.skip(true, 'no Regal in this build, or no WebGL here: the still stands in')

    await expect(page.locator('.reel-card--ready')).toBeVisible({ timeout: 30_000 })
    await page.waitForFunction(() => Boolean((window as unknown as { __reel: { ready?: unknown } }).__reel.ready))
    const seen = await page.evaluate(
      () => (window as unknown as { __reel: { first?: { height: number; books: string[]; sectionHeight: number }; ready?: { height: number; books: string[]; sectionHeight: number }; sawOwnPoster: boolean } }).__reel,
    )
    expect(seen.sawOwnPoster, 'a poster of the section, drawn at any time').toBe(false)
    expect(seen.first, "Regal's first frame was in the page before the canvas").toBeTruthy()
    // Regal draws at most five Books at its start: the arc around the Book in front, never the 12.
    expect(seen.first!.books.length).toBeGreaterThan(0)
    expect(seen.first!.books.length).toBeLessThanOrEqual(5)
    // No height change at the handover, and no band: the card is the reel's own height.
    expect(Math.abs(seen.ready!.height - seen.first!.height)).toBeLessThanOrEqual(1)
    expect(Math.abs(seen.ready!.sectionHeight - seen.first!.sectionHeight)).toBeLessThanOrEqual(1)
  })

  test('it plays, a swipe takes it over, and only Play brings it back', async ({ page }) => {
    test.slow()
    const viewer = await signedIn(page)
    const friend = await friendWithSharedBooks(viewer, 12)
    await page.goto(friendPath(friend))
    await expect(page.getByTestId('member.bothRead')).toBeVisible()
    if (!(await reelPossible(page))) test.skip(true, 'no Regal in this build, or no WebGL here: the still stands in')

    const reel = page.locator(REEL)
    await expect(reel).toHaveAttribute('data-mode', 'playing', { timeout: 30_000 })
    // Until the canvas has taken over, Regal's own first frame is what shows and nothing of it takes input: wait for
    // the canvas before touching the Books. The section has no poster of its own, before or after.
    await expect(page.locator('.reel-card--ready')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('member.bothRead.poster')).toHaveCount(0)
    await expect(reel).toHaveAttribute('data-book-count', '12')
    // The reel is what a screen reader meets: nothing of it is hidden or inert.
    await expect(page.locator('.regal-books-reel')).not.toHaveAttribute('aria-hidden', 'true')
    await expect(page.locator('.regal-books-reel')).not.toHaveAttribute('inert', '')
    // Each slide is named with its place ("1 of 12, Title, Author"): Regal fills {n} and {count} in our label.
    await expect(reel.locator('[aria-roledescription="slide"]')).toHaveAttribute('aria-label', /^\d+ of 12, /)
    // WCAG 2.2.2: what moves on its own can be paused, and the button says what it does.
    await expect(page.getByRole('button', { name: 'Pause slideshow' })).toBeVisible()

    // A horizontal drag on the arc: Manual, another Book in front, and it stays manual.
    const box = (await page.locator('.reel-card__view').boundingBox())!
    const y = box.y + box.height / 2
    const front = await reel.getAttribute('data-front')
    await page.mouse.move(box.x + box.width - 20, y)
    await page.mouse.down()
    for (const step of [0.8, 0.6, 0.4, 0.2]) await page.mouse.move(box.x + box.width * step, y, { steps: 3 })
    await page.mouse.up()
    await expect(reel).toHaveAttribute('data-mode', 'manual')
    await expect(reel).not.toHaveAttribute('data-front', front ?? '')
    await page.waitForTimeout(4000)
    await expect(reel, 'a swipe leaves it manual for the visit').toHaveAttribute('data-mode', 'manual')
    await expect(page.getByRole('button', { name: 'Play slideshow' }), 'in Manual the button reads Play').toBeVisible()

    // Play is the only way back (H, default 1).
    await page.getByRole('button', { name: 'Play slideshow' }).click()
    await expect(reel).toHaveAttribute('data-mode', 'playing')
    await expect(page.getByRole('button', { name: 'Pause slideshow' })).toBeVisible()
  })

  test('the Book in front comes out with her stars and yours, Back puts it back, Open book opens its page', async ({ page }) => {
    test.slow()
    const viewer = await signedIn(page)
    const friend = await friendWithSharedBooks(viewer, 12)
    await page.goto(friendPath(friend))
    await expect(page.getByTestId('member.bothRead')).toBeVisible()
    if (!(await reelPossible(page))) test.skip(true, 'no Regal in this build, or no WebGL here: the still stands in')

    const reel = page.locator(REEL)
    await expect(reel).toHaveAttribute('data-mode', 'playing', { timeout: 30_000 })
    // Regal's own first frame takes no input: wait for the canvas to have taken over before touching the Books.
    await expect(page.locator('.reel-card--ready')).toBeVisible({ timeout: 30_000 })
    // A tap on the Book in front takes it out, also mid-play (the owner's decision).
    await tapFrontBook(page)
    const picked = (await reel.getAttribute('data-picked'))!
    expect(picked, 'a Book taken out').toMatch(/^[0-9a-f-]{36}$/)

    // The sheet is the Stack's (`role=dialog`), and Regal draws it twice while the caption morphs into its title
    // (one copy behind `aria-hidden`); the dialog a screen reader is given is the one to read here.
    const sheet = page.getByRole('dialog').first()
    await expect(sheet.getByTestId('member.bothRead.detailMeta')).toContainText('Ida')
    await expect(sheet.getByTestId('member.bothRead.detailMeta')).toContainText('You')
    // Show back / Put back / Open book, and no blurb: `both_read` carries none.
    await expect(sheet.getByTestId('member.bothRead.flip')).toHaveText('Show back')
    await expect(sheet.getByTestId('member.bothRead.putBack')).toHaveText('Put back')
    await expect(sheet.getByTestId('member.bothRead.openBook')).toHaveText('Open book')
    await sheet.getByTestId('member.bothRead.flip').click()
    await expect(sheet.getByTestId('member.bothRead.flip'), 'Show back turns the Book round').toHaveText('Show front')

    // The system Back closes the Book and never leaves her page (H); it stays Manual after that.
    await page.goBack()
    await expect(reel).toHaveAttribute('data-mode', 'manual')
    await expect(reel).toHaveAttribute('data-picked', '')
    await expect(page).toHaveURL(new RegExp(`${friend.id}$`))

    // Taken out again, Open book puts the Book back at once and pushes its page; Back comes home.
    await tapFrontBook(page)
    const bookId = (await reel.getAttribute('data-picked'))!
    await page.getByRole('dialog').first().getByTestId('member.bothRead.openBook').click()
    await expect(page).toHaveURL(new RegExp(`/book/${bookId}$`))
    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`${friend.id}$`))
    // Her page again: the round plays once per app session for her, so the reel finds itself resting (Play plays it).
    await expect(page.locator('.reel-card--ready')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator(REEL)).toHaveAttribute('data-picked', '')
    await page.waitForTimeout(1500)
    await expect(page.locator(REEL), 'a return visit does not replay the round').not.toHaveAttribute('data-mode', 'playing')
  })
})
