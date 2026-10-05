import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import type { BookSnapshot } from '../app/data/books'
import { createLibrary } from '../app/data/library'
import { isoDay } from '../app/utils/dates'
import { signUpMember } from '../tests/support/member'
import { emailCooldown, readMailedCode, runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { test } from './fixtures'
import { recordedApple, signedIn, untilStill } from './support'

/**
 * The share target and the app shortcuts (#91). Another app shares a link or
 * text to Libellus: it opens at /share?title=&text=&url= (the manifest's GET
 * share_target), finds the Book through the same sources as search and goes to
 * its page, replacing /share in the history, or opens the search palette with the
 * words typed in. Signed out, the share waits through the sign-in. The
 * shortcuts open /?search=1 and /?progress=1. With docs/parity.md this is the
 * behavioural reference. The Books are made through the repository (so the
 * Catalogue holds them under an ISBN nobody else has); Apple answers from the
 * recordings.
 */

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

/** A valid ISBN-13 nobody has (979…), so the run never meets a real Book or cached rating. */
async function unusedIsbn13(): Promise<string> {
  for (;;) {
    const body = `979${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`
    const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0)
    const isbn = `${body}${(10 - (sum % 10)) % 10}`
    const taken = await sql(
      'select 1 from public.books where isbn13 = $1 union all select 1 from public.goodreads_ratings where isbn13 = $1',
      [isbn],
    )
    if (!taken.length) return isbn
  }
}

