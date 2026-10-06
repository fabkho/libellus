import { expect, type Locator, type Page } from '@playwright/test'
import { ratingX } from '../app/utils/rating'
import { appleAnswer, appleCover } from '../tests/support/apple'
import { openLibraryAnswer } from '../tests/support/openLibrary'
import { INSTALL_HINT_KEY } from '../app/utils/installHint'
import { signUpMember } from '../tests/support/member'
import { emailCooldown, readMailedCode } from '../tests/support/stack'

/**
 * Answers every source behind search from the recordings: Apple
 * (tests/fixtures/apple) and OpenLibrary (tests/fixtures/openlibrary), their
 * search APIs and their covers. No flow ever reaches a live API. Covers are
 * the recorded stand-in, served with the CDNs' CORS header, so the app can
 * read them to make the thumbhash.
 */
export async function recordedApple(page: Page) {
  await page.route('https://itunes.apple.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(appleAnswer(new URL(route.request().url()))),
    }),
  )
  await page.route('https://openlibrary.org/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(openLibraryAnswer(new URL(route.request().url()))),
    }),
  )
  await page.route('https://covers.openlibrary.org/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/jpeg',
      headers: { 'access-control-allow-origin': '*' },
      body: appleCover(),
    }),
  )
  await page.route(/^https:\/\/is\d-ssl\.mzstatic\.com\//, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/jpeg',
      headers: { 'access-control-allow-origin': '*' },
      body: appleCover(),
    }),
  )
}

/**
 * Signs a fresh member in through the screens: address, then the mailed code.
 *
 * Every flow runs on an iPhone's Safari, where Home shows the install hint
 * (issue #94) above what the flow reads and taps. It is dismissed from the
 * start, the way a member who has been here before has: `installHint: true`
 * leaves it to the flow that is about it (e2e/install-hint.spec.ts).
 */
export async function signedIn(page: Page, { installHint = false }: { installHint?: boolean } = {}) {
  if (!installHint) {
    await page.addInitScript((key) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, String(Date.now()))
    }, INSTALL_HINT_KEY)
  }
  const member = await signUpMember()
  await emailCooldown()
  await page.goto('/sign-in')
  await page.getByTestId('signIn.email').fill(member.email)
  await page.getByTestId('signIn.submit').click()
  await expect(page).toHaveURL(/\/verify$/)
  await page.getByTestId('verify.code').fill(await readMailedCode(member.email, 2))
  await expect(page.getByTestId('home.title')).toBeVisible()
  return member
}

/**
 * Waits until nothing on the page is moving: no sheet rising or sliding away,
 * no list opening or closing an item's room (both carry `data-moving` until
 * their transition has ended), and no page still on its way to its scroll
 * place after a navigation (the document carries it until the router has
 * scrolled, app/router.options.ts). Watching an element's box instead is not
 * enough: a slow runner may paint no frame between two looks, and a sheet
 * mid-rise then seems to stand still.
 */
export async function untilStill(page: Page) {
  await expect(page.locator('[data-moving]')).toHaveCount(0)
}

/**
 * Opens the Profile from the avatar and waits until it has come to rest, the
 * way a member waits to read it before she reaches for a row. The page opens
 * with its account rows right under the hero; once the reading record is in
 * (`profile.library` is the hero's line for it), a member with nothing finished
 * gets the empty state, which opens its room above the rows and slides them
 * ~150 px down over a quarter of a second (UiReveal, `data-moving`). A tap
 * aimed at a row where it first showed lands on the empty state instead, and a
 * starved runner that paints no frame between two looks takes that row for
 * still (the Import row of import.spec.ts, the theme switch of auth.spec.ts).
 * So: the record in, then nothing moving.
 */
export async function openProfile(page: Page) {
  await page.getByTestId('shell.avatar').click()
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.getByTestId('profile.library')).toBeVisible()
  await untilStill(page)
}

/**
 * Brings the tab bar back the way a member does: up to the top of the page,
 * where it always shows (composables/useHideOnScroll.ts). A page scrolled down
 * to a control has it away, and a tap on a tab that is off the screen goes
 * nowhere ("element is outside of the viewport").
 */
export async function showTabBar(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(page.getByTestId('shell.tabs')).not.toHaveAttribute('data-away')
}

