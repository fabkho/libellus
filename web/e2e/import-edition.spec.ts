import { randomInt } from 'node:crypto'
import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { runTitle, sql, TEST_PUBLISHER } from '../tests/support/stack'
import { recordedApple, recordedTitleQuery, signedIn } from './support'
import { test } from './fixtures'

/**
 * Choosing the edition of a book in the import's preview (#111). A book found
 * by its title (or only in the file) is listed under "Needs a look" with
 * Choose edition; it opens the Change edition sheet of the Book page, here
 * with the editions the match found and what the same search finds. The pick
 * (✓) replaces the row's edition in the preview only: the row moves to "Your
 * choices" with the edition's language, year and pages, nothing is written
 * yet, and the import then adds that edition. Books she did not touch import
 * what the match picked. The recordings know Piranesi by "piranesi" only, so
 * the title and author query is pointed at them (`recordedTitleQuery`). With docs/parity.md this
 * is the behavioural reference for Choose edition.
 */

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
  await recordedTitleQuery(page)
})

/** A valid ISBN-13 no real book has (979-0), different every run. */
function uniqueIsbn(): string {
  const body = `9790${String(randomInt(0, 1e8)).padStart(8, '0')}`
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0)
  return `${body}${(10 - (sum % 10)) % 10}`
}

const wrap = (value: string) => `"=""${value}"""`

const HEADER =
  'Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Publisher,Binding,Number of Pages,' +
  'Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,' +
  'My Review,Spoiler,Private Notes,Read Count,Owned Copies'

/** Piranesi without an ISBN (matched by its title, among many editions) and a book only the file knows. */
function file(ownTitle: string) {
  const csv = [
    HEADER,
    `981,Piranesi,Susanna Clarke,"Clarke, Susanna",,${wrap('')},${wrap('')},0,,Paperback,,,,,2025/06/12,to-read,to-read (#1),to-read,,,,0,0`,
    `982,${ownTitle},Mira Okafor,"Okafor, Mira",,${wrap('')},${wrap(uniqueIsbn())},0,${TEST_PUBLISHER},Paperback,300,2019,2019,,2025/08/01,to-read,to-read (#2),to-read,,,,0,0`,
  ].join('\n')
  return { name: 'goodreads_library_export.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }
}

/** Opens the preview with Piranesi (matched by title) first under "Needs a look". */
async function preview(page: Page, ownTitle: string) {
  await page.goto('/import')
  await page.getByTestId('import.file').setInputFiles(file(ownTitle))
  await expect(page.getByTestId('import.start')).toHaveText('Import 2 books', { timeout: 30_000 })
  await expect(page.getByTestId('import.attentionList.title')).toHaveText(['Piranesi', ownTitle])
}

test('a member chooses the edition of a book found by its title: the preview takes it and the import writes it', async ({ page }) => {
  const member = await signedIn(page)
  const ownTitle = runTitle('Harbour Lights')
  await preview(page, ownTitle)

  // Both books can be chosen from: Piranesi (found by its title) and the one only the file knows.
  const rows = page.getByTestId('import.attentionList.row')
  await expect(page.getByTestId('import.attentionList.action')).toHaveText([en.import.chooseEdition, en.import.chooseEdition])
  await expect(page.getByTestId('import.choices')).toHaveCount(0)
  await expect(page.getByTestId('import.matched')).toContainText('1')

  await rows.first().getByTestId('import.attentionList.action').click()
  await expect(page.getByTestId('edition')).toBeVisible()
  await expect(page.getByTestId('edition.title')).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: en.import.edition.title })).toBeVisible()
  await expect(page.getByTestId('edition.hint')).toHaveText(en.import.edition.hint)
  // A labelled radio group: the edition the preview has first (checked), the row as the file has it, then the others.
  await expect(page.getByRole('radiogroup', { name: en.book.edition.listLabel })).toBeVisible()
  const candidates = page.getByTestId('edition.candidate')
  await expect(candidates.first()).toHaveAttribute('aria-checked', 'true')
  await expect(candidates.first()).toContainText(en.import.edition.current)
  await expect(candidates.nth(1)).toContainText(en.import.edition.file)
  await expect(page.getByTestId('edition.loading')).toBeHidden({ timeout: 30_000 })
  expect(await candidates.count()).toBeGreaterThan(3)
  // Choosing needs another edition than the one it has.
  await expect(page.getByTestId('edition.action')).toBeDisabled()
  await expect(page.getByTestId('edition.action')).toHaveText(en.import.edition.action)
  // No source is ever named.
  await expect(page.getByTestId('edition')).not.toContainText(/Apple|Open ?Library/)

  // Another edition than the ones the sheet opened on, one that says its year (which others also say, depends on what the sources and the Catalogue hold).
  const pick = candidates
    .filter({ hasText: /(19|20)\d{2}/ })
    .filter({ hasNotText: en.import.edition.current })
    .filter({ hasNotText: en.import.edition.file })
    .first()
  const facts = await pick.getByTestId('edition.candidateFacts').locator('span:not([aria-hidden])').allInnerTexts()
  await pick.click()
  await expect(pick).toHaveAttribute('aria-checked', 'true')
  await expect(candidates.first()).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByTestId('edition.action')).toBeEnabled()
  await page.getByTestId('edition.action').click()
  await expect(page.getByTestId('edition')).toBeHidden()

  // Only the preview changed: the row moved to "Your choices" with the edition's facts, nothing is written.
  await expect(page.getByTestId('import.attentionList.title')).toHaveText([ownTitle])
  await expect(page.getByTestId('import.choicesList.title')).toHaveText(['Piranesi'])
  await expect(page.getByTestId('import.choicesList.note')).toHaveText([en.import.note.chosen])
  await expect(page.getByTestId('import.choicesList.facts').locator('span:not([aria-hidden])')).toHaveText(facts)
  await expect(page.getByTestId('import.choicesList.action')).toHaveText(en.import.changeEdition)
  // Still matched to an edition: hers.
  await expect(page.getByTestId('import.matched')).toContainText('1')
  const [{ before }] = await sql<{ before: number }>('select count(*)::int as before from public.library_entries where member_id = $1', [member.id])
  expect(before).toBe(0)

  await page.getByTestId('import.start').click()
  await expect(page.getByTestId('import.doneTitle')).toHaveText('2 books added')

  // The entry has the picked edition; the untouched row imported what it always does.
  const stored = await sql<{ title: string; source: string; language: string | null; year: number | null; page_count: number | null; mine: boolean }>(
    `select b.title, b.source, b.language, b.published_year as year, b.page_count, b.owner_id is not null as mine
       from public.library_entries e join public.books b on b.id = e.book_id
      where e.member_id = $1 order by e.import_key`,
    [member.id],
  )
  expect(stored).toHaveLength(2)
  const [piranesi, own] = stored
  expect(piranesi!.title).toContain('Piranesi')
  // What the row said it was is what was written: its year, and its pages and language when it had them.
  expect(facts).toContain(String(piranesi!.year))
  const pages = facts.find((fact) => /pages$/.test(fact))
  if (pages) expect(pages).toBe(`${piranesi!.page_count} pages`)
  else expect(piranesi!.page_count).toBeNull()
  expect(own).toMatchObject({ title: ownTitle, source: 'import', mine: false })
})

