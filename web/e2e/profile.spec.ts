import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import type { BookSnapshot } from '../app/data/books'
import { createLibrary } from '../app/data/library'
import { addDays, isoDay } from '../app/utils/dates'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { test } from './fixtures'
import { signedIn, untilStill } from './support'

/**
 * The Profile (issue #78): the avatar opens it, a pushed screen with the hero
 * (the address while she has no name, since when she reads, the Library in one
 * line), the year pills (All first and lit), the four figures, the books by
 * year (a year opens its review) or by month (a month opens its books), the
 * reading days, the ratings (a row opens the books rated so, a second read
 * marked), the records, the authors read more than once, the years in review,
 * and the account. A year in review: its figures, its months as covers, the
 * favourite, the years either side. The reads are written as an import would
 * (dates in the past). With docs/parity.md (Profile, Year in review) this is
 * the behavioural reference.
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

type Read = [started: string | null, ended: string, rating: number | null, outcome?: 'finished' | 'abandoned']

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key]))
/** The plural form of a `one | many` message. */
const plural = (template: string, count: number, values: Record<string, string | number> = {}) =>
  fill(template.split(' | ')[count === 1 ? 0 : 1]!, { count, ...values })

async function seed(page: Page, client: Parameters<typeof createLibrary>[0], more: [BookSnapshot, Read[]][] = []) {
  const library = createLibrary(client)
  const add = async (snapshot: BookSnapshot, reads: Read[]) => {
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
  await add(book('Dune Messiah', 'Frank Herbert', 336), [['2025-05-22', '2025-07-23', 19]])
  await add(book('Piranesi', 'Susanna Clarke', 272), [
    ['2024-11-27', '2024-12-29', 20],
    ['2025-08-31', '2025-09-09', 20],
  ])
  await add(book('Ruin', 'John Gwynne', 800), [['2025-02-04', '2025-02-04', null, 'abandoned']])
  await add(book('Up Next', 'Ursula K. Le Guin', 200), [])
  // Being read, with a day of progress today.
  const eden = await add(book('East of Eden', 'John Steinbeck', 608), [])
  await library.startReading(eden.id, addDays(isoDay(), -2))
  const [read] = await sql<{ id: string }>('select id from public.reading_sessions where entry_id = $1', [eden.id])
  await sql('insert into public.reading_progress_days (session_id, day, start_page, end_page) values ($1, $2, 0, 24)', [read!.id, isoDay()])
  for (const [snapshot, reads] of more) await add(snapshot, reads)
  await page.reload()
}

test('the avatar opens the Profile: the figures of all years and of one, the sheets, the year in review', async ({ page }) => {
  const member = await signedIn(page)
  await seed(page, member.client)

  // The avatar opens the Profile, pushed: the hero, All lit.
  await page.getByTestId('shell.avatar').click()
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.getByTestId('profile.title')).toHaveText(member.email)
  await expect(page.getByTestId('profile.since')).toHaveText(fill(en.profile.since, { date: 'November 2024' }))
  await expect(page.getByTestId('profile.library')).toHaveText(fill(en.profile.library, { read: 3, reading: 1, want: 1 }))
  await expect(page.getByTestId('profile.year.all')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('profile.years').getByRole('button')).toHaveText([en.profile.all, '2025', '2024'])

  // All: four finished reads (a re-read counts), the re-read and the DNF under them.
  await expect(page.getByTestId('profile.books')).toHaveText('4')
  await expect(page.getByTestId('profile.booksLine')).toHaveText(
    `${fill(en.profile.figures.rereads, { count: 1 })} · ${fill(en.profile.figures.dnf, { count: 1 })}`,
  )
  await expect(page.getByTestId('profile.pages')).toHaveText('1,776')
  await expect(page.getByTestId('profile.average')).toHaveText('4.7')
  await expect(page.getByTestId('profile.daysABook')).toHaveText('35') // 10, 33, 36, 63: the middle two's mean, rounded
  await expect(page.getByTestId('profile.daysRead')).toHaveText('1/30')
  await expect(page.getByTestId('profile.pagesADay')).toHaveText('24')
  await expect(page.getByTestId('profile.record.longest').getByTestId('profile.readTitle')).toHaveText(runTitle('Dune'))
  await expect(page.getByTestId('profile.authorName')).toHaveText(['Susanna Clarke', 'Frank Herbert']) // a re-read is a return too
  await expect(page.getByTestId('profile.yearCard.2025')).toBeVisible()

  // A star row opens the books rated so, best first; the second read is marked.
  await page.getByTestId('profile.stars.5').click()
  await expect(page.getByTestId('profileReads.sheetTitle')).toHaveText(plural(en.profile.sheet.stars, 5, { year: en.profile.sheet.allYears }))
  await expect(page.getByTestId('profileReads.read').getByTestId('profile.readTitle')).toHaveText([runTitle('Piranesi'), runTitle('Piranesi')])
  await expect(page.getByTestId('profileReads.read').first().getByTestId('profile.readAgain')).toHaveText(en.history.ordinal.second)
  await page.getByTestId('profileReads.cancel').click()
  await expect(page.getByTestId('profileReads')).toBeHidden()

  // Under All, a year's column opens its review; back is the Profile.
  await page.getByTestId('profile.columns.2024').click()
  await expect(page).toHaveURL(/\/profile\/2024$/)
  await expect(page.getByTestId('yearInReview.title')).toHaveText('2024')
  await page.getByTestId('yearInReview.back').click()
  await expect(page).toHaveURL(/\/profile$/)

  // One year: its figures; a month opens its books, and a book its page.
  await page.getByTestId('profile.year.2025').click()
  await expect(page.getByTestId('profile.books')).toHaveText('3')
  await expect(page.getByTestId('profile.columns.6')).toBeDisabled()
  await page.getByTestId('profile.columns.5').click()
  await expect(page.getByTestId('profileReads.sheetTitle')).toHaveText(fill(en.profile.sheet.month, { month: 'May', year: 2025 }))
  await expect(page.getByTestId('profileReads.read').getByTestId('profile.readTitle')).toHaveText([runTitle('Dune')])
  await page.getByTestId('profileReads.read').click()
  await expect(page.getByTestId('book.title')).toHaveText(runTitle('Dune'))
  // Back from the book: the Profile with the sheet it was opened from, open again.
  await page.goBack()
  await expect(page.getByTestId('profileReads.sheetTitle')).toHaveText(fill(en.profile.sheet.month, { month: 'May', year: 2025 }))
  await expect(page.getByTestId('profile.year.2025')).toHaveAttribute('aria-pressed', 'true')
  // The book page's own back does the same, from a star row's sheet; Cancel then closes it for good.
  await page.getByTestId('profileReads.cancel').click()
  await expect(page.getByTestId('profileReads')).toBeHidden()
  await page.getByTestId('profile.stars.5').click()
  await page.getByTestId('profileReads.read').click()
  await expect(page.getByTestId('book.title')).toHaveText(runTitle('Piranesi'))
  await page.getByTestId('book.back').click()
  await expect(page.getByTestId('profileReads.sheetTitle')).toHaveText(plural(en.profile.sheet.stars, 5, { year: '2025' }))
  await page.getByTestId('profileReads.cancel').click()
  await expect(page.getByTestId('profileReads')).toBeHidden()
  // Opened afresh (not by Back from its book), the Profile starts without a sheet.
  await page.getByTestId('profile.back').click()
  await page.getByTestId('shell.avatar').click()
  await expect(page.getByTestId('profile.year.2025')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('profileReads')).toBeHidden()

  // "2025 in review": its months as covers, the favourite, the year before (in place of this one).
  await page.getByTestId('profile.inReview').click()
  await expect(page).toHaveURL(/\/profile\/2025$/)
  await expect(page.getByTestId('yearInReview.month.5').getByTestId('yearInReview.read')).toHaveCount(1)
  await expect(page.getByTestId('yearInReview.month.6').getByTestId('yearInReview.read')).toHaveCount(0)
  // The covers open a little apart and press together (docs/MOTION.md, Month rows): at rest they carry no transform.
  await expect(page.getByTestId('yearInReview.month.5').locator('[data-intro-cover]')).toHaveCSS('transform', 'none')
  await expect(page.getByTestId('yearInReview.favouriteTitle')).toHaveText(runTitle('Piranesi'))
  await expect(page.getByTestId('yearInReview.after')).toHaveCount(0)
  await page.getByTestId('yearInReview.before').click()
  await expect(page).toHaveURL(/\/profile\/2024$/)
  await expect(page.getByTestId('yearInReview.after')).toBeVisible()
  await page.getByTestId('yearInReview.back').click()
  await expect(page).toHaveURL(/\/profile$/)

  // Back from the Profile is where it was opened.
  await page.getByTestId('profile.back').click()
  await expect(page.getByTestId('home.title')).toBeVisible()
})
/**
 * The Pages figure's line, where it reads "N without a count": a finished read whose
 * Book has no page count, on top of the seed's (every one of which has a count).
 */
