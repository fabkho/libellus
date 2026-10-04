import { expect, type Locator, type Page } from '@playwright/test'
import { ratingX } from '../app/utils/rating'
import { appleAnswer, appleCover } from '../tests/support/apple'
import { openLibraryAnswer } from '../tests/support/openLibrary'
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

/** Signs a fresh member in through the screens: address, then the mailed code. */
export async function signedIn(page: Page) {
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
