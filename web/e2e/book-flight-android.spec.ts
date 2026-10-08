import { readFileSync } from 'node:fs'
import { expect, type Page } from '@playwright/test'
import { appleRowCover } from '../tests/support/apple'
import { sql } from '../tests/support/stack'
import { recordedApple, signedIn, untilStill } from './support'
import { test } from './fixtures'

/**
 * The cover's flight into the book page (docs/MOTION.md, Push to a book) as
 * the member gets it: Chrome on an Android phone, a finger on a Library row,
 * the built app (every flow runs on the build, e2e/serve.mjs). Its minified
 * stylesheet writes the motion tokens in seconds (`.25s`, not `250ms`); read
 * without its unit that once made every flight a quarter of a millisecond
 * long, and the book page snapped in. So the flying cover is measured frame by
 * frame on a throttled CPU. And it flies sharp: the list's image is sized for
 * its row (120 × 180), so the hero's own image takes over in the air and the
 * small one is never shown blown up. And it runs on the compositor (transform
 * and opacity only): the main thread held busy mid-flight, the cover keeps
 * moving on screen (docs/MOTION.md, How the push to a book is built).
 *
 * (Formerly book-flight-built.spec.ts, which put the build's tokens on the dev
 * server's page; with the flows on the build that is what they get anyway.)
 */
// What moves is the subject here: the transitions play, which the config's Reduce Motion would cut.
test.use({ reducedMotion: 'no-preference' })

test.use({ browserName: 'chromium', viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })

const COVER = 'https://is1-ssl.mzstatic.com/image/thumb/Publication/v4/t5/flight/cover.jpg/600x900bb.jpg'

/**
 * The motion tokens as the production build writes them: every time in seconds, in its shortest
 * form (`.25s`). The build serves them so; on the dev server (LIBELLUS_E2E_DEV=1) they are put on
 * the page that way.
 */
