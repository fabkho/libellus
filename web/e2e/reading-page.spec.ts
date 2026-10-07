import { readFileSync } from 'node:fs'
import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import type { BookSnapshot } from '../app/data/books'
import { createAuth } from '../app/data/auth'
import { createLibrary } from '../app/data/library'
import { createReadingPages } from '../app/data/readingPage'
import { isoDay } from '../app/utils/dates'
import { appleCover } from '../tests/support/apple'
import { signUpMember } from '../tests/support/member'
import { createWaitlist } from '../app/data/waitlist'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId, uniqueEmail, visitorAddress, visitorClient } from '../tests/support/stack'
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
    await expectAccessibleBoth(page, 'reading page')

    // The footer: the waitlist form, and a way in for whoever has a code.
    await expect(page.getByTestId('readingPage.waitlist')).toContainText(en.readingPage.waitlist.text)
    await expect(page.getByTestId('readingPage.signUp')).toHaveText(en.readingPage.footer.signUp)

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

  test('rows that scroll sideways start inside the page\'s side padding, not flush against the screen edge', async ({ page }) => {
    const ada = await signUpMember()
    const library = createLibrary(ada.client)
    const today = isoDay()
    for (const title of ['Loved A', 'Loved B', 'Loved C', 'Loved D', 'Loved E', 'Loved F'])
      await library.addToLibrary(book(title), { status: 'finished', startedOn: today, endedOn: today, rating: 19 })
    const token = (await createReadingPages(ada.client).setOn(true)).data!.token!

    for (const width of [360, 412]) {
      await page.setViewportSize({ width, height: 800 })
      await page.goto(`/r/${token}`)
      for (const row of ['readingPage.favouritesRow', 'readingPage.shelfCovers']) {
        const list = page.getByTestId(row)
        await expect(list).toBeVisible()
        // It does scroll sideways, and it rests at its start with the leading inset (a snap point without scroll-padding scrolled it 20 px in).
        expect(await list.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
        await expect.poll(() => list.evaluate((el) => el.scrollLeft), { message: `${row} at ${width}` }).toBe(0)
        const first = await list.locator('li').first().evaluate((el) => el.getBoundingClientRect().left)
        expect(first, `${row} at ${width}`).toBeGreaterThanOrEqual(16)
        // The row still runs to the screen's right edge.
        const box = await list.evaluate((el) => ({ left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right }))
        expect(box.left).toBe(0)
        expect(box.right).toBe(width)
      }
    }
  })
})

