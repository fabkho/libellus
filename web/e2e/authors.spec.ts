import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { authorInitials } from '../app/utils/enrich'
import { runTitle } from '../tests/support/stack'
import { enrichedLibrary, forgetEnriched, type Enriched } from './enriched'
import { test } from './fixtures'
import { signedIn, untilStill } from './support'

/**
 * Author pages and series (#167) with enriched Books (e2e/enriched.ts: Terry
 * Pratchett's Discworld and City Watch, Ursula K. Le Guin's Earthsea and two
 * novels, Joe Haldeman's The Forever War, as the enrich function stores them):
 * the Book page's author line opens the author's page, with its hero, credits
 * and works grouped in reading order with her statuses, and "+ Want to read";
 * the series line opens the series sheet; she corrects a Book's series, says it
 * is in no series and goes back to the suggested one, each kept across a
 * reload; Home shows the next Book of her series; a Library row's author opens
 * the page too. The offline flow (the page from the device's copy) is
 * e2e/authors-offline.spec.ts.
 */

const stored: string[] = []
test.afterAll(async () => {
  await forgetEnriched(stored)
})

async function enriched(page: Page): Promise<Enriched> {
  const member = await signedIn(page)
  const data = await enrichedLibrary(member.client)
  stored.push(...data.ids)
  return data
}

const fill = (text: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), text)

test('the Book page\'s author opens her page: hero, credits, works in reading order with her statuses', async ({ page }) => {
  const data = await enriched(page)
  await page.goto(`/book/${data.entries.feetOfClay.book.id}`)
  await expect(page.getByTestId('book.title')).toHaveText(runTitle('Feet of Clay'))
  await expect(page.getByTestId('book.authors')).toHaveText(data.names.pratchett)
  await page.getByTestId('book.author').click()

  await expect(page).toHaveURL(new RegExp(`/author/${data.authors.pratchett}$`))
  await expect(page.getByTestId('author.name')).toHaveText(data.names.pratchett)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(data.names.pratchett)
  await expect(page.getByTestId('author.dates')).toHaveText(fill(en.author.lived, { born: 1948, died: 2015 }))
  await expect(page.getByTestId('author.genre').first()).toBeVisible()
  await expect(page.getByTestId('author.summary')).toContainText('Discworld series')
  await expect(page.getByTestId('author.wikipedia')).toHaveText(en.author.fromWikipedia)
  await expect(page.getByTestId('author.wikipedia')).toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Terry_Pratchett')
  // No portrait: her initials in the ring.
  await expect(page.getByTestId('author.initials')).toHaveText(authorInitials(data.names.pratchett))
  await expect(page.getByTestId('author.photo')).toHaveCount(0)

  // City Watch first (the most specific series), in reading order, with her statuses.
  const cityWatch = page.getByTestId('author.series').first()
  await expect(cityWatch.getByTestId('author.groupTitle')).toHaveText(data.names.cityWatch)
  await expect(cityWatch.getByTestId('author.seriesParent')).toHaveText(data.names.discworld)
  await expect(cityWatch.getByTestId('author.workTitle')).toHaveText([runTitle('Guards! Guards!'), runTitle('Men at Arms'), runTitle('Feet of Clay')])
  await expect(cityWatch.getByTestId('author.workMeta')).toHaveText([`${fill(en.series.book, { n: 1 })} · 1989`, `${fill(en.series.book, { n: 2 })} · 1993`, `${fill(en.series.book, { n: 3 })} · 1996`])
  const statuses = cityWatch.getByTestId('author.workStatus')
  await expect(statuses.nth(0)).toContainText(en.status.finished)
  await expect(statuses.nth(0).getByRole('img')).toHaveAttribute('aria-label', fill(en.rating.label, { value: '4.50' }))
  await expect(statuses.nth(2)).toHaveText(en.status.want_to_read)

  // Discworld lists the books in no sub-series; the essays are among the other works.
  const discworld = page.getByTestId('author.series').nth(1)
  await expect(discworld.getByTestId('author.groupTitle')).toHaveText(data.names.discworld)
  await expect(discworld.getByTestId('author.workTitle')).toHaveText(['Mort', 'Small Gods'])
  await expect(page.getByTestId('author.other').getByTestId('author.workTitle')).toHaveText(['A Slip of the Keyboard'])

  // "+ Want to read" on Mort: the Add sheet, on Want to read, then her status in its place.
  const mort = discworld.getByTestId('author.work').first()
  await mort.getByTestId('author.workWant').click()
  await expect(page.getByTestId('add')).toBeVisible()
  await untilStill(page)
  await page.getByTestId('add.submit').click()
  await expect(page.getByTestId('add')).toBeHidden()
  await expect(mort.getByTestId('author.workStatus')).toHaveText(en.status.want_to_read)
  await expect(mort.getByTestId('author.workWant')).toHaveCount(0)

  // A work opens its Book; Back returns to the author's page.
  await cityWatch.getByTestId('author.workLink').first().click()
  await expect(page.getByTestId('book.title')).toHaveText(runTitle('Guards! Guards!'))
  await page.getByTestId('book.back').click()
  await expect(page.getByTestId('author.name')).toHaveText(data.names.pratchett)
  await page.getByTestId('author.back').click()
  await expect(page.getByTestId('book.title')).toHaveText(runTitle('Feet of Clay'))
})

