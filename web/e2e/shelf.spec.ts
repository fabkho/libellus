import { readFileSync } from 'node:fs'
import { expect, type Locator, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import type { BookSnapshot } from '../app/data/books'
import { createAuth } from '../app/data/auth'
import { createLibrary } from '../app/data/library'
import { isoDay } from '../app/utils/dates'
import { emailCooldown, mailCount, newClient, readMailedCode, runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { test } from './fixtures'
import { shelfOwner } from './shelfOwner'
import { signedIn } from './support'

/**
 * Your shelf (#23): Regal's 3D shelf of the owner's published library file, for
 * the owner's account only. She finds her newest Books as Regal's row in a card
 * on her Profile, and a year's in its review; a Book taken out breaks out over
 * the whole screen, and the sheet's Done, Escape or the system's Back puts it
 * back without leaving the page (Regal's round Back is off). Only with more
 * Books than the row holds does Show all open the whole shelf full screen. A file that can't be read says so and
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

/** The current year (Home's tally counts it), and the fixture with nine Books read in it, a month apart: Home's sheet shows that year's. */
const YEAR = Number(isoDay().slice(0, 4))
const THIS_YEAR = (() => {
  const file = JSON.parse(FIXTURE) as { books: Record<string, unknown>[] }
  const read = file.books.filter((book) => book.status === 'read')
  const books = Array.from({ length: 9 }, (_, i) => ({ ...read[i % read.length], id: `shelf-year-${i}`, dateRead: `${YEAR}-${String(i + 1).padStart(2, '0')}-12` }))
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

/** The owner as a client of the Library (she exists; a code is mailed to her). */
async function ownerClient(email: string) {
  const client = newClient()
  const auth = createAuth(client)
  await emailCooldown()
  const before = await mailCount(email)
  await auth.requestCode(email)
  const verified = await auth.verifyCode(email, await readMailedCode(email, before + 1))
  if (verified.error) throw new Error(`Owner sign-in failed: ${verified.error}`)
  return client
}

/** A Book for the Library, found on Apple Books and unique to the run. */
function snapshot(title: string, author: string, pages: number): BookSnapshot {
  return {
    title: runTitle(title),
    authors: [author],
    isbn13: null,
    isbn10: null,
    pageCount: pages,
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
}

/** One finished read in 2025 in the owner's Library, so 2025 has a year in review. */
async function finishedIn2025(email: string) {
  const client = await ownerClient(email)
  const entry = (await createLibrary(client).addToLibrary(snapshot('The Glass Orchard', 'Mira Holloway', 412))).data!
  await sql(`insert into public.reading_sessions (entry_id, started_on, ended_on, outcome, rating) values ($1, '2025-11-02', '2025-11-20', 'finished', 18)`, [entry.id])
}

/** Finished reads in the current year in a member's Library (Home's tally counts them), one per title, the first ending today. */
async function finishedThisYear(client: Parameters<typeof createLibrary>[0], titles: string[]) {
  const library = createLibrary(client)
  for (const [i, title] of titles.entries()) {
    const entry = (await library.addToLibrary(snapshot(title, 'Mira Holloway', 300))).data!
    const ended = i === 0 ? isoDay() : `${YEAR}-01-0${i}`
    await sql(`insert into public.reading_sessions (entry_id, started_on, ended_on, outcome, rating) values ($1, $2, $3, 'finished', 16)`, [entry.id, `${YEAR}-01-01`, ended])
  }
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

  test('finds her newest Books as a row on the Profile, takes one out over the whole screen, and the system Back puts it away', async ({ page }) => {
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

    // The row fills Libellus' card edge to edge: no second frame of Regal's inside it.
    expect(await row.evaluate((el) => [getComputedStyle(el).borderTopWidth, getComputedStyle(el).borderRadius])).toEqual(['0px', '0px'])

    // A Book taken out breaks out over the whole screen, above the header and the tab bar.
    // (Android's gesture navigation, 24 px, stood in for the device's inset as e2e/insets.spec.ts does.)
    await page.addStyleTag({ content: ':root { --safe-area-bottom: 24px; }' })
    await takeOut(page, row)
    const out = page.locator('body > .row-card__view--out')
    await expect(out).toHaveCount(1)
    // The phone's sheet is Libellus' (Done, the action in the lamp colour, no pills) and clears the gesture bar.
    const sheet = page.locator('body > article.row-card__details--sheet')
    if (await sheet.count()) {
      expect(Number.parseFloat(await sheet.evaluate((el) => getComputedStyle(el).paddingBottom))).toBeGreaterThanOrEqual(24)
      await expect(page.getByTestId('shelfRow.putBack')).toHaveText(en.shelf.detail.done)
      // One grabber (Regal's, UiSheet's size), the sheet's own and a bare container: no frame, the app's sheet corners.
      await expect(page.locator('.row-card__grabber')).toHaveCount(1)
      const frame = await sheet.evaluate((el) => [getComputedStyle(el).borderTopWidth, getComputedStyle(el).borderTopLeftRadius])
      expect(frame[0]).toBe('0px')
      expect(Number.parseFloat(frame[1]!)).toBeGreaterThan(0)
      await expect(page.getByTestId('shelfRow.flip')).toHaveText(en.shelf.detail.backCover)
      await page.getByTestId('shelfRow.flip').click()
      await expect(page.getByTestId('shelfRow.flip')).toHaveText(en.shelf.detail.frontCover)
    }
    // Regal's round Back is off: the sheet's Done is the way back.
    await expect(page.locator('.row-card__back')).toHaveCount(0)
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

  test("finds a year's Books as a row in its review, and puts a Book back with Done or Escape", async ({ page }) => {
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
    // The details are Libellus' (regal-themed): the sheet's Done is the one way back that shows, no round Back.
    const details = page.locator('body > article.row-card__details')
    await expect(details).toBeVisible()
    await expect(page.locator('.row-card__back')).toHaveCount(0)
    await page.getByTestId('shelfRow.putBack').click()
    await expect(row).toHaveAttribute('data-picked', '')
    await expect(page.locator('.row-card__view--out')).toHaveCount(0)
    // The Book is back in the row and can be taken out again; Escape puts it back too.
    await takeOut(page, row)
    await expect(page.locator('body > .row-card__view--out')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(page.locator('.row-card__view--out')).toHaveCount(0)
    await expect(page).toHaveURL(/\/profile\/2025$/)
    expect(await moves()).toBe(0)
    // Its history entry went with it: Back leaves the year.
    await page.goBack({ waitUntil: 'commit' })
    await expect(page).not.toHaveURL(/\/profile\/2025$/)
  })

  test("Home's Read in tally opens the year's Books as her row alone: a Book breaks out above the sheet, Back puts it away and then closes the sheet", async ({ page }) => {
    await libraryFile(page, 200, THIS_YEAR)
    const owner = await signInAsOwner(page)
    await finishedThisYear(await ownerClient(owner.email), ['Home Tally One', 'Home Tally Two'])
    await page.reload()

    // The tally is a button now (she has read this year); the sheet is closed.
    const tally = page.getByTestId('home.tally')
    await expect(tally).toHaveAttribute('aria-haspopup', 'dialog')
    await expect(page.getByTestId('homeTally')).toHaveCount(0)
    await tally.click()
    const sheet = page.getByTestId('homeTally')
    await expect(sheet).toBeVisible()
    await expect(page.getByTestId('homeTally.sheetTitle')).toHaveText(fill(en.home.readIn, { year: YEAR }))

    // Her row of that year's Books and the link on to the review: nothing else, no list of reads, and the card bare.
    const row = shelfRow(page, 'homeTally.shelfRow')
    await expect(row).toHaveAttribute('data-book-count', '9')
    await expect(row).toHaveAttribute('aria-label', fill(en.shelf.year.rowLabel, { year: YEAR }))
    await expect(page.getByTestId('homeTally.read')).toHaveCount(0)
    const card = page.getByTestId('homeTally.shelfRow')
    expect(await card.evaluate((el) => getComputedStyle(el).boxShadow)).toBe('none')
    expect(await card.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
    await expect(page.getByTestId('homeTally.yearInReview')).toHaveText(en.home.yearInReview)

    // A Book taken out breaks out above the sheet (z 50), not under it.
    await takeOut(page, row)
    const out = page.locator('body > .row-card__view--out')
    await expect(out).toHaveCount(1)
    expect(Number(await out.evaluate((el) => getComputedStyle(el).zIndex))).toBeGreaterThan(
      Number(await sheet.evaluate((el) => getComputedStyle(el).zIndex)),
    )
    const middle = { x: 206, y: 400 }
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid="homeTally"]') ?? null, middle)).toBeNull()

    // The system Back puts the Book back and leaves the sheet; the next one closes the sheet. The router never moves.
    const moves = await countNavigations(page)
    await page.goBack({ waitUntil: 'commit' })
    await expect(row).toHaveAttribute('data-picked', '')
    await expect(page.locator('.row-card__view--out')).toHaveCount(0)
    await expect(sheet).toBeVisible()
    await page.goBack({ waitUntil: 'commit' })
    await expect(sheet).toBeHidden()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByTestId('home.title')).toBeVisible()
    expect(await moves()).toBe(0)

    // Done puts it back too, and the sheet stays until it is closed with its Cancel.
    await tally.click()
    await takeOut(page, shelfRow(page, 'homeTally.shelfRow'))
    await page.getByTestId('shelfRow.putBack').click()
    await expect(page.locator('.row-card__view--out')).toHaveCount(0)
    await expect(sheet).toBeVisible()

    // The link at the end opens the year in review.
    await page.getByTestId('homeTally.yearInReview').click()
    await expect(page).toHaveURL(new RegExp(`/profile/${YEAR}$`))
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

anyone("nobody else's tally opens the shelf: the year's Books without the row, no file, no Regal", async ({ page }) => {
  const asked: string[] = []
  const regal = /\/regal\.[^/]*\.js$|\/components\/regal\/|\/components\/shelf\/(?:Row|Stage)\.vue/
  page.on('request', (request) => {
    const url = request.url()
    if (url.startsWith('https://books.fabkho.dev/') || regal.test(new URL(url).pathname)) asked.push(url)
  })
  await libraryFile(page, 200, THIS_YEAR)
  const member = await signedIn(page)
  const title = runTitle('Home Tally Anyone')
  await finishedThisYear(member.client, ['Home Tally Anyone'])
  await page.reload()

  await page.getByTestId('home.tally').click()
  await expect(page.getByTestId('homeTally')).toBeVisible()
  await expect(page.getByTestId('homeTally.sheetTitle')).toHaveText(fill(en.home.readIn, { year: YEAR }))
  await expect(page.getByTestId('homeTally.read').getByTestId('profile.readTitle')).toHaveText([title])
  await expect(page.getByTestId('homeTally.shelfRow')).toHaveCount(0)
  await expect(page.getByTestId('homeTally.yearInReview')).toBeVisible()

  // A read still opens its Book, and the link goes on to the review.
  await page.getByTestId('homeTally.yearInReview').click()
  await expect(page).toHaveURL(new RegExp(`/profile/${YEAR}$`))
  expect(asked).toEqual([])
})
