import { readFileSync } from 'node:fs'
import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import type { BookSnapshot } from '../app/data/books'
import { createAuth } from '../app/data/auth'
import { createLibrary } from '../app/data/library'
import { emailCooldown, mailCount, newClient, readMailedCode, runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { test } from './fixtures'
import { shelfOwner } from './shelfOwner'
import { signedIn } from './support'

/**
 * Your shelf (#23): Regal's 3D Stack of the owner's published library file,
 * for the owner's account only. She finds it on her Profile (a card with the
 * count), opens it full screen, and finds that year's Books stacked in a year in
 * review, which opens full screen too. A file that can't be read says so and
 * tries again. Anyone else has no card, no stack, no request for the file, and
 * the address is a page that doesn't exist. The library file is the synthetic
 * fixture (tests/fixtures/shelf/library.json, 8 Books, 4 read in 2025), answered
 * for the published address: no flow reaches the real one. With docs/parity.md
 * (Your shelf) this is the behavioural reference.
 */

const LIBRARY_SRC = 'https://books.fabkho.dev/v2/library.json'
const FIXTURE = readFileSync(new URL('../tests/fixtures/shelf/library.json', import.meta.url), 'utf8')

const fill = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key]))
/** The plural form of a `one | many` message. */
const plural = (template: string, count: number, values: Record<string, string | number> = {}) =>
  fill(template.split(' | ')[count === 1 ? 0 : 1]!, { count, ...values })

/** The published library file, answered from the fixture (or with `status`), as R2 answers it: with CORS. */
async function libraryFile(page: Page, status = 200) {
  await page.unroute(LIBRARY_SRC).catch(() => {})
  await page.route(LIBRARY_SRC, (route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: status === 200 ? FIXTURE : 'Not found',
    }),
  )
}

/** Regal's Stack inside the shelf: how many Books it lays out. */
const stackedBooks = (page: Page) => page.getByTestId('shelf.stage').locator('section[data-book-count]')

/** Signs the owner in through the screens (she exists; a code is mailed to her). */
async function signInAsOwner(page: Page) {
  const owner = await shelfOwner()
  await emailCooldown()
  const before = await mailCount(owner.email)
  await page.goto('/sign-in')
  await page.getByTestId('signIn.email').fill(owner.email)
  await page.getByTestId('signIn.submit').click()
  await expect(page).toHaveURL(/\/verify$/)
  await page.getByTestId('verify.code').fill(await readMailedCode(owner.email, before + 1))
  await expect(page.getByTestId('home.title')).toBeVisible()
  return owner
}

