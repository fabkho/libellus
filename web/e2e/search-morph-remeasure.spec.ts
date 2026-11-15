import { expect } from '@playwright/test'
import { signedIn, untilStill } from './support'
import { test } from './fixtures'

/**
 * Measurement, not an assertion of correct behaviour: does the search palette's morph geometry change
 * under it when the layout viewport shrinks mid-open?
 *
 * On Chrome Android the app's viewport meta carries `interactive-widget=resizes-content`
 * (nuxt.config.ts:230): the keyboard shrinks the *page* instead of raising a keyboard inset, so
 * `useKeyboardInset` reads 0 and `lift` never moves. `play('open')` measures the capsule and the palette
 * ~2 ticks after the tap, when the page is still full height; the resize then arrives. If the morph was
 * measured against the tall page, its clip-path grows toward a rectangle the palette no longer occupies,
 * and what a member sees is the palette appearing already formed.
 *
 * This spec emulates that resize with `setViewportSize` (Playwright cannot emulate
 * `interactive-widget`, so this is the closest thing) and prints what `play()` measured each time it ran.
 * It is a probe: read the log, then decide. `reducedMotion: 'no-preference'` because every other flow runs
 * with `reduce`, which takes the fade path and never exercises the morph at all.
 */
test.use({ reducedMotion: 'no-preference' })

test('probe: does a mid-open viewport resize move the morph geometry?', async ({ page }) => {
  test.slow()
  await signedIn(page)
  await page.goto('/')
  await untilStill(page)

  await page.getByTestId('shell.tab.search').click()
  // What the palette's rect is BEFORE the resize, then after it: does the resize move the thing the
  // morph was measured against?
  const before = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.palette')
    const cap = document.querySelector<HTMLElement>('[data-morph="capsule"]')
    const box = el?.getBoundingClientRect()
    const cbox = cap?.getBoundingClientRect()
    return {
      viewportHeight: window.innerHeight,
      paletteTop: box ? Math.round(box.top) : null,
      paletteHeight: box ? Math.round(box.height) : null,
      capsuleTop: cbox ? Math.round(cbox.top) : null,
      capsuleLeft: cbox ? Math.round(cbox.left) : null,
      capsuleWidth: cbox ? Math.round(cbox.width) : null,
    }
  })
  // Mid-open: shrink the page the way the Android keyboard does.
  await page.setViewportSize({ width: 390, height: 500 })
  await page.waitForTimeout(600)
  const after = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.palette')
    const cap = document.querySelector<HTMLElement>('[data-morph="capsule"]')
    const box = el?.getBoundingClientRect()
    const cbox = cap?.getBoundingClientRect()
    return {
      viewportHeight: window.innerHeight,
      paletteTop: box ? Math.round(box.top) : null,
      paletteHeight: box ? Math.round(box.height) : null,
      capsuleTop: cbox ? Math.round(cbox.top) : null,
      capsuleLeft: cbox ? Math.round(cbox.left) : null,
      capsuleWidth: cbox ? Math.round(cbox.width) : null,
    }
  })
  // eslint-disable-next-line no-console
  console.log(`GEOMETRY before=${JSON.stringify(before)} after=${JSON.stringify(after)}`)

  const log = await page.evaluate(() => (window as unknown as { __morphLog?: unknown[] }).__morphLog ?? [])
  // eslint-disable-next-line no-console
  console.log(`MORPH LOG: ${JSON.stringify(log, null, 2)}`)

  // The probe passes as long as it ran; the numbers in the log are the result.
  expect(Array.isArray(log)).toBe(true)
})
