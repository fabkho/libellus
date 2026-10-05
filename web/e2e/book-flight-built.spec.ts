import { readFileSync } from 'node:fs'
import { expect, type Page } from '@playwright/test'
import { appleRowCover } from '../tests/support/apple'
import { sql } from '../tests/support/stack'
import { recordedApple, signedIn, untilStill } from './support'
import { test } from './fixtures'

/**
 * The cover's flight into the book page (docs/MOTION.md, Push to a book) as
 * the member gets it: Chrome on an Android phone, a finger on a Library row,
 * the built app. The flows run on the dev server, which serves the motion
 * tokens as written (`250ms`); the built app's minified stylesheet says
 * `.25s`, and read without its unit that made every flight a quarter of a
 * millisecond long — the book page snapped in. So the tokens are put on the
 * page as the build ships them, and the flying cover is measured frame by
 * frame on a throttled CPU. And it flies sharp: the list's image is sized for
 * its row (120 × 180), so the hero's own image takes over in the air and the
 * small one is never shown blown up.
 */

test.use({ browserName: 'chromium', viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })

const COVER = 'https://is1-ssl.mzstatic.com/image/thumb/Publication/v4/t5/flight/cover.jpg/600x900bb.jpg'

/** The motion tokens as the production build writes them: every time in seconds, in its shortest form (`.25s`). */
async function asBuilt(page: Page) {
  const tokens = JSON.parse(readFileSync(new URL('../../design/tokens.json', import.meta.url), 'utf8'))
  const durations = Object.entries(tokens.duration as Record<string, { $value?: number }>)
    .filter(([, token]) => typeof token.$value === 'number')
    .map(([name, token]) => [`--duration-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, `${token.$value! / 1000}s`.replace(/^0\./, '.')])
  await page.evaluate((all) => {
    for (const [name, value] of all) document.documentElement.style.setProperty(name!, value!)
  }, durations)
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--duration-standard').trim())).toBe('.25s')
}

/** Puts `count` Books with a cover on the member's Want to read. */
async function shelf(memberId: string, count: number) {
  for (let i = 0; i < count; i++) {
    const [book] = await sql<{ id: string }>(
      `insert into public.books (title, authors, source, owner_id, cover_url, cover_dominant)
         values ($1, '{"Ursula K. Le Guin"}', 'manual', $2, $3, '#5b6c8f') returning id`,
      [`Flight ${String(i + 1).padStart(2, '0')}`, memberId, COVER],
    )
    await sql(`insert into public.library_entries (member_id, book_id, status, added_at) values ($1, $2, 'want_to_read', now() - make_interval(mins => $3))`, [
      memberId,
      book!.id,
      i,
    ])
  }
}

type Frame = { t: number; width: number; top: number; small: number; sharp: number }

/** From now on, every frame: the flying cover's box, and how much of the list's small image and of the hero's large one shows in it. */
async function record(page: Page) {
  await page.evaluate(() => {
    const frames: Frame[] = []
    Object.assign(window, { __frames: frames })
    let looked = 0
    const look = () => {
      const fly = document.querySelector('[data-testid="shell.flightCover"]')
      if (fly) {
        const box = fly.getBoundingClientRect()
        const opacity = (large: boolean) =>
          Math.max(
            0,
            ...[...fly.querySelectorAll('img')]
              .filter((image) => image.src.endsWith('600x900bb.jpg') === large && image.complete && image.naturalWidth > 0)
              .map((image) => Number(getComputedStyle(image).opacity)),
          )
        frames.push({ t: performance.now(), width: box.width, top: box.top, small: opacity(false), sharp: opacity(true) })
      }
      if (++looked < 300) requestAnimationFrame(look)
    }
    requestAnimationFrame(look)
  })
}

const frames = (page: Page) => page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames)

/** Signed in with six Books on Want to read, on the Library, the CPU slowed to a phone's. */
async function library(page: Page) {
  await recordedApple(page)
  // The list asks Apple for its row's size; the flows' recorded cover is larger, so the row gets a real 120 × 180.
  await page.route(/120x180bb\.jpg$/, (route) =>
    route.fulfill({ status: 200, contentType: 'image/jpeg', headers: { 'access-control-allow-origin': '*' }, body: appleRowCover() }),
  )
  const member = await signedIn(page)
  await shelf(member.id, 6)
  await page.getByTestId('shell.tab.library').tap()
  await expect(page.getByTestId('library.entry')).toHaveCount(6)
  const row = page.getByTestId('library.entry').nth(2)
  await expect(row.locator('[data-cover] img')).toHaveCSS('opacity', '1')
  await untilStill(page)
  await asBuilt(page)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  return { row, rowCover: (await row.locator('[data-cover]').boundingBox())! }
}

async function landed(page: Page) {
  await expect(page.getByTestId('book.hero')).toBeVisible()
  await expect(page.getByTestId('shell.flightCover')).toHaveCount(0)
  await expect(page.getByTestId('shell.flightPage')).toBeEmpty()
}

test('in the built app, a Library row’s cover flies into the book page over frames, not in one', async ({ page }) => {
  const { row, rowCover } = await library(page)
  await record(page)
  await row.locator('[data-cover]').tap()
  await landed(page)
  const hero = (await page.getByTestId('book.hero').locator('[data-cover]').boundingBox())!

  // Between the row and the hero for a good part of `standard` (250 ms), growing and rising every frame.
  const flown = await frames(page)
  const between = flown.filter((frame) => frame.width > rowCover.width + 1 && frame.width < hero.width - 1)
  expect(between.length).toBeGreaterThanOrEqual(4)
  expect(between.at(-1)!.t - between[0]!.t).toBeGreaterThan(100)
  for (let i = 1; i < between.length; i++) {
    expect(between[i]!.width).toBeGreaterThanOrEqual(between[i - 1]!.width)
    expect(between[i]!.top).toBeLessThanOrEqual(between[i - 1]!.top)
  }
})

test('the cover flies sharp: the hero’s image takes over in the air, the row’s small one is never blown up', async ({ page }) => {
  const { row, rowCover } = await library(page)
  await record(page)
  await row.locator('[data-cover]').tap()
  await landed(page)

  const flown = await frames(page)
  expect(flown.length).toBeGreaterThan(4)
  // Larger than half again the row: whatever of the small image shows is under the large one.
  const blownUp = flown.filter((frame) => frame.width > rowCover.width * 1.5 && frame.small * (1 - frame.sharp) > 0.05)
  expect(blownUp).toEqual([])
  // The large image was in (asked for on the press): the cover flew sharp, not on its thumbhash.
  expect(flown.filter((frame) => frame.sharp === 1).length).toBeGreaterThan(flown.length / 2)

  // On the hero: its own image, or the copy that flew with it held over it until that is in.
  const cover = page.getByTestId('book.hero').locator('[data-cover]')
  await expect(cover.locator(':scope > img')).toHaveCSS('opacity', '1')
  await expect(cover.getByTestId('shell.flightHeld')).toHaveCount(0)
})
