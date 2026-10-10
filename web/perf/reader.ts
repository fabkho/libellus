/**
 * Perf harness: how fast "Read now" opens the ebook reader (docs/perf/bundle.md, F6), on a throttled Chromium.
 *
 *   pnpm perf:reader [--profile slow4g-4x] [--runs 3] [--label after]
 *
 * Needs the seeded stack (pnpm perf:seed), a build (pnpm perf:build) and its server (pnpm perf:serve). A fresh
 * browser context per case, the seeded member signed in, Metamorphosis linked to one of her Books as an ebook
 * (the way Add ebook does it, unthrottled), then a new page at the profile's throttling on that Book's page:
 *
 *   prefetched   waits until the reader's chunks are in (or the build has none to wait for), then taps Read now
 *   mid-prefetch taps the moment the button shows
 *   cold         no prefetch (Save-Data on): what the tap costs with nothing fetched ahead
 *
 * and for each: tap → the reader's room is on screen, tap → `data-ready` (the opening flight and the engine
 * done), and whether anything that looks like a loading state (a spinner, a skeleton, a busy region) showed
 * in between. The service worker is blocked in the `network` rows, so the chunks cost the throttled network
 * as on a first visit; the `sw` rows let it install first and keep the precache/runtime cache (a returning
 * member). Run it against the build before and after a change (`--label`) to compare.
 */
import { createClient } from '@supabase/supabase-js'
import type { BrowserContext, Page } from '@playwright/test'
import { buildEpub, METAMORPHOSIS_GUTENBERG } from '../tests/support/epub'
import { launch, memberSession, newContext, PROFILES, throttle } from './browser'
import { appUrl } from './env'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
const arg = (name: string, fallback: string) => {
  const at = process.argv.indexOf(`--${name}`)
  return at < 0 ? fallback : (process.argv[at + 1] ?? fallback)
}
const profile = PROFILES[arg('profile', 'slow4g-4x')]!
const runs = Number(arg('runs', '3'))
const label = arg('label', 'build')
const base = appUrl('chromium')
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!

type Case = { name: string; sw: boolean; wait: 'chunks' | 'button' | 'off' }
const CASES: Case[] = [
  { name: 'network · prefetched', sw: false, wait: 'chunks' },
  { name: 'network · mid-prefetch', sw: false, wait: 'button' },
  { name: 'network · cold', sw: false, wait: 'off' },
  { name: 'sw · returning member', sw: true, wait: 'chunks' },
]

const browser = await launch(profile)
const session = await memberSession()

async function prepare(sw: boolean): Promise<{ context: BrowserContext; book: string }> {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true, serviceWorkers: sw ? 'allow' : 'block', colorScheme: 'dark' })
  await context.addInitScript('window.__name = (fn) => fn')
  await context.addInitScript((s: Record<string, string>) => {
    for (const [k, v] of Object.entries(s)) if (!localStorage.getItem(k)) localStorage.setItem(k, v)
  }, session)
  const page = await context.newPage()
  // The Library opens on Want to read: its first card is a Book with a Read now button once an ebook is linked.
  await page.goto(`${base}/library`)
  const card = page.locator('[data-testid="library.wantToRead"] a[href^="/book/"]').first()
  await card.waitFor({ timeout: 60_000 })
  const href = (await card.getAttribute('href'))!
  await page.goto(`${base}${href}`)
  await page.getByTestId('book.title').waitFor()
  await page.getByTestId('book.options').click()
  await page.getByTestId('bookOptions.addEbook').setInputFiles({ name: 'pg5200.epub', mimeType: 'application/epub+zip', buffer: Buffer.from(buildEpub(METAMORPHOSIS_GUTENBERG)) })
  // The file is Metamorphosis and the Book is not: the app asks once whether to link it anyway.
  const another = page.getByTestId('ebookAnother.action')
  await another.or(page.getByTestId('book.ebook')).first().waitFor({ timeout: 30_000 })
  if (await another.isVisible()) await another.click()
  await page.getByTestId('book.ebook').waitFor()
  if (sw) {
    // The precache is complete when the worker controls the page and its cache stops growing.
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
    let last = -1
    for (let i = 0; i < 60; i++) {
      const n = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async (k) => (await (await caches.open(k)).keys()).length))).reduce((a, b) => a + b, 0))
      if (n === last && n > 50) break
      last = n
      await page.waitForTimeout(1000)
    }
  }
  await page.close()
  return { context, book: href }
}

