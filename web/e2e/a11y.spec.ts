import { expect, type Page } from '@playwright/test'
import type { BookSnapshot } from '../app/data/books'
import { createLibrary } from '../app/data/library'
import { addDays, isoDay } from '../app/utils/dates'
import { signUpMember } from '../tests/support/member'
import { emailCooldown, readMailedCode, runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { test } from './fixtures'
import { endFromBook, expectAccessible, openProfile, recordedApple, signedIn, untilStill } from './support'

/**
 * Accessibility (docs/ACCESSIBILITY.md): axe-core over the screens and sheets of the critical paths
 * (the way in, Home and the search, a Book with Start, Update progress, Finish and Add, the Library,
 * the Profile), in the dark room only (the design's own; the text tokens are checked in both
 * themes by their contrast table in docs/ACCESSIBILITY.md), on a phone (412 × 915, the Pixel the
 * Android checks use). A serious or critical violation fails the flow; the
 * moderate and minor ones are printed, not failed (the DevTools' Nuxt a11y tab
 * shows them while developing). The scan is `expectAccessible` (e2e/support.ts);
 * a violation that is known and cannot be fixed here goes in its ALLOWED with the
 * reason, never by turning a rule off for a whole screen. The public reading page, its Book cards
 * and the waitlist form are scanned in e2e/reading-page.spec.ts.
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

/**
 * A linked author with her works (#167): the Book page's "More from the author". The Books are hers; the
 * works are the Books' own and some more she has, each with an edition to open. Named with the run tag,
 * so the sweep finds them (tests/support/stack.ts).
 */
async function linkedAuthor(name: string, books: { book: { id: string; title: string } }[], more: string[]) {
  const key = (suffix: 'A' | 'W') => `OL${Math.floor(1_000_000 + Math.random() * 9_000_000)}${suffix}`
  const [author] = await sql<{ id: string }>(
    `insert into public.authors (openlibrary_key, name, birth_date, birth_precision, summaries, fetched_at, works_fetched_at)
     values ($1, $2, '1929-10-21', 11, $3::jsonb, now(), now()) returning id`,
    [key('A'), runTitle(name), JSON.stringify({ en: { text: 'An American author of novels, short stories, poetry and essays, best known for her science fiction and fantasy.', title: name, url: 'https://en.wikipedia.org/wiki/Ursula_K._Le_Guin' } })],
  )
  const work = async (title: string, bookId?: string) => {
    const isbn13 = `978${Math.floor(1_000_000_000 + Math.random() * 8_999_999_999)}`.slice(0, 13)
    const edition = bookId ? {} : { en: { title, isbn13, openlibrary_edition_key: null, cover_url: null } }
    const [w] = await sql<{ id: string }>(
      `insert into public.works (openlibrary_key, title, first_year, kind, editions, fetched_at) values ($1, $2, 1966, 'novel', $3::jsonb, now()) returning id`,
      [key('W'), title, JSON.stringify(edition)],
    )
    await sql('insert into public.work_authors (work_id, author_id, position) values ($1, $2, 1)', [w!.id, author!.id])
    if (bookId) await sql(`insert into public.book_works (book_id, work_id, matched_by) values ($1, $2, 'title')`, [bookId, w!.id])
  }
  for (const entry of books) {
    await work(entry.book.title, entry.book.id)
    await sql('insert into public.book_authors (book_id, position, author_id) values ($1, 1, $2)', [entry.book.id, author!.id])
  }
  for (const title of more) await work(runTitle(title))
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
  // Their genres (#168): the chips on the Book page, the sheet, the Library's filter and the Profile's rows.
  const genred = async (entry: { book: { id: string } }, ...genres: string[]) => {
    for (const [rank, genre] of genres.entries())
      await sql(`insert into public.book_genres (book_id, genre_id, rank, source, confidence, map_version) values ($1, $2, $3, 'wikidata', 1, 1)`, [entry.book.id, genre, rank + 1])
  }
  await genred(await add(book('Dune', 'Frank Herbert', 896), [['2025-04-12', '2025-05-17', 16]]), 'sci-fi', 'fantasy')
  // Read this year: Home's tally counts it and opens its sheet.
  const dispossessed = await add(book('The Dispossessed', 'Ursula K. Le Guin', 387), [[addDays(isoDay(), -9), addDays(isoDay(), -3), 18]])
  await genred(dispossessed, 'sci-fi', 'literary')
  await genred(await add(book('Piranesi', 'Susanna Clarke', 272), [['2024-11-27', '2024-12-29', null]]), 'fantasy')
  // A finished read whose Book has no page count: the Pages card's "N without a count" line opens it.
  const lathe = await add(book('The Lathe of Heaven', 'Ursula K. Le Guin', null), [['2024-03-02', '2024-03-20', null]])
  await add(book('Ruin', 'John Gwynne', 800), [['2025-02-04', '2025-02-04', null, 'abandoned']])
  const upNext = await add(book('Up Next', 'Ursula K. Le Guin', 200), [])
  await linkedAuthor('Ursula K. Le Guin', [dispossessed, lathe, upNext], ['Rocannon\'s World', 'The Left Hand of Darkness', 'A Wizard of Earthsea'])
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

test.describe('accessibility, dark', { tag: '@full' }, () => {
  test.use({ colorScheme: 'dark', viewport: { width: 412, height: 915 } })

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

  test('the Library: its three segments', async ({ page }) => {
    const member = await signedIn(page)
    await seed(page, member.client)
    await page.getByTestId('shell.tab.library').click()
    for (const segment of ['want_to_read', 'reading', 'finished']) {
      await page.getByTestId(`library.segment.${segment}`).click()
      await expectAccessible(page, `the Library, ${segment}`)
    }
  })

  test('a Book in every status, and its sheets', async ({ page }) => {
    // Seven scans and four Books: longer than a usual flow, above all on CI's two cores.
    test.slow()
    await recordedApple(page)
    const member = await signedIn(page)
    await seed(page, member.client)

    // Being read: the page, Update progress (the wheel), Finish.
    await page.getByTestId('home.entry').first().click()
    await expect(page.getByTestId('book.title')).toBeVisible()
    await expectAccessible(page, 'a Book being read')
    await openSheet(page, 'book.updateProgress', 'progress')
    await expect(page.getByTestId('progress.abandonRow')).toBeVisible()
    await expectAccessible(page, 'Update progress')
    await closeSheet(page, 'progress')
    await endFromBook(page, 'finish')
    await expectAccessible(page, 'Finish')
    await closeSheet(page, 'finish')

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
    // Her author under it (#167): the section starts when it nears the viewport, then opens.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await expect(page.getByTestId('book.authorMoreWork').first()).toBeVisible()
    await untilStill(page)
    await expectAccessible(page, 'a Book, its author below')

    // Not in the Library: from a search result, and Add.
    await page.getByTestId('shell.tab.search').click()
    // Apple's Piranesi, not hers: the Catalogue (her own and every other flow's) answers nothing here.
    await page.route(/\/rest\/v1\/rpc\/search_books/, async (route) => route.fulfill({ response: await route.fetch(), body: '[]' }))
    await page.getByTestId('search.query').fill('Piranesi')
    // The first result the sources found, after her own group ("In your Library").
    await page.locator('[data-testid="search.results"] > li[data-near-key]').first().getByTestId('search.result').click()
    await expect(page.getByTestId('book.add')).toBeVisible()
    await expectAccessible(page, 'a Book not in the Library')
    await openSheet(page, 'book.add', 'add')
    await expectAccessible(page, 'Add')
  })

  test('the Profile, where she signs out and deletes her account', async ({ page }) => {
    const member = await signedIn(page)
    await seed(page, member.client)
    // Until the reading record is in and has come to rest: its figures and lines fade in over `standard`
    // (`arrive`), and a scan that starts before them reads colours half way (#7c7872 for inkFaint).
    await openProfile(page)
    await expect(page.getByTestId('profile.figures')).toBeVisible()
    await expectAccessible(page, 'the Profile')
  })
})

/**
 * What axe cannot see: the keyboard. The Library's segments are tabs (the arrows move between
 * them), a sheet takes focus, keeps it and gives it back on Escape, and saving progress on
 * Home's card leaves focus on the card's button, now Undo, with the save said in a status.
 */
test.describe('accessibility, the keyboard', { tag: '@full' }, () => {
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

  test('a Book being read has one action; Finish and DNF follow each other in its sheet, and focus comes back to it', async ({ page }) => {
    const member = await signedIn(page)
    await seed(page, member.client)
    await page.getByTestId('home.entry').first().click()
    const update = page.getByTestId('book.updateProgress')
    await expect(update).toBeVisible()
    await untilStill(page)
    await update.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('progress')).toBeVisible()
    await untilStill(page)
    // Finish, then DNF under it: next to each other in the focus order, as they are read (WebKit's
    // Tab skips buttons, like Safari's default, so the order is read from the document).
    const order = await page.getByTestId('progress').evaluate((sheet) =>
      [...sheet.querySelectorAll<HTMLElement>('button:not([disabled]), input, [tabindex]:not([tabindex="-1"])')].map((el) => el.dataset.testid),
    )
    expect(order.slice(-2)).toEqual(['progress.finish', 'progress.abandon'])
    await page.getByTestId('progress.abandon').focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('abandon')).toBeVisible()
    await untilStill(page)
    // The DNF sheet took over from the progress sheet; leaving it gives focus back to the page's action.
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('abandon')).toBeHidden()
    await expect(update).toBeFocused()
  })
})