test('"As in the file" keeps what the file says, a choice can be changed again, and the sheet says when the search cannot run offline', async ({ page }) => {
  const member = await signedIn(page)
  const ownTitle = runTitle('Quiet Rooms')
  await preview(page, ownTitle)

  // Offline the sheet still lists what the match found, and says what the search needs.
  await page.context().setOffline(true)
  await page.getByTestId('import.attentionList.action').first().click()
  await expect(page.getByTestId('edition.offline')).toHaveText(en.import.edition.offline)
  await expect(page.getByTestId('edition.candidate').first()).toBeVisible()
  await page.context().setOffline(false)
  await expect(page.getByTestId('edition.offline')).toBeHidden()
  await expect(page.getByTestId('edition.loading')).toBeHidden({ timeout: 30_000 })

  // Keep as in the file: the Manual book the file describes; the row moves to her choices.
  const inFile = page.getByTestId('edition.candidate').filter({ hasText: en.import.edition.file })
  await inFile.click()
  await page.getByTestId('edition.action').click()
  await expect(page.getByTestId('import.choicesList.title')).toHaveText(['Piranesi'])
  await expect(page.getByTestId('import.fromFile')).toContainText('2')
  await expect(page.getByTestId('import.matched')).toContainText('0')

  // Changed again: the sheet opens on her choice, checked.
  await page.getByTestId('import.choicesList.action').click()
  await expect(page.getByTestId('edition.candidate').first()).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('edition.candidate').first()).toContainText(en.import.edition.file)
  await page.getByTestId('edition.cancel').click()
  await expect(page.getByTestId('edition')).toBeHidden()

  await page.getByTestId('import.start').click()
  await expect(page.getByTestId('import.doneTitle')).toHaveText('2 books added')
  const stored = await sql<{ title: string; source: string; mine: boolean }>(
    `select b.title, b.source, b.owner_id is not null as mine
       from public.library_entries e join public.books b on b.id = e.book_id
      where e.member_id = $1 order by e.import_key`,
    [member.id],
  )
  expect(stored).toEqual([
    { title: 'Piranesi', source: 'manual', mine: true },
    { title: ownTitle, source: 'import', mine: false },
  ])
})

test('a book no source knows by its ISBN becomes her own edition in the preview, and the import makes it', async ({ page }) => {
  const member = await signedIn(page)
  const ownTitle = runTitle('Harbour Lights')
  await preview(page, ownTitle)

  // The book only the file knows: Choose edition, then My edition isn't listed.
  await page.getByTestId('import.attentionList.row').nth(1).getByTestId('import.attentionList.action').click()
  await expect(page.getByTestId('edition')).toBeVisible()
  await page.getByTestId('edition.missing').click()
  await expect(page.getByTestId('edition')).toBeHidden()
  await expect(page.getByTestId('ownEdition')).toBeVisible()
  await page.getByTestId('ownEdition.isbn').fill(uniqueIsbn())
  await page.getByTestId('ownEdition.lookUp').click()
  await expect(page.getByTestId('ownEdition.notFound')).toBeVisible()
  await page.getByTestId('ownEdition.startOwn').click()
  await page.getByTestId('ownEdition.format.audiobook').click()
  await page.getByTestId('ownEdition.year').fill('2021')
  await page.getByTestId('ownEdition.submit').click()
  await expect(page.getByTestId('ownEdition')).toBeHidden()

  // Only the preview changed; the import makes her own edition, an audiobook.
  await expect(page.getByTestId('import.choicesList.title')).toHaveText([ownTitle])
  await page.getByTestId('import.start').click()
  await expect(page.getByTestId('import.doneTitle')).toHaveText('2 books added')
  const [own] = await sql<{ format: string; year: number; mine: boolean }>(
    `select b.format::text as format, b.published_year as year, b.owner_id = $1 as mine
       from public.library_entries e join public.books b on b.id = e.book_id
      where e.member_id = $1 and b.title = $2`,
    [member.id, ownTitle],
  )
  expect(own).toEqual({ format: 'audiobook', year: 2021, mine: true })
})
