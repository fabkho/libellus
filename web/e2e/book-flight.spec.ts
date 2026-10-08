import { expect, type Page } from '@playwright/test'
import { appleCover, appleRowCover } from '../tests/support/apple'
import { sql } from '../tests/support/stack'
import { enrichedLibrary, forgetEnriched } from './enriched'
import { recordedApple, signedIn, untilStill } from './support'
import { test } from './fixtures'

/**
 * Push to a book and back (docs/MOTION.md, Push to a book;
 * composables/useBookFlight.ts): the tapped cover flies into the book page's
 * hero and back into its row, and the list is where it was. The flows check
 * where each flight ends — the live covers shown, the flight's layers empty,
 * the scroll restored — and, with the Web Animations frozen, that Back tapped
 * mid-flight turns the cover around from where it is on screen. The hand-off
 * (#61) is checked frame by frame: the new page is never drawn bare before
 * the flight, the list's small image is never shown blown up, and a cover
 * that lands before the book page's image lands on its colour, where that
 * image then fades in (e2e/book-flight-android.spec.ts has the sharp case).
 * And what used to go wrong (docs/MOTION.md, What can go wrong): a flight
 * turned around never shows the live page with its cover beside the flying
 * one; with the same Book twice on Home, Back flies into the one tapped; a
 * Book page still loading gets the cover all the same, waiting on the
 * stand-in until the hero is drawn there.
 */
// What moves is the subject here: the transitions play, which the config's Reduce Motion would cut.
test.use({ reducedMotion: 'no-preference' })

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

test('a cover flies into its book page and back into its row, and the Library is where it was', { tag: '@full' }, async ({ page }) => {
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

test('Back tapped mid-flight turns the cover around from where it is', { tag: '@full' }, async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 })
  const member = await signedIn(page)
  await shelf(member.id, 6)
  await page.getByTestId('shell.tab.library').click()
  const row = page.getByTestId('library.entry').nth(2)
  await expect(row).toBeVisible()
  // The Library at its place first: measured while it still moves there, the row and the scroll are stale.
  await untilStill(page)
  const place = await scrollY(page)
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
  expect(await scrollY(page)).toBe(place)
})

test('from Home and from search the cover flies too; back to a closed search it cross-fades', { tag: '@full' }, async ({ page }) => {
  const member = await signedIn(page)
  await shelf(member.id, 3)
  await page.reload()

  // Home's Want to read.
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

test('the hand-off: never a bare frame, and a cover whose image is late lands on its thumbhash and fades it in there', { tag: '@full' }, async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 })
  const member = await signedIn(page)
  // One Book with a cover and a description long enough to scroll the book page.
  const [book] = await sql<{ id: string }>(
    `insert into public.books (title, authors, source, owner_id, cover_url, cover_dominant, description)
       values ('Flight hand-off', '{"Ursula K. Le Guin"}', 'manual', $1, $2, '#5b6c8f', $3) returning id`,
    [member.id, COVER, 'The wind blows from the sea. '.repeat(120)],
  )
  await sql(`insert into public.library_entries (member_id, book_id, status) values ($1, $2, 'want_to_read')`, [member.id, book!.id])
  // The book page's image (600×900) is held back until released; the list's (120×180) comes at once.
  let release = () => {}
  const released = new Promise<void>((resolve) => (release = resolve))
  await page.route(/600x900bb\.jpg$/, async (route) => {
    await released
    await route.fulfill({ status: 200, contentType: 'image/jpeg', headers: { 'access-control-allow-origin': '*' }, body: appleCover() })
  })
  await page.route(/120x180bb\.jpg$/, (route) =>
    route.fulfill({ status: 200, contentType: 'image/jpeg', headers: { 'access-control-allow-origin': '*' }, body: appleRowCover() }),
  )
  await page.getByTestId('shell.tab.library').click()
  const row = page.getByTestId('library.entry').first()
  await expect(row.locator('[data-cover] img')).toHaveCSS('opacity', '1')
  await untilStill(page)

  // Every frame from the tap on: where it is, what of each page shows, and how much of the list's
  // small image shows in the flying cover, and at what size.
  type Frame = { book: boolean; page: number; copy: boolean; flying: boolean; width: number; small: number }
  await page.evaluate(() => {
    const frames: Frame[] = []
    Object.assign(window, { __frames: frames })
    const look = () => {
      const fly = document.querySelector('[data-testid="shell.flightCover"]')
      const small = [...(fly?.querySelectorAll('img') ?? [])].filter((image) => !image.src.endsWith('600x900bb.jpg'))
      frames.push({
        book: location.pathname.startsWith('/book/'),
        page: Number(getComputedStyle(document.querySelector('main')!).opacity),
        copy: document.querySelector('[data-testid="shell.flightPage"]')!.childElementCount > 0,
        flying: Boolean(fly),
        width: fly?.getBoundingClientRect().width ?? 0,
        small: Math.max(0, ...small.map((image) => Number(getComputedStyle(image).opacity))),
      })
      if (frames.length < 120) requestAnimationFrame(look)
    }
    requestAnimationFrame(look)
  })
  const rowWidth = (await row.locator('[data-cover]').boundingBox())!.width
  await row.locator('[data-cover]').click()
  await expect(page.getByTestId('book.title')).toHaveText('Flight hand-off')
  await expectLanded(page, 1)

  // Until the flight started, the copy of the Library stood in: the book page never showed bare.
  const frames = await page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames)
  const started = frames.findIndex((frame) => frame.flying)
  expect(started).toBeGreaterThan(0)
  expect(frames.slice(0, started).filter((frame) => frame.book && (frame.page > 0 || !frame.copy))).toEqual([])
  // The list's image (sized for its row) is gone before the cover is half again as large: never shown blown up.
  expect(frames.filter((frame) => frame.flying && frame.width > rowWidth * 1.5 && frame.small > 0.05)).toEqual([])

  // Landed before its image: the hero shows what is under its image (its thumbhash, or its colour),
  // nothing of the list's stays on it, and it stays so through a scroll.
  const hero = page.getByTestId('book.hero').locator('[data-cover]')
  await expect(hero.locator(':scope > img')).toHaveCSS('opacity', '0')
  await expect(hero.getByTestId('shell.flightHeld')).toHaveCount(0)
  await page.evaluate(() => window.scrollTo({ top: 120, behavior: 'instant' }))
  await expect.poll(() => scrollY(page)).toBe(120)
  await expect(hero.locator(':scope > img')).toHaveCSS('opacity', '0')

  // The image arrives: decoded and faded in on the hero; the halo has faded in for the pool of colour.
  release()
  await expect(hero.locator(':scope > img')).toHaveCSS('opacity', '1')
  await expect(page.getByTestId('book.hero').locator('.pool')).toHaveCSS('opacity', '0')
  await expect(page.getByTestId('book.hero').locator('.halo')).not.toHaveCSS('opacity', '0')
})

