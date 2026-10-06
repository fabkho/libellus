import { expect } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import type { BookSnapshot } from '../app/data/books'
import { createLibrary } from '../app/data/library'
import { createLinkTemplates } from '../app/data/linkTemplates'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { test } from './fixtures'
import { goto, openProfile, recordedApple, signedIn, untilStill } from './support'

/**
 * Book links (issue #116): a member keeps her own ordered list of links in the
 * Profile (Book links: a label and an address with {isbn}, {isbn10}, {title},
 * {author}), and every Book's page offers them, filled from the Book, under the
 * facts: the first by its label, the others behind More. Hers alone: another
 * member opening the same Book sees none of them. A Book without an ISBN gets
 * only the links it can fill. Nothing is looked up; no flow follows a link.
 */

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

function book(title: string, isbn13: string | null): BookSnapshot {
  return {
    title: runTitle(title),
    authors: ['Ursula K. Le Guin'],
    isbn13,
    isbn10: null,
    pageCount: 300,
    year: 1969,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: null,
    coverUrl: `https://is1-ssl.mzstatic.com/image/thumb/Links${title.replace(/\W/g, '')}/600x900bb.jpg`,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

const enc = encodeURIComponent

/** A valid ISBN-13 no Book has (979…), so the run never meets a Catalogue Book of the same number. */
async function unusedIsbn13(): Promise<string> {
  for (;;) {
    const body = `979${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`
    const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0)
    const isbn = `${body}${(10 - (sum % 10)) % 10}`
    if (!(await sql('select 1 from public.books where isbn13 = $1', [isbn])).length) return isbn
  }
}

test('she sets her links in the Profile, in her order, and a Book page offers them', async ({ page }) => {
  const member = await signedIn(page)
  const library = createLibrary(member.client)
  const isbn13 = await unusedIsbn13()
  const withIsbn = (await library.addToLibrary(book('The Left Hand of Darkness', isbn13))).data!
  const without = (await library.addToLibrary(book('Unnumbered', null))).data!

  // None yet: the row says so, the sheet is empty.
  await openProfile(page)
  await expect(page.getByTestId('profile.linksValue')).toHaveText(en.links.rowNone)
  await page.getByTestId('profile.links').click()
  await expect(page.getByTestId('links.empty')).toBeVisible()

  // Two links; an address that is not one is refused under its field.
  await page.getByTestId('links.add').click()
  await page.getByTestId('links.label').nth(0).fill('Open Library')
  await page.getByTestId('links.url').nth(0).fill('https://openlibrary.org/isbn/{isbn}')
  await page.getByTestId('links.add').click()
  await page.getByTestId('links.label').nth(1).fill('City library')
  await page.getByTestId('links.url').nth(1).fill('catalogue.example.org/?q={title}')
  await page.getByTestId('links.action').click()
  await expect(page.getByTestId('links.urlError')).toHaveText(en.links.error.url_invalid)
  await page.getByTestId('links.url').nth(1).fill('https://catalogue.example.org/search?q={title}&a={author}')

  // The library first: moved up, then saved.
  await page.getByTestId('links.up').nth(1).click()
  await expect(page.getByTestId('links.label').nth(0)).toHaveValue('City library')
  await page.getByTestId('links.action').click()
  await expect(page.getByTestId('links')).toBeHidden()
  await expect(page.getByTestId('profile.linksValue')).toHaveText('2')

  // The Book's page: the first link, the other behind More.
  await goto(page, `/book/${withIsbn.book.id}`)
  await expect(page.getByTestId('book.title')).toHaveText(runTitle('The Left Hand of Darkness'))
  const links = page.getByTestId('book.link')
  await expect(links).toHaveCount(1)
  await expect(links.nth(0)).toHaveText('City library')
  await expect(links.nth(0)).toHaveAttribute(
    'href',
    `https://catalogue.example.org/search?q=${enc(runTitle('The Left Hand of Darkness'))}&a=${enc('Ursula K. Le Guin')}`,
  )
  await expect(links.nth(0)).toHaveAttribute('target', '_blank')
  const more = page.getByTestId('book.linksMore')
  await expect(more).toHaveAttribute('aria-expanded', 'false')
  await more.click()
  await expect(more).toHaveAttribute('aria-expanded', 'true')
  await expect(links).toHaveCount(2)
  await expect(links.nth(1)).toHaveText('Open Library')
  await expect(links.nth(1)).toHaveAttribute('href', `https://openlibrary.org/isbn/${isbn13}`)
  await more.click()
  await expect(links).toHaveCount(1)

  // No ISBN: only the link it can fill, and no More.
  await untilStill(page)
  await goto(page, `/book/${without.book.id}`)
  await expect(page.getByTestId('book.title')).toHaveText(runTitle('Unnumbered'))
  await expect(links).toHaveCount(1)
  await expect(links.nth(0)).toHaveText('City library')
  await expect(page.getByTestId('book.linksMore')).toHaveCount(0)

  // Kept with her account: a reload still offers them.
  await page.reload()
  await expect(page.getByTestId('book.link')).toHaveText('City library')
})

test("another member's links never show: a Book's page without links of her own has no row", async ({ page }) => {
  const owner = await signedIn(page)
  const entry = (await createLibrary(owner.client).addToLibrary(book('A Wizard of Earthsea', await unusedIsbn13()))).data!
  expect((await createLinkTemplates(owner.client).save([{ label: 'Her catalogue', url: 'https://catalogue.example.org/{isbn}' }])).error).toBeNull()
  await goto(page, `/book/${entry.book.id}`)
  await expect(page.getByTestId('book.link')).toHaveText('Her catalogue')

  // She signs out; somebody else signs in, on the same Catalogue Book.
  await goto(page, '/profile')
  await page.getByTestId('profile.signOut').click()
  await expect(page).toHaveURL(/\/sign-in$/)
  await signedIn(page)
  await goto(page, `/book/${entry.book.id}`)
  await expect(page.getByTestId('book.title')).toHaveText(runTitle('A Wizard of Earthsea'))
  await expect(page.getByTestId('book.links')).toHaveCount(0)
})
