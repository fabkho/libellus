import { expect, test } from './fixtures'
import { appleCover } from '../tests/support/apple'
import { friendPath, friendWithSharedBooks } from './bothRead'
import { signedIn } from './support'

/**
 * On a Pages build the reel's covers come through our own cache (`/cover`, functions/cover.js, utils/coverSize.ts):
 * the library document names `/cover?u=…&w=…` addresses on the page's origin at the Books' size, and the preload, the
 * poster and the canvas's textures all ask for those same addresses, each once. The flows' build has the proxy off (the
 * Function would reach the cover hosts), so this one runs only when it is built with NUXT_PUBLIC_COVER_PROXY=on, and
 * answers `/cover` itself from the flows' cover picture (a page route; the Function is never reached).
 *
 *   NUXT_PUBLIC_COVER_PROXY=on pnpm e2e e2e/both-read-cover-proxy.spec.ts
 */
test.use({ browserName: 'chromium', reducedMotion: 'no-preference' })

const PROXY_BUILD = process.env.NUXT_PUBLIC_COVER_PROXY === 'on'
const BUILD_HAS_REGAL = /^(1|true)$/i.test(process.env.LIBELLUS_REGAL?.trim() ?? '')

test('the reel asks for its covers at its size through /cover, once each, never straight from the host', async ({ page }) => {
  test.skip(!PROXY_BUILD || !BUILD_HAS_REGAL, 'built without the cover proxy (NUXT_PUBLIC_COVER_PROXY=on) or Regal')
  const proxied: string[] = []
  await page.route(/\/cover\?/, async (route) => {
    proxied.push(route.request().url())
    await route.fulfill({ status: 200, contentType: 'image/jpeg', headers: { 'access-control-allow-origin': '*' }, body: appleCover() })
  })
  const direct: string[] = []
  page.on('request', (request) => {
    if (/(^|\.)mzstatic\.com$/.test(new URL(request.url()).hostname)) direct.push(request.url())
  })
  const viewer = await signedIn(page)
  const friend = await friendWithSharedBooks(viewer, 12, { covers: true })
  await page.goto(friendPath(friend))
  await page.getByTestId('member.bothRead').scrollIntoViewIfNeeded()
  await expect(page.locator('.reel-card--ready')).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(1500)

  expect(proxied.length, 'covers asked for through /cover').toBeGreaterThan(0)
  const dpr = await page.evaluate(() => Math.min(3, Math.max(1, window.devicePixelRatio || 1)))
  const widths = { 1: '240', 2: '480', 3: '600' } as const
  for (const url of proxied) {
    const parsed = new URL(url)
    expect(parsed.origin, 'on the page\'s origin').toBe(new URL(page.url()).origin)
    expect(parsed.searchParams.get('w'), 'the width of a 300 px Book at this pixel ratio').toBe(widths[dpr as 1 | 2 | 3])
    expect(parsed.searchParams.get('u')).toMatch(/^https:\/\/is\d+-ssl\.mzstatic\.com\//)
  }
  expect(new Set(proxied).size, 'each cover downloaded once (the preload, the poster and the textures share the address)').toBe(proxied.length)
  // (The page's other covers, the Finished rows' small ones, are not the reel's and still go to the host.)
  const reelSize = new RegExp(`/${widths[dpr as 1 | 2 | 3]}x\\d+bb\\.`)
  expect(direct.filter((url) => reelSize.test(url)), "a cover of the reel's size straight from the host").toEqual([])
})
