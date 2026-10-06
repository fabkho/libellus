import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import type { BookSnapshot } from '../app/data/books'
import { createLibrary } from '../app/data/library'
import { IMPORT_HINT_KEY } from '../app/utils/importHint'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { expectAccessible, recordedApple, signedIn, untilStill } from './support'
import { test } from './fixtures'

/**
 * Home's offer of the import (utils/importHint.ts): a new member whose Library is empty finds
 * "Coming from Goodreads or Hardcover?" under the way to Search and goes to the Import page by
 * it; over one to three entries a smaller card with a × offers it too, once; never to a member
 * who imported (here or elsewhere) or who has a real Library, and nothing on Home moves when
 * the lists arrive. Every other flow starts with the offer out of the way (`signedIn`).
 */

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

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

/** Puts `count` Books on Want to read and shows Home as a member who opens the app finds it. */
async function addBooks(page: Page, member: Awaited<ReturnType<typeof signedIn>>, count: number) {
  const library = createLibrary(member.client)
  const entries = []
  for (let n = 0; n < count; n++) entries.push((await library.addToLibrary(book(`Offer ${n}`))).data!)
  await page.reload()
  await expect(page.getByTestId('home.title')).toBeVisible()
  return entries
}

test('a new member finds the import on the empty Home and reaches the Import page by it', async ({ page }) => {
  await signedIn(page, { importHint: true })
  const card = page.getByTestId('home.importOffer')

  // The empty state, and under it a quiet row: a heading, a line, and the whole row a real link.
  await expect(page.getByTestId('home.emptyTitle')).toHaveText(en.home.emptyTitle)
  await expect(card).toBeVisible()
  await expect(page.getByTestId('home.importOfferTitle')).toHaveText(en.home.importOffer.title)
  await expect(page.getByTestId('home.importOfferTitle')).toHaveJSProperty('tagName', 'H2')
  await expect(page.getByTestId('home.importOfferText')).toHaveText(en.home.importOffer.text)
  // The whole row is the link.
  const action = page.getByTestId('home.importOfferAction')
  await expect(action).toContainText(en.home.importOffer.title)
  await expect(action).toHaveAttribute('href', '/import')
  // The whole card has no ×: the empty Home has nothing else to hide it for, and no pop-up came.
  await expect(page.getByTestId('home.importOfferDismiss')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // The way to Search is still there, and on screen with the card.
  await expect(page.getByTestId('home.search')).toBeInViewport()
  await expect(action).toBeInViewport()

  await action.click()
  await expect(page).toHaveURL(/\/import$/)
  await expect(page.getByTestId('import.title')).toHaveText(en.import.title)
})

test('over a few entries a smaller card offers it, and a dismissal is remembered on the device', async ({ page }) => {
  const member = await signedIn(page, { importHint: true })
  await addBooks(page, member, 2)
  const card = page.getByTestId('home.importOffer')

  await expect(page.getByTestId('home.reading')).toBeVisible()
  await expect(card).toBeVisible()
  await expect(page.getByTestId('home.importOfferTitle')).toHaveText(en.home.importOffer.title)
  await expect(page.getByTestId('home.importOfferAction')).toHaveAttribute('href', '/import')
  const dismiss = page.getByTestId('home.importOfferDismiss')
  await expect(dismiss).toHaveAccessibleName(en.home.importOffer.dismiss)

  await dismiss.click()
  await expect(card).toBeHidden()
  const memory = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}'), IMPORT_HINT_KEY)
  expect(memory).toEqual({ [member.id]: 'dismissed' })

  // Gone after a reload, and with a third entry too.
  await page.reload()
  await expect(page.getByTestId('home.reading')).toBeVisible()
  await expect(card).toBeHidden()
  await addBooks(page, member, 1)
  await expect(card).toBeHidden()
})

test('no card for a member with a real Library, or one who imported before', async ({ page }) => {
  const member = await signedIn(page, { importHint: true })
  const entries = await addBooks(page, member, 4)
  await expect(page.getByTestId('home.reading')).toBeVisible()
  await expect(page.getByTestId('home.importOffer')).toHaveCount(0)

  // Down to one entry the card would be there... except that one came in through an import,
  // which the device may not know (another device): asked once, remembered, and the card goes.
  for (const entry of entries.slice(1)) await sql('delete from public.library_entries where id = $1', [entry.id])
  await sql('update public.library_entries set import_key = $1 where id = $2', [`goodreads:offer-${entries[0]!.id}`, entries[0]!.id])
  await page.reload()
  await expect(page.getByTestId('home.reading')).toBeVisible()
  await expect(page.getByTestId('home.importOffer')).toHaveCount(0)
  await expect
    .poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}'), IMPORT_HINT_KEY))
    .toEqual({ [member.id]: 'imported' })

  // And one who imported and then emptied the Library is not offered it again either.
  await sql('delete from public.library_entries where id = $1', [entries[0]!.id])
  await page.reload()
  await expect(page.getByTestId('home.emptyTitle')).toBeVisible()
  await expect(page.getByTestId('home.importOffer')).toHaveCount(0)
})

test('the card is in the first frame and nothing on Home moves when the lists arrive', async ({ page }) => {
  await signedIn(page, { importHint: true })
  // The device now holds the member's Library (it is empty), so the next start decides from it.
  await expect(page.getByTestId('home.importOffer')).toBeVisible()
  // Records, frame by frame, where the card and the search prompt are, from the page's first frame.
  await page.addInitScript(() => {
    const frames: Record<string, number | null>[] = []
    ;(window as unknown as { frames: typeof frames }).frames = frames
    const top = (id: string) => document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect().top ?? null
    const tick = () => {
      frames.push({ card: top('home.importOffer'), search: top('home.search') })
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  // The lists are asked for, slowly: whatever shows first is what the device held.
  await page.route(/\/rest\/v1\/library_entries/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600))
    await route.continue()
  })
  await page.reload()
  await expect(page.getByTestId('home.importOffer')).toBeVisible()
  await page.waitForTimeout(1200)
  const frames = await page.evaluate(() => (window as unknown as { frames: Record<string, number | null>[] }).frames)
  // Home's first frame has the card with it, before the lists have answered.
  expect(frames.find((frame) => frame.search !== null)?.card).not.toBeNull()
  const shown = frames.filter((frame) => frame.card !== null)
  expect(shown.length).toBeGreaterThan(10)
  expect(new Set(shown.map((frame) => frame.card)).size).toBe(1)
  expect(new Set(shown.map((frame) => frame.search)).size).toBe(1)
})

test('with Reduce Motion the small card still closes, without travel', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const member = await signedIn(page, { importHint: true })
  await addBooks(page, member, 1)
  await expect(page.getByTestId('home.importOffer')).toBeVisible()
  await page.getByTestId('home.importOfferDismiss').click()
  await untilStill(page)
  await expect(page.getByTestId('home.importOffer')).toHaveCount(0)
})

for (const colorScheme of ['light', 'dark'] as const) {
  test(`the offer is accessible, ${colorScheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme })
    const member = await signedIn(page, { importHint: true })
    await expect(page.getByTestId('home.importOffer')).toBeVisible()
    await expectAccessible(page, 'Home, empty, with the import offer')
    await addBooks(page, member, 2)
    await expect(page.getByTestId('home.importOffer')).toBeVisible()
    await expectAccessible(page, 'Home, a few entries, with the import offer')
  })
}