test('the Pages card opens the books without a page count', async ({ page }) => {
  const member = await signedIn(page)
  await seed(page, member.client, [[book('Noumenon', 'Marina J. Lostetter', null), [['2025-01-02', '2025-01-20', 16]]]])
  await page.getByTestId('shell.avatar').click()
  await expect(page).toHaveURL(/\/profile$/)

  // Under All the line is a button that says what it opens, and it opens the one read without a count.
  const line = page.getByTestId('profile.pagesMissing')
  await expect(line).toHaveText(fill(en.profile.figures.pagesMissing, { count: 1 }))
  await expect(line).toHaveAttribute('aria-label', fill(en.profile.figures.pagesMissingOpen, { count: 1 }))
  await line.click()
  await expect(page.getByTestId('profileReads.sheetTitle')).toHaveText(en.profile.sheet.pagesMissing)
  await expect(page.getByTestId('profileReads.read').getByTestId('profile.readTitle')).toHaveText([runTitle('Noumenon')])
  // Its row opens the book page, where the page count can be set (#60), and Back from there is the sheet again.
  await page.getByTestId('profileReads.read').click()
  await expect(page.getByTestId('book.title')).toHaveText(runTitle('Noumenon'))
  await page.getByTestId('book.back').click()
  await expect(page.getByTestId('profileReads.sheetTitle')).toHaveText(en.profile.sheet.pagesMissing)
  await page.getByTestId('profileReads.cancel').click()
  await expect(page.getByTestId('profileReads')).toBeHidden()

  // 2025, the year it was read in: the line is the button, and the sheet is that year's.
  await page.getByTestId('profile.year.2025').click()
  await expect(page.getByTestId('profile.pagesMissing')).toHaveText(fill(en.profile.figures.pagesMissing, { count: 1 }))
  await page.getByTestId('profile.pagesMissing').click()
  await expect(page.getByTestId('profileReads.read').getByTestId('profile.readTitle')).toHaveText([runTitle('Noumenon')])
  await page.getByTestId('profileReads.cancel').click()

  // 2024: every read of the year has a count, so the line is plain text and nothing opens from it.
  await page.getByTestId('profile.year.2024').click()
  await expect(page.getByTestId('profile.pagesMissing')).toHaveCount(0)
})
/**
 * The Reading days: a day that was read is a button that opens the books it was read in; a day that was not is
 * a quiet dot. The seed's East of Eden (still being read) has today, 24 pages; Hyperion, finished, has a day of
 * 40 pages ten days ago.
 */
