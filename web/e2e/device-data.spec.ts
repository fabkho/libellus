import { expect, type Page } from '@playwright/test'
import { createLibrary } from '../app/data/library'
import { signUpMember } from '../tests/support/member'
import { runTitle, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { test } from './fixtures'
import { goto, handSession, recordedApple, sessionStorageInMemory, signedIn, untilStill } from './support'

/**
 * What survives a sign-out and a dead session (security round F10, F11): a session whose refresh
 * token is gone (revoked on the server, the access token run out) is forgotten by the device as a
 * sign-out forgets it, and another member signing in on the same device sees nothing of hers.
 * The pure parts are tests/device-data.test.ts.
 *
 * Chromium with its service worker allowed: the covers a member browsed are the worker's caches.
 */
test.use({ browserName: 'chromium', serviceWorkers: 'allow' })

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

/** The files under `ebooks/` in the origin private file system. */
async function ebookCopies(page: Page) {
  return page.evaluate(async () => {
    try {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('ebooks')
      let count = 0
      for await (const _ of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) count++
      return count
    } catch {
      return 0
    }
  })
}

function book(title: string, author = 'Ada Private') {
  return {
    title: runTitle(title),
    authors: [author],
    isbn13: null,
    isbn10: null,
    pageCount: 100,
    year: 2001,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: null,
    coverUrl: `https://is1-ssl.mzstatic.com/image/thumb/Private${title.replace(/\W/g, '')}/600x900bb.jpg`,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple' as const,
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

/** Everything the page keeps of a member: localStorage as one string, the caches, and the device's files. */
async function deviceDump(page: Page) {
  return page.evaluate(async () => {
    const storage = JSON.stringify({ ...localStorage })
    // The sign-in page browses covers itself, so a cache may exist again: what matters is what she put there.
    const cached: string[] = []
    for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) cached.push(`${name} ${new URL(request.url).pathname}`)
    return { storage, cached }
  })
}

test('a session that died is forgotten, and the next member on the device sees nothing of hers (F10, F11)', async ({ page }) => {
  const ada = await signedIn(page)
  const secret = book('Ada’s secret diary')
  await createLibrary(ada.client).addToLibrary(secret, { status: 'want_to_read' })
  await goto(page, '/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await untilStill(page)
  await goto(page, '/library')
  await expect(page.getByTestId('library.entry').filter({ hasText: secret.title })).toBeVisible()
  // What a browsing session leaves: the cover caches and an ebook copy, and the member's copy in localStorage.
  await page.evaluate(async () => {
    await (await caches.open('libellus-covers')).put('/cover-of-ada.jpg', new Response('x'))
    await (await caches.open('libellus-portraits')).put('/portrait-of-ada.jpg', new Response('x'))
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('ebooks', { create: true })
    await (await dir.getFileHandle('ada.epub', { create: true })).createWritable().then(async (w) => (await w.write('x'), w.close()))
  })
  const before = await deviceDump(page)
  expect(before.storage).toContain('secret diary')
  expect(before.cached.filter((entry) => /ada/.test(entry))).toHaveLength(2)

  // Her refresh token dies on the server and her access token has run out: the next start cannot renew it.
  await ada.client.auth.signOut({ scope: 'global' })
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (!/^sb-.*-auth-token$/.test(key)) continue
      localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key)!), expires_at: 1 }))
    }
  })
  await page.goto('/library')
  await expect(page).toHaveURL(/\/sign-in$/)
  await untilStill(page)

  // Nothing of hers is left: not her Library's copy, nor the covers she browsed, nor her ebook copy.
  const left = await deviceDump(page)
  expect(left.storage).not.toMatch(/secret diary|Ada Private/)
  expect(left.cached.filter((entry) => /ada/.test(entry))).toEqual([])
  expect(await ebookCopies(page)).toBe(0)

  // Another member signs in on the same device: only her own Library shows.
  const { kept, storage } = sessionStorageInMemory()
  const ben = await signUpMember(storage)
  const benBook = book('Ben’s own book', 'Ben Plain')
  await createLibrary(ben.client).addToLibrary(benBook, { status: 'want_to_read' })
  await handSession(page, kept)
  await goto(page, '/library')
  await expect(page.getByTestId('library.entry').filter({ hasText: benBook.title })).toBeVisible()
  await expect(page.getByText(secret.title)).toHaveCount(0)
  expect((await deviceDump(page)).storage).not.toMatch(/secret diary|Ada Private/)
})
