import { expect } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { METAMORPHOSIS_GUTENBERG, type EpubSpec } from '../tests/support/epub'
import { sql } from '../tests/support/stack'
import { test } from './fixtures'
import { openReader, shelve, withEbook } from './readerSupport'
import { recordedApple, signedIn, untilStill } from './support'

/**
 * The built-in reader (#131, phase 2), on the iPhone viewport. Chromium: the
 * copy is kept in the origin private file system, which Playwright's WebKit
 * does not write (e2e/ebooks.spec.ts likewise). The EPUB is built in memory from the
 * openings of Metamorphosis's three parts (Project Gutenberg #5200, public
 * domain) and linked with Add ebook, as phase 1 does.
 *
 * - Read now is the lit action of a Book being read with its ebook here; it
 *   opens the reader over the page, the printed page by default (sepia).
 * - A page turned and the reader closed: the progress is written (forward
 *   only, at once on closing) and the place is kept server-side.
 * - The Aa sheet's Classic mode switches the style; Contents goes to a part.
 * - A Want to read Book asks to start reading before progress counts.
 * - A crafted EPUB (Metamorphosis with every trick in its first part) runs no
 *   script and reaches nothing outside the book, in a scriptless frame
 *   (Chromium) and in one that allows scripts (as WebKit needs), while it still
 *   shows, styled, and turns its pages.
 */

test.use({ browserName: 'chromium' })

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

/** The progress of the member's open read. */
const progressOf = (email: string) =>
  sql<{ progress_page: number | null }>(
    `select s.progress_page from public.reading_sessions s
       join public.library_entries e on e.id = s.entry_id
       join auth.users u on u.id = e.member_id
      where u.email = $1 and s.outcome is null`,
    [email],
  )

test('Read now opens the reader; a page turned is progress, written on closing, and the place is kept', async ({ page }) => {
  const member = await signedIn(page)
  const entry = await shelve(member, 'Metamorphosis', 'reading')
  await withEbook(page, entry)

  // With the ebook here, Read now is the action and Finish steps back beside Abandon.
  await expect(page.getByTestId('book.read')).toHaveText(en.book.read)
  await expect(page.getByTestId('book.finish')).toBeVisible()

  const reader = await openReader(page)
  // The printed page in sepia, by default.
  await expect(reader).toHaveAttribute('data-mode', 'c')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sepia')

  // Turn on: the keyboard's arrow turns a page, as a tap at the right edge does.
  const opened = (await reader.getAttribute('data-fraction'))!
  await page.keyboard.press('ArrowRight')
  await expect(reader).not.toHaveAttribute('data-fraction', opened)
  const turned = (await reader.getAttribute('data-fraction'))!
  // A second turn asked for while the page still settles is kept, not lost.
  await page.keyboard.press('ArrowRight')
  await page.mouse.click(370, 400)
  await expect.poll(async () => Number(await reader.getAttribute('data-fraction'))).toBeGreaterThan(Number(turned))
  const read = (await reader.getAttribute('data-fraction'))!

  // A tap in the middle brings the capsule; Back closes the book.
  await reader.getByTestId('reader.page').click({ position: { x: 195, y: 400 } })
  await page.getByTestId('reader.back').click()
  await expect(page.getByTestId('reader')).toHaveCount(0)
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'sepia')

  // The progress went forward (on closing, not after the idle wait), and the place is the server's too.
  await expect.poll(async () => (await progressOf(member.email))[0]?.progress_page ?? 0).toBeGreaterThan(0)
  await expect
    .poll(async () => (await sql<{ n: number }>('select count(*)::int as n from public.reader_places where entry_id = $1', [entry.id]))[0]!.n)
    .toBe(1)

  // Opening again goes back to the same place.
  const again = await openReader(page)
  await expect(again).toHaveAttribute('data-fraction', read)
})

