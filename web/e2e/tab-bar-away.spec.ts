import { expect, type Page } from '@playwright/test'
import type { BookSnapshot } from '../app/data/books'
import { createLibrary } from '../app/data/library'
import { MIN_END_PX } from '../app/utils/hideOnScroll'
import { runTitle, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { openProfile, recordedApple, signedIn, untilStill } from './support'
import { test } from './fixtures'

/**
 * The tab bar on every page (#82, composables/useHideOnScroll.ts): on Home,
 * Library and the Profile alike it slides away while the member scrolls down,
 * comes back on a short scroll up, and is there at the end of the page and at
 * the top. A page only a little longer than the screen keeps it (#205,
 * `MIN_END_PX`): on the phone-sized window these flows use (393×360, so a page
 * scrolls a good way) Home, an empty Library and a book page are exactly that —
 * a few px of reading are not worth a bar that goes and comes back — so a flow
 * that wants the bar away first puts Books on the Library, which makes it long
 * (`seedLibrary`). With Reduce Motion it stays. Search opens from a bar that is
 * away (the bar is back in its place for the morph and stays after closing), a
 * sheet brings it back and keeps it, and Back lands with it showing. Apple
 * answers from the recordings (e2e/support.ts); the Library is the real local
 * stack.
 *
 * The page is scrolled one step per frame, so every step is a scroll event of
 * its own, as a finger's would be.
 */
// What moves is the subject here: the transitions play, which the config's Reduce Motion would cut.
test.use({ reducedMotion: 'no-preference' })

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

const tabs = (page: Page) => page.getByTestId('shell.tabs')

/** How far the page scrolls past the screen: the `end` `barAfterScroll` reads. */
async function room(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollHeight - Math.max(window.innerHeight, document.documentElement.clientHeight),
  )
}

/** Scrolls by `by` px in steps of `step`, one per frame. */
async function scroll(page: Page, by: number, step = 40) {
  await page.evaluate(
    async ({ by, step }) => {
      const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))
      const target = window.scrollY + by
      for (let y = window.scrollY; Math.abs(target - y) > 0; ) {
        y = by > 0 ? Math.min(target, y + step) : Math.max(target, y - step)
        window.scrollTo(0, y)
        await frame()
      }
      await frame()
    },
    { by, step },
  )
}

