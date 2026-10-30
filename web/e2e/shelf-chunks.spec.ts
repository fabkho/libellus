import { readFileSync } from 'node:fs'
import { expect, test } from './fixtures'
import { SHELF_LIBRARY_SRC } from './shelfOwner'
import { openProfile, signedInAsOwner } from './support'

/**
 * Regal comes in two chunks (regal.config.ts): `regal-reel` (the reel, three.js, TresJS) and `regal` (what only the
 * owner's Stack, Row and Bookcase use), the first fetched by a friend's page alone. Your shelf is the second's one
 * customer, and nothing else drives it end to end here: so one cheap check that the Profile's row and the shelf's
 * Stack still draw with both, and that neither says its chunk is missing. Chromium with motion and WebGL; it skips
 * itself where the build has no Regal or the browser no WebGL.
 */
test.use({ browserName: 'chromium', reducedMotion: 'no-preference' })

const BUILD_HAS_REGAL = /^(1|true)$/i.test(process.env.LIBELLUS_REGAL?.trim() ?? '')
const LIBRARY_FILE = readFileSync(new URL('../tests/fixtures/shelf/library.json', import.meta.url), 'utf8')

test("the owner's shelf (the row on her Profile and the Stack) still loads with the chunks split", async ({ page }) => {
  test.slow()
  test.skip(!BUILD_HAS_REGAL, 'no Regal in this build')
  const chunks = new Set<string>()
  page.on('request', (request) => {
    const match = request.url().match(/\/_nuxt\/(regal(?:-[a-z]+)?)\.[^/]+\.js$/)
    if (match) chunks.add(match[1]!)
  })
  await page.route(SHELF_LIBRARY_SRC, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: LIBRARY_FILE }),
  )
  await signedInAsOwner(page)
  const webgl = await page.evaluate("(() => { try { const c = document.createElement('canvas'); return Boolean(c.getContext('webgl2') || c.getContext('webgl')) } catch { return false } })()")
  test.skip(!webgl, 'no WebGL here')

  // The Profile's row (`LazyShelfRow`).
  await openProfile(page)
  const row = page.getByTestId('profile.shelfRow')
  await row.scrollIntoViewIfNeeded()
  await expect(row.locator('canvas')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('shelf.noChunk')).toHaveCount(0)

  // The Stack (`LazyShelfStage`).
  await page.goto('/profile/shelf')
  await expect(page.getByTestId('shelf.stage').locator('canvas')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('shelf.noChunk')).toHaveCount(0)

  // Both chunks were asked for: the shelf's own and the one it shares with the reel.
  expect([...chunks].sort()).toEqual(expect.arrayContaining(['regal', 'regal-reel']))
})
