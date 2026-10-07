import { expect, test } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { runTitle } from '../tests/support/stack'
import { enrichedLibrary, forgetEnriched } from './enriched'
import { keepShell } from './offlineShell'
import { goto, signedIn } from './support'

/**
 * Author pages and series offline (#167, #15): an author's page, a Book's
 * series line and Home's "Next in your series" opened online once open again
 * without a connection, from the device's copy (data/enrich/device.ts); an
 * author's page never opened on the device says it shows once she is back
 * online; correcting a series says "Offline". And the first opening stands in
 * placeholders that the page replaces whole.
 *
 * Chromium, as e2e/offline.spec.ts (the reason is there): the dev server has
 * no service worker, so `keepShell` keeps the app's files.
 */
test.use({
  browserName: 'chromium',
  launchOptions: { args: ['--disable-features=LocalNetworkAccessChecks'] },
})

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

const stored: string[] = []
test.afterAll(async () => {
  await forgetEnriched(stored)
})

test('an author page, a series line and Home\'s next in series open offline from the device', async ({ page, baseURL }) => {
  const network = await keepShell(page, baseURL!)
  const member = await signedIn(page)
  const data = await enrichedLibrary(member.client)
  stored.push(...data.ids)

  // The first opening: placeholders of the page's shape until the page comes, then the page in their place.
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  await page.route('**/rest/v1/rpc/author_page', async (route) => {
    await held
    await route.continue()
  })
  await goto(page, `/author/${data.authors.pratchett}`)
  await expect(page.getByTestId('author.loading')).toBeVisible()
  await expect(page.getByTestId('author.name')).toHaveCount(0)
  release()
  await expect(page.getByTestId('author.name')).toHaveText(data.names.pratchett)
  await expect(page.getByTestId('author.loading')).toHaveCount(0)
  await page.unroute('**/rest/v1/rpc/author_page')

  // Online once: the Book page with its series line, and Home with its row.
  await goto(page, `/book/${data.entries.feetOfClay.book.id}`)
  await expect(page.getByTestId('book.series')).toContainText(data.names.cityWatch)
  await goto(page, '/')
  await expect(page.getByTestId('home.nextTitle').first()).toHaveText('Forever Free')

  await network.goOffline()
  await page.reload()

  await expect(page.getByTestId('home.nextTitle').first()).toHaveText('Forever Free')
  await expect(page.getByTestId('home.nextWant').first()).toBeDisabled()

  await goto(page, `/author/${data.authors.pratchett}`)
  await expect(page.getByTestId('author.name')).toHaveText(data.names.pratchett)
  await expect(page.getByTestId('author.series').first().getByTestId('author.workTitle').first()).toHaveText(runTitle('Guards! Guards!'))
  await expect(page.getByTestId('author.workWant').first()).toContainText(en.common.offline)

  await goto(page, `/book/${data.entries.feetOfClay.book.id}`)
  await expect(page.getByTestId('book.series')).toContainText(data.names.cityWatch)
  await page.getByTestId('book.series').click()
  await expect(page.getByTestId('series.workTitle')).toHaveCount(3)
  await page.getByTestId('series.correct').click()
  await expect(page.getByTestId('seriesEdit.action')).toBeDisabled()
  await expect(page.getByTestId('seriesEdit.action')).toHaveText(en.common.offline)
  await page.getByTestId('seriesEdit.cancel').click()

  // Never opened here: it says when it will show.
  await goto(page, `/author/${data.authors.haldeman}`)
  await expect(page.getByTestId('author.missing')).toContainText(en.author.offlineTitle)
})
