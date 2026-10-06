/**
 * Ebook files on Chrome for Android (#131, phase 1): the installed app on the
 * emulator, driven over adb and the Chrome DevTools protocol (docs/TESTING.md,
 * Ebook files). Not part of CI and not a Playwright test. One step per run, so
 * the system's own dialogs (the folder picker, "Allow Chrome to access",
 * Chrome's "Allow this site to view files?") can be answered in between, by
 * hand or with `adb shell input tap`:
 *
 *   pnpm tsx e2e/android/ebooks.ts --base http://localhost:3126 --out /tmp/libellus-ebook-link --step setup
 *   … --step share1   one EPUB shared to the app (the share target's multipart POST, through its service worker)
 *   … --step share3   three EPUBs at once
 *   … --step book     the book page of the first shared one
 *   … --step pick     taps Choose under Profile → Account → Ebook folder (the platform's folder picker opens)
 *   … --step scan     reloads (Android drops the folder's permission with it), opens Ebooks and taps Scan
 *   … --step report   the Ebooks page after the scan
 *
 * What is real: the installed app (standalone, its service worker, its origin
 * private file system), the share target's POST with real `File`s through the
 * service worker, the folder picker, Chrome's permission dialog and real taps.
 * What is not: Android's share sheet (it lists only a WebAPK, which the
 * emulator without a Google account cannot mint), so the POST is made by the
 * page itself from the files the dev machine serves under `/__fixtures/`
 * (public-domain Project Gutenberg EPUBs copied into the build's output).
 *
 * The first run (`setup`) signs a fresh test member up (address on the test
 * domain) and puts Pride and Prejudice, Moby-Dick, Dracula and Anna Karenina on
 * her Want to read; `member.json` in `--out` keeps her for the other steps.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium, type Page } from '@playwright/test'
import sharp from 'sharp'
import type { BookSnapshot } from '../../app/data/books'
import { createLibrary } from '../../app/data/library'
import { signUpMember } from '../../tests/support/member'
import { emailCooldown, readMailedCode, runTitle, stack, TEST_PUBLISHER, uniqueAppleId } from '../../tests/support/stack'

const { values: args } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://localhost:3126' },
    out: { type: 'string', default: '/tmp/libellus-ebook-link' },
    serial: { type: 'string', default: 'emulator-5554' },
    step: { type: 'string', default: 'setup' },
  },
})
const OUT = args.out!
mkdirSync(OUT, { recursive: true })
process.env.LIBELLUS_TEST_RUN ??= 'android'

const ADB = process.env.ANDROID_HOME ? join(process.env.ANDROID_HOME, 'platform-tools', 'adb') : 'adb'
const adb = (...command: string[]) => execFileSync(ADB, ['-s', args.serial!, ...command], { maxBuffer: 64 * 1024 * 1024 })
const shell = (command: string) => adb('shell', command).toString()
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function screenshot(name: string) {
  await sharp(adb('exec-out', 'screencap', '-p')).resize({ height: 1000, withoutEnlargement: true }).jpeg({ quality: 82 }).toFile(join(OUT, `android-${name}.jpg`))
  console.log('shot', name)
}

/** A real finger on an element: the page's origin from one calibration tap (see smoke.ts). */
async function tapReal(page: Page, testid: string) {
  const [w, h] = shell('wm size').match(/(\d+)x(\d+)\s*$/)!.slice(1).map(Number) as [number, number]
  const at = { x: Math.round(w / 2), y: Math.round(h / 2) }
  const seen = page.evaluate(
    () =>
      new Promise<{ x: number; y: number; dpr: number }>((resolve) => {
        const swallow = (event: TouchEvent) => {
          event.preventDefault()
          event.stopImmediatePropagation()
          window.removeEventListener('touchstart', swallow, true)
          resolve({ x: event.touches[0]!.clientX, y: event.touches[0]!.clientY, dpr: devicePixelRatio })
        }
        window.addEventListener('touchstart', swallow, { capture: true, passive: false })
      }),
  )
  await sleep(200)
  shell(`input tap ${at.x} ${at.y}`)
  const css = await seen
  const target = page.getByTestId(testid).first()
  await target.scrollIntoViewIfNeeded()
  await sleep(300)
  const box = await target.boundingBox()
  if (!box) throw new Error(`${testid} is not on screen`)
  const x = Math.round(at.x - css.x * css.dpr + (box.x + box.width / 2) * css.dpr)
  const y = Math.round(at.y - css.y * css.dpr + (box.y + box.height / 2) * css.dpr)
  shell(`input tap ${x} ${y}`)
}

const book = (title: string, author: string): BookSnapshot => ({
  title: runTitle(title),
  authors: [author],
  isbn13: null,
  isbn10: null,
  pageCount: 400,
  year: 1900,
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
})

/** The installed app's page: the one Chrome shows standalone at the base address. */
async function appPage(): Promise<Page> {
  const browser = await chromium.connectOverCDP('http://localhost:9333')
  for (const candidate of browser.contexts().flatMap((context) => context.pages())) {
    if (!candidate.url().startsWith(args.base!)) continue
    const standalone = await candidate.evaluate(() => matchMedia('(display-mode: standalone)').matches && document.visibilityState === 'visible').catch(() => false)
    if (standalone) return candidate
  }
  throw new Error('Open the installed Libellus (its icon on the home screen) first.')
}

