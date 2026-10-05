import { readFileSync } from 'node:fs'
import { expect, type Locator, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import type { BookSnapshot } from '../app/data/books'
import { createAuth } from '../app/data/auth'
import { createLibrary } from '../app/data/library'
import { emailCooldown, mailCount, newClient, readMailedCode, runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { test } from './fixtures'
import { shelfOwner } from './shelfOwner'
import { signedIn } from './support'

/**
 * Your shelf (#23): Regal's 3D shelf of the owner's published library file, for
 * the owner's account only. She finds her newest Books as Regal's row in a card
 * on her Profile, and a year's in its review; a Book taken out breaks out over
 * the whole screen, and Back (the system's or the round one) puts it back
 * without leaving the page. Only with more Books than the row holds does Show
 * all open the whole shelf full screen. A file that can't be read says so and
 * tries again. Anyone else has no card, no row, no request for the file or for
 * Regal's code, and the address is a page that doesn't exist. The library file
 * is the synthetic fixture (tests/fixtures/shelf/library.json, 8 Books, 4 read
 * in 2025), answered for the published address: no flow reaches the real one.
 * With docs/parity.md (Your shelf) this is the behavioural reference.
 */

const LIBRARY_SRC = 'https://books.fabkho.dev/v2/library.json'
const FIXTURE = readFileSync(new URL('../tests/fixtures/shelf/library.json', import.meta.url), 'utf8')

const fill = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key]))
/** The plural form of a `one | many` message. */
const plural = (template: string, count: number, values: Record<string, string | number> = {}) =>
  fill(template.split(' | ')[count === 1 ? 0 : 1]!, { count, ...values })

/** More Books than the Profile's row holds (80): the fixture's, copied, a day apart going back from its newest. */
const MANY_BOOKS = 85
const MANY = (() => {
  const file = JSON.parse(FIXTURE) as { books: Record<string, unknown>[] }
  const read = file.books.filter((book) => book.status === 'read')
  const books = Array.from({ length: MANY_BOOKS }, (_, i) => ({
    ...read[i % read.length],
    id: `shelf-many-${i}`,
    dateRead: new Date(Date.UTC(2026, 8, 28 - i)).toISOString().slice(0, 10),
  }))
  return JSON.stringify({ ...file, books })
})()

/** The published library file, answered from the fixture (or `body`, or with `status`), as R2 answers it: with CORS. */
async function libraryFile(page: Page, status = 200, body = FIXTURE) {
  await page.unroute(LIBRARY_SRC).catch(() => {})
  await page.route(LIBRARY_SRC, (route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: status === 200 ? body : 'Not found',
    }),
  )
}

/** Regal's Stack inside the shelf: how many Books it lays out. */
const stackedBooks = (page: Page) => page.getByTestId('shelf.stage').locator('section[data-book-count]')

/** Regal's row in a card (the Profile's, a year in review's): its Books, and the one that is out (`data-picked`). */
const shelfRow = (page: Page, testId: string) => page.getByTestId(testId).locator('section.row-card')

/** Takes out the Book in the row's focus as the keyboard does (Enter), the same Pick a tap makes. */
async function takeOut(page: Page, row: Locator) {
  await row.scrollIntoViewIfNeeded()
  await expect(row.locator('.row-focus')).toBeAttached({ timeout: 30_000 })
  await row.locator('.row-card__scroller').focus()
  await page.keyboard.press('Enter')
  await expect(row).not.toHaveAttribute('data-picked', '')
}

