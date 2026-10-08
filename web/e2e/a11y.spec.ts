import { expect, type Page } from '@playwright/test'
import sharp from 'sharp'
import type { BookSnapshot } from '../app/data/books'
import { createLibrary } from '../app/data/library'
import { addDays, isoDay } from '../app/utils/dates'
import { signUpMember } from '../tests/support/member'
import { emailCooldown, readMailedCode, runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { enrichedLibrary, forgetEnriched } from './enriched'
import { test } from './fixtures'
import { endFromBook, expectAccessible, openProfile, recordedApple, recordedTitleQuery, signedIn, untilStill } from './support'

/**
 * Accessibility (docs/ACCESSIBILITY.md): axe-core over every main screen and
 * sheet, in the light and the dark room, on a phone (412 × 915, the Pixel the
 * Android checks use). A serious or critical violation fails the flow; the
 * moderate and minor ones are printed, not failed (the DevTools' Nuxt a11y tab
 * shows them while developing). The scan is `expectAccessible` (e2e/support.ts);
 * a violation that is known and cannot be fixed here goes in its ALLOWED with the
 * reason, never by turning a rule off for a whole screen. Your shelf's screens
 * are scanned in e2e/shelf.spec.ts, where the owner's flows take turns; the reading page,
 * its Book cards and their sheets (#171) in e2e/reading-page.spec.ts. The reader
 * (#131) is scanned in each of its three rooms in e2e/a11y-reader.spec.ts (Chromium).
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
  // Their genres (#168): the chips on the Book page, the sheet, the Library's filter and the Profile's rows.
  const genred = async (entry: { book: { id: string } }, ...genres: string[]) => {
    for (const [rank, genre] of genres.entries())
      await sql(`insert into public.book_genres (book_id, genre_id, rank, source, confidence, map_version) values ($1, $2, $3, 'wikidata', 1, 1)`, [entry.book.id, genre, rank + 1])
  }
  await genred(await add(book('Dune', 'Frank Herbert', 896), [['2025-04-12', '2025-05-17', 16]]), 'sci-fi', 'fantasy')
  // Read this year: Home's tally counts it and opens its sheet.
  await genred(await add(book('The Dispossessed', 'Ursula K. Le Guin', 387), [[addDays(isoDay(), -9), addDays(isoDay(), -3), 18]]), 'sci-fi', 'literary')
  await genred(await add(book('Piranesi', 'Susanna Clarke', 272), [['2024-11-27', '2024-12-29', null]]), 'fantasy')
  await add(book('Ruin', 'John Gwynne', 800), [['2025-02-04', '2025-02-04', null, 'abandoned']])
  await add(book('Up Next', 'Ursula K. Le Guin', 200), [])
  const eden = await add(book('East of Eden', 'John Steinbeck', 608), [])
  await library.startReading(eden.id, addDays(isoDay(), -2))
  const [read] = await sql<{ id: string }>('select id from public.reading_sessions where entry_id = $1', [eden.id])
  await sql('insert into public.reading_progress_days (session_id, day, start_page, end_page) values ($1, $2, 0, 24)', [read!.id, isoDay()])
  await page.reload()
  await expect(page.getByTestId('home.title')).toBeVisible()
}

/** A small picture for the photo's sheets. */
function samplePhoto(): Promise<Buffer> {
  return sharp({ create: { width: 600, height: 400, channels: 3, background: { r: 180, g: 140, b: 90 } } }).png().toBuffer()
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
  test.describe(`accessibility, ${colorScheme}`, { tag: '@full' }, () => {
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
      await openSheet(page, 'library.view.filter', 'libraryFilter')
      await page.getByTestId('libraryFilter.status.notFinished').click()
      await page.getByTestId('libraryFilter.action').click()
      await expect(page.getByTestId('libraryFilter')).toBeHidden()
      await untilStill(page)
      await expectAccessible(page, 'the Library, not finished')
      await page.getByTestId('library.view.clear').click()
      await untilStill(page)
      // Filter and sort (#169): the pills, the sheets, a filter set (chips, count), nothing matching.
      await openSheet(page, 'library.view.filter', 'libraryFilter')
      await expectAccessible(page, 'the Library, Filter')
      await page.getByTestId('libraryFilter.rating.4').click()
      await page.getByTestId('libraryFilter.action').click()
      await expect(page.getByTestId('libraryFilter')).toBeHidden()
      await untilStill(page)
      await expect(page.getByTestId('library.view.chip')).toHaveCount(1)
      await expectAccessible(page, 'the Library, filtered')
      await openSheet(page, 'library.view.sort', 'librarySort')
      await expectAccessible(page, 'the Library, Sort')
      await closeSheet(page, 'librarySort')
      await openSheet(page, 'library.view.filter', 'libraryFilter')
      await page.getByTestId('libraryFilter.pagesMin').fill('9000')
      await page.getByTestId('libraryFilter.action').click()
      await expect(page.getByTestId('library.viewEmpty')).toBeVisible()
      await untilStill(page)
      await expectAccessible(page, 'the Library, nothing matches')
      await page.getByTestId('library.viewEmpty.clear').click()
      await untilStill(page)
      await page.goto('/collections')
      await expect(page.getByTestId('collections.title')).toBeVisible()
      await expectAccessible(page, 'Collections')
    })

    test('a Book in every status, and its sheets', async ({ page }) => {
      // Eleven scans and four Books: longer than a usual flow, above all on CI's two cores.
      test.slow()
      await recordedApple(page)
      const member = await signedIn(page)
      await seed(page, member.client)

      // Being read: the page, Update progress (the wheel, Finish and DNF under it), Finish, Abandon
      // (both from that sheet), the options (Read as), Change edition.
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
      await endFromBook(page, 'abandon')
      await expectAccessible(page, 'Abandon')
      await closeSheet(page, 'abandon')
      await openSheet(page, 'book.options', 'bookOptions')
      await expectAccessible(page, "a Book's options")
      await page.getByTestId('bookOptions.changeEdition').click()
      await expect(page.getByTestId('edition')).toBeVisible()
      await expect(page.getByTestId('edition.loading')).toHaveCount(0)
      await expectAccessible(page, 'Change edition')
      // My edition isn't listed: the ISBN, nothing found, her own edition's form with a wrong field.
      await page.getByTestId('edition.missing').click()
      await expect(page.getByTestId('ownEdition')).toBeVisible()
      await untilStill(page)
      await expectAccessible(page, "My edition isn't listed")
      await page.getByTestId('ownEdition.isbn').fill('979-0-000042-01-8')
      await page.getByTestId('ownEdition.lookUp').click()
      await expect(page.getByTestId('ownEdition.notFound')).toBeVisible()
      await expectAccessible(page, "My edition isn't listed, nothing found")
      await page.getByTestId('ownEdition.startOwn').click()
      await page.getByTestId('ownEdition.submit').click()
      await expect(page.getByTestId('ownEdition.invalid')).toBeVisible()
      await expectAccessible(page, 'her own edition')
      await closeSheet(page, 'ownEdition')

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
      await expect(page.getByTestId('book.genre').first()).toBeVisible()
      await openSheet(page, 'book.genresEdit', 'genreSheet')
      await expectAccessible(page, 'the genres sheet')
      await closeSheet(page, 'genreSheet')

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

    test('an author\'s page, a series and its correction, Home\'s next in series', async ({ page }) => {
      const member = await signedIn(page)
      const data = await enrichedLibrary(member.client)
      try {
        await page.goto(`/author/${data.authors.pratchett}`)
        await expect(page.getByTestId('author.name')).toBeVisible()
        await expectAccessible(page, "an author's page")
        await page.goto(`/book/${data.entries.feetOfClay.book.id}`)
        await expect(page.getByTestId('book.series')).toBeVisible()
        await expectAccessible(page, 'a Book in a series')
        await openSheet(page, 'book.series', 'series')
        await expectAccessible(page, 'the series sheet')
        await page.getByTestId('series.correct').click()
        await expect(page.getByTestId('seriesEdit')).toBeVisible()
        await untilStill(page)
        await expectAccessible(page, 'correcting a series')
        await closeSheet(page, 'seriesEdit')
        await page.goto('/')
        await expect(page.getByTestId('home.nextInSeries')).toBeVisible()
        await expectAccessible(page, "Home with the next in a series")
      } finally {
        await forgetEnriched(data.ids)
      }
    })

    test('the Profile, its sheets and a year in review', async ({ page }) => {
      const member = await signedIn(page)
      await seed(page, member.client)
      // Until the reading record is in and has come to rest: its figures and lines fade in over `standard`
      // (`arrive`), and a scan that starts before them reads colours half way (#7c7872 for inkFaint).
      await openProfile(page)
      await expect(page.getByTestId('profile.figures')).toBeVisible()
      await expectAccessible(page, 'the Profile')
      await openSheet(page, 'profile.stars.4', 'profileReads')
      await expectAccessible(page, "the Profile's reads sheet")
      await closeSheet(page, 'profileReads')
      await openSheet(page, 'profile.links', 'links')
      await expectAccessible(page, 'Book links')
      await closeSheet(page, 'links')
      await openSheet(page, 'profile.whatsNew', 'whatsNew')
      await expectAccessible(page, "What's new")
      await closeSheet(page, 'whatsNew')
      // The photo (#156): the crop, then the sheet of a saved photo.
      await page.getByTestId('photo.file').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: await samplePhoto() })
      await expect(page.getByTestId('photo.picture')).toBeVisible()
      await untilStill(page)
      await expectAccessible(page, 'the photo crop')
      await page.getByTestId('photo.action').click()
      await expect(page.getByTestId('photo')).toBeHidden()
      await untilStill(page)
      await openSheet(page, 'profile.avatar', 'photo')
      await expectAccessible(page, 'the photo sheet')
      await closeSheet(page, 'photo')
      await page.goto('/profile/2025')
      await expect(page.getByTestId('yearInReview.title')).toHaveText('2025')
      // Her favourite is the record's: in once the year has arrived, and the page has come to rest.
      await expect(page.getByTestId('yearInReview.favouriteTitle')).toBeVisible()
      await expectAccessible(page, 'a year in review')
    })

    test('Import: the apps it reads, how to export from each, a refused file', async ({ page }) => {
      await signedIn(page)
      await page.goto('/import')
      await expect(page.getByTestId('import.howTo')).toBeVisible()
      await expectAccessible(page, 'Import')
      await page.getByTestId('import.howTo.hardcover').click()
      await expect(page.getByTestId('import.howTo.hardcover.text')).toBeVisible()
      await page.getByTestId('import.file').setInputFiles({ name: 'notes.csv', mimeType: 'text/csv', buffer: Buffer.from('Name,Email\nA,B\n') })
      await expect(page.getByTestId('import.fileError')).toBeVisible()
      await expectAccessible(page, 'Import, how to export and a refused file')
    })

    test('Import: the preview with a book to choose an edition for, and the Choose edition sheet', async ({ page }) => {
      await recordedTitleQuery(page)
      await signedIn(page)
      await page.goto('/import')
      const header =
        'Book Id,Title,Author,ISBN,ISBN13,My Rating,Publisher,Number of Pages,Year Published,Date Read,Date Added,Exclusive Shelf,My Review'
      await page.getByTestId('import.file').setInputFiles({
        name: 'goodreads_library_export.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(`${header}\n991,Piranesi,Susanna Clarke,,,0,,,,,2025/06/12,to-read,\n`),
      })
      await expect(page.getByTestId('import.start')).toBeVisible({ timeout: 30_000 })
      await expectAccessible(page, 'Import preview, a book to choose an edition for')
      await openSheet(page, 'import.attentionList.action', 'edition')
      await expect(page.getByTestId('edition.loading')).toHaveCount(0, { timeout: 30_000 })
      await expectAccessible(page, 'Choose edition')
      await closeSheet(page, 'edition')
      await page.getByTestId('import.attentionList.action').first().click()
      await page.getByTestId('edition.candidate').nth(1).click()
      await page.getByTestId('edition.action').click()
      await expect(page.getByTestId('import.choices')).toBeVisible()
      await expectAccessible(page, 'Import preview, her choices')
    })
  })
}

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