test('Aa: Classic mode switches the style and stays; Contents goes to a part', async ({ page }) => {
  const member = await signedIn(page)
  const entry = await shelve(member, 'Metamorphosis', 'reading')
  await withEbook(page, entry)

  const reader = await openReader(page)
  await reader.getByTestId('reader.page').click({ position: { x: 195, y: 400 } })
  await page.getByTestId('reader.type').click()
  await expect(page.getByTestId('readerType')).toBeVisible()
  await page.getByTestId('readerType.classic').click()
  await expect(page.getByTestId('readerType.classic')).toHaveAttribute('aria-checked', 'true')
  await expect(reader).toHaveAttribute('data-mode', 'a')
  await page.keyboard.press('Escape')
  await untilStill(page)

  await reader.getByTestId('reader.page').click({ position: { x: 195, y: 400 } })
  await page.getByTestId('reader.contents').click()
  await expect(page.getByTestId('readerContents.list')).toBeVisible()
  await page.getByTestId('readerContents.item.2').click()
  await expect(page.getByTestId('readerContents')).toHaveCount(0)
  await expect(reader).toHaveAttribute('data-chapter', '2')
})

test('A Want to read Book: Read now opens the book and asks to start reading', async ({ page }) => {
  const member = await signedIn(page)
  const entry = await shelve(member, 'Metamorphosis', 'want_to_read')
  await withEbook(page, entry)

  // Start reading steps back beside Read now.
  await expect(page.getByTestId('book.start')).toBeVisible()
  await openReader(page)
  await expect(page.getByTestId('start')).toBeVisible()
})

// ------------------------------------------------------------------ a crafted book

/** What a script of the book would leave on the app's window, had it run. */
const pwn = (what: string) => `top.__libellusPwned=(top.__libellusPwned||[]).concat('${what}')`

/** Metamorphosis, its first part carrying every way a page tries to run a script as Libellus or reach outside the book. */
const CRAFTED: EpubSpec = {
  ...METAMORPHOSIS_GUTENBERG,
  chapters: METAMORPHOSIS_GUTENBERG.chapters!.map((chapter, i) =>
    i > 0
      ? chapter
      : {
          ...chapter,
          head:
            '<script type="text/javascript" src="trap.js"></script>' +
            `<script type="text/javascript">${pwn('inline script')}</script>` +
            '<meta http-equiv="refresh" content="0;url=https://evil.example/refresh"/>' +
            `<meta http-equiv="Content-Security-Policy" content="script-src * 'unsafe-inline'"/>` +
            '<base href="https://evil.example/"/>' +
            '<link rel="stylesheet" type="text/css" href="trap.css"/>' +
            '<link rel="stylesheet" type="text/css" href="https://evil.example/track.css"/>',
          markup:
            '<p id="trap-style" class="sc">Kept in small capitals by the book’s own stylesheet.</p>' +
            `<img id="trap-img" src="../images/cover.jpg" alt="" onload="${pwn('onload')}"/>` +
            `<img src="missing.png" alt="" onerror="${pwn('onerror')}"/>` +
            `<p><a id="trap-link" href="javascript:${pwn('javascript link')}">A link</a> and <a href="https://evil.example/web">one out</a>.</p>` +
            `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" onload="${pwn('svg onload')}"><script>${pwn('svg script')}</script><rect width="12" height="12"/></svg>` +
            `<iframe srcdoc="&lt;script&gt;${pwn('srcdoc')}&lt;/script&gt;"></iframe>` +
            '<object data="trap.svg" type="image/svg+xml"></object><embed src="trap.svg" type="image/svg+xml"/>' +
            `<form action="https://evil.example/form"><input name="q" value="x" onfocus="${pwn('onfocus')}" autofocus="autofocus"/></form>`,
        },
  ),
  resources: [
    { id: 'trap-js', href: 'text/trap.js', mediaType: 'application/javascript', content: pwn('script file') },
    { id: 'trap-css', href: 'text/trap.css', mediaType: 'text/css', content: '.sc { text-transform: uppercase } body { background-image: url(https://evil.example/pixel.png) }' },
    { id: 'trap-svg', href: 'text/trap.svg', mediaType: 'image/svg+xml', content: `<svg xmlns="http://www.w3.org/2000/svg"><script>${pwn('object svg')}</script></svg>` },
  ],
}