test('a day read in the Reading days opens the books read that day', async ({ page }) => {
  const member = await signedIn(page)
  const today = isoDay()
  const lit = addDays(today, -10)
  await seed(page, member.client, [[book('Hyperion', 'Dan Simmons', 482), [[addDays(today, -12), addDays(today, -9), 16]]]])
  const [hyperion] = await sql<{ id: string }>(
    'select s.id from public.reading_sessions s join public.library_entries e on e.id = s.entry_id join public.books b on b.id = e.book_id where b.title = $1',
    [runTitle('Hyperion')],
  )
  await sql('insert into public.reading_progress_days (session_id, day, start_page, end_page) values ($1, $2, 0, 40)', [hyperion!.id, lit])
  await page.reload()
  await page.getByTestId('shell.avatar').click()
  await expect(page).toHaveURL(/\/profile$/)

  // The English words of a day, as the member's locale gives them: "12 March", "Thursday 12 March".
  const long = (day: string) => {
    const date = new Date(`${day}T00:00:00`)
    return `${date.getDate()} ${date.toLocaleString('en', { month: 'long' })}`
  }
  const title = (day: string) => `${new Date(`${day}T00:00:00`).toLocaleString('en', { weekday: 'long' })} ${long(day)}`

  // Only the two days that were read are buttons, each named by its day and its pages; every other day is a dot.
  const days = page.getByTestId('profile.days')
  await expect(days.getByRole('button')).toHaveCount(2)
  await expect(page.getByTestId(`profile.day.${lit}`)).toHaveAccessibleName(plural(en.profile.days.dayRead, 40, { date: long(lit) }))
  await expect(page.getByTestId(`profile.day.${today}`)).toHaveAccessibleName(plural(en.profile.days.dayRead, 24, { date: long(today) }))
  await expect(page.getByTestId(`profile.day.${addDays(today, -1)}`)).toHaveCount(0)
  await expect(page.getByRole('group', { name: fill(en.profile.days.label, { read: 2, count: 30 }) })).toBeVisible()

  // The button has the room the grid has (its cell and half the gaps, 24 × 20) and the dot is no smaller for it.
  const box = (await page.getByTestId(`profile.day.${lit}`).boundingBox())!
  expect(box.width).toBeGreaterThanOrEqual(24)
  expect(box.height).toBeGreaterThanOrEqual(20)

  // A tap opens the sheet of the day: its title in words, the book read that day, as the other sheets' rows.
  await page.getByTestId(`profile.day.${lit}`).click()
  await expect(page.getByTestId('profileReads.sheetTitle')).toHaveText(title(lit))
  await expect(page.getByTestId('profileReads.read').getByTestId('profile.readTitle')).toHaveText([runTitle('Hyperion')])
  // Its row opens the book page, and Back from there is the sheet again.
  await page.getByTestId('profileReads.read').click()
  await expect(page.getByTestId('book.title')).toHaveText(runTitle('Hyperion'))
  await page.getByTestId('book.back').click()
  await expect(page.getByTestId('profileReads.sheetTitle')).toHaveText(title(lit))
  await page.getByTestId('profileReads.cancel').click()
  await expect(page.getByTestId('profileReads')).toBeHidden()

  // From the keyboard: Tab to the day, Enter; a read still going is named like any other.
  await page.getByTestId(`profile.day.${today}`).focus()
  await expect(page.getByTestId(`profile.day.${today}`)).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('profileReads.sheetTitle')).toHaveText(title(today))
  await expect(page.getByTestId('profileReads.read').getByTestId('profile.readTitle')).toHaveText([runTitle('East of Eden')])
  await page.getByTestId('profileReads.cancel').click()
  await expect(page.getByTestId('profileReads')).toBeHidden()
})

