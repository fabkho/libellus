import { readFileSync } from 'node:fs'
import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import type { BookSnapshot } from '../app/data/books'
import { createAuth } from '../app/data/auth'
import { createLibrary } from '../app/data/library'
import { createReadingPages } from '../app/data/readingPage'
import { isoDay } from '../app/utils/dates'
import { signUpMember } from '../tests/support/member'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { test } from './fixtures'
import { SHELF_LIBRARY_SRC, shelfOwner } from './shelfOwner'
import { expectAccessible, expectNoSideScroll, signedIn, untilStill } from './support'

/**
 * Share with friends (issue #171): a member's public reading page and her Book
 * cards. She turns the page on in Profile → Share, picks its sections and
 * shares a Book from its options, with or without her review. Anyone with the
 * link, signed out, reads only what she turned on; a new link (or turning it
 * off) leaves the old one on "This page isn't here". Her shelf is a row of
 * covers; the owner's is Regal's 3D row from the published library file (only
 * in a build with Regal). The pages are scanned for accessibility in the light
 * and the dark room. With docs/parity.md (Reading page) this is the
 * behavioural reference.
 */

const fill = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key]))
/** Regal's code: the built `regal` chunk, or (the dev server) its components and the two of Libellus' that import them. */
const REGAL_CODE = /\/regal\.[^/]*\.js$|\/components\/regal\/|\/components\/shelf\/(?:Row|Stage)\.vue/