/**
 * Opens an address the way a member types it in, once the page she is on has
 * come to rest: nothing moving (`untilStill`) and no sheet's own history entry
 * left on top of the page's (composables/useBackDismiss.ts). A sheet that has
 * just closed steps back off its entry a moment later, and WebKit loses a page
 * load that starts during that step back: `load` never comes, or its driver
 * reports an internal error (collections.spec.ts in CI).
 */
export async function goto(page: Page, url: string) {
  await untilStill(page)
  const layers = () => page.evaluate(() => (history.state as { libellusLayer?: number } | null)?.libellusLayer ?? 0)
  await expect.poll(layers).toBe(0)
  await page.goto(url)
}

/**
 * Where an element is once the sheet it is in has finished rising: it is on
 * the page, nothing is moving (`untilStill`) and its box held still between
 * two looks (a sheet that opens a moment after the tap has to have started
 * rising first).
 */
export async function settledBox(locator: Locator) {
  const moving = locator.page().locator('[data-moving]')
  let last = null as Awaited<ReturnType<Locator['boundingBox']>>
  await expect
    .poll(
      async () => {
        // Nothing moving first, then the box: a box read after that is in place.
        const calm = (await moving.count()) === 0
        const box = await locator.boundingBox()
        const still = calm && Boolean(box && last && box.y === last.y)
        last = box
        return still
      },
      { intervals: [100] },
    )
    .toBe(true)
  return last!
}

/** A finger (here a mouse) pressed on the stars and dragged to `quarters`. */
export async function dragRating(page: Page, control: Locator, quarters: number) {
  const box = await settledBox(control)
  const y = box.y + box.height / 4
  const [size, gap] = [44, 12]
  await page.mouse.move(box.x + size / 2, y)
  await page.mouse.down()
  for (const q of [4, 8, 12, quarters]) await page.mouse.move(box.x + ratingX(q, size, gap) + 1, y, { steps: 4 })
  await page.mouse.up()
}

/**
 * The page never moves sideways (docs/DESIGN.md, The page does not scroll sideways): the
 * document is no wider than the viewport, and no element of the page itself sticks out of it.
 *
 * `html` and `body` clip the x axis (main.css), so the page cannot be wider whatever is
 * inside it, and `scrollWidth` alone would stay quiet about an element that is cut off. The
 * second look finds those: every element whose box leaves the viewport, except where the
 * box is meant to: inside something that scrolls or clips (the year cards, Regal's row) and
 * what is fixed to the screen (a sheet's own frame, Regal's out-of-the-row view).
 */
export async function expectNoSideScroll(page: Page, where: string) {
  const found = await page.evaluate(() => {
    const root = document.documentElement
    const width = root.clientWidth
    const clipsAt = (el: Element) => {
      if (getComputedStyle(el).position === 'fixed') return true
      for (let parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        if (getComputedStyle(parent).overflowX !== 'visible') return true
      }
      return false
    }
    const outside: string[] = []
    const name = (el: Element) => {
      const id = el.getAttribute('data-testid')
      return `${el.tagName.toLowerCase()}${id ? `[${id}]` : ''}`
    }
    for (const el of document.body.querySelectorAll('*')) {
      const box = el.getBoundingClientRect()
      if (!box.width && !box.height) continue
      if (box.right <= width + 0.5 && box.left >= -0.5) continue
      if (clipsAt(el)) continue
      outside.push(`${name(el)} ${Math.round(box.left)}…${Math.round(box.right)}`)
    }
    // A word wider than its box runs out of it without widening the box: look at the text itself.
    const words = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let node = words.nextNode(); node; node = words.nextNode()) {
      const parent = node.parentElement
      if (!parent || !node.textContent?.trim() || getComputedStyle(parent).overflowX !== 'visible' || clipsAt(parent) || parent.closest('[aria-hidden="true"]')) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const box of range.getClientRects()) {
        if (box.right <= width + 0.5 && box.left >= -0.5) continue
        outside.push(`text in ${name(parent)} ${Math.round(box.left)}…${Math.round(box.right)}`)
        break
      }
    }
    return { scrollWidth: root.scrollWidth, clientWidth: width, scrollX: window.scrollX, outside }
  })
  expect.soft(found.scrollWidth, `${where}: the document is wider than the viewport`).toBeLessThanOrEqual(found.clientWidth)
  expect.soft(found.scrollX, `${where}: the page was moved sideways`).toBe(0)
  expect.soft(found.outside, `${where}: elements stick out of the viewport`).toEqual([])
}
