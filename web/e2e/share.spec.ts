import { expect, type BrowserContext, type Page } from '@playwright/test'
import { buildEpub, MOBY_DICK_GUTENBERG, type EpubSpec } from '../tests/support/epub'
import { test } from './fixtures'
import { goto, recordedApple, signedIn, untilStill } from './support'

/**
 * The share target (#91, #131, security round F4): `POST /share` is answered by the service
 * worker (public/sw-share.js), which keeps the files shared to the app until the member taps
 * "Add" on /share. A page on another origin can submit the same form, so the worker refuses a
 * cross-site POST, and whatever gets through still imports nothing without the tap.
 *
 * Chromium with its service worker allowed (every other flow blocks it): the worker is the thing
 * under test. The attacker's page is answered by a route on a made-up host and posts to the app.
 */
test.use({
  browserName: 'chromium',
  serviceWorkers: 'allow',
  // The attacker's page has no address of its own the local stack could be reached from.
  launchOptions: { args: ['--disable-features=LocalNetworkAccessChecks'] },
})

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

const epub = (title: string, spec: EpubSpec = MOBY_DICK_GUTENBERG) => Array.from(buildEpub({ ...spec, title }))

/** What the app's own device storage holds: the shared files not taken yet, and the copies taken in. */
async function deviceFiles(page: Page) {
  return page.evaluate(async () => {
    const shared = (await caches.has('libellus-shared-ebooks')) ? (await (await caches.open('libellus-shared-ebooks')).keys()).length : 0
    const found: string[] = []
    async function walk(dir: FileSystemDirectoryHandle, prefix: string) {
      for await (const [name, handle] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
        if (handle.kind === 'directory') await walk(handle as FileSystemDirectoryHandle, `${prefix}${name}/`)
        else found.push(`${prefix}${name}`)
      }
    }
    try {
      await walk(await (await navigator.storage.getDirectory()).getDirectoryHandle('ebooks'), 'ebooks/')
    } catch {
      // None yet.
    }
    return { shared, copies: found.filter((path) => path.endsWith('.epub')).length }
  })
}

/** The app is open, signed in, and its service worker is there to answer a POST. */
async function ready(page: Page) {
  await goto(page, '/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await untilStill(page)
}

/**
 * A page on another origin submits the share target's form with an EPUB, as any site can
 * (`<form method=post action=…/share enctype=multipart/form-data>`). Returns that page.
 */
async function postFromAttacker(context: BrowserContext, target: string, files: { name: string; type: string; bytes: number[] }[]) {
  const attacker = await context.newPage()
  await attacker.route('http://attacker.test/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>free ebooks</title><form id="f" method="post" enctype="multipart/form-data"><input data-testid="attacker.file" id="file" type="file" name="ebooks" multiple></form>' }),
  )
  await attacker.goto('http://attacker.test/')
  await attacker.evaluate(
    ([action, list]) => {
      const form = document.getElementById('f') as HTMLFormElement
      const input = document.getElementById('file') as HTMLInputElement
      const transfer = new DataTransfer()
      for (const file of list) transfer.items.add(new File([new Uint8Array(file.bytes)], file.name, { type: file.type }))
      input.files = transfer.files
      form.action = action
      form.submit()
    },
    [target, files] as const,
  )
  return attacker
}

test('a POST from another site imports nothing into the signed-in member’s device', async ({ page, context, baseURL }) => {
  await signedIn(page)
  await ready(page)

  const attacker = await postFromAttacker(context, `${baseURL}/share`, [
    { name: 'planted.epub', type: 'application/epub+zip', bytes: epub('PLANTED BY ATTACKER') },
  ])
  // Before the fix the page went on to /share?ebooks=<id>, took the file in and landed on /ebooks.
  const imported = await attacker.waitForURL(/\/ebooks/, { timeout: 5_000 }).then(
    () => true,
    () => false,
  )
  expect(imported).toBe(false)
  await untilStill(attacker)
  expect(await deviceFiles(attacker)).toEqual({ shared: 0, copies: 0 })
})