/**
 * From now on, every frame: whether a cover flies while a live cover of the Book at `href` shows
 * on the live page (its row, or on its own page the hero), the two at once; and the widest the
 * flying cover was.
 */
async function watchFrames(page: Page, href: string) {
  await page.evaluate((href) => {
    const seen = { doubles: [] as string[], widest: 0, frames: 0 }
    Object.assign(window, { __seen: seen })
    const look = () => {
      seen.frames++
      const fly = document.querySelector('[data-testid="shell.flightCover"]')
      const main = document.querySelector('main')!
      if (fly) {
        seen.widest = Math.max(seen.widest, fly.getBoundingClientRect().width)
        const live = [
          ...main.querySelectorAll(`a[href="${href}"] [data-cover]`),
          ...(location.pathname === href ? main.querySelectorAll('[data-flight="hero"] [data-cover]') : []),
        ].filter((cover) => getComputedStyle(cover).visibility !== 'hidden')
        if (live.length && Number(getComputedStyle(main).opacity) > 0.01)
          seen.doubles.push(`frame ${seen.frames} on ${location.pathname}: page at ${getComputedStyle(main).opacity}`)
      }
      if (seen.frames < 600) requestAnimationFrame(look)
    }
    requestAnimationFrame(look)
  }, href)
}

const seen = (page: Page) => page.evaluate(() => (window as unknown as { __seen: { doubles: string[]; widest: number } }).__seen)

test('turned around mid-flight, the page in between never shows the live cover beside the flying one', { tag: '@full' }, async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 })
  const member = await signedIn(page)
  await shelf(member.id, 6)
  await page.getByTestId('shell.tab.library').click()
  const row = page.getByTestId('library.entry').nth(2)
  await expect(row.locator('[data-cover]')).toBeVisible()
  await untilStill(page)
  await watchFrames(page, (await row.getAttribute('href'))!)

  // In, Back while it flies in, and the same Book again while it flies back: each held mid-air.
  await freeze(page)
  await row.click()
  await expect(page.getByTestId('shell.flightCover')).toHaveCount(1)
  await freezeAt(page, 100)
  await page.getByTestId('book.back').click()
  await expect(page.getByTestId('library.title')).toBeVisible()
  await expect(row.locator('[data-cover][data-flight-hidden]')).toHaveCount(1)
  await freezeAt(page, 80)
  await row.click()
  await expect(page.getByTestId('book.title')).toBeVisible()
  await expect(page.getByTestId('book.hero').locator('[data-cover][data-flight-hidden]')).toHaveCount(1)
  await thaw(page)
  await expectLanded(page, 3)
  // While the router drew each new page and before its flight took over, the page stood in its
  // copy (the pose), at the strength the flight showed it: never the live page with the cover on it.
  expect((await seen(page)).doubles).toEqual([])
})

