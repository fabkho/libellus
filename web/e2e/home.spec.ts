import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { isoDay } from '../app/utils/dates'
import { recordedApple, signedIn } from './support'
import { test } from './fixtures'

/**
 * Home (#8): a new member lands on the empty state that leads to Search; a
 * Book added and started shows under Currently reading with its day; Finish
 * on the card takes it away and the year's tally goes up. Up next lists the
 * Want to read Books and See all leads to the Library. Apple answers from the
 * recordings (e2e/support.ts); the Library is the real local stack. With
 * docs/parity.md this is the behavioural reference for Home.
 */

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
  // The Catalogue is shared with every other run on this stack, which may have
  // added another edition of these Books just now; this flow is about Books
  // found on Apple Books, so the Catalogue answers nothing here.
  await page.route(/\/rest\/v1\/rpc\/search_books/, async (route) =>
    route.fulfill({ response: await route.fetch(), body: '[]' }),
  )
})

/** Searches, opens the first result and adds it to Want to read; leaves its book page open. */
async function addFirstResult(page: Page, query: string, title: string) {
  await page.getByTestId('shell.tab.search').click()
  await page.getByTestId('search.query').fill(query)
  await page.getByTestId('search.result').first().click()
  await expect(page.getByTestId('book.title')).toHaveText(title)
  await page.getByTestId('book.add').click()
  await page.getByTestId('add.submit').click()
  await expect(page.getByTestId('add')).toBeHidden()
}

test('a new member starts on the empty Home, reads a book from there and finishes it', async ({ page }) => {
  await signedIn(page)
  const year = isoDay().slice(0, 4)

  // New member: the greeting under the date, the empty shelf, the way to Search.
  await expect(page.getByTestId('home.date')).toBeVisible()
  await expect(page.getByTestId('home.title')).toHaveText(new RegExp(`^(${Object.values(en.home.greeting).join('|')})$`))
  await expect(page.getByTestId('home.emptyTitle')).toHaveText(en.home.emptyTitle)
  await expect(page.getByTestId('home.readingCard')).toHaveCount(0)
  await expect(page.getByTestId('home.tally')).toBeHidden()

  // The search prompt opens the overlay over Home.
  await page.getByTestId('home.search').click()
  await expect(page.getByTestId('search.overlay')).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
  await page.getByTestId('search.query').fill('Piranesi')
  await page.getByTestId('search.result').first().click()
  await expect(page.getByTestId('book.title')).toHaveText('Piranesi')
  await page.getByTestId('book.add').click()
  await page.getByTestId('add.submit').click()
  await expect(page.getByTestId('add')).toBeHidden()

  // A Book on Want to read is no longer an empty Library: Up next, nothing being read, 0 this year.
  await page.getByTestId('shell.tab.home').click()
  await expect(page.getByTestId('home.emptyTitle')).toBeHidden()
  await expect(page.getByTestId('home.readingEmpty')).toHaveText(en.home.readingEmpty)
  await expect(page.getByTestId('home.tallyLabel')).toHaveText(en.home.readIn.replace('{year}', year))
  await expect(page.getByTestId('home.tallyCount')).toHaveText('0')
  await expect(page.getByTestId('home.upNextEntry')).toHaveCount(1)

  // Start it from its page: Home shows it under Currently reading, day 1.
  await page.getByTestId('home.upNextEntry').click()
  await expect(page.getByTestId('book.title')).toHaveText('Piranesi')
  await page.getByTestId('book.start').click()
  await page.getByTestId('start.submit').click()
  await expect(page.getByTestId('start')).toBeHidden()
  await page.getByTestId('shell.tab.home').click()
  await expect(page.getByTestId('home.readingCard')).toHaveCount(1)
  await expect(page.getByTestId('home.entryTitle')).toHaveText('Piranesi')
  await expect(page.getByTestId('home.entrySince')).toContainText('day 1')
  await expect(page.getByTestId('home.readingCount')).toHaveText('1')
  await expect(page.getByTestId('home.upNext')).toBeHidden()
  await expect(page.getByTestId('home.tallyCount')).toHaveText('0')

  // The card opens the book page, and Back to Home keeps it as it was.
  await page.getByTestId('home.entry').click()
  await expect(page).toHaveURL(/\/book\/[0-9a-f-]{36}$/)
  await page.getByTestId('shell.tab.home').click()
  await expect(page.getByTestId('home.readingCard')).toHaveCount(1)

  // Finish from the card (Update, then Finish in the sheet) opens the Finish sheet over Home; finishing counts it.
  await page.getByTestId('home.update').click()
  await page.getByTestId('progress.finish').click()
  await expect(page.getByTestId('finish')).toBeVisible()
  await page.getByTestId('finish.submit').click()
  await expect(page.getByTestId('finish')).toBeHidden()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId('home.readingCard')).toHaveCount(0)
  await expect(page.getByTestId('home.readingEmpty')).toBeVisible()
  await expect(page.getByTestId('home.tallyCount')).toHaveText('1')
  await expect(page.getByTestId('home.ticks').locator('.tick')).toHaveCount(1)
  await expect(page.getByTestId('home.tally')).toHaveAttribute(
    'aria-label',
    en.home.readInLabel.replace('{year}', year).replace('{count}', '1'),
  )
})

test('Up next lists what is Want to read, newest first, and See all opens the Library', async ({ page }) => {
  await signedIn(page)
  await addFirstResult(page, 'Piranesi', 'Piranesi')
  await addFirstResult(page, 'Klara und die Sonne', 'Klara und die Sonne')

  await page.getByTestId('shell.tab.home').click()
  await expect(page.getByTestId('home.upNextEntry')).toHaveCount(2)
  await expect(page.getByTestId('home.upNextEntry').first()).toHaveAttribute('aria-label', 'Klara und die Sonne')
  await expect(page.getByTestId('home.seeAll')).toContainText('2')

  await page.getByTestId('home.seeAll').click()
  await expect(page).toHaveURL(/\/library$/)
  await expect(page.getByTestId('library.wantToRead')).toBeVisible()
})