test('an author with a portrait credits it; one with novels and a collection groups them', async ({ page }) => {
  // The portrait answers a recorded image (no request leaves the machine).
  await page.route('https://thumb.wikimedia.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#876"/></svg>' }),
  )
  const data = await enriched(page)
  await page.goto(`/author/${data.authors.leGuin}`)
  await expect(page.getByTestId('author.name')).toHaveText(data.names.leGuin)
  await expect(page.getByTestId('author.initials')).toHaveText(authorInitials(data.names.leGuin))
  await expect(page.getByTestId('author.photo')).toBeAttached()
  await expect(page.getByTestId('author.photoFile')).toHaveText(fill(en.author.photoBy, { artist: 'Marian Wood Kolisch' }))
  await expect(page.getByTestId('author.photoFile')).toHaveAttribute('href', 'https://commons.wikimedia.org/wiki/File:Ursula_Le_Guin.jpg')
  await expect(page.getByTestId('author.photoLicence')).toHaveText('CC BY-SA 2.0')

  await expect(page.getByTestId('author.series').getByTestId('author.workTitle')).toHaveText([runTitle('A Wizard of Earthsea'), 'The Tombs of Atuan', 'The Farthest Shore'])
  await expect(page.getByTestId('author.standalone').getByTestId('author.groupTitle')).toHaveText(en.author.standalone)
  await expect(page.getByTestId('author.standalone').getByTestId('author.workTitle')).toHaveText(['The Lathe of Heaven', runTitle('The Dispossessed')])
  await expect(page.getByTestId('author.other').getByTestId('author.workTitle')).toHaveText(['The Wind’s Twelve Quarters'])

  // A key nobody has: the page says so.
  await page.goto('/author/Q1')
  await expect(page.getByTestId('author.missing')).toContainText(en.author.missingTitle)
})

