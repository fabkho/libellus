import { randomInt } from 'node:crypto'
import { expect } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { recordedApple, signedIn } from './support'
import { test } from './fixtures'

/**
 * Importing a Goodreads export (#40): from the avatar menu to /import, a file
 * chosen, the preview (books per Status, matched editions, what needs a look),
 * the import and its summary, the books in the Library, and the same file
 * again adding nothing. The file is synthetic, made per run: a book the
 * Catalogue holds (put there by this test), one the recordings know by its
 * ISBN (e2e/support.ts answers Apple and OpenLibrary), one with an ISBN no
 * source knows (an import Book) and one without an ISBN on a custom shelf (her
 * own Manual book). Test Books carry the run's tag, so the sweep removes them.
 */

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

/** A valid ISBN-13 no real book has (979-0), different every run. */
function uniqueIsbn(): string {
  const body = `9790${String(randomInt(0, 1e8)).padStart(8, '0')}`
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0)
  return `${body}${(10 - (sum % 10)) % 10}`
}

const wrap = (value: string) => `"=""${value}"""`

function exportFile(titles: { known: string; unknown: string; own: string }, isbns: { known: string; unknown: string }): string {
  const header =
    'Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Publisher,Binding,Number of Pages,' +
    'Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,' +
    'My Review,Spoiler,Private Notes,Read Count,Owned Copies'
  return [
    header,
    `901,"${titles.known} (Lamps, #1)",Ida Lumen,"Lumen, Ida",,${wrap('')},${wrap(isbns.known)},4,${TEST_PUBLISHER},Hardcover,352,2021,2021,2024/03/09,2024/02/01,,,read,"Quiet and sad.<br/>Lovely.",,,1,0`,
    `902,Piranesi,Susanna Clarke,"Clarke, Susanna",,${wrap('')},${wrap('9781526622419')},0,Bloomsbury,Paperback,272,2020,2020,,2025/06/12,to-read,to-read (#1),to-read,,,,0,0`,
    `903,"${titles.unknown} (Harbour, #2)",Mira Okafor,"Okafor, Mira",,${wrap('')},${wrap(isbns.unknown)},0,${TEST_PUBLISHER},Paperback,300,2019,2019,,2025/08/01,currently-reading,currently-reading (#1),currently-reading,,,,0,0`,
    `904,${titles.own},Lea Marchetti,"Marchetti, Lea",,${wrap('')},${wrap('')},0,,Paperback,190,,2016,,2025/06/10,wishlist,wishlist (#1),wishlist,,,,0,0`,
  ].join('\n')
}

