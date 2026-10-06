import { expect, type Page } from '@playwright/test'
import type { BookSnapshot } from '../app/data/books'
import { createLibrary } from '../app/data/library'
import { addDays, isoDay } from '../app/utils/dates'
import { signUpMember } from '../tests/support/member'
import { emailCooldown, readMailedCode, runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { test } from './fixtures'
import { expectAccessible, recordedApple, signedIn, untilStill } from './support'

/**
 * Accessibility (docs/ACCESSIBILITY.md): axe-core over every main screen and
 * sheet, in the light and the dark room, on a phone (412 × 915, the Pixel the
 * Android checks use). A serious or critical violation fails the flow; the
 * moderate and minor ones are printed, not failed (the DevTools' Nuxt a11y tab
 * shows them while developing). The scan is `expectAccessible` (e2e/support.ts);
 * a violation that is known and cannot be fixed here goes in its ALLOWED with the
 * reason, never by turning a rule off for a whole screen. Your shelf's screens
 * are scanned in e2e/shelf.spec.ts, where the owner's flows take turns.
 */

function book(title: string, author: string, pages: number | null): BookSnapshot {
  return {
    title: runTitle(title),
    authors: [author],
    isbn13: null,
    isbn10: null,
    pageCount: pages,
    year: 1965,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: 'A book written for the accessibility flow, with a description long enough to be a paragraph.',
    coverUrl: null,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

/** A Library with something in every state: three reads finished (one this year, one unrated), one abandoned, one being read with a day of progress, one wanted. */
async function seed(page: Page, client: Parameters<typeof createLibrary>[0]) {
  const library = createLibrary(client)
  const add = async (snapshot: BookSnapshot, reads: [string, string, number | null, ('finished' | 'abandoned')?][]) => {
    const entry = (await library.addToLibrary(snapshot)).data!
    for (const [started, ended, rating, outcome = 'finished'] of reads) {
      await sql('insert into public.reading_sessions (entry_id, started_on, ended_on, outcome, rating) values ($1, $2, $3, $4, $5)', [
        entry.id,
        started,
        ended,
        outcome,
        rating,
      ])
    }
    return entry
  }
  await add(book('Dune', 'Frank Herbert', 896), [['2025-04-12', '2025-05-17', 16]])
  // Read this year: Home's tally counts it and opens its sheet.
  await add(book('The Dispossessed', 'Ursula K. Le Guin', 387), [[addDays(isoDay(), -9), addDays(isoDay(), -3), 18]])
  await add(book('Piranesi', 'Susanna Clarke', 272), [['2024-11-27', '2024-12-29', null]])
  await add(book('Ruin', 'John Gwynne', 800), [['2025-02-04', '2025-02-04', null, 'abandoned']])
  await add(book('Up Next', 'Ursula K. Le Guin', 200), [])
  const eden = await add(book('East of Eden', 'John Steinbeck', 608), [])
  await library.startReading(eden.id, addDays(isoDay(), -2))
  const [read] = await sql<{ id: string }>('select id from public.reading_sessions where entry_id = $1', [eden.id])
  await sql('insert into public.reading_progress_days (session_id, day, start_page, end_page) values ($1, $2, 0, 24)', [read!.id, isoDay()])
  await page.reload()
  await expect(page.getByTestId('home.title')).toBeVisible()
}

/** Opens a sheet with a tap and waits for it to be in place. */
async function openSheet(page: Page, opener: string, sheet: string) {
  await page.getByTestId(opener).first().click()
  await expect(page.getByTestId(sheet)).toBeVisible()
  await untilStill(page)
}

async function closeSheet(page: Page, sheet: string) {
  await page.keyboard.press('Escape')
  await expect(page.getByTestId(sheet)).toBeHidden()
  await untilStill(page)
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`accessibility, ${colorScheme}`, () => {
    test.use({ colorScheme, viewport: { width: 412, height: 915 } })

    test('the way in: sign in, sign up, the code', async ({ page }) => {
      await page.goto('/sign-up')
      await expect(page.getByTestId('signUp.title')).toBeVisible()
      await expectAccessible(page, 'sign up')

      const member = await signUpMember()
      await emailCooldown()
      await page.goto('/sign-in')
      await expect(page.getByTestId('signIn.title')).toBeVisible()
      await expectAccessible(page, 'sign in')
      await page.getByTestId('signIn.email').fill(member.email)
      await page.getByTestId('signIn.submit').click()
      await expect(page).toHaveURL(/\/verify$/)
      await expectAccessible(page, 'the code')
      await page.getByTestId('verify.code').fill(await readMailedCode(member.email, 2))
      await expect(page.getByTestId('home.title')).toBeVisible()
    })

    test('Home, its sheet, the search palette and its results', async ({ page }) => {
      await recordedApple(page)
      const member = await signedIn(page)
      await expectAccessible(page, 'Home, empty')
      await seed(page, member.client)
      await expectAccessible(page, 'Home')
      await openSheet(page, 'home.tally', 'homeTally')
      await expectAccessible(page, "Home's Read in sheet")
      await closeSheet(page, 'homeTally')

      await page.getByTestId('shell.tab.search').click()
      await expect(page.getByTestId('search.query')).toBeFocused()
      await untilStill(page)
      await expectAccessible(page, 'the search palette')
      await page.getByTestId('search.query').fill('Piranesi')
      await expect(page.getByTestId('search.result').first()).toBeVisible()
      await expectAccessible(page, 'search results')
    })

    test('the Library: its segments, the filters, Collections', async ({ page }) => {
      const member = await signedIn(page)
      await seed(page, member.client)
      await page.getByTestId('shell.tab.library').click()
      for (const segment of ['want_to_read', 'reading', 'finished']) {
        await page.getByTestId(`library.segment.${segment}`).click()
        await expectAccessible(page, `the Library, ${segment}`)
      }
      await page.getByTestId('library.filter.notFinished').click()
      await expectAccessible(page, 'the Library, not finished')
      await page.goto('/collections')
      await expect(page.getByTestId('collections.title')).toBeVisible()
      await expectAccessible(page, 'Collections')
    })

    test('a Book in every status, and its sheets', async ({ page }) => {
      await recordedApple(page)
      const member = await signedIn(page)
      await seed(page, member.client)

      // Being read: the page, Update progress (the wheel), Finish, Abandon, the options, Change edition.
      await page.getByTestId('home.entry').first().click()
      await expect(page.getByTestId('book.title')).toBeVisible()
      await expectAccessible(page, 'a Book being read')
      await openSheet(page, 'book.updateProgress', 'progress')
      await expectAccessible(page, 'Update progress')
      await closeSheet(page, 'progress')
      await openSheet(page, 'book.finish', 'finish')
      await expectAccessible(page, 'Finish')
      await closeSheet(page, 'finish')
      await openSheet(page, 'book.abandon', 'abandon')
      await expectAccessible(page, 'Abandon')
      await closeSheet(page, 'abandon')
      await openSheet(page, 'book.options', 'bookOptions')
      await expectAccessible(page, "a Book's options")
      await page.getByTestId('bookOptions.changeEdition').click()
      await expect(page.getByTestId('edition')).toBeVisible()
      await expect(page.getByTestId('edition.loading')).toHaveCount(0)
      await expectAccessible(page, 'Change edition')
      await closeSheet(page, 'edition')

      // Wanted: Start.
      await page.getByTestId('shell.tab.library').click()
      await page.getByTestId('library.segment.want_to_read').click()
      await page.getByTestId('library.entry').first().click()
      await expect(page.getByTestId('book.title')).toBeVisible()
      await expectAccessible(page, 'a wanted Book')
      await openSheet(page, 'book.start', 'start')
      await expectAccessible(page, 'Start reading')
      await closeSheet(page, 'start')

      // Finished, with its reads.
      await page.getByTestId('shell.tab.library').click()
      await page.getByTestId('library.segment.finished').click()
      await page.getByTestId('library.entry').first().click()
      await expect(page.getByTestId('book.title')).toBeVisible()
      await expectAccessible(page, 'a finished Book')

      // Not in the Library: from a search result, and Add.
      await page.getByTestId('shell.tab.search').click()
      await page.getByTestId('search.query').fill('Klara')
      await page.getByTestId('search.result').first().click()
      await expect(page.getByTestId('book.add')).toBeVisible()
      await expectAccessible(page, 'a Book not in the Library')
      await openSheet(page, 'book.add', 'add')
      await expectAccessible(page, 'Add')
    })

    test('the Profile, its sheets and a year in review', async ({ page }) => {
      const member = await signedIn(page)
      await seed(page, member.client)
      await page.getByTestId('shell.avatar').click()
      await expect(page.getByTestId('profile.title')).toBeVisible()
      await expect(page.getByTestId('profile.figures')).toBeVisible()
      await expectAccessible(page, 'the Profile')
      await openSheet(page, 'profile.stars.4', 'profileReads')
      await expectAccessible(page, "the Profile's reads sheet")
      await closeSheet(page, 'profileReads')
      await openSheet(page, 'profile.links', 'links')
      await expectAccessible(page, 'Book links')
      await closeSheet(page, 'links')
      await page.goto('/profile/2025')
      await expect(page.getByTestId('yearInReview.title')).toHaveText('2025')
      await expectAccessible(page, 'a year in review')
    })
  })
}

/**
 * What axe cannot see: the keyboard. The Library's segments are tabs (the arrows move between
 * them), a sheet takes focus, keeps it and gives it back on Escape, and saving progress on
 * Home's card leaves focus on the card's button, now Undo, with the save said in a status.
 */
test.describe('accessibility, the keyboard', () => {
  test.use({ viewport: { width: 412, height: 915 } })

  test('the Library segments are tabs, a sheet keeps and returns focus, a save keeps focus on its card', async ({ page }) => {
    const member = await signedIn(page)
    await seed(page, member.client)

    // Home's card: Update opens the sheet; Save gives focus back to the same button, now Undo.
    await page.getByTestId('home.update').focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('progress')).toBeVisible()
    await untilStill(page)
    await page.getByTestId('progress.wheel').focus()
    await page.keyboard.press('ArrowUp')
    await page.getByTestId('progress.action').click()
    await expect(page.getByTestId('progress')).toBeHidden()
    await expect(page.getByTestId('home.undo')).toBeFocused()
    await expect(page.getByTestId('home.readingCard').getByRole('status')).toContainText('+1')

    // The segments: one Tab stop, the arrows move and show.
    await page.getByTestId('shell.tab.library').click()
    const want = page.getByTestId('library.segment.want_to_read')
    await expect(want).toHaveAttribute('tabindex', '0')
    await expect(page.getByTestId('library.segment.finished')).toHaveAttribute('tabindex', '-1')
    await want.focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('library.segment.reading')).toBeFocused()
    await expect(page.getByTestId('library.segment.reading')).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await expect(page.getByTestId('library.segment.finished')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tabpanel')).toHaveAccessibleName(/^Finished/)

    // A sheet: focus goes in and stays in (the page behind is inert); Escape gives it back.
    await page.getByTestId('library.segment.want_to_read').click()
    await page.getByTestId('library.entry').first().click()
    const start = page.getByTestId('book.start')
    await start.focus()
    await page.keyboard.press('Enter')
    const sheet = page.getByTestId('start')
    await expect(sheet).toBeVisible()
    await untilStill(page)
    // Tab never lands on the page behind it (past the sheet's last control it leaves the document).
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab')
      expect(await sheet.evaluate((el) => el.contains(document.activeElement) || document.activeElement === document.body)).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
    await expect(start).toBeFocused()
  })
})
