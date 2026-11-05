import { expect, type Page } from '@playwright/test'
import { appleAnswer } from '../tests/support/apple'
import { test } from './fixtures'
import { recordedApple, signedIn, untilStill } from './support'
import { seedHome } from './bookOpenSeed'

/**
 * A Book opens at once, and Home keeps its place on the way back (docs/MOTION.md, "A book opens at once"; docs/parity.md, Book).
 * What a member does with the Book page's slow read: she scrolls Home down, taps a Book in "Next in your series" (or the
 * Currently reading card), the page's own answer taking two seconds, and closes the page again. The files that call this
 * run it in WebKit (the default project) and in Chromium (e2e/book-open*.spec.ts), with Reduce Motion off: the cover's
 * flight is what is watched.
 *
 * Seeded: a Home with four Books being read, six waiting and five started series (e2e/bookOpenSeed.ts), tall enough to
 * scroll 600 px. The Book requests are what is delayed, never the app's own files.
 */

/** How long the stack takes to answer once a Book's page asks (the page used to show only a cover for this long, and longer). */
const SLOW_MS = 2000
/** The hero's title is on screen this long after the tap, at most (the owner's bar is ~300 ms; the margin is for a runner under load). */
const HERO_WITHIN_MS = 500
/** Home is scrolled back to within this many pixels of where it was. */
const PLACE_TOLERANCE = 2

/** The page's own read is slow: every request to the stack from now on takes `ms`. Returns the undo. */
async function slowStack(page: Page, ms = SLOW_MS) {
  const slow = async (route: import('@playwright/test').Route) => {
    await new Promise((resolve) => setTimeout(resolve, ms))
    await route.continue().catch(() => {})
  }
  await page.route(/\/rest\/v1\//, slow)
  // The sources a Book the Catalogue has not got is asked of (the recordings, tests/fixtures).
  await page.route('https://itunes.apple.com/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, ms))
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(appleAnswer(new URL(route.request().url()))) })
  })
  return async () => {
    await page.unroute(/\/rest\/v1\//, slow)
    await page.unroute('https://itunes.apple.com/**')
  }
}

/**
 * Watches the page's own frames from the next tap on: when the tap came, when the hero's title was first drawn (and what it said),
 * and from then on whether a cover was in the air, with the scroll of every frame. The page's clock, not the test's: a runner that
 * is slow to talk to the browser does not count against the page.
 */
async function watchFrames(page: Page) {
  await page.evaluate(() => {
    const seen = { tapAt: 0, heroAt: 0, hero: '', frames: [] as { at: number; y: number; flying: boolean }[], recording: true }
    Object.assign(window, { __opening: seen })
    for (const type of ['pointerdown', 'click'])
      addEventListener(type, () => seen.recording && !seen.tapAt && (seen.tapAt = performance.now()), { capture: true })
    const step = (now: number) => {
      if (!seen.recording) return
      if (seen.tapAt) {
        if (!seen.heroAt) {
          const title = document.querySelector('[data-testid="book.title"]')?.textContent?.trim()
          if (title) [seen.heroAt, seen.hero] = [now, title]
        }
        seen.frames.push({ at: now, y: Math.round(scrollY), flying: Boolean(document.querySelector('[data-testid="shell.flightCover"]')) })
      }
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })
}

type Frames = { tapAt: number; heroAt: number; hero: string; frames: { at: number; y: number; flying: boolean }[] }
const framesOf = (page: Page) => page.evaluate(() => (window as unknown as { __opening: Frames }).__opening)

/** Starts a fresh recording of the frames from the next tap (a second tap in the same flow). */
async function resetFrames(page: Page) {
  await page.evaluate(() => {
    const seen = (window as unknown as { __opening: Frames & { recording: boolean } }).__opening
    Object.assign(seen, { tapAt: 0, heroAt: 0, hero: '', frames: [] })
  })
}

/** Where things are on the page, for "nothing moved when the Book came". */
const boxOf = (page: Page, testid: string) =>
  page.getByTestId(testid).first().evaluate((el) => {
    const box = el.getBoundingClientRect()
    return { top: Math.round(box.top + scrollY), height: Math.round(box.height) }
  })

/** What a flight leaves behind when it has landed: nothing. */
const leftovers = (page: Page) =>
  page.evaluate(
    () =>
      document.querySelectorAll('.flight-cover, .flight-held, [data-flight-hidden]').length +
      (document.documentElement.hasAttribute('data-flight-pose') ? 1 : 0) +
      document.querySelectorAll('[data-moving]').length,
  )

async function homeScrolledTo(page: Page, top: number) {
  await page.evaluate((to) => window.scrollTo({ top: to, behavior: 'instant' }), top)
  await untilStill(page)
  await expect.poll(() => page.evaluate(() => Math.round(scrollY))).toBeGreaterThan(top - 2)
}

async function seededHome(page: Page, options: Parameters<typeof seedHome>[1] = { reading: 4 }) {
  await recordedApple(page)
  const member = await signedIn(page)
  const seeded = await seedHome(member.client, options)
  await page.reload()
  await expect(page.getByTestId('home.title')).toBeVisible()
  await expect(page.getByTestId('home.nextLink')).toHaveCount(Math.min(5, options.series ?? 5))
  await untilStill(page)
  return { member, seeded }
}

/** Coming back: the page is at rest, Home is where it was, the cover that flew has landed and nothing of the flight is left. */
async function expectBackOnHome(page: Page, was: number, row: ReturnType<Page['getByTestId']>) {
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId('home.title')).toBeVisible()
  await untilStill(page)
  await expect.poll(async () => Math.abs((await page.evaluate(() => scrollY)) - was), { message: "Home's place" }).toBeLessThanOrEqual(PLACE_TOLERANCE)
  await expect(row).toBeInViewport()
  await expect.poll(() => leftovers(page), { message: 'what the flight left' }).toBe(0)
}