async function measure(c: Case, context: BrowserContext, book: string) {
  const page: Page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await throttle(cdp, profile)
  // Linking the ebook (above) already fetched the reader into the HTTP cache; a returning member's page does not have it there.
  await cdp.send('Network.clearBrowserCache')
  const reader = /ebook-reader|reader\./
  // Nothing fetched ahead: the browser says the member asked to save data, so the app does not prefetch (a failed
  // prefetch would leave the failure in the module map, and the tap would fail with it).
  if (c.wait === 'off') await page.addInitScript(() => Object.defineProperty(navigator, 'connection', { value: { saveData: true } }))
  await page.addInitScript(() => {
    const w = window as unknown as { __tap?: { at: number; layer: number | null; ready: number | null; loaders: string[] } }
    const watch = () => {
      const t = w.__tap
      if (!t) return requestAnimationFrame(watch)
      const layer = document.querySelector('[data-testid="reader"]')
      const now = performance.now()
      if (layer && t.layer === null) t.layer = now - t.at
      if (layer?.getAttribute('data-ready') === 'true' && t.ready === null) t.ready = now - t.at
      for (const el of document.querySelectorAll('[aria-busy="true"], [data-testid*="loading" i], [data-testid*="skeleton" i], .skeleton, .spinner')) t.loaders.push(el.getAttribute('data-testid') ?? el.className)
      if (t.ready === null) requestAnimationFrame(watch)
    }
    requestAnimationFrame(watch)
  })
  await page.goto(`${base}${book}`, { waitUntil: 'commit' })
  await page.getByTestId('book.read').waitFor({ timeout: 60_000 })
  if (c.wait === 'chunks') {
    // Prefetched: every chunk of the reader is in (builds without a `reader` chunk have no wait to do).
    await page.waitForFunction(() => performance.getEntriesByType('resource').some((e) => /ebook-reader|\/reader\./.test(e.name)) || false, null, { timeout: 30_000 }).catch(() => {})
    await page.waitForTimeout(2500)
  }
  const before = await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => /_nuxt\//.test(e.name)).length)
  await page.evaluate(() => {
    ;(window as unknown as { __tap: unknown }).__tap = { at: performance.now(), layer: null, ready: null, loaders: [] }
  })
  await page.getByTestId('book.read').tap()
  await page.waitForFunction(() => (window as unknown as { __tap: { ready: number | null } }).__tap.ready !== null, null, { timeout: 60_000 })
  const tap = await page.evaluate(() => (window as unknown as { __tap: { layer: number | null; ready: number | null; loaders: string[] } }).__tap)
  const after = await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => /_nuxt\//.test(e.name)).length)
  const fetched = await page.evaluate((re) => performance.getEntriesByType('resource').filter((e) => new RegExp(re).test(e.name)).map((e) => `${e.name.split('/').pop()} ${Math.round((e as PerformanceResourceTiming).encodedBodySize / 1024)} KB`), reader.source)
  await page.close()
  return { layer: tap.layer ?? NaN, ready: tap.ready ?? NaN, loaders: [...new Set(tap.loaders)], fetchedAtTap: after - before, fetched }
}

console.log(`${label} · ${profile.name} · ${runs} runs (median; ms from the tap)`)
console.log('case'.padEnd(26), 'room shown'.padStart(11), 'ready'.padStart(8), ' loading UI   chunks fetched by the tap')
for (const c of CASES) {
  const rows: Awaited<ReturnType<typeof measure>>[] = []
  for (let i = 0; i < runs; i++) {
    const { context, book } = await prepare(c.sw)
    rows.push(await measure(c, context, book))
    await context.close()
  }
  const loaders = [...new Set(rows.flatMap((r) => r.loaders))]
  console.log(c.name.padEnd(26), String(Math.round(median(rows.map((r) => r.layer)))).padStart(11), String(Math.round(median(rows.map((r) => r.ready)))).padStart(8), ' ', (loaders.length ? loaders.join(',') : 'none').padEnd(12), median(rows.map((r) => r.fetchedAtTap)), 'files;', rows.at(-1)!.fetched.join(', ') || '-')
}
await browser.close()
