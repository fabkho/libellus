import { expect } from '@playwright/test'
import { test } from './fixtures'
import { shelve, withEbook } from './readerSupport'
import { recordedApple, signedIn, untilStill } from './support'

/**
 * A release renames the `ebook-reader` chunks and the site stops serving the old ones, while a device still runs
 * the older build (an installed app keeps its shell until a navigation brings a new one, docs/perf/bundle.md F6).
 * Read now on such a device must say "This book could not be opened. Try again." and stay usable — the next tap,
 * once the files are reachable again, opens the book — instead of the reported silence: a failed `import()` the
 * browser keeps for good and no word to the member.
 *
 * The deploy is simulated with routes: the reader's files answer 404 (the pruned chunks) while the file list the
 * site serves is another build's (it names nothing this build imports). What the running build warms before it
 * imports must be its own list, so the site's list is never even read.
 */
test.use({ browserName: 'chromium' })

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

test('Read now whose reader files a release took away says so, and works again without a reload', async ({ page }) => {
  // The evidence of the reported bug: what the member never saw (no reader, no word of it) and what the
  // browser did instead (the chunk 404s, the import kept failing).
  const consoleErrors: string[] = []
  const chunkReads: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('requestfailed', (request) => consoleErrors.push(`${request.url()} ${request.failure()?.errorText ?? ''}`))

  // The deploy: the reader's chunks are gone from the site; the file list it serves is another build's.
  await page.route('**/_nuxt/ebook-reader*', (route) => {
    chunkReads.push(route.request().url())
    return route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' })
  })
  const serverListReads: string[] = []
  await page.route('**/_nuxt/builds/reader-files.json', (route) => {
    serverListReads.push(route.request().url())
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  })

  const member = await signedIn(page)
  const entry = await shelve(member, 'Metamorphosis', 'reading')
  await withEbook(page, entry)

  // The member taps a hundred times; the first two are enough to see it.
  await page.getByTestId('book.read').click()
  await untilStill(page)
  await page.getByTestId('book.read').click()
  await untilStill(page)
  console.log('read-now evidence:', JSON.stringify({ consoleErrors, chunkReads, serverListReads }))

  // No reader: no tap could open the book (not on this build again).
  await expect(page.getByTestId('reader')).toHaveCount(0)
  // The member is told, instead of the taps doing nothing at all.
  await expect(page.getByTestId('book.readFailed')).toBeVisible()

  // The build warms its own files before it imports them; the site's current list is another build's and
  // must never be read.
  expect(serverListReads).toEqual([])

  // The files are reachable again (the member's app updated, the site settled): the next tap opens the book —
  // nothing kept a failed `import()` in the module map for good.
  await page.unroute('**/_nuxt/ebook-reader*')
  await page.getByTestId('book.read').click()
  await expect(page.getByTestId('book.readFailed')).toHaveCount(0)
  await expect(page.getByTestId('reader')).toHaveAttribute('data-ready', 'true', { timeout: 15_000 })
})