/** One finished read in 2025 in the owner's Library, so 2025 has a year in review. */
async function finishedIn2025(email: string) {
  const client = newClient()
  const auth = createAuth(client)
  await emailCooldown()
  const before = await mailCount(email)
  await auth.requestCode(email)
  const verified = await auth.verifyCode(email, await readMailedCode(email, before + 1))
  if (verified.error) throw new Error(`Owner sign-in failed: ${verified.error}`)
  const book: BookSnapshot = {
    title: runTitle('The Glass Orchard'),
    authors: ['Mira Holloway'],
    isbn13: null,
    isbn10: null,
    pageCount: 412,
    year: 2024,
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
  const entry = (await createLibrary(client).addToLibrary(book)).data!
  await sql(`insert into public.reading_sessions (entry_id, started_on, ended_on, outcome, rating) values ($1, '2025-11-02', '2025-11-20', 'finished', 18)`, [entry.id])
}

/** The brightness (0–1) of a computed `rgb(r, g, b)` colour. */
function brightness(rgb: string) {
  const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).map(Number)
  return (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255
}

// Regal's own buttons in the panel (before its theming slots, fabkho/regal#63) carry no test ID.
const regalOwnControls = test.extend<{ everyControlHasATestId: void }>({ everyControlHasATestId: [async ({}, use) => use(), { auto: true }] })

test.describe('Your shelf, the owner', () => {
  // One owner (one id) for the whole run: her flows take turns.
  test.describe.configure({ mode: 'serial' })

  test('finds her shelf on the Profile and opens it full screen', async ({ page }) => {
    await libraryFile(page)
    await signInAsOwner(page)

    await page.goto('/profile')
    const card = page.getByTestId('profile.shelf')
    await expect(card).toBeVisible()
    await expect(card).toContainText(en.shelf.card.title)
    await expect(page.getByTestId('profile.shelfCount')).toHaveText('8')
    await expect(card).toHaveAttribute('aria-label', plural(en.shelf.card.label, 8))

    await card.click()
    await expect(page).toHaveURL(/\/profile\/shelf$/)
    await expect(page.getByTestId('shelf')).toBeVisible()
    await expect(page.getByTestId('shelf.count')).toHaveText(plural(en.shelf.count, 8))
    // Regal's Stack has the whole file, and the pile it stood in for has gone.
    await expect(stackedBooks(page)).toHaveAttribute('data-book-count', '8')
    await expect(page.getByTestId('shelf.loading')).toHaveCount(0, { timeout: 30_000 })
    // The room is full screen: the tab bar has stepped away.
    await expect(page.getByTestId('shell.tabs')).toHaveAttribute('data-away', 'true')

    await page.getByTestId('shelf.back').click()
    await expect(page).toHaveURL(/\/profile$/)
    await expect(page.getByTestId('shell.tabs')).not.toHaveAttribute('data-away', 'true')
  })

  test("finds a year's Books stacked in its review, and opens them full screen", async ({ page }) => {
    await libraryFile(page)
    const owner = await signInAsOwner(page)
    await finishedIn2025(owner.email)

    await page.goto('/profile/2025')
    const section = page.getByTestId('yearInReview.shelf')
    await expect(section).toBeVisible()
    await expect(section).toContainText(en.shelf.year.title)
    await expect(page.getByTestId('yearInReview.shelfCount')).toHaveText('4')
    // Under the months.
    const months = await page.getByTestId('yearInReview.months').boundingBox()
    expect((await section.boundingBox())!.y).toBeGreaterThan(months!.y)

    await page.getByTestId('yearInReview.shelfOpen').click()
    await expect(page).toHaveURL(/\/profile\/shelf\?year=2025/)
    await expect(page.getByTestId('shelf.count')).toHaveText(plural(en.shelf.yearCount, 4, { year: 2025 }))
    await expect(stackedBooks(page)).toHaveAttribute('data-book-count', '4')

    // Back is the year it came from.
    await page.getByTestId('shelf.back').click()
    await expect(page).toHaveURL(/\/profile\/2025/)
  })

  // The panel of a Book that is out is in <body>, outside the room: it must still wear the room's
  // theme (`theme="auto"`, regal-themed.css), dark in the room whatever the app's theme is (the app
  // is light here), and follow the room live. Regal's `data-regal-theme` says which it resolved; a
  // Regal without theming (its main, until #63) has none and keeps its own look.
  regalOwnControls('the Book detail panel wears the room, and follows it when it changes', async ({ page }) => {
    await libraryFile(page)
    await signInAsOwner(page)

    // `debug=pick`: Regal tells where a Book stands, so the tap lands on one.
    await page.goto('/profile/shelf?debug=pick')
    await expect(stackedBooks(page)).toHaveAttribute('data-book-count', '8')
    await expect(page.getByTestId('shelf.loading')).toHaveCount(0, { timeout: 30_000 })
    await expect.poll(() => page.evaluate(() => (window as any).__regalPick?.clickableBooks().length ?? 0), { timeout: 30_000 }).toBeGreaterThan(0)
    const book = await page.evaluate(() => (window as any).__regalPick.clickableBooks()[0] as { x: number; y: number })
    await page.touchscreen.tap(book.x, book.y)

    const panel = page.locator('article.details')
    await expect(panel).toBeVisible()
    const regalThemes = (await panel.getAttribute('data-regal-theme')) !== null
    test.info().annotations.push({ type: 'regal-theming', description: regalThemes ? 'Regal with theming (#63)' : 'Regal without theming: look not asserted' })
    if (!regalThemes) return

    const background = () => panel.evaluate((element) => getComputedStyle(element).backgroundColor)
    await expect(panel).toHaveAttribute('data-regal-theme', 'dark')
    expect(brightness(await background())).toBeLessThan(0.2)
    // Libellus' own buttons, not Regal's.
    await expect(page.getByTestId('shelf.putBack')).toBeVisible()

    // The room's theme flips (the shelf page itself never does; this is the hook Regal watches).
    const room = page.getByTestId('shelf')
    await room.evaluate((element) => element.setAttribute('data-theme', 'light'))
    await expect(panel).toHaveAttribute('data-regal-theme', 'light')
    expect(brightness(await background())).toBeGreaterThan(0.8)
    await room.evaluate((element) => element.setAttribute('data-theme', 'dark'))
    await expect(panel).toHaveAttribute('data-regal-theme', 'dark')
    expect(brightness(await background())).toBeLessThan(0.2)

    // Put back, with Libellus' button.
    await page.getByTestId('shelf.putBack').click()
    await expect(panel).toHaveCount(0)
  })

  test('says so when the file cannot be read, and tries again', async ({ page }) => {
    await libraryFile(page, 500)
    await signInAsOwner(page)

    await page.goto('/profile/shelf')
    await expect(page.getByTestId('shelf.error')).toContainText(en.shelf.loadError)
    await expect(page.getByTestId('shelf.stage')).toHaveCount(0)

    await libraryFile(page)
    await page.getByTestId('shelf.retry').click()
    await expect(page.getByTestId('shelf.error')).toHaveCount(0)
    await expect(stackedBooks(page)).toHaveAttribute('data-book-count', '8')
  })
})

// Nuxt's own page for an address that doesn't exist is not a Libellus screen (its link home has no test ID).
const anyone = test.extend<{ everyControlHasATestId: void }>({ everyControlHasATestId: [async ({}, use) => use(), { auto: true }] })

anyone('nobody else has a shelf: no card, no stack, no file, no address', async ({ page }) => {
  const asked: string[] = []
  page.on('request', (request) => request.url().startsWith('https://books.fabkho.dev/') && asked.push(request.url()))
  await libraryFile(page)
  await signedIn(page)

  await page.goto('/profile')
  await expect(page.getByTestId('profile.empty')).toBeVisible()
  await expect(page.getByTestId('profile.shelf')).toHaveCount(0)

  await page.goto('/profile/2025')
  await expect(page.getByTestId('yearInReview')).toBeVisible()
  await expect(page.getByTestId('yearInReview.shelf')).toHaveCount(0)

  // The address is a page that doesn't exist, like any other unknown one.
  await page.goto('/profile/shelf')
  await expect(page.getByText('404').first()).toBeVisible()
  await expect(page.getByTestId('shelf')).toHaveCount(0)

  expect(asked).toEqual([])
})
