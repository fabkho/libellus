import { expect, type Page } from '@playwright/test'
import sharp from 'sharp'
import { test } from './fixtures'
import { signedIn, untilStill } from './support'

/**
 * The avatar's flight to the Profile and back (docs/MOTION.md, Push to the
 * Profile) is one named group (`data-profile-avatar`, `view-transition-name:
 * profile-avatar`), so its ring, photo, shadow and initials must all be drawn
 * inside the element that carries the name: whatever is drawn outside it stays
 * in the page's own snapshot and is already at the end while the avatar is
 * still on its way. In Chromium, where the transition's frames can be paused
 * and looked at.
 */
// What moves is the subject here: the View Transition plays, which the config's Reduce Motion cuts.
test.use({ reducedMotion: 'no-preference' })
test.use({ browserName: 'chromium', viewport: { width: 412, height: 915 } })

/** The elements in `scope` that draw a box-shadow (the ring, the shadow, the hairline) outside the element that carries the name. */
async function drawnOutside(page: Page, scope: string) {
  return page.evaluate((scope) => {
    const root = document.querySelector(scope)!
    return [root, ...root.querySelectorAll('*')]
      .filter((el) => getComputedStyle(el).boxShadow !== 'none' && !el.closest('[data-profile-avatar]'))
      .map((el) => el.getAttribute('data-testid') ?? el.tagName)
  }, scope)
}

test('everything the avatar draws is inside the element that flies, in the header and in the hero', async ({ page }) => {
  await signedIn(page)
  expect(await drawnOutside(page, '[data-testid="shell.avatar"]')).toEqual([])
  await page.getByTestId('shell.avatar').click()
  await expect(page.getByTestId('profile.library')).toBeVisible()
  await untilStill(page)
  expect(await drawnOutside(page, '[data-testid="profile.avatar"]')).toEqual([])
})

for (const scheme of ['light', 'dark'] as const) {
  test(`the Profile's ring is not drawn at its place before the avatar gets there (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await page.addInitScript(() => {
      const start = document.startViewTransition.bind(document)
      document.startViewTransition = ((update: never) => {
        const transition = start(update)
        ;(window as unknown as { transition: ViewTransition }).transition = transition
        return transition
      }) as never
    })
    await signedIn(page)
    await page.getByTestId('shell.avatar').click()
    await page.waitForFunction(() => (window as unknown as { transition?: unknown }).transition)
    await page.evaluate(async () => {
      const { transition } = window as unknown as { transition: ViewTransition }
      await transition.ready
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      document.getAnimations().forEach((animation) => animation.pause())
      // The Profile fades in over the tab: a fifth of the way, the target ring would show faintly.
      document.getAnimations().forEach((animation) => (animation.currentTime = 80))
    })
    await page.waitForTimeout(100)

    // The Profile's own snapshot is showing, the flying avatar still near the corner: at the
    // ring's left edge there is nothing but the page (and the shadow it casts), as 3 px further out.
    const box = await page.evaluate(() => {
      const ring = document.querySelector('[data-testid="profile.avatar"]')!.getBoundingClientRect()
      return { left: ring.left, centre: ring.top + ring.height / 2 }
    })
    const scale = 3
    const shot = await sharp(await page.screenshot({ scale: 'device' })).raw().toBuffer({ resolveWithObject: true })
    const at = (x: number, y: number) => {
      const i = (Math.round(y * scale) * shot.info.width + Math.round(x * scale)) * shot.info.channels
      return [shot.data[i]!, shot.data[i + 1]!, shot.data[i + 2]!]
    }
    const ring = at(box.left - 0.5, box.centre)
    const beside = at(box.left - 3, box.centre)
    expect(Math.max(...ring.map((c, i) => Math.abs(c - beside[i]!)))).toBeLessThan(10)

    await page.evaluate(() => document.getAnimations().forEach((animation) => animation.play()))
    await expect(page.getByTestId('profile.library')).toBeVisible()
  })
}