test('a member with nothing finished yet sees the empty Profile and her account', async ({ page }) => {
  const member = await signedIn(page)
  await page.getByTestId('shell.avatar').click()
  await expect(page.getByTestId('profile.empty')).toContainText(en.profile.empty.title)
  await expect(page.getByTestId('profile.figures')).toHaveCount(0)
  await expect(page.getByTestId('profile.library')).toHaveText(fill(en.profile.library, { read: 0, reading: 0, want: 0 }))
  await expect(page.getByTestId('profile.email')).toHaveText(member.email)
  await expect(page.getByTestId('profile.nameValue')).toHaveText(en.account.nameNone)
  await expect(page.getByTestId('profile.import')).toHaveAttribute('href', '/import')
})

test('the Profile stands in its final shape while its figures load, and nothing moves when they land', { tag: '@full' }, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const member = await signedIn(page)
  // Four authors read more than once (as many as the Profile shows, and as its placeholders guess).
  await seed(page, member.client, [
    [book('A Wizard of Earthsea', 'Ursula K. Le Guin', 183), [['2025-01-02', '2025-01-09', 16]]],
    [book('The Tombs of Atuan', 'Ursula K. Le Guin', 180), [['2025-01-10', '2025-01-20', 15]]],
    [book('Leviathan Wakes', 'James S. A. Corey', 561), [['2025-03-01', '2025-03-20', 14]]],
    [book("Caliban's War", 'James S. A. Corey', 595), [['2025-03-21', '2025-04-08', 15]]],
  ])

  // The reading record is held back until the page has been looked at.
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  await page.route(/\/rest\/v1\/reading_sessions\?.*outcome=not\.is\.null/, async (route) => {
    await held
    await route.continue()
  })
  await page.getByTestId('shell.avatar').click()
  await expect(page).toHaveURL(/\/profile$/)

  // Before it comes: the figures' grid and the chart's frame are there, the region busy, no figure in it.
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(1)
  await expect(page.getByTestId('profile.figures')).toBeVisible()
  await expect(page.getByTestId('profile.columns')).toBeVisible()
  await expect(page.getByTestId('profile.days')).toBeVisible()
  await expect(page.getByTestId('profile.books')).toHaveCount(0)
  await untilStill(page)
  const height = () => page.evaluate(() => document.documentElement.scrollHeight)
  const before = await height()

  // When it lands, the figures arrive in place: the page keeps its height to a few pixels.
  release()
  await expect(page.getByTestId('profile.books')).toHaveText('8')
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
  await expect(page.getByTestId('profile.author')).toHaveCount(4)
  await untilStill(page)
  expect(Math.abs((await height()) - before)).toBeLessThanOrEqual(4)
})