async function scrollToEnd(page: Page) {
  await page.evaluate(async () => {
    window.scrollTo(0, document.documentElement.scrollHeight)
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
}

async function expectAway(page: Page) {
  await expect(tabs(page)).toHaveAttribute('data-away', 'true')
  // Off the screen once it has slid away, and out of reach.
  const height = page.viewportSize()!.height
  await expect.poll(async () => (await tabs(page).boundingBox())!.y).toBeGreaterThanOrEqual(height)
  await expect(tabs(page)).toHaveCSS('opacity', '0')
}

async function expectShown(page: Page) {
  await expect(tabs(page)).not.toHaveAttribute('data-away')
  await expect(tabs(page)).toHaveCSS('opacity', '1')
  await expect(tabs(page)).toBeInViewport({ ratio: 1 })
}

/** A Book of this run's own, for the Library a flow seeds (tests/support/stack.ts). */
function book(title: string): BookSnapshot {
  return {
    title: runTitle(title),
    authors: ['Ida Lumen'],
    isbn13: null,
    isbn10: null,
    pageCount: 200,
    year: 2020,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: null,
    coverUrl: null,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

/**
 * Puts `count` Books on Want to read and stands on the Library: the list makes it
 * scroll well past `MIN_END_PX`, so there the bar has somewhere to go (#205).
 * Checked here, so a flow that stops hiding the bar says so itself instead of
 * failing in some later expectation.
 */
async function seedLibrary(page: Page, member: Awaited<ReturnType<typeof signedIn>>, count: number) {
  const library = createLibrary(member.client)
  for (let n = 0; n < count; n++) await library.addToLibrary(book(`Shelf ${n}`))
  await page.reload()
  await expect(page.getByTestId('home.title')).toBeVisible()
  await page.getByTestId('shell.tab.library').click()
  await expect(page.getByTestId('library.title')).toBeVisible()
  await untilStill(page)
  expect(await room(page)).toBeGreaterThanOrEqual(MIN_END_PX)
}

/** Books enough for the Library to be long; Home, with their covers in one row, stays short. */
const LONG_LIBRARY = 12

async function openPiranesi(page: Page) {
  await page.getByTestId('shell.tab.search').click()
  await page.getByTestId('search.query').fill('Piranesi')
  await page
    .getByTestId('search.result')
    .filter({ has: page.getByTestId('search.resultTitle').getByText('Piranesi', { exact: true }) })
    .first()
    .click()
  await expect(page.getByTestId('book.title')).toHaveText('Piranesi')
  await untilStill(page)
}

test('a page only a little longer than the screen keeps the bar, however far it is scrolled', { tag: '@full' }, async ({
  page,
}) => {
  // A short window: the empty Home of a new member, an empty Library and a book
  // page each scroll a little, and each is under `MIN_END_PX` of it.
  await page.setViewportSize({ width: 393, height: 360 })
  await signedIn(page)
  await expect(page.getByTestId('home.title')).toBeVisible()
  await untilStill(page)

  for (const where of ['Home', 'the Library', 'a book page'] as const) {
    // Home draws its empty state a moment after its first paint: wait until the page scrolls
    // at all before reading how far it does.
    await expect.poll(() => room(page)).toBeGreaterThan(0)
    const end = await room(page)
    expect(end, where).toBeLessThan(MIN_END_PX)

    // Part of the way down, down in steps and at the very end: the bar stays.
    await scroll(page, Math.floor(end / 2))
    await expectShown(page)
    await scroll(page, Math.ceil(end / 2))
    await expectShown(page)
    await scrollToEnd(page)
    await expectShown(page)
    // And back and forth over it: nothing on it is worth the bar getting out of the way.
    await scroll(page, -end)
    await expectShown(page)
    await page.evaluate(() => window.scrollTo(0, 0))
    await expectShown(page)

    if (where === 'Home') {
      await page.getByTestId('shell.tab.library').click()
      await expect(page.getByTestId('library.title')).toBeVisible()
      await untilStill(page)
    } else if (where === 'the Library') {
      await openPiranesi(page)
    }
  }
})

test('on a long page the tab bar slides away scrolling down and returns scrolling up, at the end and at the top', { tag: '@full' }, async ({
  page,
}) => {
  await page.setViewportSize({ width: 393, height: 360 })
  const member = await signedIn(page)
  await seedLibrary(page, member, LONG_LIBRARY)

  // A few pixels are not a scroll: it stays.
  await scroll(page, 6, 3)
  await expectShown(page)

  // Down: away.
  await scroll(page, 120)
  await expectAway(page)

  // Up a little, less than the intent: still away. A little more: back.
  await scroll(page, -6, 3)
  await expect(tabs(page)).toHaveAttribute('data-away', 'true')
  await scroll(page, -20, 5)
  await expectShown(page)

  // Down again, then to the very end of the page: back at the end.
  await scroll(page, 60)
  await expectAway(page)
  await scrollToEnd(page)
  await expectShown(page)

  // Away again on the way up from the end? No: up shows. Down from the middle hides, the top shows.
  await scroll(page, -200)
  await expectShown(page)
  await scroll(page, 80)
  await expectAway(page)
  await page.evaluate(() => window.scrollTo(0, 0))
  await expectShown(page)

  // The Profile: a pushed screen, and of a member with nothing read a long one.
  await openProfile(page)
  await expectShown(page)
  await scroll(page, 120)
  await expectAway(page)
  await scroll(page, -20, 5)
  await expectShown(page)

  // Back with the bar away: the page it lands on has it.
  await scroll(page, 120)
  await expectAway(page)
  await page.goBack()
  await expect(page.getByTestId('library.title')).toBeVisible()
  await expectShown(page)
})

test('with Reduce Motion the bar never hides, and focus moving into a bar that is away brings it back', { tag: '@full' }, async ({
  page,
}) => {
  await page.setViewportSize({ width: 393, height: 360 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const member = await signedIn(page)
  await seedLibrary(page, member, LONG_LIBRARY)
  await scroll(page, 200)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(60)
  await expectShown(page)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await scroll(page, 60)
  await expectAway(page)

  // A keyboard or a screen reader reaching the bar shows it.
  await page.getByTestId('shell.tab.home').focus()
  await expectShown(page)
})

test('search opens from a tab bar that is away, and the bar is back after it closes; a sheet keeps it', { tag: '@full' }, async ({
  page,
}) => {
  await page.setViewportSize({ width: 393, height: 360 })
  const member = await signedIn(page)
  await seedLibrary(page, member, LONG_LIBRARY)

  await scroll(page, 160)
  await expectAway(page)

  // Search, opened while the bar is away (as from a page's own search prompt):
  // the bar is back in its place at once, so the palette grows out of it.
  await page.getByTestId('shell.tab.search').dispatchEvent('click')
  await expect(page.getByTestId('search.query')).toBeFocused()
  await expect(tabs(page)).not.toHaveAttribute('data-away')
  await page.getByTestId('search.cancel').click()
  await expect(page.getByTestId('search.query')).toBeHidden()
  await expectShown(page)

  // Away again, then a sheet: the bar
  // comes back and stays while it is open.
  await scroll(page, -150)
  await scroll(page, 160)
  await expectAway(page)
  await page.getByTestId('library.view.filter').dispatchEvent('click')
  await expect(page.getByTestId('libraryFilter')).toBeVisible()
  await expect(tabs(page)).not.toHaveAttribute('data-away')
  await untilStill(page)
  await expect(tabs(page)).not.toHaveAttribute('data-away')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('libraryFilter')).toBeHidden()
  await expectShown(page)
})
