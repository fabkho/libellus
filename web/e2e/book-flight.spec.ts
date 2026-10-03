import { expect, type Page } from '@playwright/test'
import { sql } from '../tests/support/stack'
import { recordedApple, signedIn, untilStill } from './support'
import { test } from './fixtures'

/**
 * Push to a book and back (docs/MOTION.md, Push to a book;
 * composables/useBookFlight.ts): the tapped cover flies into the book page's
 * hero and back into its row, and the list is where it was. The flows check
 * where each flight ends — the live covers shown, the flight's layers empty,
 * the scroll restored — and, with the Web Animations frozen, that Back tapped
 * mid-flight turns the cover around from where it is on screen.
 */

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
  // Every animation the flight starts can be held still: `__flight.frozen`
  // pauses each one as it is created (CSS transitions are not affected).
  // `started` counts the flights: each fades the copy of the page it left.
  await page.addInitScript(() => {
    const flight = { frozen: false, started: 0 }
    Object.assign(window, { __flight: flight })
    const animate = Element.prototype.animate
    Element.prototype.animate = function (this: Element, ...args: Parameters<Element['animate']>) {
      const animation = animate.apply(this, args)
      if (flight.frozen) animation.pause()
      if (this.parentElement?.dataset.testid === 'shell.flightPage') flight.started++
      return animation
    }
  })
})

const COVER = 'https://is1-ssl.mzstatic.com/image/thumb/Publication/v4/t5/flight/cover.jpg/600x900bb.jpg'

/** Puts `count` Books on the member's Want to read, every other one without a cover (a Placeholder). */
async function shelf(memberId: string, count: number) {
  for (let i = 0; i < count; i++) {
    const [book] = await sql<{ id: string }>(
      `insert into public.books (title, authors, source, owner_id, cover_url, cover_dominant)
         values ($1, '{"Ursula K. Le Guin"}', 'manual', $2, $3, '#5b6c8f') returning id`,
      [`Flight ${String(i + 1).padStart(2, '0')}`, memberId, i % 2 ? null : COVER],
    )
    await sql(`insert into public.library_entries (member_id, book_id, status, added_at) values ($1, $2, 'want_to_read', now() - make_interval(mins => $3))`, [
      memberId,
      book!.id,
      i,
    ])
  }
}

const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY))

type Flight = { frozen: boolean; started: number }
const flight = (page: Page) => page.evaluate(() => (window as unknown as { __flight: Flight }).__flight)
const freeze = (page: Page) => page.evaluate(() => ((window as unknown as { __flight: Flight }).__flight.frozen = true))

/** The `count`th flight has started, and is over: nothing in its layers, no live cover left hidden, nothing animating on the page. */
async function expectLanded(page: Page, count: number) {
  await expect.poll(async () => (await flight(page)).started).toBe(count)
  await expect(page.getByTestId('shell.flightCover')).toHaveCount(0)
  await expect(page.locator('[data-flight-hidden]')).toHaveCount(0)
  await expect(page.locator('[data-moving]')).toHaveCount(0)
  await expect(page.getByTestId('shell.flightPage')).toBeEmpty()
  expect(
    await page.evaluate(() =>
      document
        .querySelector('main')!
        .getAnimations()
        .map((a) => `${a.constructor.name} ${a.playState} ${(a as CSSTransition).transitionProperty ?? ''}`),
    ),
  ).toEqual([])
}

/** The flying cover's box on screen. */
async function flyBox(page: Page) {
  return (await page.getByTestId('shell.flightCover').boundingBox())!
}

/** Holds the flight still, its animations `ms` in. */
async function freezeAt(page: Page, ms: number) {
  await page.evaluate((at) => {
    for (const animation of document.getAnimations())
      if (!(animation instanceof CSSTransition) && !(animation instanceof CSSAnimation)) animation.currentTime = at
  }, ms)
}

async function thaw(page: Page) {
  await page.evaluate(() => {
    ;(window as unknown as { __flight: Flight }).__flight.frozen = false
    for (const animation of document.getAnimations()) if (animation.playState === 'paused') animation.play()
  })
}

test('a cover flies into its book page and back into its row, and the Library is where it was', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 })
  const member = await signedIn(page)
  await shelf(member.id, 14)
  await page.getByTestId('shell.tab.library').click()
  await expect(page.getByTestId('library.entry')).toHaveCount(14)
  await untilStill(page)

  // Scrolled down (again, if the tab's own place lands just after the first try).
  await expect
    .poll(async () => {
      await page.evaluate(() => window.scrollTo(0, 300))
      return scrollY(page)
    })
    .toBe(300)
  const row = page.getByTestId('library.entry').nth(6)
  const title = await row.getByTestId('library.entryTitle').textContent()
  const rowCover = (await row.locator('[data-cover]').boundingBox())!

  // A tap right on the cover, where it is (no scrolling it into view first).
  await page.mouse.click(rowCover.x + rowCover.width / 2, rowCover.y + rowCover.height / 2)
  await expect(page.getByTestId('book.title')).toHaveText(title!)
  await expectLanded(page, 1)
  // The hero is the live one, at the top of the page.
  await expect(page.getByTestId('book.hero').locator('[data-cover]')).toBeVisible()
  expect(await scrollY(page)).toBe(0)

  await page.getByTestId('book.back').click()
  await expect(page.getByTestId('library.title')).toBeVisible()
  await expectLanded(page, 2)
  await expect.poll(() => scrollY(page)).toBe(300)
  // Its cover is back in its row, where it was.
  expect((await row.locator('[data-cover]').boundingBox())!.y).toBeCloseTo(rowCover.y, 0)
  await expect(row.locator('[data-cover]')).toBeVisible()
})