async function asBuilt(page: Page) {
  if (process.env.LIBELLUS_E2E_DEV) {
    const tokens = JSON.parse(readFileSync(new URL('../../design/tokens.json', import.meta.url), 'utf8'))
    const durations = Object.entries(tokens.duration as Record<string, { $value?: number }>)
      .filter(([, token]) => typeof token.$value === 'number')
      .map(([name, token]) => [`--duration-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, `${token.$value! / 1000}s`.replace(/^0\./, '.')])
    await page.evaluate((all) => {
      for (const [name, value] of all) document.documentElement.style.setProperty(name!, value!)
    }, durations)
  }
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

/**
 * From now on, every frame: the flying cover's box, and how much of the list's small image and of the hero's large one shows in it.
 * And, as the cover is first seen, how long its travel is set to run: the animation's own timing (the cover's `transform`), which the
 * frames cannot say. They are what the main thread gets to look at, and a starved one looks only every 80 ms.
 */
async function record(page: Page) {
  await page.evaluate(() => {
    const frames: Frame[] = []
    Object.assign(window, { __frames: frames, __travel: 0 })
    let looked = 0
    const look = () => {
      const fly = document.querySelector('[data-testid="shell.flightCover"]')
      if (fly) {
        for (const animation of fly.getAnimations()) {
          if (!(animation.effect as KeyframeEffect).getKeyframes().some((keyframe) => 'transform' in keyframe)) continue
          Object.assign(window, { __travel: Math.max((window as unknown as { __travel: number }).__travel, Number(animation.effect!.getComputedTiming().endTime)) })
        }
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

/** How long the cover's travel was set to run (ms), as read off the animation. */
const travel = (page: Page) => page.evaluate(() => (window as unknown as { __travel: number }).__travel)

/**
 * Signed in with six Books on Want to read, on the Library, the CPU slowed to a phone's.
 * `rowImages`: the rows' small images wait for it (a connection too slow to have brought them yet).
 */
async function library(page: Page, rowImages?: Promise<void>) {
  await recordedApple(page)
  // The list asks Apple for its row's size; the flows' recorded cover is larger, so the row gets a real 120 × 180.
  await page.route(/120x180bb\.jpg$/, async (route) => {
    await rowImages
    await route.fulfill({ status: 200, contentType: 'image/jpeg', headers: { 'access-control-allow-origin': '*' }, body: appleRowCover() })
  })
  const member = await signedIn(page)
  await shelf(member.id, 6)
  await page.getByTestId('shell.tab.library').tap()
  await expect(page.getByTestId('library.entry')).toHaveCount(6)
  const row = page.getByTestId('library.entry').nth(2)
  if (!rowImages) await expect(row.locator('[data-cover] img')).toHaveCSS('opacity', '1')
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

test('in the built app, a Library row’s cover flies into the book page over frames, not in one', { tag: '@full' }, async ({ page }) => {
  const { row, rowCover } = await library(page)
  await record(page)
  await row.locator('[data-cover]').tap()
  await landed(page)
  const hero = (await page.getByTestId('book.hero').locator('[data-cover]').boundingBox())!

  // The travel is `standard` (250 ms) long, not the quarter of a millisecond the build's `.25s` once read as: the animation's
  // own timing says so, whatever the main thread got round to drawing. Sampled in frames, the length of the flight depends on
  // how often the page's main thread gets to look (every 17 ms here, every 80 ms with the CPU starved as on a busy CI runner:
  // 2 frames in the air, 77 ms apart), which says nothing about the flight, a compositor's.
  expect(await travel(page)).toBeGreaterThanOrEqual(200)

  // And what was seen of it is between the row and the hero (not in one jump to the end), growing and rising every frame.
  const flown = await frames(page)
  const between = flown.filter((frame) => frame.width > rowCover.width + 1 && frame.width < hero.width - 1)
  expect(between.length).toBeGreaterThanOrEqual(1)
  for (let i = 1; i < between.length; i++) {
    expect(between[i]!.width).toBeGreaterThanOrEqual(between[i - 1]!.width)
    expect(between[i]!.top).toBeLessThanOrEqual(between[i - 1]!.top)
  }
})

test('the cover flies sharp: the hero’s image takes over in the air, the row’s small one is never blown up', { tag: '@full' }, async ({ page }) => {
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

type Return = { width: number; large: number; held: number }

/** From now on, every frame of the cover on its way back: its width and how much of the hero's large image shows (the copy's own opacity counted), and, once it has landed, the copy held on the row. */
async function recordReturn(page: Page) {
  await page.evaluate(() => {
    const frames: Return[] = []
    Object.assign(window, { __return: frames })
    let looked = 0
    const effective = (image: Element, until: Element) => {
      let opacity = 1
      for (let at: Element | null = image; at && at !== until.parentElement; at = at.parentElement) opacity *= Number(getComputedStyle(at).opacity)
      return opacity
    }
    const look = () => {
      const fly = document.querySelector('[data-testid="shell.flightCover"]')
      const held = document.querySelector('[data-testid="shell.flightHeld"]')
      const source = fly ?? held
      if (source) {
        const large = [...source.querySelectorAll('img')].filter((image) => image.src.endsWith('600x900bb.jpg') && image.complete && image.naturalWidth > 0)
        frames.push({
          width: (fly ?? held!).getBoundingClientRect().width,
          large: Math.max(0, ...large.map((image) => effective(image, source))),
          held: fly ? 0 : 1,
        })
      }
      if (++looked < 300) requestAnimationFrame(look)
    }
    requestAnimationFrame(look)
  })
}

const returned = (page: Page) => page.evaluate(() => (window as unknown as { __return: Return[] }).__return)

test('closing a book page, the cover keeps the hero’s large image the whole way back and gives way to the row’s own once it is decoded', { tag: '@full' }, async ({ page }) => {
  const { row, rowCover } = await library(page)
  await row.locator('[data-cover]').tap()
  await landed(page)
  // The book page's own image is in: the cover that flies back is the sharp one.
  await expect(page.getByTestId('book.hero').locator('[data-cover] > img')).toHaveCSS('opacity', '1')
  await recordReturn(page)
  await page.getByTestId('book.back').tap()
  await expect(page.getByTestId('library.title')).toBeVisible()
  await expect(page.getByTestId('shell.flightCover')).toHaveCount(0)
  await expect(page.getByTestId('shell.flightHeld')).toHaveCount(0)

  const flown = (await returned(page)).filter((frame) => !frame.held)
  expect(flown.length).toBeGreaterThanOrEqual(4)
  // The large image is on the cover at full strength in every frame in the air, down to the row's size:
  // the row's small image is never what shows, not even half-way (it was cross-faded in over the whole way).
  expect(flown.filter((frame) => frame.large < 0.99)).toEqual([])
  expect(Math.min(...flown.map((frame) => frame.width))).toBeLessThan(rowCover.width * 1.1)
  // Landed: the row's own cover is there, sharp, with nothing of the flight left on it.
  await expect(row.locator('[data-cover] > img')).toHaveCSS('opacity', '1')
  await expect(row.locator('[data-cover]')).toHaveCSS('visibility', 'visible')
})

test('closing a book page opened before its row’s image came, the cover stays on the row, sharp, until that image is in', { tag: '@full' }, async ({ page }) => {
  let release!: () => void
  const { row } = await library(page, new Promise<void>((resolve) => (release = resolve)))
  await row.locator('[data-cover]').tap()
  await landed(page)
  await expect(page.getByTestId('book.hero').locator('[data-cover] > img')).toHaveCSS('opacity', '1')
  await recordReturn(page)
  await page.getByTestId('book.back').tap()
  await expect(page.getByTestId('library.title')).toBeVisible()

  // Landed on its row, which has only its thumbhash: the large image stays on it, in the row's sheet.
  const held = row.locator('[data-cover]').getByTestId('shell.flightHeld')
  await expect(held).toHaveCount(1)
  await expect(page.getByTestId('shell.flightCover')).toHaveCount(0)
  await expect(row.locator('[data-cover] > img')).toHaveCSS('opacity', '0')
  const flown = (await returned(page)).filter((frame) => !frame.held)
  expect(flown.filter((frame) => frame.large < 0.99)).toEqual([])
  await expect(held).toHaveCSS('opacity', '1')

  // The row's image arrives: decoded and faded in under it, then the copy gives way.
  release()
  await expect(row.locator('[data-cover] > img')).toHaveCSS('opacity', '1')
  await expect(held).toHaveCount(0)
})

test('the flight runs on the compositor: a main thread busy mid-flight does not stop the cover', { tag: '@full' }, async ({ page }) => {
  const { row } = await library(page)
  // Two frames into the flight the page's own work takes the main thread for 200 ms (a list
  // rendering, a store answering): transform and opacity alone, the compositor keeps drawing it.
  await page.evaluate(() => {
    const watch = () => {
      if (!document.querySelector('[data-testid="shell.flightCover"]')) return void requestAnimationFrame(watch)
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const busy = { from: performance.timeOrigin + performance.now(), to: 0 }
          const end = performance.now() + 200
          while (performance.now() < end) {}
          busy.to = performance.timeOrigin + performance.now()
          Object.assign(window, { __busy: busy })
        }),
      )
    }
    requestAnimationFrame(watch)
  })
  // What the screen shows, frame by frame, as the compositor hands it out (no main thread needed).
  const cdp = await page.context().newCDPSession(page)
  const shown: { at: number; data: string }[] = []
  cdp.on('Page.screencastFrame', (frame) => {
    shown.push({ at: (frame.metadata.timestamp ?? 0) * 1000, data: frame.data })
    void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 40 })
  await row.locator('[data-cover]').tap()
  await landed(page)
  await cdp.send('Page.stopScreencast')
  const busy = await page.evaluate(() => (window as unknown as { __busy: { from: number; to: number } }).__busy)
  const during = shown.filter((frame) => frame.at >= busy.from && frame.at <= busy.to)
  // Where the cover is in each of those frames: the top of its dark blue, read off a canvas. It keeps
  // rising (with an animation the main thread drives, it stands still for the whole 200 ms).
  const tops = await page.evaluate(async (images) => {
    const out: number[] = []
    for (const data of images) {
      const image = new Image()
      image.src = `data:image/jpeg;base64,${data}`
      await image.decode()
      const canvas = new OffscreenCanvas(image.width, image.height)
      const g = canvas.getContext('2d')!
      g.drawImage(image, 0, 0)
      const px = g.getImageData(0, 0, image.width, image.height).data
      let top = -1
      for (let y = 0; y < image.height && top < 0; y += 2)
        for (let x = 0; x < image.width; x += 2) {
          const i = (y * image.width + x) * 4
          if (px[i + 2]! > 90 && px[i]! < 70 && px[i + 1]! < 80 && px[i + 2]! - px[i]! > 50) { top = y; break }
        }
      out.push(top)
    }
    return out
  }, during.map((frame) => frame.data))
  expect(new Set(tops).size).toBeGreaterThanOrEqual(3)
})