/**
 * Where the account rows are, in the page's own coordinates, from the call until `stop()`: one look per frame,
 * so the very first frame the Profile paints is among them. The page itself rises into place with a transform
 * (the push, docs/MOTION.md), which this does not see; only what moves in the layout does.
 */
async function watchAccount(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __account: number[]; __watching: boolean }
    w.__account = []
    w.__watching = true
    const look = () => {
      const row = document.querySelector('[data-testid="profile.account"]')
      if (row) w.__account.push(Math.round(row.getBoundingClientRect().top + window.scrollY))
      if (w.__watching) requestAnimationFrame(look)
    }
    requestAnimationFrame(look)
  })
  return async () => {
    const tops = await page.evaluate(() => {
      const w = window as unknown as { __account: number[]; __watching: boolean }
      w.__watching = false
      return w.__account
    })
    expect(tops.length).toBeGreaterThan(0)
    return { first: tops[0]!, spread: Math.max(...tops) - Math.min(...tops) }
  }
}

for (const [name, wanted] of [
  ['nothing in her Library', false],
  ['only a Book she wants to read', true],
] as const) {
  test(`the account rows do not move on the Profile of a member with ${name}`, { tag: '@full' }, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    const member = await signedIn(page)
    if (wanted) await createLibrary(member.client).addToLibrary(book('Up Next', 'Ursula K. Le Guin', 200))
    // The Library is on the device (Home loaded it); the record is held back so the first frame is the one looked at.
    await page.reload()
    await expect(page.getByTestId('home.title')).toBeVisible()
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    await page.route(/\/rest\/v1\/reading_sessions\?.*outcome=not\.is\.null/, async (route) => {
      await held
      await route.continue()
    })
    const stop = await watchAccount(page)
    await page.getByTestId('shell.avatar').click()
    await expect(page).toHaveURL(/\/profile$/)

    // Before the record: the empty state already stands over the rows, the hero's line still a placeholder.
    await expect(page.getByTestId('profile.empty')).toBeVisible()
    await expect(page.getByTestId('profile.library')).toHaveCount(0)
    await untilStill(page)

    release()
    await expect(page.getByTestId('profile.library')).toHaveText(fill(en.profile.library, { read: 0, reading: 0, want: wanted ? 1 : 0 }))
    await untilStill(page)
    expect((await stop()).spread).toBeLessThanOrEqual(4)
  })
}
