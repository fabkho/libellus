import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import type { BookSnapshot } from '../app/data/books'
import { createLibrary } from '../app/data/library'
import { addDays, isoDay } from '../app/utils/dates'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { test } from './fixtures'
import { expectAccessible, openProfile, recordedApple, signedIn, untilStill } from './support'

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

/** A template of en.json with its blanks filled ("Your page count for Noumenon"). */
const fill = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key]))

function book(title: string, pageCount: number | null = 272): BookSnapshot {
  return {
    title: runTitle(title),
    authors: ['Susanna Clarke'],
    isbn13: null,
    isbn10: null,
    pageCount,
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
  await expectAccessible(page, 'the unrated sheet')

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

/**
 * Her own page count on a finished read (issue #60): the Books whose editions have no count are the
 * Pages card's "N without a count", and the sheet behind that line carries a field on every row. A
 * count typed there is her override — the entry's `page_count_override`, never the edition's
 * `books.page_count` — so the row leaves the list and the line behind the sheet decrements at once.
 */
test('the pagesMissing sheet sets her own page count: the row leaves and the line decrements', async ({ page }) => {
  const member = await signedIn(page)
  const library = createLibrary(member.client)
  // Two finished reads whose editions have no page count, newest end first (Noumenon, then The Lathe of Heaven).
  for (const [title, back] of [
    ['The Lathe of Heaven', -12],
    ['Noumenon', -4],
  ] as const) {
    await library.addToLibrary(book(title, null), { status: 'finished', startedOn: addDays(today, back - 9), endedOn: addDays(today, back) })
  }
  await openProfile(page)

  const line = page.getByTestId('profile.pagesMissing')
  await expect(line).toHaveText(inEnglish(en.profile.figures.pagesMissing, 2))
  await line.click()
  const rows = page.getByTestId('profileReads.row')
  await expect(rows).toHaveCount(2)

  // Every row carries her own field, named by its Book and holding the count the read has (none: empty).
  const first = rows.first()
  await expect(first.getByTestId('profile.readTitle')).toHaveText(runTitle('Noumenon'))
  const field = first.getByTestId('profileReads.total')
  await expect(field).toHaveAttribute('aria-label', fill(en.profile.figures.pagesMissingYourTotal, { title: runTitle('Noumenon') }))
  await expect(field).toHaveValue('')

  // A count typed and confirmed: the row leaves the list, and the line behind the sheet decrements.
  await field.fill('312')
  await field.press('Enter')
  await expect(rows).toHaveCount(1)
  await expect(page.getByTestId('profile.pagesMissing')).toHaveText(inEnglish(en.profile.figures.pagesMissing, 1))

  // The override is hers and the edition's count is untouched: a shared row is never written.
  const stored = await sql<{ page_count_override: number | null; book_count: number | null }>(
    `select e.page_count_override, b.page_count as book_count
       from public.library_entries e join public.books b on b.id = e.book_id
      where e.member_id = $1 and b.title = $2`,
    [member.id, runTitle('Noumenon')],
  )
  expect(stored).toEqual([{ page_count_override: 312, book_count: null }])

  // The next row, and the sheet has nothing left: the Pages line is no longer something to open.
  const last = rows.first()
  await last.getByTestId('profileReads.total').fill('120')
  await last.getByTestId('profileReads.total').press('Enter')
  await expect(rows).toHaveCount(0)
  await page.getByTestId('profileReads.cancel').click()
  await expect(page.getByTestId('profile.pagesMissing')).toHaveCount(0)
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
