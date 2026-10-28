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
 * Chromium with motion: the suite's WebKit at Reduce Motion never mounts the reel (that is
 * e2e/both-read.spec.ts's poster). It skips itself where the flows' build has no Regal (LIBELLUS_REGAL, the
 * variable e2e/build.ts is told) or the browser no WebGL, where the poster is the right answer.
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
      // The reel was moving: it is Manual now, and it stands still for the next tap.
      await page.waitForTimeout(600)
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
  test('it plays, a swipe takes it over, and only Play brings it back', async ({ page }) => {
    test.slow()
    const viewer = await signedIn(page)
    const friend = await friendWithSharedBooks(viewer, 12)
    await page.goto(friendPath(friend))
    await expect(page.getByTestId('member.bothRead')).toBeVisible()
    if (!(await reelPossible(page))) test.skip(true, 'no Regal in this build, or no WebGL here: the poster stands in')

    const reel = page.locator(REEL)
    await expect(reel).toHaveAttribute('data-mode', 'playing', { timeout: 30_000 })
    // Until the canvas has drawn its first frame the poster stands in for it, and the poster's covers are
    // links of their own: wait for the canvas to have it before touching the Books.
    await expect(page.getByTestId('member.bothRead.poster')).toHaveAttribute('aria-hidden', 'true', { timeout: 30_000 })
    await expect(reel).toHaveAttribute('data-book-count', '12')
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
    if (!(await reelPossible(page))) test.skip(true, 'no Regal in this build, or no WebGL here: the poster stands in')

    const reel = page.locator(REEL)
    await expect(reel).toHaveAttribute('data-mode', 'playing', { timeout: 30_000 })
    // Until the canvas has drawn its first frame the poster stands in for it, and the poster's covers are
    // links of their own: wait for the canvas to have it before touching the Books.
    await expect(page.getByTestId('member.bothRead.poster')).toHaveAttribute('aria-hidden', 'true', { timeout: 30_000 })
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
    await expect(reel).toHaveAttribute('data-picked', '')
  })
})