test('a member imports a Goodreads export, sees the books in her Library, and importing it again adds nothing', async ({ page }) => {
  const member = await signedIn(page)
  const knownTitle = runTitle('Lamp Light')
  const unknownTitle = runTitle('Harbour Lights')
  const ownTitle = runTitle('Quiet Rooms')
  const isbns = { known: uniqueIsbn(), unknown: uniqueIsbn() }
  // A Book some member added before: the import finds it in the Catalogue by its ISBN.
  await sql('insert into public.books (title, authors, isbn13, source, apple_id, publisher) values ($1, $2, $3, $4, $5, $6)', [
    knownTitle,
    ['Ida Lumen'],
    isbns.known,
    'apple',
    uniqueAppleId(),
    TEST_PUBLISHER,
  ])
  const file = {
    name: 'goodreads_library_export.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(`\uFEFF${exportFile({ known: knownTitle, unknown: unknownTitle, own: ownTitle }, isbns)}`),
  }

  // From the Profile's account rows.
  await page.getByTestId('shell.avatar').click()
  await expect(page.getByTestId('profile.import')).toHaveText(en.import.menuItem)
  await page.getByTestId('profile.import').click()
  await expect(page).toHaveURL(/\/import$/)
  await expect(page.getByTestId('import.title')).toHaveText(en.import.title)
  await expect(page.getByTestId('import.empty')).toHaveText(en.import.pickText)

  // Offline nothing can be looked up or written: the way forward says so.
  await page.context().setOffline(true)
  await expect(page.getByTestId('import.choose')).toBeDisabled()
  await expect(page.getByTestId('import.choose')).toHaveText(en.common.offline)
  await page.context().setOffline(false)
  await expect(page.getByTestId('import.choose')).toHaveText(en.import.choose)

  // A file that is not an export is refused with a word.
  await page.getByTestId('import.file').setInputFiles({ name: 'notes.csv', mimeType: 'text/csv', buffer: Buffer.from('title,author\nA,B\n') })
  await expect(page.getByTestId('import.fileError')).toHaveText(en.import.fileError.notGoodreads)

  // The preview: per Status, what matched, what needs a look.
  await page.getByTestId('import.file').setInputFiles(file)
  await expect(page.getByTestId('import.fileName')).toHaveText(file.name)
  await expect(page.getByTestId('import.inFile')).toHaveText('4 books in this file')
  await expect(page.getByTestId('import.count.want_to_read')).toHaveText('2')
  await expect(page.getByTestId('import.count.reading')).toHaveText('1')
  await expect(page.getByTestId('import.count.finished')).toHaveText('1')
  await expect(page.getByTestId('import.matched')).toContainText('2')
  await expect(page.getByTestId('import.fromFile')).toContainText('2')
  await expect(page.getByTestId('import.alreadyThere')).toContainText('0')
  await expect(page.getByTestId('import.attentionList.title')).toHaveText([unknownTitle, ownTitle])
  await expect(page.getByTestId('import.attentionList.row').nth(1).getByTestId('import.attentionList.note')).toHaveText([
    en.import.note.fromFile,
    en.import.note.otherShelf.replace('{shelf}', 'wishlist'),
  ])

  await expect(page.getByTestId('import.start')).toHaveText('Import 4 books')
  await page.getByTestId('import.start').click()
  await expect(page.getByTestId('import.doneTitle')).toHaveText('4 books added')
  await expect(page.getByTestId('import.added')).toContainText('4')
  await expect(page.getByTestId('import.kept')).toContainText('0')

  // The Library has them, each with the Status the file gave it.
  await page.getByTestId('import.toLibrary').click()
  await expect(page).toHaveURL(/\/library$/)
  await page.getByTestId('library.segment.want_to_read').click()
  await expect(page.getByTestId('library.wantToRead').getByTestId('library.entryTitle')).toHaveCount(2)
  expect((await page.getByTestId('library.wantToRead').getByTestId('library.entryTitle').allTextContents()).sort()).toEqual(
    ['Piranesi', ownTitle].sort(),
  )
  await page.getByTestId('library.segment.reading').click()
  await expect(page.getByTestId('library.reading').getByTestId('library.entryTitle')).toHaveText([unknownTitle])
  await page.getByTestId('library.segment.finished').click()
  await expect(page.getByTestId('library.finished').getByTestId('library.entryTitle')).toHaveText([knownTitle])
  await expect(page.getByTestId('library.finished').getByTestId('library.entryRating')).toContainText('4')

  const stored = await sql<{ title: string; source: string; mine: boolean; rating: number | null; ended_on: string | null }>(
    `select b.title, b.source, b.owner_id is not null as mine, s.rating, s.ended_on::text
       from public.library_entries e join public.books b on b.id = e.book_id
       left join public.reading_sessions s on s.entry_id = e.id
      where e.member_id = $1 order by e.import_key`,
    [member.id],
  )
  expect(stored).toEqual([
    expect.objectContaining({ title: knownTitle, source: 'apple', mine: false, rating: 16, ended_on: '2024-03-09' }),
    expect.objectContaining({ title: 'Piranesi', mine: false, rating: null }),
    expect.objectContaining({ title: unknownTitle, source: 'import', mine: false }),
    expect.objectContaining({ title: ownTitle, source: 'manual', mine: true }),
  ])

  // The same file again: everything is there, nothing to import.
  await page.getByTestId('shell.avatar').click()
  await page.getByTestId('profile.import').click()
  await page.getByTestId('import.again').click()
  await page.getByTestId('import.file').setInputFiles(file)
  await expect(page.getByTestId('import.alreadyThere')).toContainText('4')
  await expect(page.getByTestId('import.nothing')).toHaveText(en.import.nothingToImport)
  await expect(page.getByTestId('import.start')).toBeHidden()
  const [{ entries }] = await sql<{ entries: number }>(
    'select count(*)::int as entries from public.library_entries where member_id = $1',
    [member.id],
  )
  expect(entries).toBe(4)
})