/** Counts the router's navigations from now on (a Book put back must not be one). */
async function countNavigations(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const app = (document.querySelector('#__nuxt') as unknown as { __vue_app__: { config: { globalProperties: { $router: import('vue-router').Router } } } }).__vue_app__
    const counter = window as unknown as { __navigations: number }
    counter.__navigations = 0
    app.config.globalProperties.$router.beforeEach(() => {
      counter.__navigations++
    })
  })
  return () => page.evaluate(() => (window as unknown as { __navigations: number }).__navigations)
}

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

  test('finds her newest Books as a row on the Profile, takes one out over the whole screen, and Back puts it away', async ({ page }) => {
    await libraryFile(page)
    await signInAsOwner(page)

    await page.goto('/profile')
    const section = page.getByTestId('profile.shelf')
    await expect(section).toBeVisible()
    await expect(section).toContainText(en.shelf.card.title)
    await expect(page.getByTestId('profile.shelfCount')).toHaveText('8')
    // The row holds all of them: nothing to show beyond it, and nothing links to the full shelf.
    const row = shelfRow(page, 'profile.shelfRow')
    await expect(row).toHaveAttribute('data-book-count', '8')
    await expect(row).toHaveAttribute('aria-label', en.shelf.card.rowLabel)
    await expect(page.getByTestId('profile.shelfAll')).toHaveCount(0)
    await expect(page.locator('a[href^="/profile/shelf"]')).toHaveCount(0)

    // A Book taken out breaks out over the whole screen, above the header and the tab bar.
    await takeOut(page, row)
    const out = page.locator('body > .row-card__view--out')
    await expect(out).toHaveCount(1)
    expect(Number(await out.evaluate((el) => getComputedStyle(el).zIndex))).toBeGreaterThan(
      Number(await page.getByTestId('shell.tabs').evaluate((el) => getComputedStyle(el).zIndex)),
    )
    const tabs = (await page.getByTestId('shell.tabs').boundingBox())!
    const onTop = await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('[data-testid="shell.tabs"]') ?? null, [tabs.x + tabs.width / 2, tabs.y + tabs.height / 2])
    expect(onTop).toBeNull()

    // The system Back puts it back, and the Profile stays: the router never moved, and the tab bar
    // (away or not, as the page's scroll left it) didn't stir.
    const tabBar = await page.getByTestId('shell.tabs').getAttribute('data-away')
    const moves = await countNavigations(page)
    await page.goBack({ waitUntil: 'commit' })
    await expect(row).toHaveAttribute('data-picked', '')
    await expect(page.locator('.row-card__view--out')).toHaveCount(0)
    await expect(page).toHaveURL(/\/profile$/)
    await expect(page.getByTestId('profile')).toBeVisible()
    expect(await page.getByTestId('shell.tabs').getAttribute('data-away')).toBe(tabBar)
    expect(await moves()).toBe(0)

    // The Book's entry is gone with it: the next Back leaves the Profile.
    await page.goBack({ waitUntil: 'commit' })
    await expect(page.getByTestId('home.title')).toBeVisible()
  })

  test('opens the whole shelf from Show all once it holds more Books than the row', async ({ page }) => {
    await libraryFile(page, 200, MANY)
    await signInAsOwner(page)

    await page.goto('/profile')
    await expect(page.getByTestId('profile.shelfCount')).toHaveText(String(MANY_BOOKS))
    // The row holds the newest 80.
    await expect(shelfRow(page, 'profile.shelfRow')).toHaveAttribute('data-book-count', '80')
    const all = page.getByTestId('profile.shelfAll')
    await expect(all).toHaveText(en.shelf.card.all)
    await expect(all).toHaveAttribute('aria-label', plural(en.shelf.card.allLabel, MANY_BOOKS))

    await all.click()
    await expect(page).toHaveURL(/\/profile\/shelf$/)
    await expect(page.getByTestId('shelf')).toBeVisible()
    await expect(page.getByTestId('shelf.count')).toHaveText(plural(en.shelf.count, MANY_BOOKS))
    // Regal's Stack has the whole file, and the pile it stood in for has gone.
    await expect(stackedBooks(page)).toHaveAttribute('data-book-count', String(MANY_BOOKS))
    await expect(page.getByTestId('shelf.loading')).toHaveCount(0, { timeout: 30_000 })
    // The room is full screen: the tab bar has stepped away.
    await expect(page.getByTestId('shell.tabs')).toHaveAttribute('data-away', 'true')

    await page.getByTestId('shelf.back').click()
    await expect(page).toHaveURL(/\/profile$/)
    await expect(page.getByTestId('shell.tabs')).not.toHaveAttribute('data-away', 'true')
  })

  test("finds a year's Books as a row in its review, and puts a Book back with the round Back", async ({ page }) => {
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
    const row = shelfRow(page, 'yearInReview.shelfRow')
    await expect(row).toHaveAttribute('data-book-count', '4')
    await expect(row).toHaveAttribute('aria-label', fill(en.shelf.year.rowLabel, { year: 2025 }))
    // No page of its own: the row is the year's shelf.
    await expect(page.locator('a[href^="/profile/shelf"]')).toHaveCount(0)

    await takeOut(page, row)
    await expect(page.locator('body > .row-card__view--out')).toHaveCount(1)
    const moves = await countNavigations(page)
    // The details are Libellus' (regal-themed, its pills) where Regal has theming (#63).
    const details = page.locator('body > article.row-card__details')
    await expect(details).toBeVisible()
    if ((await details.getAttribute('data-regal-theme')) !== null) await expect(page.getByTestId('shelfRow.putBack')).toBeVisible()
    await page.locator('.row-card__back').click()
    await expect(row).toHaveAttribute('data-picked', '')
    await expect(page.locator('.row-card__view--out')).toHaveCount(0)
    await expect(page).toHaveURL(/\/profile\/2025$/)
    expect(await moves()).toBe(0)
    // Its history entry went with it: Back leaves the year.
    await page.goBack({ waitUntil: 'commit' })
    await expect(page).not.toHaveURL(/\/profile\/2025$/)
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

    await page.goto('/profile')
    await expect(page.getByTestId('profile.shelfError')).toContainText(en.shelf.loadError)
    await expect(page.getByTestId('profile.shelfRow')).toHaveCount(0)

    await libraryFile(page)
    await page.getByTestId('profile.shelfRetry').click()
    await expect(page.getByTestId('profile.shelfError')).toHaveCount(0)
    await expect(shelfRow(page, 'profile.shelfRow')).toHaveAttribute('data-book-count', '8')
  })
})

// Nuxt's own page for an address that doesn't exist is not a Libellus screen (its link home has no test ID).
const anyone = test.extend<{ everyControlHasATestId: void }>({ everyControlHasATestId: [async ({}, use) => use(), { auto: true }] })

anyone('nobody else has a shelf: no card, no row, no file, no Regal, no address', async ({ page }) => {
  const asked: string[] = []
  // The file, and Regal's code: the built `regal` chunk, or (the dev server) its components and the two of Libellus' that import them.
  const regal = /\/regal\.[^/]*\.js$|\/components\/regal\/|\/components\/shelf\/(?:Row|Stage)\.vue/
  page.on('request', (request) => {
    const url = request.url()
    if (url.startsWith('https://books.fabkho.dev/') || regal.test(new URL(url).pathname)) asked.push(url)
  })
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