test('Back tapped mid-flight turns the cover around from where it is', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 })
  const member = await signedIn(page)
  await shelf(member.id, 6)
  await page.getByTestId('shell.tab.library').click()
  const row = page.getByTestId('library.entry').nth(2)
  const rowCover = (await row.locator('[data-cover]').boundingBox())!

  // Frozen 100 ms into the push: the cover is on its way, between its row and the hero.
  await freeze(page)
  await row.click()
  await expect(page.getByTestId('shell.flightCover')).toHaveCount(1)
  await freezeAt(page, 100)
  const hero = (await page.getByTestId('book.hero').locator('[data-cover]').boundingBox())!
  const mid = await flyBox(page)
  expect(mid.y).toBeLessThan(rowCover.y - 1)
  expect(mid.y).toBeGreaterThan(hero.y + 1)
  expect(mid.width).toBeGreaterThan(rowCover.width)
  expect(mid.width).toBeLessThan(hero.width)
  // The Library, copied, fades out as the book page fades in: both partly there.
  const [leaving, arriving] = await page.evaluate(() => [
    Number(getComputedStyle(document.querySelector('[data-testid="shell.flightPage"]')!.firstElementChild!).opacity),
    Number(getComputedStyle(document.querySelector('main')!).opacity),
  ])
  expect(leaving).toBeGreaterThan(0.05)
  expect(leaving).toBeLessThan(0.95)
  expect(arriving).toBeCloseTo(1 - leaving, 2)

  // Back: the flight back starts where the cover is, not from the hero.
  await page.getByTestId('book.back').click()
  await expect(page.getByTestId('library.title')).toBeVisible()
  // Flying back: its row's cover waits, hidden, for the copy in the air.
  await expect(row.locator('[data-cover][data-flight-hidden]')).toHaveCount(1)
  await expect(page.getByTestId('shell.flightCover')).toHaveCount(1)
  const turned = await flyBox(page)
  expect(Math.abs(turned.x - mid.x)).toBeLessThan(1.5)
  expect(Math.abs(turned.y - mid.y)).toBeLessThan(1.5)
  expect(Math.abs(turned.width - mid.width)).toBeLessThan(1.5)

  // And lands in its row.
  await thaw(page)
  await expectLanded(page, 2)
  await expect(row.locator('[data-cover]')).toBeVisible()
  expect(await scrollY(page)).toBe(0)
})

test('from Home and from search the cover flies too; back to a closed search it cross-fades', async ({ page }) => {
  const member = await signedIn(page)
  await shelf(member.id, 3)
  await page.reload()

  // Home's Up next.
  const upNext = page.getByTestId('home.upNextEntry').first()
  await expect(upNext).toBeVisible()
  await freeze(page)
  await upNext.click()
  await expect(page.getByTestId('shell.flightCover')).toHaveCount(1)
  await thaw(page)
  await expect(page.getByTestId('book.hero')).toBeVisible()
  await expectLanded(page, 1)
  await page.getByTestId('book.back').click()
  await expect(page.getByTestId('home.title')).toBeVisible()
  await expectLanded(page, 2)

  // A search result: the palette closes behind the flying cover.
  await page.getByTestId('shell.tab.search').click()
  await page.getByTestId('search.query').fill('Piranesi')
  const result = page.getByTestId('search.result').first()
  await expect(result).toBeVisible()
  await freeze(page)
  await result.click()
  await expect(page.getByTestId('shell.flightCover')).toHaveCount(1)
  await thaw(page)
  await expect(page.getByTestId('book.title')).toHaveText('Piranesi')
  await expectLanded(page, 3)
  await expect(page.getByTestId('search.overlay')).toBeHidden()

  // Back: the palette is gone, so the cover leaves with its page instead of flying.
  await freeze(page)
  await page.getByTestId('book.back').click()
  await expect(page.getByTestId('home.title')).toBeVisible()
  await expect(page.getByTestId('shell.flightPage')).not.toBeEmpty()
  await expect(page.getByTestId('shell.flightCover')).toHaveCount(0)
  await thaw(page)
  await expectLanded(page, 4)
})