export function bookOpenFlows() {
  test.describe('a Book opens at once and Home keeps its place', () => {
    test.use({ reducedMotion: 'no-preference', viewport: { width: 412, height: 915 } })
    test.describe.configure({ timeout: 90_000 })

    test('Next in your series: the hero at once, skeletons for the rest, the Book replacing them in place; Back flies it home to the same place', async ({ page }, testInfo) => {
      const { seeded } = await seededHome(page)
      await homeScrolledTo(page, 600)
      const was = await page.evaluate(() => Math.round(scrollY))
      expect(was).toBeGreaterThan(500)

      const [first] = seeded
      const row = page.getByTestId('home.nextLink').first()
      await expect(row.getByTestId('home.nextTitle')).toHaveText(first!.next)
      const undo = await slowStack(page)
      await watchFrames(page)
      await row.tap()

      // 1. The tapped card's own words are the hero's, long before the Book's answer.
      await expect(page.getByTestId('book.title')).toHaveText(first!.next)
      await expect.poll(async () => (await framesOf(page)).heroAt, { message: 'the hero was drawn' }).toBeGreaterThan(0)
      const opened = await framesOf(page)
      expect(opened.hero).toBe(first!.next)
      expect(opened.heroAt - opened.tapAt, 'tap to the hero drawn (ms)').toBeLessThan(HERO_WITHIN_MS)
      // The cover and where the Book stands in its series are the card's too; the rest waits, in the shape of what comes.
      await expect(page.getByTestId('book.hero').locator('[data-cover]')).toBeVisible()
      await expect(page.getByTestId('book.seriesPreview')).toContainText('Book 2 of 2')
      await expect(page.getByTestId('book.authorsLoading')).toBeVisible()
      await expect(page.getByTestId('book.factsLoading')).toBeVisible()
      await expect(page.getByTestId('book.actionsLoading')).toBeVisible()
      await expect(page.getByTestId('book.aboutLoading')).toBeVisible()
      await expect(page.getByTestId('book.loading')).toHaveCount(0)
      await expect(page.getByTestId('book.loadingStatus')).toHaveText('Loading the book…')
      await expect(page.getByTestId('book.description')).toHaveCount(0)
      await expect(page.getByTestId('book.add')).toHaveCount(0)
      await untilStill(page)
      await page.screenshot({ path: testInfo.outputPath('hero-mid-load.png') })
      await testInfo.attach('hero-mid-load', { path: testInfo.outputPath('hero-mid-load.png'), contentType: 'image/png' })
      const loadingBoxes = {
        title: await boxOf(page, 'book.title'),
        series: await boxOf(page, 'book.seriesPreview'),
        facts: await boxOf(page, 'book.factsLoading'),
        button: await page.getByTestId('book.actionsLoading').evaluate((el) => {
          const box = el.lastElementChild!.getBoundingClientRect()
          return { top: Math.round(box.top + scrollY), height: Math.round(box.height) }
        }),
      }

      // 2. The Book's answer replaces the preview in place: the same title and cover, and nothing above the fold moves.
      await expect(page.getByTestId('book.description')).toContainText('The second book of Saga 1', { timeout: 20_000 })
      await expect(page.getByTestId('book.add')).toBeVisible()
      await expect(page.getByTestId('book.authors')).toContainText('Tamsyn Muir')
      await expect(page.getByTestId('book.title')).toHaveText(first!.next)
      await expect(page.getByTestId('book.loadingStatus')).toHaveText('')
      await expect(page.getByTestId('book.authorsLoading')).toHaveCount(0)
      await untilStill(page)
      const loaded = {
        title: await boxOf(page, 'book.title'),
        series: await boxOf(page, 'book.series'),
        facts: await boxOf(page, 'book.facts'),
      }
      expect(loaded.title).toEqual(loadingBoxes.title)
      expect(Math.abs(loaded.series.top - loadingBoxes.series.top), 'the series line').toBeLessThanOrEqual(1)
      expect(Math.abs(loaded.facts.top - loadingBoxes.facts.top), 'the facts line').toBeLessThanOrEqual(1)
      // The action is where its skeleton was, with the height of it.
      const button = await boxOf(page, 'book.add')
      expect(Math.abs(button.top - loadingBoxes.button.top), 'the action').toBeLessThanOrEqual(1)
      expect(Math.abs(button.height - loadingBoxes.button.height), "the action's height").toBeLessThanOrEqual(1)
      await undo()

      // 3. Back: the cover flies home into the row it left, and Home stands exactly where it was.
      await resetFrames(page)
      await page.getByTestId('book.back').tap()
      await expectBackOnHome(page, was, row)
      const back = await framesOf(page)
      expect(back.frames.some((frame) => frame.flying), 'the cover flew back').toBe(true)
      // From the first frame Home was drawn at its place, never at the top first.
      const drawn = back.frames.filter((frame) => frame.y > 0)
      expect(drawn.length).toBeGreaterThan(0)
      expect(drawn.every((frame) => Math.abs(frame.y - was) <= PLACE_TOLERANCE), 'every frame once Home was drawn').toBe(true)
    })

    test('the card the tap opened is the one the cover flies back to, again and again', async ({ page }) => {
      const { seeded } = await seededHome(page)
      await homeScrolledTo(page, 600)
      const was = await page.evaluate(() => Math.round(scrollY))
      await watchFrames(page)
      for (const [index, one] of seeded.slice(0, 3).entries()) {
        const row = page.getByTestId('home.nextLink').nth(index)
        await expect(row.getByTestId('home.nextTitle')).toHaveText(one.next)
        await resetFrames(page)
        await row.tap()
        await expect(page.getByTestId('book.title')).toHaveText(one.next)
        await expect(page.getByTestId('book.description')).toBeVisible()
        await untilStill(page)
        await resetFrames(page)
        await page.getByTestId('book.back').tap()
        await expectBackOnHome(page, was, row)
        expect((await framesOf(page)).frames.some((frame) => frame.flying), `flight ${index + 1}`).toBe(true)
      }
    })

    test('Back while the Book is still being read: the cover flies home all the same, and Home is where it was', async ({ page }) => {
      const { seeded } = await seededHome(page)
      await homeScrolledTo(page, 600)
      const was = await page.evaluate(() => Math.round(scrollY))
      const row = page.getByTestId('home.nextLink').nth(1)
      const undo = await slowStack(page, 5000)
      await watchFrames(page)
      await row.tap()
      await expect(page.getByTestId('book.title')).toHaveText(seeded[1]!.next)
      await expect(page.getByTestId('book.actionsLoading')).toBeVisible()
      await untilStill(page)
      await resetFrames(page)
      // The hero is a cover, not a stand-in for one: what the way back flies from.
      await page.getByTestId('book.back').tap()
      await expectBackOnHome(page, was, row)
      expect((await framesOf(page)).frames.some((frame) => frame.flying), 'the cover flew back').toBe(true)
      await undo()
    })

    test('the Currently reading card opens at once too, and Back brings Home back to its place', async ({ page }) => {
      await seededHome(page)
      await homeScrolledTo(page, 300)
      // The third card: in view at this place, so the tap scrolls nothing (Playwright scrolls what it taps into view).
      const card = page.getByTestId('home.entry').nth(2)
      await expect(card).toBeInViewport({ ratio: 1 })
      const was = await page.evaluate(() => Math.round(scrollY))
      const title = (await card.getByTestId('home.entryTitle').textContent())!.trim()
      const undo = await slowStack(page)
      await watchFrames(page)
      await card.tap()
      await expect(page.getByTestId('book.title')).toHaveText(title)
      await expect.poll(async () => (await framesOf(page)).heroAt, { message: 'the hero was drawn' }).toBeGreaterThan(0)
      const opened = await framesOf(page)
      expect(opened.heroAt - opened.tapAt, 'tap to the hero drawn (ms)').toBeLessThan(HERO_WITHIN_MS)
      // Her own Book: its authors, its state and its action are there too, from her Library.
      await expect(page.getByTestId('book.authors')).toContainText('Susanna Clarke')
      await expect(page.getByTestId('book.updateProgress')).toBeVisible()
      await expect(page.getByTestId('book.actionsLoading')).toHaveCount(0)
      await untilStill(page)
      await undo()
      await resetFrames(page)
      await page.getByTestId('book.back').tap()
      await expectBackOnHome(page, was, card)
      expect((await framesOf(page)).frames.some((frame) => frame.flying), 'the cover flew back').toBe(true)
    })

    test("rows that come into Home after it is back (the document shorter for a moment) do not take its place", async ({ page }) => {
      await seededHome(page)
      await homeScrolledTo(page, 600)
      const was = await page.evaluate(() => Math.round(scrollY))
      const row = page.getByTestId('home.nextLink').nth(2)
      await row.tap()
      await expect(page.getByTestId('book.title')).toBeVisible()
      await untilStill(page)
      // Once Home is back and has landed on its place, two of its sections give way and return (as when their data is read again):
      // a document shorter than the place clamps the scroll to its end, and the member would be left there.
      await page.evaluate(() => {
        addEventListener(
          'popstate',
          () =>
            setTimeout(() => {
              const squash = document.createElement('style')
              squash.textContent = '[data-testid="home.reading"], [data-testid="home.nextInSeries"] { display: none !important }'
              document.head.append(squash)
              setTimeout(() => squash.remove(), 300)
            }, 350),
          { capture: true, once: true },
        )
      })
      await page.getByTestId('book.back').tap()
      await expect(page).toHaveURL(/\/$/)
      // Wait for the squash to have come and gone, then Home is where it was.
      await page.waitForTimeout(900)
      await expectBackOnHome(page, was, row)
    })

    test('a Book opened cold (an address, a reload) shows its shape, then the Book', async ({ page }) => {
      const { seeded } = await seededHome(page, { series: 1, reading: 1, wanted: 1 })
      const undo = await slowStack(page, 1500)
      await page.goto(`/book/isbn-${seeded[0]!.isbn13}`)
      await expect(page.getByTestId('book.loading')).toBeVisible()
      await expect(page.getByTestId('book.actionsLoading')).toBeVisible()
      await expect(page.getByTestId('book.aboutLoading')).toBeVisible()
      await expect(page.getByTestId('book.title')).toHaveCount(0)
      await expect(page.getByTestId('book.title')).toHaveText(seeded[0]!.next, { timeout: 20_000 })
      await expect(page.getByTestId('book.add')).toBeVisible()
      await expect(page.getByTestId('book.loading')).toHaveCount(0)
      await undo()
    })

    test('a Book nobody has: the page says so, with no skeleton left', async ({ page }) => {
      await seededHome(page, { series: 1, reading: 1, wanted: 1 })
      await page.goto('/book/isbn-9780000000002')
      await expect(page.getByTestId('book.missing')).toBeVisible({ timeout: 20_000 })
      await expect(page.getByTestId('book.actionsLoading')).toHaveCount(0)
      await expect(page.getByTestId('book.aboutLoading')).toHaveCount(0)
      await expect(page.getByTestId('book.title')).toHaveCount(0)
    })
  })
}