/** What Android's share sheet hands the app: a multipart POST of the files to /share, here made by the page from files the Mac serves. */
async function share(page: Page, names: string[]) {
  const started = Date.now()
  await page.evaluate(async (files) => {
    const transfer = new DataTransfer()
    for (const name of files) {
      const blob = await (await fetch(`/__fixtures/${name}`)).blob()
      transfer.items.add(new File([blob], name, { type: 'application/epub+zip' }))
    }
    const form = Object.assign(document.createElement('form'), { method: 'post', action: '/share', enctype: 'multipart/form-data' })
    const input = Object.assign(document.createElement('input'), { type: 'file', name: 'ebooks', multiple: true })
    input.files = transfer.files
    form.append(input)
    document.body.append(form)
    form.submit()
  }, names)
  await page.waitForURL(/\/ebooks$/, { timeout: 60_000 })
  await page.getByTestId('ebooks.reportLine').waitFor({ timeout: 60_000 })
  console.log('shared', names.join(', '), 'in', Date.now() - started, 'ms:', await page.getByTestId('ebooks.reportLine').innerText())
}

async function main() {
  const apiPort = new URL(stack.url).port
  for (const port of [new URL(args.base!).port, apiPort]) adb('reverse', `tcp:${port}`, `tcp:${port}`)
  adb('forward', 'tcp:9333', 'localabstract:chrome_devtools_remote')
  const page = await appPage()
  // tsx names the functions it compiles (`__name`); the pages they run in need it too.
  await page.context().addInitScript('window.__name = (fn) => fn')
  await page.evaluate('window.__name = (fn) => fn')
  const memberFile = join(OUT, 'member.json')

  if (args.step === 'setup') {
    await page.goto(`${args.base}/sign-in`)
    const member = await signUpMember()
    await emailCooldown()
    await page.getByTestId('signIn.email').fill(member.email)
    await page.getByTestId('signIn.submit').click()
    await page.waitForURL(/\/verify$/)
    await page.getByTestId('verify.code').fill(await readMailedCode(member.email, 2))
    await page.getByTestId('home.title').waitFor()
    const library = createLibrary(member.client)
    const entries = []
    for (const [title, author] of [
      ['Pride and Prejudice', 'Jane Austen'],
      ['Moby-Dick', 'Herman Melville'],
      ['Dracula', 'Bram Stoker'],
      ['Anna Karenina', 'Leo Tolstoy'],
    ] as const)
      entries.push((await library.addToLibrary(book(title, author), { status: 'want_to_read' })).data!)
    writeFileSync(memberFile, JSON.stringify({ email: member.email, books: entries.map((entry) => ({ id: entry.book.id, title: entry.book.title })) }, null, 2))
    await page.reload()
    await page.getByTestId('home.title').waitFor()
    console.log('member', member.email, 'controller', await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    await screenshot('0-home')
    return
  }
  const member = existsSync(memberFile) ? (JSON.parse(readFileSync(memberFile, 'utf8')) as { books: { id: string; title: string }[] }) : null

  if (args.step === 'share1') {
    await share(page, ['pg1342.epub'])
    await sleep(800)
    await screenshot('1-share-one')
  }
  if (args.step === 'share3') {
    await share(page, ['pg2701.epub', 'pg345.epub', 'pg84.epub'])
    await sleep(1200)
    await screenshot('2-share-three')
    console.log(
      'copies',
      await page.evaluate(async () => {
        const out: string[] = []
        const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
          for await (const [name, handle] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries())
            handle.kind === 'directory' ? await walk(handle as FileSystemDirectoryHandle, `${prefix}${name}/`) : out.push(`${prefix}${name}`)
        }
        await walk(await navigator.storage.getDirectory(), '')
        return out
      }),
    )
  }
  if (args.step === 'book' && member) {
    await page.goto(`${args.base}/book/${member.books[0]!.id}`)
    await page.getByTestId('book.ebook').waitFor()
    await sleep(1000)
    await screenshot('3-book-linked')
  }
  if (args.step === 'pick') {
    await page.goto(`${args.base}/ebooks`)
    await page.getByTestId('ebooks.folder').waitFor()
    await sleep(800)
    await tapReal(page, 'ebooks.folder')
    await sleep(2000)
    await screenshot('4-folder-picker')
  }
  if (args.step === 'scan') {
    // A reload in the installed app drops the folder's permission (phase 0): Scan has to ask on the tap.
    await page.goto(`${args.base}/ebooks`)
    await page.getByTestId('ebooks.folderName').waitFor()
    console.log('folder', await page.getByTestId('ebooks.folderName').innerText(), 'permission', await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('libellus')
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      const all = await new Promise<{ handle: FileSystemDirectoryHandle & { queryPermission(o: object): Promise<string> } }[]>((resolve) => {
        const req = db.transaction('ebookFolders').objectStore('ebookFolders').getAll()
        req.onsuccess = () => resolve(req.result)
      })
      return all[0] ? all[0].handle.queryPermission({ mode: 'read' }) : 'no folder'
    }))
    await sleep(600)
    await tapReal(page, 'ebooks.scan')
    await sleep(1500)
    await screenshot('5-scan-allow')
  }
  if (args.step === 'report') {
    await page.getByTestId('ebooks.reportLine').waitFor({ timeout: 60_000 })
    console.log('scan:', await page.getByTestId('ebooks.reportLine').innerText())
    await sleep(800)
    await screenshot('6-scan-report')
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
