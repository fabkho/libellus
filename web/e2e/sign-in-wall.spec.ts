import { expect } from '@playwright/test'
import { test } from './fixtures'

/**
 * The wall behind the way in (components/auth/Frame.vue, WallCover.vue) is decoration. Its covers were the
 * sign-in's largest contentful paint, 5.6 s against 2.2 s without them, because twenty images were asked
 * for before the form was painted (docs/perf/final-round.md, finding 1): they are asked for after it, at
 * low priority, drawn on canvases, and the wall stays hidden from assistive technology and out of the
 * focus order.
 */
const COVERS = 15
const isCoverRequest = (name: string) => /mzstatic\.com\//.test(name)

/** Notes the first frame the form's title was in: a cover asked for before it was asked for before the form. */
const noteTheForm = () => {
  const w = window as unknown as { __formShownAt?: number }
  const tick = () => {
    const title = document.querySelector('[data-testid="signIn.title"]')
    if (title && title.getBoundingClientRect().height > 0) w.__formShownAt = performance.now()
    else requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

test('the wall asks for no cover before the form is on screen, and is hidden from assistive technology', async ({ page }) => {
  await page.addInitScript(noteTheForm)
  await page.goto('/sign-in')
  await expect(page.getByTestId('signIn.title')).toBeVisible()
  // The covers arrive after the form: fifteen of them, over the cloth boards (the fourth row is bare).
  const wall = page.locator('.wall')
  await expect(wall.locator('canvas.cover-in')).toHaveCount(COVERS, { timeout: 15_000 })
  await expect(wall.locator('.spine')).toHaveCount(20)

  const { formShownAt, requests } = await page.evaluate(() => ({
    formShownAt: (window as unknown as { __formShownAt?: number }).__formShownAt ?? Number.NaN,
    requests: performance.getEntriesByType('resource').map((entry) => ({ name: entry.name, start: entry.startTime })),
  }))
  const covers = requests.filter((request) => isCoverRequest(request.name))
  expect(covers).toHaveLength(COVERS)
  expect(formShownAt).toBeGreaterThan(0)
  // Not one was started before the first frame that had the form in it.
  for (const cover of covers) expect(cover.start, cover.name).toBeGreaterThan(formShownAt)
  // They are asked for at the size the 82 px slot draws, 240 × 360 (docs/covers.md), never the 600 × 900 the data holds.
  for (const cover of covers) expect(cover.name).toMatch(/\/240x360bb\.jpg$/)

  // Decoration: hidden from the accessibility tree, nothing in it takes focus, no image to describe.
  await expect(wall).toHaveAttribute('aria-hidden', 'true')
  await expect(page.locator('.veil')).toHaveAttribute('aria-hidden', 'true')
  expect(await wall.locator('img, a, button, input, [tabindex]').count()).toBe(0)
})

test('the covers arriving do not take the focus from the member typing', async ({ page }) => {
  await page.goto('/sign-in')
  const email = page.getByTestId('signIn.email')
  await email.focus()
  await email.fill('typing@libellus.test')
  await expect(page.locator('.wall canvas.cover-in')).toHaveCount(COVERS, { timeout: 15_000 })
  await expect(email).toBeFocused()
  await expect(email).toHaveValue('typing@libellus.test')
})

test('a cover fades in over its board, and with Reduce Motion it is there at once', async ({ page }) => {
  await page.goto('/sign-in')
  await expect(page.locator('.wall canvas.cover-in').first()).toBeVisible({ timeout: 15_000 })
  // The config's Reduce Motion (playwright.config.ts): no transition at all.
  const reduced = await page.locator('.wall canvas.cover').first().evaluate((el) => getComputedStyle(el).transitionProperty)
  expect(reduced).toBe('none')
})

test.describe('with motion', () => {
  test.use({ reducedMotion: 'no-preference' })

  test('a cover fades in over `standard` (docs/MOTION.md)', async ({ page }) => {
    await page.goto('/sign-in')
    await expect(page.locator('.wall canvas.cover-in').first()).toBeVisible({ timeout: 15_000 })
    const transition = await page.locator('.wall canvas.cover').first().evaluate((el) => {
      const style = getComputedStyle(el)
      return { property: style.transitionProperty, duration: style.transitionDuration }
    })
    expect(transition).toEqual({ property: 'opacity', duration: '0.25s' })
  })
})