test('the series line opens the series; she corrects it, says it is in no series, and goes back', async ({ page }) => {
  const data = await enriched(page)
  await page.goto(`/book/${data.entries.feetOfClay.book.id}`)
  const line = page.getByTestId('book.series')
  await expect(line).toHaveText(`${fill(en.series.bookOf, { n: 3, count: 3 })} · ${data.names.cityWatch}`)

  await line.click()
  await expect(page.getByTestId('series')).toBeVisible()
  await expect(page.getByTestId('series.sheetTitle')).toHaveText(data.names.cityWatch)
  await expect(page.getByTestId('series.parent')).toHaveText(fill(en.series.partOf, { name: data.names.discworld }))
  await expect(page.getByTestId('series.workTitle')).toHaveText([runTitle('Guards! Guards!'), runTitle('Men at Arms'), runTitle('Feet of Clay')])
  await expect(page.getByTestId('series.work').nth(2)).toHaveAttribute('data-current', '')
  await expect(page.getByTestId('series.workCurrent')).toHaveText(en.series.thisBook)
  await untilStill(page)

  // Her own series and place: a novella between two.
  await page.getByTestId('series.correct').click()
  await expect(page.getByTestId('seriesEdit')).toBeVisible()
  await expect(page.getByTestId('seriesEdit.name')).toHaveValue(data.names.cityWatch)
  await expect(page.getByTestId('seriesEdit.position')).toHaveValue('3')
  await untilStill(page)
  await page.getByTestId('seriesEdit.position').fill('two')
  await page.getByTestId('seriesEdit.action').click()
  await expect(page.getByTestId('seriesEdit.error')).toHaveText(en.series.error.position)
  const mine = runTitle('My Watch')
  await page.getByTestId('seriesEdit.name').fill(mine)
  await page.getByTestId('seriesEdit.position').fill('2,5')
  await page.getByTestId('seriesEdit.action').click()
  await expect(page.getByTestId('seriesEdit')).toBeHidden()
  await expect(line).toHaveText(`${fill(en.series.book, { n: '2.5' })} · ${mine}`)

  // Kept: the page read again says the same.
  await page.reload()
  await expect(line).toHaveText(`${fill(en.series.book, { n: '2.5' })} · ${mine}`)
  await line.click()
  await expect(page.getByTestId('series.mine')).toHaveText(en.series.mine)
  await untilStill(page)

  // In no series: the line goes; the options offer the correction back.
  await page.getByTestId('series.correct').click()
  await untilStill(page)
  await page.getByTestId('seriesEdit.none').click()
  await expect(page.getByTestId('seriesEdit')).toBeHidden()
  await expect(line).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('book.title')).toHaveText(runTitle('Feet of Clay'))
  await expect(line).toHaveCount(0)
  await page.getByTestId('book.options').click()
  await untilStill(page)
  await page.getByTestId('bookOptions.series').click()
  await expect(page.getByTestId('seriesEdit')).toBeVisible()
  await untilStill(page)
  await page.getByTestId('seriesEdit.reset').click()
  await expect(page.getByTestId('seriesEdit')).toBeHidden()
  await expect(line).toHaveText(`${fill(en.series.bookOf, { n: 3, count: 3 })} · ${data.names.cityWatch}`)
})

test('Home shows the next Book of her series; a Library row\'s author opens the author\'s page', async ({ page }) => {
  const data = await enriched(page)
  await page.goto('/')
  const next = page.getByTestId('home.nextInSeries')
  await expect(next.getByRole('heading')).toHaveText(en.series.next)
  // Most recent finish first: Haldeman (August), Le Guin (July), Pratchett's City Watch (June).
  await expect(next.getByTestId('home.nextTitle')).toHaveText(['Forever Free', 'The Tombs of Atuan', runTitle('Feet of Clay')])
  await expect(next.getByTestId('home.nextMeta')).toHaveText([
    fill(en.series.nextPlace, { n: 2, name: data.names.foreverWar }),
    fill(en.series.nextPlace, { n: 2, name: data.names.earthsea }),
    fill(en.series.nextPlace, { n: 3, name: data.names.cityWatch }),
  ])
  await expect(next.getByTestId('home.next').nth(2).getByTestId('home.nextStatus')).toHaveText(en.status.want_to_read)
  await expect(next.getByTestId('home.next').first().getByTestId('home.nextWant')).toBeVisible()

  await page.getByTestId('shell.tab.library').click()
  await page.getByTestId('library.segment.finished').click()
  const row = page.getByTestId('library.entry').filter({ hasText: runTitle('The Forever War') })
  await expect(row.getByTestId('library.entryAuthor')).toHaveAttribute('data-press-to', `/author/${data.authors.haldeman}`)
  await row.getByTestId('library.entryAuthor').click()
  await expect(page).toHaveURL(new RegExp(`/author/${data.authors.haldeman}$`))
  await expect(page.getByTestId('author.name')).toHaveText(data.names.haldeman)
  await expect(page.getByTestId('author.dates')).toHaveText(fill(en.author.born, { year: 1943 }))
  // The rest of the row still opens the Book.
  await page.getByTestId('author.back').click()
  await row.getByTestId('library.entryTitle').click()
  await expect(page.getByTestId('book.title')).toHaveText(runTitle('The Forever War'))
})
