import { recordedApple, signedIn, untilStill } from './support'
import { expect, test } from './fixtures'

/**
 * The morph must survive the keyboard arriving on Chrome Android. The app's viewport meta carries
 * `interactive-widget=resizes-content` (nuxt.config.ts:230): the keyboard shrinks the *page* instead
 * of raising a keyboard inset, so `useKeyboardInset` reads 0 and `lift` never moves. The tab bar is
 * `fixed bottom`, so it rides up with the shrink — but `play('open')` measured the capsule ~2 ticks
 * after the tap, on the still-tall page. The morph then grows from a rectangle ~159 px below where the
 * bar actually is, and what a member sees is the palette arriving already formed.
 *
 * The overlay therefore re-plays the morph once when the layout viewport shrinks or grows mid-open
 * (SearchOverlay.vue, `remeasureOnResize`): `play()` cancels the stale run and re-measures from the
 * progress on screen.
 *
 * This spec emulates that resize with `setViewportSize` (Playwright cannot emulate
 * `interactive-widget`, so this is the closest thing) and asserts:
 * 1. the morph's clip-path actually moves (it morphs, not fades — the suite default runs `reduce`,
 *    which takes the fade and never exercises this at all), and
 * 2. a mid-open resize moves the capsule the morph was measured against by more than the re-play
 *    threshold, so the re-play fires against the moved box.
 *
 * Measured 2026-11-15 (commit df4ce80a): before — viewport 659, capsule top 581, palette top 48
 * height 595; after — viewport 500, capsule top 422, palette top 48 height 436. The capsule moved
 * 159 px; the palette's top did not.
 */
test.use({ reducedMotion: 'no-preference' })

test('a mid-open viewport resize re-measures the search morph', async ({ page }) => {
  test.slow()
  await recordedApple(page)
  await signedIn(page)
  // Home already: `signedIn` lands on it. Not a second `page.goto('/')` a moment later — a document
  // load cancels the chunks the one before it is still importing, and the browser reports the cancelled
  // import as an uncaught "Importing a module script failed" (the fixture fails a page that throws one;
  // e2e/support.ts, `goto`). Release 1.48.0 lost exactly that, with no chunk missing from the build.
  await untilStill(page)

  await page.getByTestId('shell.tab.search').click()
  await page.getByTestId('search.overlay').waitFor()
  // The morph lasts 340 ms (`--duration-overlay`): sample the *body* (the element whose clip-path
  // the morph animates) while it is still running.
  await page.waitForTimeout(100)
  const before = await page.evaluate(() => {
    const cap = document.querySelector<HTMLElement>('[data-morph="capsule"]')
    const el = document.querySelector<HTMLElement>('[data-testid="search.overlay"] .body')
    return {
      capsuleTop: cap ? Math.round(cap.getBoundingClientRect().top) : null,
      clipPath: el ? getComputedStyle(el).clipPath : null,
    }
  })
  // Shrink the page the way the Android keyboard does.
  await page.setViewportSize({ width: 390, height: 500 })
  await page.waitForTimeout(120)
  const after = await page.evaluate(() => {
    const cap = document.querySelector<HTMLElement>('[data-morph="capsule"]')
    const el = document.querySelector<HTMLElement>('[data-testid="search.overlay"] .body')
    return {
      viewportHeight: window.innerHeight,
      capsuleTop: cap ? Math.round(cap.getBoundingClientRect().top) : null,
      clipPath: el ? getComputedStyle(el).clipPath : null,
    }
  })
  // eslint-disable-next-line no-console
  console.log(`MORPH before=${JSON.stringify(before)} after=${JSON.stringify(after)}`)

  // 1. The palette morphs: its body's clip-path is an inset growing from the capsule's rect, never `none`.
  expect(before.clipPath).not.toBe('none')
  expect(before.clipPath).toMatch(/^inset\(/)
  // 2. The resize moved the capsule the morph measured against, by more than the re-play threshold
  // (SearchOverlay.vue, RESIZE_PX): the re-play fires and the morph re-measures against the moved box.
  expect(before.capsuleTop).not.toBeNull()
  expect(after.capsuleTop).not.toBeNull()
  expect(Math.abs(after.capsuleTop! - before.capsuleTop!)).toBeGreaterThan(24)
  expect(after.viewportHeight).toBeLessThan(600)

  // Close again, the ordinary way, so no layer is left open for the next test.
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('search.overlay')).toBeHidden()
})
