import { devices } from '@playwright/test'
import { expect, test } from './fixtures'
import { openProfile, signedIn } from './support'

/**
 * The scrim of a sheet and the Android status bar (utils/statusBarDim.ts, issue A6).
 *
 * Chromium on a Pixel, the engine of the installed app on Android. What this can show is the
 * web side: the scrim covers the whole layout viewport (its top edge is 0, the status bar's
 * region included, since the page is edge to edge with `viewport-fit=cover`), nothing above it
 * is transformed or filtered (which would make `position: fixed` relative to that ancestor),
 * and the theme-color tags follow the sheet. What the system paints in its own bar from those
 * tags is checked on the phone (docs/TESTING.md, the scrim and the status bar).
 */
test.use({ ...devices['Pixel 7'], browserName: 'chromium' })

test('the scrim covers the whole viewport and the status bar takes its colour while a sheet is open', async ({ page }) => {
  await signedIn(page)
  await openProfile(page)
  const tags = () => page.evaluate(() => [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((m) => m.content))
  const before = await tags()

  await page.getByTestId('profile.name').click()
  const scrim = page.getByTestId('accountName.scrim')
  await expect(scrim).toBeVisible()

  const probe = await scrim.evaluate((el) => {
    const box = el.getBoundingClientRect()
    const viewport = window.visualViewport!
    const containing: string[] = []
    for (let node = el.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (style.transform !== 'none' || style.filter !== 'none' || style.perspective !== 'none' || style.backdropFilter !== 'none' || /paint|layout|strict|content/.test(style.contain) || /transform|filter|perspective/.test(style.willChange))
        containing.push(node.tagName.toLowerCase())
    }
    return {
      parent: el.parentElement?.tagName.toLowerCase(),
      position: getComputedStyle(el).position,
      box: { top: box.top, left: box.left, width: box.width, height: box.height },
      viewport: { top: viewport.offsetTop, left: viewport.offsetLeft, width: viewport.width, height: viewport.height },
      html: document.documentElement.getBoundingClientRect().height,
      containing,
    }
  })
  expect(probe.parent).toBe('body')
  expect(probe.position).toBe('fixed')
  expect(probe.containing).toEqual([])
  expect(probe.box.top).toBe(0)
  expect(probe.box.left).toBe(0)
  expect(probe.box.width).toBe(probe.viewport.width)
  expect(probe.box.height).toBe(probe.viewport.height)

  // The bar follows the scrim: every tag a shade darker than it was.
  const during = await tags()
  expect(during).toHaveLength(before.length)
  during.forEach((colour, i) => expect(colour).not.toBe(before[i]))

  await page.getByTestId('accountName.cancel').click()
  await expect(scrim).toHaveCount(0)
  expect(await tags()).toEqual(before)
})
