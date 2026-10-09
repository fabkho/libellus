import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import type { BookSnapshot } from '../app/data/books'
import { createAuth } from '../app/data/auth'
import { createLibrary } from '../app/data/library'
import { createReadingPages } from '../app/data/readingPage'
import { isoDay } from '../app/utils/dates'
import { signUpMember } from '../tests/support/member'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId, uniqueEmail, visitorAddress } from '../tests/support/stack'
import { test } from './fixtures'
import { expectAccessible, expectNoSideScroll, signedIn, untilStill } from './support'

/**
 * Share with friends (issue #171): a member's public reading page and her Book
 * cards. She turns the page on in Profile → Share, picks its sections and
 * shares a Book from its options, with or without her review. Anyone with the
 * link, signed out, reads only what she turned on; a new link (or turning it
 * off) leaves the old one on "This page isn't here". The waitlist form on it
 * takes an address. The pages are scanned for accessibility in the dark room
 * (docs/ACCESSIBILITY.md). With docs/parity.md (Reading page) this is the
 * behavioural reference.
 */

const fill = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key]))
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

/** One theme, dark (docs/ACCESSIBILITY.md): the page takes the viewer's own, and the tokens are checked in both. */
async function expectAccessibleDark(page: Page, where: string) {
  await page.emulateMedia({ colorScheme: 'dark' })
  await expectAccessible(page, `${where} (dark)`)
}

test.describe('a reading page, signed out', () => {
  test('shows what she turned on and opens a Book card', async ({ page }) => {
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
    await expectAccessibleDark(page, 'reading page')

    // The footer: the waitlist form, and a way in for whoever has a code.
    await expect(page.getByTestId('readingPage.waitlist')).toContainText(en.readingPage.waitlist.text)
    await expect(page.getByTestId('readingPage.signUp')).toHaveText(en.readingPage.footer.signUp)

    await page.getByTestId('readingPage.finishedBook').filter({ hasText: loved.book.title }).click()
    await expect(page).toHaveURL(new RegExp(`/r/${token}/book/${loved.book.id}$`))
    await expect(page.getByTestId('bookCard.title')).toHaveText(loved.book.title)
    await expect(page.getByTestId('bookCard.rating')).toContainText(fill(en.readingPage.card.rating, { name: 'Ada' }))
    await expect(page.getByTestId('bookCard.review')).toHaveCount(0)
    await expectAccessibleDark(page, 'Book card')

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
    await expectAccessibleDark(page, 'a dead reading page')
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

test.describe('the waitlist on a reading page, signed out', () => {
  // The limits count a caller by the address its request came from, and every flow here calls from the same
  // machine: each flow's browser calls as an address of its own (what Cloudflare would set in front of the API).
  const visitingAs = async (page: Page, address = visitorAddress()) => {
    await page.route('**/rest/v1/rpc/join_waitlist', (route) => route.continue({ headers: { ...route.request().headers(), 'cf-connecting-ip': address } }))
    return address
  }

  test('takes an address, thanks the same for it again, refuses what is not one, and keeps no account', async ({ page }) => {
    const { token, loved } = await adaWithAPage()
    const address = uniqueEmail('wl-flow')
    await visitingAs(page)
    await page.goto(`/r/${token}`)
    const form = page.getByTestId('readingPage.waitlistForm')
    await expect(page.getByTestId('readingPage.waitlist')).toContainText(en.readingPage.waitlist.text)
    await expect(page.getByTestId('readingPage.waitlistConsent')).toHaveText(en.readingPage.waitlist.consent)
    await expect(page.getByTestId('readingPage.waitlistJoin')).toHaveText(en.readingPage.waitlist.join)
    // The honeypot is out of reach for a person.
    await expect(page.getByTestId('readingPage.waitlistWebsite')).toHaveAttribute('tabindex', '-1')

    // Not an address: said under the field, nothing is sent.
    await page.getByTestId('readingPage.waitlistEmail').fill('not-an-address')
    await page.getByTestId('readingPage.waitlistJoin').click()
    await expect(page.getByTestId('readingPage.waitlistInvalid')).toHaveText(en.readingPage.waitlist.invalid)
    await expect(page.getByTestId('readingPage.waitlistEmail')).toHaveAttribute('aria-invalid', 'true')
    expect(await sql('select 1 from private.waitlist where email::text like $1', ['%not-an-address%'])).toHaveLength(0)
    await expectAccessibleDark(page, 'waitlist form with an error')

    // An address: "You're on the list", and the form is gone.
    await page.getByTestId('readingPage.waitlistEmail').fill(` ${address.toUpperCase()} `)
    await page.getByTestId('readingPage.waitlistEmail').press('Enter')
    await expect(page.getByTestId('readingPage.waitlistDone')).toContainText(en.readingPage.waitlist.doneTitle)
    await expect(form).toHaveCount(0)
    await expectAccessibleDark(page, 'waitlist, joined')
    const rows = await sql<{ source: string; consent_text_version: string; invited_at: string | null; member: string | null }>(
      'select source, consent_text_version, invited_at, source_member_id::text as member from private.waitlist where email::text = $1',
      [address],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ source: 'reading_page', invited_at: null })
    expect(rows[0]!.member).not.toBeNull()
    // No account was made.
    expect(await sql('select 1 from auth.users where email = $1', [address])).toHaveLength(0)

    // The same address again, from the Book card's footer: the same thanks, still one entry.
    await page.goto(`/r/${token}/book/${loved.book.id}`)
    await page.getByTestId('readingPage.waitlistEmail').fill(address)
    await page.getByTestId('readingPage.waitlistJoin').click()
    await expect(page.getByTestId('readingPage.waitlistDone')).toContainText(en.readingPage.waitlist.doneTitle)
    expect(await sql('select 1 from private.waitlist where email::text = $1', [address])).toHaveLength(1)
    // Signed out, nothing sent her to sign in.
    await expect(page).toHaveURL(new RegExp(`/r/${token}/book/`))
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
    await expectAccessibleDark(page, 'Share sheet, off')

    await page.getByTestId('sharing.on').click()
    await expect(page.getByTestId('sharing.on')).toHaveAttribute('aria-checked', 'true')
    const link = (await page.getByTestId('sharing.link').textContent())!.trim()
    expect(link).toMatch(/\/r\/[A-Za-z0-9_-]{22}$/)
    await page.getByTestId('sharing.section.year').click()
    await expect(page.getByTestId('sharing.section.year')).toHaveAttribute('aria-checked', 'false')
    await expectAccessibleDark(page, 'Share sheet, on')
    await page.keyboard.press('Escape')
    await untilStill(page)
    await expect(page.getByTestId('profile.readingPageValue')).toHaveText(en.sharing.rowOn)

    // The Book's options → Share, with her review.
    await page.goto(`/book/${loved.book.id}`)
    await page.getByTestId('book.options').click()
    await page.getByTestId('bookOptions.share').click()
    await expect(page.getByTestId('shareBook.review')).toHaveAttribute('aria-checked', 'false')
    await page.getByTestId('shareBook.review').click()
    await expectAccessibleDark(page, 'Share book sheet')
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
})