test.describe('with series and authors', () => {
  const stored: string[] = []
  test.afterAll(async () => {
    await forgetEnriched(stored)
  })

  test('the same Book twice on Home: Back flies its cover into the one it was tapped on', { tag: '@full' }, async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 })
    const member = await signedIn(page)
    const data = await enrichedLibrary(member.client)
    stored.push(...data.ids)
    await page.reload()
    // Feet of Clay is on Want to read and the next Book of her City Watch: on Home twice.
    const href = `/book/${data.entries.feetOfClay.book.id}`
    const series = page.getByTestId('home.nextInSeries').locator(`a[href="${href}"]`)
    const upNext = page.getByTestId('home.upNextEntry').and(page.locator(`[href="${href}"]`))
    await expect(series).toBeVisible()
    await expect(upNext).toBeVisible()
    await series.scrollIntoViewIfNeeded()
    await untilStill(page)

    await series.locator('[data-cover]').click()
    await expect(page.getByTestId('book.hero')).toBeVisible()
    await expectLanded(page, 1)

    // Back, held mid-air: the series row's cover waits for it, Want to read's stays as it is.
    await freeze(page)
    await page.getByTestId('book.back').click()
    await expect(page.getByTestId('home.title')).toBeVisible()
    await expect(page.getByTestId('shell.flightCover')).toHaveCount(1)
    await expect(series.locator('[data-cover]')).toHaveAttribute('data-flight-hidden')
    await expect(upNext.locator('[data-cover]')).not.toHaveAttribute('data-flight-hidden')
    await thaw(page)
    await expectLanded(page, 2)
  })

  test('a Book page still loading: the cover flies to its place and waits there for the hero; a missing Book lets it go', { tag: '@full' }, async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 })
    const member = await signedIn(page)
    const data = await enrichedLibrary(member.client)
    stored.push(...data.ids)
    // Mort is in the Catalogue, not in her Library: its page asks the Catalogue by its ISBN, and every
    // such answer is held back until let go (`release`), so the page is still loading when the cover lands.
    let release = () => {}
    const hold = () => new Promise<void>((resolve) => (release = resolve))
    let released = hold()
    await page.route(/\/rest\/v1\/books\?.*isbn13=eq\./, async (route) => {
      await released
      await route.fallback()
    })
    await page.goto(`/author/${data.authors.pratchett}`)
    const mort = page.getByTestId('author.work').filter({ has: page.getByText('Mort', { exact: true }) })
    await expect(mort).toBeVisible()
    await mort.scrollIntoViewIfNeeded()
    await untilStill(page)
    await watchFrames(page, `/book/isbn-${data.mort.isbn13}`)

    await mort.getByTestId('author.workLink').click()
    // The page is still loading: the cover flew all the way, and stays on the hero's place.
    const waiting = page.getByTestId('book.loading').getByTestId('shell.flightHeld')
    await expect(waiting).toHaveCount(1)
    await expect(page.getByTestId('shell.flightCover')).toHaveCount(0)
    expect((await seen(page)).widest).toBeGreaterThan(130)
    const place = (await waiting.boundingBox())!

    // The Book comes: the hero takes over where the cover waited, and nothing of the flight is left.
    release()
    await expect(page.getByTestId('book.title')).toHaveText(data.mort.title)
    const hero = (await page.getByTestId('book.hero').locator('[data-cover]').boundingBox())!
    for (const side of ['x', 'y', 'width', 'height'] as const) expect(hero[side]).toBeCloseTo(place[side], 0)
    await expectLanded(page, 1)
    expect((await seen(page)).doubles).toEqual([])

    // A Book no source knows (Forever Free, the next of her Forever War): the cover flies, finds no hero, and goes.
    released = hold()
    await page.goto('/')
    const free = page.getByTestId('home.next').filter({ hasText: 'Forever Free' })
    await expect(free).toBeVisible()
    await free.scrollIntoViewIfNeeded()
    await untilStill(page)
    await watchFrames(page, (await free.locator('a').first().getAttribute('href'))!)
    await free.locator('[data-cover]').click()
    await expect(page.getByTestId('book.loading').getByTestId('shell.flightHeld')).toHaveCount(1)
    release()
    await expect(page.getByTestId('book.missing')).toBeVisible()
    // (A new page load: the flights are counted afresh.)
    await expectLanded(page, 1)
    expect((await seen(page)).widest).toBeGreaterThan(130)
  })
})
