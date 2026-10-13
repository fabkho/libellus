import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import type { BookSnapshot } from '../app/data/books'
import { createLibrary } from '../app/data/library'
import { addDays, isoDay } from '../app/utils/dates'
import { runTitle, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { test } from './fixtures'
import { openProfile, recordedApple, signedIn, untilStill } from './support'

/**
 * Rating a Book from the unrated sheet (issue #14, part 2): "3 not rated yet" opens the sheet, every
 * row carries five stars named by its Book, a rating takes the row out of the list (the figures
 * behind the sheet follow at once), Undo for 5 s takes it back, and rated the last of them away the
 * sheet says "Everything rated". The Library is the real local stack; the Books are made through the
 * repository so they have the page counts the recorded Apple answers lack. The Rating's write and
 * its offline queue are tests/rate-from-sheet.test.ts; this is the flow.
 */
test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

const today = isoDay()
/** Where the screenshots go (docs/TESTING.md: a whole screen, at most 1000 px high). */
const OUT = process.env.RATE_SHOTS_OUT ?? '/tmp/rate-from-sheet'

/** A plural of en.json as the app renders it in English ("Rated 4 stars"). */
function inEnglish(value: string, count: number) {
  return (count === 1 ? value.split(' | ')[0] : value.split(' | ').at(-1)).replaceAll('{count}', String(count))
}

function book(title: string): BookSnapshot {
  return {
    title: runTitle(title),
    authors: ['Susanna Clarke'],
    isbn13: null,
    isbn10: null,
    pageCount: 272,
    year: 2020,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: null,
    // Answered by the recorded cover (e2e/support.ts, recordedApple).
    coverUrl: `https://is1-ssl.mzstatic.com/image/thumb/Publication${title.replace(/\W/g, '')}/600x900bb.jpg`,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

/** Three finished reads with no Rating — the unrated sheet's rows, newest end first (Piranesi, Dune, Emma). */
async function threeUnrated(page: Page) {
  const member = await signedIn(page)
  const library = createLibrary(member.client)
  const finished = [
    ['Piranesi', -3],
    ['Dune', -5],
    ['Emma', -7],
  ] as const
  for (const [title, back] of finished) {
    await library.addToLibrary(book(title), { status: 'finished', startedOn: addDays(today, back - 7), endedOn: addDays(today, back) })
  }
  return member
}

test('the unrated sheet rates in place: rows leave, figures follow, Undo takes one back', async ({ page }) => {
  await threeUnrated(page)
  await openProfile(page)

  // The Average's line opens the sheet.
  await expect(page.getByTestId('profile.unrated')).toHaveText(inEnglish(en.profile.figures.unrated, 3))
  await page.getByTestId('profile.unrated').click()
  const rows = page.getByTestId('profileReads.row')
  await expect(rows).toHaveCount(3)

  // Every row's stars are named by its Book.
  const first = rows.first()
  await expect(first.getByTestId('profile.readTitle')).toHaveText(/Piranesi/)
  for (const star of [1, 2, 3, 4, 5]) {
    await expect(first.getByTestId(`profileReads.rate.${star}`)).toHaveAttribute('aria-label', /Piranesi/)
    await expect(first.getByTestId(`profileReads.rate.${star}`)).toHaveAttribute('aria-label', new RegExp(`\\b${star} star`))
  }

  // Four stars: the row leaves the list and the pill says so, with Undo.
  await first.getByTestId('profileReads.rate.4').click()
  await expect(rows).toHaveCount(2)
  await expect(page.getByTestId('profileReads.rated')).toHaveText(inEnglish(en.profile.sheet.rated, 4))

  // Undo puts it back.
  await page.getByTestId('profileReads.undo').click()
  await expect(rows).toHaveCount(3)
  await expect(page.getByTestId('profileReads.rated')).toHaveCount(0)

  // The rest of them, one after the other, without leaving the sheet.
  await rows.first().getByTestId('profileReads.rate.5').click()
  await expect(rows).toHaveCount(2)
  await rows.first().getByTestId('profileReads.rate.3').click()
  await expect(rows).toHaveCount(1)
  await rows.first().getByTestId('profileReads.rate.2').click()
  await expect(rows).toHaveCount(0)
  await expect(page.getByTestId('profileReads.empty')).toHaveText(en.profile.sheet.emptyRated)

  // Closed: the figures are the rated ones (5 + 3 + 2 stars), and nothing is left to open.
  await page.getByTestId('profileReads.cancel').click()
  await expect(page.getByTestId('profile.average')).toHaveText('3.3')
  await expect(page.getByTestId('profile.unrated')).toHaveCount(0)
})

const SIZES = [
  { name: '390', viewport: { width: 390, height: 844 } },
  { name: '360', viewport: { width: 360, height: 780 } },
]

for (const size of SIZES) {
  for (const theme of ['light', 'dark'] as const) {
    test.describe(`screenshots, ${size.name} px, ${theme}`, () => {
      test.use({ colorScheme: theme, viewport: size.viewport })

      test('the sheet, a Rating and its Undo, and everything rated', async ({ page }) => {
        await page.addInitScript(([key, value]) => localStorage.setItem(key!, value!), ['libellus-theme', theme])
        mkdirSync(OUT, { recursive: true })
        const run = `${size.name}-${theme}`
        await threeUnrated(page)
        await openProfile(page)
        await page.getByTestId('profile.unrated').click()
        await expect(page.getByTestId('profileReads.row')).toHaveCount(3)
        await page.screenshot({ path: join(OUT, `rate-sheet-${run}.jpg`), type: 'jpeg', quality: 80 })

        await page.getByTestId('profileReads.row').first().getByTestId('profileReads.rate.4').click()
        await expect(page.getByTestId('profileReads.rated')).toHaveCSS('opacity', '1')
        await expect(page.getByTestId('profileReads.row')).toHaveCount(2)
        await untilStill(page)
        await page.screenshot({ path: join(OUT, `rate-toast-${run}.jpg`), type: 'jpeg', quality: 80 })
        await page.getByTestId('profileReads.row').first().getByTestId('profileReads.rate.3').click()
        await expect(page.getByTestId('profileReads.row')).toHaveCount(1)
        await page.getByTestId('profileReads.row').first().getByTestId('profileReads.rate.2').click()
        await expect(page.getByTestId('profileReads.row')).toHaveCount(0)
        await expect(page.getByTestId('profileReads.empty')).toHaveText(en.profile.sheet.emptyRated)
        await untilStill(page)
        await page.screenshot({ path: join(OUT, `rate-empty-${run}.jpg`), type: 'jpeg', quality: 80 })
      })
    })
  }
}