function book(title: string, isbn13: string | null): BookSnapshot {
  return {
    title: runTitle(title),
    authors: ['Susanna Clarke'],
    isbn13,
    isbn10: null,
    pageCount: 320,
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

/** ISBN-13 → its ISBN-10 (the Amazon address carries that one). */
function isbn10Of(isbn13: string): string {
  const body = isbn13.slice(3, 12)
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (10 - index), 0)
  const check = (11 - (sum % 11)) % 11
  return `${body}${check === 10 ? 'X' : check}`
}

const shareUrl = (params: Record<string, string>) => `/share?${new URLSearchParams(params)}`

/** A share arrives the way Android opens the app: a fresh page load at the share address. */
async function receive(page: Page, params: Record<string, string>) {
  await page.goto(shareUrl(params))
}

test('a link with an ISBN goes straight to the book, and Back does not land on the share', async ({ page }) => {
  const member = await signedIn(page)
  const isbn = await unusedIsbn13()
  const added = (await createLibrary(member.client).addToLibrary(book('Shared ISBN', isbn), { status: 'want_to_read' })).data!

  // Chrome shares the page's address in `text` and its title in `title`; the ISBN-13 is in the address.
  await receive(page, { title: 'Some Bookshop', text: `https://bookshop.example/p/${isbn}` })
  await expect(page.getByTestId('book.title')).toHaveText(added.book.title)
  await expect(page.getByTestId('book.status')).toHaveText(en.status.want_to_read)
  await expect(page).toHaveURL(new RegExp(`/book/${added.book.id}$`))

  // /share took itself out of the history: Back leaves the app's pages for what was before.
  await page.goBack()
  await expect(page).not.toHaveURL(/\/share/)
  await expect(page).not.toHaveURL(/\/book\//)
})

test('an Amazon /dp/ link carries the ISBN-10, and so does a /gp/product/ link', async ({ page }) => {
  const member = await signedIn(page)
  // 978…: the only ones that have an ISBN-10. The Catalogue keeps the first Book it was given for an ISBN, so the page is the entry's.
  const isbn = '9780306406157'
  const added = (await createLibrary(member.client).addToLibrary(book('Shared Amazon', isbn), { status: 'want_to_read' })).data!

  await receive(page, { text: `Check out this book on Amazon https://www.amazon.com/Some-Title/dp/${isbn10Of(isbn)}/ref=sr_1_1?keywords=x` })
  await expect(page.getByTestId('book.title')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/book/${added.book.id}$`))

  await receive(page, { url: `https://www.amazon.de/gp/product/${isbn10Of(isbn)}?psc=1` })
  await expect(page.getByTestId('book.title')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/book/${added.book.id}$`))
})

test('a Goodreads link finds the Book the Goodreads cache knows by its id', async ({ page }) => {
  const member = await signedIn(page)
  const isbn = await unusedIsbn13()
  const added = (await createLibrary(member.client).addToLibrary(book('Shared Goodreads', isbn), { status: 'reading', startedOn: isoDay() })).data!
  const goodreadsId = String(900_000_000 + Math.floor(Math.random() * 99_000_000))
  await sql(
    `insert into public.goodreads_ratings (isbn13, status, matched_by, goodreads_id, rating, ratings_count, reviews_count)
     values ($1, 'found', 'isbn', $2, 4.1, 1000, 100)`,
    [isbn, goodreadsId],
  )
  try {
    await receive(page, {
      title: 'Shared Goodreads by Susanna Clarke',
      text: `Check out Shared Goodreads by Susanna Clarke on Goodreads: https://www.goodreads.com/book/show/${goodreadsId}-shared-goodreads`,
    })
    await expect(page.getByTestId('book.title')).toHaveText(added.book.title)
    await expect(page.getByTestId('book.status')).toHaveText(en.status.reading)
  } finally {
    await sql('delete from public.goodreads_ratings where isbn13 = $1', [isbn])
  }
})

test('shared title text opens the search palette with the words typed in', async ({ page }) => {
  await signedIn(page)
  await receive(page, { text: 'Piranesi' })
  await expect(page.getByTestId('search.overlay')).toBeVisible()
  await expect(page.getByTestId('search.query')).toHaveValue('Piranesi')
  await expect(page.getByTestId('search.result').first()).toBeVisible()
  // Home is the page behind it, and the share is gone from the address.
  await expect(page).toHaveURL(/\/$/)

  // Back does not return to /share either.
  await page.getByTestId('search.cancel').click()
  await expect(page.getByTestId('search.overlay')).toBeHidden()
  await page.goBack().catch(() => {})
  await expect(page).not.toHaveURL(/\/share/)
})

test('a link to an ISBN no source knows opens the search palette with the shared words', async ({ page }) => {
  await signedIn(page)
  const isbn = await unusedIsbn13()
  await receive(page, { title: 'A Book Nobody Lists', url: `https://bookshop.example/p?isbn=${isbn}` })
  await expect(page.getByTestId('search.overlay')).toBeVisible()
  await expect(page.getByTestId('search.query')).toHaveValue('A Book Nobody Lists')
})

test('a share that arrives signed out waits through the sign-in and then opens the book', async ({ page }) => {
  // The member exists already (made through the repository); the browser has no session.
  const member = await signUpMember()
  const isbn = await unusedIsbn13()
  const added = (await createLibrary(member.client).addToLibrary(book('Shared Signed Out', isbn), { status: 'want_to_read' })).data!
  await emailCooldown()

  await receive(page, { url: `https://bookshop.example/p/${isbn}` })
  await expect(page).toHaveURL(/\/sign-in$/)
  await page.getByTestId('signIn.email').fill(member.email)
  await page.getByTestId('signIn.submit').click()
  await expect(page).toHaveURL(/\/verify$/)
  await page.getByTestId('verify.code').fill(await readMailedCode(member.email, 2))

  await expect(page.getByTestId('book.title')).toHaveText(added.book.title)
  await expect(page).toHaveURL(new RegExp(`/book/${added.book.id}$`))
})

test('an empty share goes Home', async ({ page }) => {
  await signedIn(page)
  await page.goto('/share')
  await expect(page.getByTestId('home.title')).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
})

test('the Search shortcut opens the palette on Home, and takes itself off the address', async ({ page }) => {
  await signedIn(page)
  await page.goto('/?search=1')
  await expect(page.getByTestId('search.overlay')).toBeVisible()
  await expect(page.getByTestId('search.query')).toBeFocused()
  await expect(page).toHaveURL(/\/$/)
})

test('the Update progress shortcut opens the sheet of the book updated last, or stays on Home when nothing is read', async ({ page }) => {
  const member = await signedIn(page)
  await page.goto('/?progress=1')
  await expect(page.getByTestId('home.title')).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId('progress')).toBeHidden()

  const library = createLibrary(member.client)
  const older = (await library.addToLibrary(book('Older Read', null), { status: 'reading', startedOn: isoDay() })).data!
  const newer = (await library.addToLibrary(book('Newer Read', null), { status: 'reading', startedOn: isoDay() })).data!
  expect((await library.updateProgress(older.id, { page: 12 }, undefined, isoDay())).error).toBeNull()
  // Later: the older one is the one updated last.
  await new Promise((resolve) => setTimeout(resolve, 1100))
  expect((await library.updateProgress(newer.id, { page: 30 }, undefined, isoDay())).error).toBeNull()
  await new Promise((resolve) => setTimeout(resolve, 1100))
  expect((await library.updateProgress(older.id, { page: 40 }, undefined, isoDay())).error).toBeNull()

  await page.goto('/?progress=1')
  await expect(page.getByTestId('book.title')).toHaveText(older.book.title)
  await expect(page.getByTestId('progress')).toBeVisible()
  await expect(page.getByTestId('progress.wheel')).toHaveAttribute('aria-valuenow', '40')
  await expect(page).toHaveURL(new RegExp(`/book/${older.book.id}$`))
  await untilStill(page)
})