function book(title: string): BookSnapshot {
  return {
    title: runTitle(title),
    authors: ['Ursula K. Le Guin'],
    isbn13: null,
    isbn10: null,
    pageCount: 300,
    year: 1969,
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

/** A member named Ada with a Book being read, two finished (one with a review) and one wanted; her page on. */
async function adaWithAPage() {
  const ada = await signUpMember()
  await createAuth(ada.client).setName('Ada')
  const library = createLibrary(ada.client)
  const today = isoDay()
  const reading = (await library.addToLibrary(book('Reading Now'), { status: 'reading', startedOn: today })).data!
  const loved = (await library.addToLibrary(book('Loved It'), { status: 'finished', startedOn: today, endedOn: today, rating: 19, review: 'Cold, strange and kind.' })).data!
  const fine = (await library.addToLibrary(book('Fine Book'), { status: 'finished', startedOn: today, endedOn: today, rating: 12 })).data!
  const wanted = (await library.addToLibrary(book('Wanted Later'))).data!
  const pages = createReadingPages(ada.client)
  const token = (await pages.setOn(true)).data!.token!
  return { ada, pages, token, reading, loved, fine, wanted }
}

async function expectAccessibleBoth(page: Page, where: string) {
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    await expectAccessible(page, `${where} (${colorScheme})`)
  }
}

test.describe('a reading page, signed out', () => {
  test('shows what she turned on, opens a Book card, and asks her for an invite', async ({ page }) => {
    const { token, reading, loved, fine } = await adaWithAPage()
    await page.goto(`/r/${token}`)

    await expect(page.getByTestId('readingPage.title')).toHaveText(fill(en.readingPage.title, { name: 'Ada' }))
    await expect(page).toHaveTitle(`${fill(en.readingPage.title, { name: 'Ada' })} · ${en.app.name}`)
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
    await expect(page.getByTestId('readingPage.readingRow')).toContainText(reading.book.title)
    await expect(page.getByTestId('readingPage.year')).toBeVisible()
    await expect(page.getByTestId('readingPage.favouritesRow')).toContainText(loved.book.title)
    await expect(page.getByTestId('readingPage.favouritesRow')).not.toContainText(fine.book.title)
    await expect(page.getByTestId('readingPage.finished')).toContainText(fine.book.title)
    // Her review is hers until she shares it.
    await expect(page.getByTestId('readingPage.review')).toHaveCount(0)
    // Her shelf, not the owner's: a row of covers, and Regal is never fetched.
    await expect(page.getByTestId('readingPage.shelfCovers.book')).toHaveCount(2)
    await expect(page.getByTestId('readingPage.shelfRow')).toHaveCount(0)
    await expectNoSideScroll(page, 'reading page')
    await expectAccessibleBoth(page, 'reading page')

    // The footer: no form, no address; how to get in.
    await expect(page.getByTestId('readingPage.inviteText')).toBeHidden()
    await page.getByTestId('readingPage.invite').click()
    await expect(page.getByTestId('readingPage.inviteText')).toContainText(fill(en.readingPage.footer.inviteText, { name: 'Ada' }))

    await page.getByTestId('readingPage.finishedBook').filter({ hasText: loved.book.title }).click()
    await expect(page).toHaveURL(new RegExp(`/r/${token}/book/${loved.book.id}$`))
    await expect(page.getByTestId('bookCard.title')).toHaveText(loved.book.title)
    await expect(page.getByTestId('bookCard.rating')).toContainText(fill(en.readingPage.card.rating, { name: 'Ada' }))
    await expect(page.getByTestId('bookCard.review')).toHaveCount(0)
    await expectAccessibleBoth(page, 'Book card')

    await page.getByTestId('bookCard.page').click()
    await expect(page).toHaveURL(new RegExp(`/r/${token}$`))
    await expect(page.getByTestId('readingPage.title')).toBeVisible()
  })

  test('is gone at its old address once she makes a new link, and so are its cards', async ({ page }) => {
    const { pages, token, loved } = await adaWithAPage()
    await page.goto(`/r/${token}`)
    await expect(page.getByTestId('readingPage.title')).toBeVisible()

    const renewed = (await pages.renewLink()).data!.token!
    await page.reload()
    await expect(page.getByTestId('readingPage.missing')).toContainText(en.readingPage.missing.title)
    await expect(page.getByTestId('readingPage.title')).toHaveCount(0)
    await expectAccessibleBoth(page, 'a dead reading page')
    await page.goto(`/r/${token}/book/${loved.book.id}`)
    await expect(page.getByTestId('bookCard.missing')).toBeVisible()

    await page.goto(`/r/${renewed}`)
    await expect(page.getByTestId('readingPage.title')).toBeVisible()
    await pages.setOn(false)
    await page.reload()
    await expect(page.getByTestId('readingPage.missing')).toBeVisible()
    // Signed out, nothing sent her to sign in.
    await expect(page).toHaveURL(new RegExp(`/r/${renewed}$`))
  })
})

test.describe('her side', () => {
  test('she turns her page on in Profile → Share, picks its sections, and shares a Book with her review', async ({ page }) => {
    const member = await signedIn(page)
    await createAuth(member.client).setName('Bea')
    const library = createLibrary(member.client)
    const today = isoDay()
    const loved = (await library.addToLibrary(book('Shared Review'), { status: 'finished', startedOn: today, endedOn: today, rating: 18, review: 'Worth every page.' })).data!

    await page.goto('/profile')
    await expect(page.getByTestId('profile.readingPageValue')).toHaveText(en.sharing.rowOff)
    await page.getByTestId('profile.readingPage').click()
    await expect(page.getByTestId('sharing.on')).toHaveAttribute('aria-checked', 'false')
    await expect(page.getByTestId('sharing.link')).toHaveCount(0)
    await expectAccessibleBoth(page, 'Share sheet, off')

    await page.getByTestId('sharing.on').click()
    await expect(page.getByTestId('sharing.on')).toHaveAttribute('aria-checked', 'true')
    const link = (await page.getByTestId('sharing.link').textContent())!.trim()
    expect(link).toMatch(/\/r\/[A-Za-z0-9_-]{22}$/)
    await page.getByTestId('sharing.section.year').click()
    await expect(page.getByTestId('sharing.section.year')).toHaveAttribute('aria-checked', 'false')
    await expectAccessibleBoth(page, 'Share sheet, on')
    await page.keyboard.press('Escape')
    await untilStill(page)
    await expect(page.getByTestId('profile.readingPageValue')).toHaveText(en.sharing.rowOn)

    // The Book's options → Share, with her review.
    await page.goto(`/book/${loved.book.id}`)
    await page.getByTestId('book.options').click()
    await page.getByTestId('bookOptions.share').click()
    await expect(page.getByTestId('shareBook.review')).toHaveAttribute('aria-checked', 'false')
    await page.getByTestId('shareBook.review').click()
    await expectAccessibleBoth(page, 'Share book sheet')
    await page.getByTestId('shareBook.copy').click()
    await expect.poll(async () => (await sql<{ review: boolean }>('select review from public.reading_page_books where member_id = $1', [member.id]))[0]?.review).toBe(true)

    // Her page, as anyone (signed in or not, nobody is sent away): no year, her review on.
    await page.goto(new URL(link).pathname)
    await expect(page.getByTestId('readingPage.title')).toHaveText(fill(en.readingPage.title, { name: 'Bea' }))
    await expect(page.getByTestId('readingPage.year')).toHaveCount(0)
    await expect(page.getByTestId('readingPage.review')).toHaveText('Worth every page.')
    await page.goto(`${new URL(link).pathname}/book/${loved.book.id}`)
    await expect(page.getByTestId('bookCard.review')).toContainText('Worth every page.')
  })

  test('with her page off, a Book\'s Share offers to turn it on', async ({ page }) => {
    const member = await signedIn(page)
    const wanted = (await createLibrary(member.client).addToLibrary(book('Not Yet'))).data!
    await page.goto(`/book/${wanted.book.id}`)
    await page.getByTestId('book.options').click()
    await page.getByTestId('bookOptions.share').click()
    await expect(page.getByTestId('shareBook.off')).toHaveText(en.sharing.book.off)
    await page.getByTestId('shareBook.turnOn').click()
    await expect(page.getByTestId('shareBook.copy')).toBeVisible()
    // No review on a Book she has not read: nothing to include.
    await expect(page.getByTestId('shareBook.review')).toHaveCount(0)
  })
})

test.describe('the owner\'s shelf', () => {
  // Only a build with Regal has it (LIBELLUS_REGAL=1, web/regal.config.ts; CI sets it).
  test.skip(!/^(1|true)$/i.test(process.env.LIBELLUS_REGAL ?? ''), 'The owner\'s shelf needs Regal: LIBELLUS_REGAL=1 and the layer')

  test('is Regal\'s 3D row on her reading page, from the published library file', async ({ page }) => {
    const owner = await shelfOwner()
    const fixture = readFileSync(new URL('../tests/fixtures/shelf/library.json', import.meta.url), 'utf8')
    await page.route(SHELF_LIBRARY_SRC, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: fixture }),
    )
    // Whose Library the published shelf is (#110), for this flow only.
    const [before] = await sql<{ owner_id: string | null }>('select owner_id from private.shelf_publish')
    const token = `e2eOwner${uniqueAppleId().slice(-14).padStart(14, '0')}`
    await sql('update private.shelf_publish set owner_id = $1', [owner.id])
    await sql(
      `insert into public.reading_pages (member_id, token) values ($1, $2)
       on conflict (member_id) do update set token = excluded.token, show_shelf = true`,
      [owner.id, token],
    )
    try {
      const regal: string[] = []
      page.on('request', (request) => REGAL_CODE.test(request.url()) && regal.push(request.url()))
      await page.goto(`/r/${token}`)
      await expect(page.getByTestId('readingPage.shelfRow')).toBeVisible()
      await expect(page.getByTestId('readingPage.shelfCovers')).toHaveCount(0)
      await expect.poll(() => regal.length).toBeGreaterThan(0)
    } finally {
      await sql('update private.shelf_publish set owner_id = $1', [before?.owner_id ?? null])
      await sql('delete from public.reading_pages where member_id = $1', [owner.id])
    }
  })
})