test.describe('a cover flies to its Book card and back', () => {
  // The flight is the app's (docs/MOTION.md, Push to a book): every animation it starts can be held still
  // (`__flight.frozen`), and each flight fades the copy of the page it left (`started`).
  // What moves is the subject here: the config's Reduce Motion cuts the flight to its ends (a cross-fade,
  // no cover in the air), so these flows run with it off, as the other motion specs do.
  test.use({ reducedMotion: 'no-preference' })
  test.beforeEach(async ({ page }) => {
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
    await page.route(/^https:\/\/is\d-ssl\.mzstatic\.com\//, (route) =>
      route.fulfill({ status: 200, contentType: 'image/jpeg', headers: { 'access-control-allow-origin': '*' }, body: appleCover() }),
    )
  })

  type Flight = { frozen: boolean; started: number }
  const started = (page: Page) => page.evaluate(() => (window as unknown as { __flight: Flight }).__flight.started)
  const freeze = (page: Page) => page.evaluate(() => ((window as unknown as { __flight: Flight }).__flight.frozen = true))
  const freezeAt = (page: Page, ms: number) =>
    page.evaluate((at) => {
      for (const animation of document.getAnimations())
        if (!(animation instanceof CSSTransition) && !(animation instanceof CSSAnimation)) animation.currentTime = at
    }, ms)
  const thaw = (page: Page) =>
    page.evaluate(() => {
      ;(window as unknown as { __flight: Flight }).__flight.frozen = false
      for (const animation of document.getAnimations()) if (animation.playState === 'paused') animation.play()
    })
  /** The `count`th flight has started and is over: nothing in its layers, no cover left hidden, nothing animating on the page. */
  async function expectLanded(page: Page, count: number) {
    await expect.poll(() => started(page)).toBe(count)
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

  async function adaWithCovers() {
    const ada = await signUpMember()
    await createAuth(ada.client).setName('Ada')
    const library = createLibrary(ada.client)
    const today = isoDay()
    for (const title of ['Flown A', 'Flown B', 'Flown C', 'Flown D', 'Flown E', 'Flown F']) {
      const snapshot = { ...book(title), coverUrl: `https://is1-ssl.mzstatic.com/image/thumb/Publication/v4/t5/flight/${title.replace(/ /g, '')}.jpg/600x900bb.jpg` }
      await library.addToLibrary(snapshot, { status: 'finished', startedOn: today, endedOn: today, rating: 19 })
    }
    return (await createReadingPages(ada.client).setOn(true)).data!.token!
  }

  test('the tapped cover flies into the card\'s hero, Back flies it into its row, and the page is where it was', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 })
    const token = await adaWithCovers()
    await page.goto(`/r/${token}`)
    const row = page.getByTestId('readingPage.favouritesRow.book').nth(1)
    await expect(row).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, 120))
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBeGreaterThan(0)
    const scrolled = await page.evaluate(() => Math.round(window.scrollY))
    const title = (await row.locator('.book-title').textContent())!
    const rowCover = (await row.locator('[data-cover]').boundingBox())!

    // Frozen 100 ms into the push: the cover is in the air, on its way from its row to the hero, and it is animating.
    await freeze(page)
    await page.mouse.click(rowCover.x + rowCover.width / 2, rowCover.y + rowCover.height / 2)
    await expect(page.getByTestId('shell.flightCover')).toHaveCount(1)
    const flying = page.getByTestId('shell.flightCover')
    await expect.poll(() => flying.evaluate((el) => el.getAnimations().length)).toBeGreaterThan(0)
    await freezeAt(page, 100)
    const hero = (await page.getByTestId('bookCard.hero').locator('[data-cover]').boundingBox())!
    const mid = (await flying.boundingBox())!
    expect(mid.width).toBeGreaterThan(rowCover.width)
    expect(mid.width).toBeLessThan(hero.width)
    expect(mid.y).toBeLessThan(rowCover.y - 1)
    expect(mid.y).toBeGreaterThan(hero.y + 1)
    // The page, copied, fades out as the card fades in: both partly there.
    const [leaving, arriving] = await page.evaluate(() => [
      Number(getComputedStyle(document.querySelector('[data-testid="shell.flightPage"]')!.firstElementChild!).opacity),
      Number(getComputedStyle(document.querySelector('main')!).opacity),
    ])
    expect(leaving).toBeGreaterThan(0.05)
    expect(leaving).toBeLessThan(0.95)
    expect(arriving).toBeCloseTo(1 - leaving, 2)

    await thaw(page)
    await expect(page).toHaveURL(new RegExp(`/r/${token}/book/`))
    await expect(page.getByTestId('bookCard.title')).toHaveText(title)
    await expectLanded(page, 1)
    // The hero is the live one; her review is hers until she shares it.
    await expect(page.getByTestId('bookCard.hero').locator('[data-cover]')).toBeVisible()
    await expect(page.getByTestId('bookCard.review')).toHaveCount(0)
    await expectAccessibleBoth(page, 'Book card after the flight')

    // Back (her page's link): the cover flies into its row; the page is as it was.
    await page.getByTestId('bookCard.page').click()
    await expect(page.getByTestId('readingPage.title')).toBeVisible()
    await expectLanded(page, 2)
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(scrolled)
    expect((await row.locator('[data-cover]').boundingBox())!.y).toBeCloseTo(rowCover.y, 0)
    await expect(row.locator('[data-cover]')).toBeVisible()

    // The browser's own Back does the same.
    await row.click()
    await expect(page.getByTestId('bookCard.title')).toBeVisible()
    await expectLanded(page, 3)
    await page.goBack()
    await expect(page.getByTestId('readingPage.title')).toBeVisible()
    await expectLanded(page, 4)
    await expect(row.locator('[data-cover]')).toBeVisible()
  })

  test('Back tapped mid-flight turns the cover around from where it is; a card opened from a link just goes to the page', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 })
    const token = await adaWithCovers()
    await page.goto(`/r/${token}`)
    const row = page.getByTestId('readingPage.favouritesRow.book').nth(2)
    await expect(row).toBeVisible()
    const rowCover = (await row.locator('[data-cover]').boundingBox())!

    await freeze(page)
    await row.click()
    await expect(page.getByTestId('shell.flightCover')).toHaveCount(1)
    await expect.poll(() => page.getByTestId('shell.flightCover').evaluate((el) => el.getAnimations().length)).toBeGreaterThan(0)
    await freezeAt(page, 100)
    const mid = (await page.getByTestId('shell.flightCover').boundingBox())!
    expect(mid.width).toBeGreaterThan(rowCover.width)

    await page.getByTestId('bookCard.page').click()
    await expect(page.getByTestId('readingPage.title')).toBeVisible()
    await expect(row.locator('[data-cover][data-flight-hidden]')).toHaveCount(1)
    const turned = (await page.getByTestId('shell.flightCover').boundingBox())!
    expect(Math.abs(turned.x - mid.x)).toBeLessThan(1.5)
    expect(Math.abs(turned.y - mid.y)).toBeLessThan(1.5)
    expect(Math.abs(turned.width - mid.width)).toBeLessThan(1.5)
    await thaw(page)
    await expectLanded(page, 2)

    // Opened from a link, the card has no page behind it: its link goes there like any address, with no flight.
    const href = await row.getAttribute('href')
    await page.goto(href!)
    await expect(page.getByTestId('bookCard.title')).toBeVisible()
    await page.getByTestId('bookCard.page').click()
    await expect(page.getByTestId('readingPage.title')).toBeVisible()
    await expect(page.getByTestId('shell.flightCover')).toHaveCount(0)
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
    await expectAccessibleBoth(page, 'waitlist form with an error')

    // An address: "You're on the list", and the form is gone.
    await page.getByTestId('readingPage.waitlistEmail').fill(` ${address.toUpperCase()} `)
    await page.getByTestId('readingPage.waitlistEmail').press('Enter')
    await expect(page.getByTestId('readingPage.waitlistDone')).toContainText(en.readingPage.waitlist.doneTitle)
    await expect(form).toHaveCount(0)
    await expectAccessibleBoth(page, 'waitlist, joined')
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

  test('says it when the database refuses (too many tries) and when the device is offline', async ({ page, context }) => {
    const { token } = await adaWithAPage()
    // This visitor has already left five addresses in the hour: the sixth, from the page, is refused in words.
    const address = await visitingAs(page)
    const earlier = createWaitlist(visitorClient(address))
    for (let i = 0; i < 5; i++) await earlier.join(uniqueEmail(`wl-earlier${i}`), token)
    await page.goto(`/r/${token}`)
    await page.getByTestId('readingPage.waitlistEmail').fill(uniqueEmail('wl-limit'))
    await page.getByTestId('readingPage.waitlistJoin').click()
    await expect(page.getByTestId('readingPage.waitlistError')).toHaveText(en.readingPage.waitlist.rateLimited)
    expect(await sql('select 1 from private.waitlist where email::text like $1', ['wl-limit-%'])).toHaveLength(0)
    await expectAccessibleBoth(page, 'waitlist form, refused')

    // Offline: the button says so and nothing is sent.
    await context.setOffline(true)
    await expect(page.getByTestId('readingPage.waitlistJoin')).toContainText(en.common.offline)
    await expect(page.getByTestId('readingPage.waitlistJoin')).toBeDisabled()
    await context.setOffline(false)
    await expect(page.getByTestId('readingPage.waitlistJoin')).toHaveText(en.readingPage.waitlist.join)

    // Another visitor, another allowance: this device, as another address, gets in.
    await page.unroute('**/rest/v1/rpc/join_waitlist')
    await visitingAs(page)
    await page.getByTestId('readingPage.waitlistEmail').fill(uniqueEmail('wl-back'))
    await page.getByTestId('readingPage.waitlistJoin').click()
    await expect(page.getByTestId('readingPage.waitlistDone')).toBeVisible()
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