/**
 * The OS's share intent, as far as a test can make one: a form the app's own page submits
 * (`Sec-Fetch-Site: same-origin`; Android's is `none`, which the worker accepts too).
 */
async function shareFromTheOs(page: Page, files: { name: string; bytes: number[] }[]) {
  await page.evaluate(
    (list) => {
      const form = Object.assign(document.createElement('form'), { method: 'post', action: '/share', enctype: 'multipart/form-data' })
      const input = Object.assign(document.createElement('input'), { type: 'file', name: 'ebooks', multiple: true })
      const transfer = new DataTransfer()
      for (const file of list) transfer.items.add(new File([new Uint8Array(file.bytes)], file.name, { type: 'application/epub+zip' }))
      input.files = transfer.files
      input.setAttribute('data-testid', 'test.shareFiles')
      form.append(input)
      document.body.append(form)
      form.submit()
    },
    files,
  )
}

test('a share asks first: it lists the files, and only Add takes them in', async ({ page }) => {
  await signedIn(page)
  await ready(page)

  await shareFromTheOs(page, [
    { name: 'moby.epub', bytes: epub('Moby-Dick') },
    { name: 'dracula.epub', bytes: epub('Dracula') },
  ])
  await expect(page.getByTestId('share.confirm')).toBeVisible()
  await expect(page.getByTestId('share.confirmTitle')).toHaveText('Add 2 ebooks shared to Libellus?')
  await expect(page.getByTestId('share.file')).toHaveCount(2)
  await expect(page.getByTestId('share.files')).toContainText('moby.epub')
  await expect(page.getByTestId('share.files')).toContainText('dracula.epub')
  // Nothing is in her library before the tap: the files only wait.
  await expect(page).toHaveURL(/\/share\?ebooks=/)
  expect(await deviceFiles(page)).toEqual({ shared: 3, copies: 0 })

  await page.getByTestId('share.add').click()
  await expect(page).toHaveURL(/\/ebooks$/)
  await expect(page.getByTestId('ebooks.reportLine')).toContainText('2 ebooks')
  expect(await deviceFiles(page)).toEqual({ shared: 0, copies: 2 })
})

test('Not now deletes what was shared and imports nothing', async ({ page }) => {
  await signedIn(page)
  await ready(page)

  await shareFromTheOs(page, [{ name: 'moby.epub', bytes: epub('Moby-Dick') }])
  await expect(page.getByTestId('share.confirm')).toBeVisible()
  await expect(page.getByTestId('share.confirmTitle')).toHaveText('Add 1 ebook shared to Libellus?')
  await page.getByTestId('share.notNow').click()
  await expect(page).toHaveURL(/\/$/)
  expect(await deviceFiles(page)).toEqual({ shared: 0, copies: 0 })
})

test('a file that is not an EPUB is not offered', async ({ page }) => {
  await signedIn(page)
  await ready(page)

  await shareFromTheOs(page, [{ name: 'notes.txt', bytes: Array.from(new TextEncoder().encode('hello')) }])
  await expect(page).toHaveURL(/\/ebooks\?missed=1$/)
  await expect(page.getByTestId('ebooks.missed')).toBeVisible()
  expect(await deviceFiles(page)).toEqual({ shared: 0, copies: 0 })
})

test('a second share replaces the one still waiting: only the address’s own is offered', async ({ page, context }) => {
  await signedIn(page)
  await ready(page)

  // Two shares arrive; only the address's one is shown, the other is deleted on the way.
  await shareFromTheOs(page, [{ name: 'first.epub', bytes: epub('First') }])
  await expect(page.getByTestId('share.confirm')).toBeVisible()
  const other = await context.newPage()
  await other.goto('/')
  await shareFromTheOs(other, [{ name: 'second.epub', bytes: epub('Second') }])
  await expect(other.getByTestId('share.files')).toContainText('second.epub')
  await expect(other.getByTestId('share.file')).toHaveCount(1)
  expect(await deviceFiles(other)).toEqual({ shared: 2, copies: 0 })
})