for (const frames of ['scriptless', 'scripted'] as const) {
  test(`A crafted book runs no script and reaches nothing outside itself (${frames} frames), and still reads`, async ({ page }) => {
    if (frames === 'scripted') {
      // As on WebKit, where a frame without scripts gets no events: the probe for it cannot tell, so
      // the frames keep `allow-scripts`, and only the sanitizer and each page's own policy stand guard.
      await page.addInitScript(() => {
        const own = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentDocument')!
        Object.defineProperty(HTMLIFrameElement.prototype, 'contentDocument', {
          configurable: true,
          get(this: HTMLIFrameElement) {
            return this.getAttribute('srcdoc')?.includes('<title>probe</title>') ? null : own.get!.call(this)
          },
        })
      })
    }
    const outside: string[] = []
    await page.route('https://evil.example/**', (route) => {
      outside.push(route.request().url())
      return route.abort()
    })
    const violations: string[] = []
    page.on('console', (message) => {
      if (/Content.Security.Policy/i.test(message.text())) violations.push(message.text())
    })

    const member = await signedIn(page)
    const entry = await shelve(member, 'Metamorphosis', 'reading')
    await withEbook(page, entry, CRAFTED)
    const bookUrl = page.url()
    const reader = await openReader(page)

    // The first part's frame (foliate's, in its closed shadow root): read through its element, from the app's side.
    const frame = await expect
      .poll(async () => {
        for (const f of page.frames()) if (f.url().startsWith('blob:') && (await f.locator('#trap-style').count())) return f
        return null
      })
      .not.toBeNull()
      .then(async () => {
        for (const f of page.frames()) if (f.url().startsWith('blob:') && (await f.locator('#trap-style').count())) return f
        throw new Error('no frame')
      })
    const element = (await frame.frameElement()) as import('@playwright/test').ElementHandle<HTMLIFrameElement>
    expect(await element.getAttribute('sandbox')).toBe(frames === 'scriptless' ? 'allow-same-origin' : 'allow-same-origin allow-scripts')
    const inside = () =>
      element.evaluate((iframe) => {
        const doc = iframe.contentDocument!
        const img = doc.getElementById('trap-img') as HTMLImageElement | null
        return {
          text: doc.body.textContent ?? '',
          transform: getComputedStyle(doc.getElementById('trap-style')!).textTransform,
          image: img?.complete ? img.naturalWidth : -1,
          scripts: doc.querySelectorAll('script, iframe, object, embed, form, base').length,
          handlers: [...doc.querySelectorAll('*')].flatMap((el) => [...el.attributes].filter((a) => /^on/i.test(a.name)).map((a) => a.name)),
          link: doc.getElementById('trap-link')?.getAttribute('href') ?? null,
          policy: doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? '',
          policies: doc.querySelectorAll('meta[http-equiv]').length,
        }
      })

    // It reads: the text, the book's own stylesheet, its picture.
    await expect.poll(async () => (await inside()).image).toBeGreaterThan(0)
    const page1 = await inside()
    expect(page1.text).toContain('One morning, when Gregor Samsa woke')
    expect(page1.transform).toBe('uppercase')
    // Nothing able to run is left, and the page carries its own policy (one: the book's own went).
    expect(page1).toMatchObject({ scripts: 0, handlers: [], link: null, policies: 1 })
    expect(page1.policy).toContain("script-src 'none'")

    // The javascript: link tapped, the page turned on and back: still nothing ran.
    await frame.locator('#trap-link').click({ force: true }).catch(() => {})
    const opened = (await reader.getAttribute('data-fraction'))!
    await page.keyboard.press('ArrowRight')
    await expect(reader).not.toHaveAttribute('data-fraction', opened)
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(1000)

    expect(await page.evaluate(() => (window as unknown as { __libellusPwned?: string[] }).__libellusPwned ?? [])).toEqual([])
    // No navigation (the meta refresh, a base, a link), nothing fetched from outside the book.
    expect(page.url()).toBe(bookUrl)
    expect(page.frames().filter((f) => f.url().includes('evil.example'))).toEqual([])
    expect(outside).toEqual([])
    await expect(reader).toHaveAttribute('data-ready', 'true')
    // The page's own policy blocks nothing the reader needs (its fonts, the book's styles and pictures).
    expect(violations.filter((v) => /font-src|style-src|img-src/.test(v))).toEqual([])
  })
}
