/**
 * Does the cover's flight get worse the more often it flies? (The owner's report: after ten to
 * fifteen round-trips from Home into a Book and back, every transition is glitchy for a while,
 * then recovers.) A measurement, not a check: it runs only by hand, in Chromium (the DevTools
 * protocol slows the CPU and reads the heap), and asserts only that nothing the flight puts up is
 * left behind.
 *
 *   LIBELLUS_E2E_PERF=1 pnpm exec playwright test e2e/perf --repeat-each 5
 *
 * Environment: FLIGHT_ROUNDS (30), FLIGHT_CPU (4: the CPU slowdown), FLIGHT_FROM (home|library),
 * FLIGHT_FINISHED (40: Finished Books besides 3 read and 8 wanted), FLIGHT_BROWSER (chromium|webkit),
 * FLIGHT_NET (local|slow), FLIGHT_OUT (a directory: each run's rounds as JSON, for docs/MOTION.md's tables),
 * FLIGHT_DEBUG (prints the requests still on their way at each Back and every one that failed).
 *
 * Every round taps a cover on the page (the next one each round, as a member browses), waits for
 * the Book page to be still, taps its Back and waits for the list to be still. Per flight (push
 * and pop) it records, from the page's own frames (requestAnimationFrame):
 * - `start`: tap to the flight's first frame (the new page drawn and measured: the work the flight
 *   waits for, Android's "be lazy" lead),
 * - `fly`: the flight's first frame to its landing (`data-moving` gone from the flight layer),
 * - `dropped`: frames missed while it flew (a gap of more than 1.5 frames counts the frames it ate),
 * - `hero`: (push) tap to the Book page's hero drawn with its Book (until then the cover waits on a stand-in),
 * - `loaf`: long animation frames (over 50 ms) from the tap to the hand-off, their count and sum.
 * After each round, with the page at rest and the garbage collected: what the flight put up and
 * left (`.flight-cover`, `.flight-held`, `[data-flight-hidden]`, `data-moving`), the document's
 * animations, the covers and elements in the document, and the DevTools counters (all DOM nodes,
 * detached ones included; event listeners; the JS heap).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type CDPSession, type Page } from '@playwright/test'
import { appleCover } from '../../tests/support/apple'
import { createLibrary } from '../../app/data/library'
import type { BookSnapshot } from '../../app/data/books'
import { runTitle, TEST_PUBLISHER, uniqueAppleId } from '../../tests/support/stack'
import { signedIn, untilStill } from '../support'

const ROUNDS = Number(process.env.FLIGHT_ROUNDS ?? 30)
const CPU = Number(process.env.FLIGHT_CPU ?? 4)
const FROM = process.env.FLIGHT_FROM === 'library' ? 'library' : 'home'
const OUT = process.env.FLIGHT_OUT
/** Finished Books on the shelf besides three being read and eight wanted (a Library of a reader, not a test's three). */
const FINISHED = Number(process.env.FLIGHT_FINISHED ?? 40)
/** `slow`: the stack answers over a phone's connection (300 ms there and back, 1.6 Mbit/s down), as the DevTools protocol slows it. */
const NET = process.env.FLIGHT_NET === 'slow' ? 'slow' : 'local'
// WebKit (Safari's engine, where Libellus is mostly used) has no CPU slowdown, heap or Long Animation Frames: its frames' gaps and the document's counts still tell.
const BROWSER = process.env.FLIGHT_BROWSER === 'webkit' ? 'webkit' : 'chromium'

test.use({
  browserName: BROWSER,
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2.625,
  isMobile: true,
  hasTouch: true,
  reducedMotion: 'no-preference',
})
// Thirty rounds take a minute or two; a run that hangs ends here.
test.describe.configure({ timeout: 10 * 60_000 })

type Flight = { start: number; fly: number; hero: number; dropped: number; worst: number; loafs: number; loafMs: number; loafMax: number }
type State = {
  leftovers: number
  moving: string
  animations: number
  covers: number
  elements: number
  nodes: number
  listeners: number
  heapMb: number
}
/** The stack's answers in a round: how many were asked, their size, and how many were still on their way at each tap. */
type Traffic = { requests: number; failed: number; kb: number; inFlightAtPush: number; inFlightAtPop: number; loafRoundMs: number }
type Round = { round: number; push: Flight; pop: Flight } & State & Traffic

function book(title: string, index: number): BookSnapshot {
  const appleId = uniqueAppleId()
  return {
    title: runTitle(`${title} ${index + 1}`),
    authors: ['Susanna Clarke'],
    isbn13: null,
    isbn10: null,
    pageCount: 272 + index,
    year: 2020,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: 'A soak test of the flight. '.repeat(30),
    // Each Book its own address: its own image to fetch and decode, as on a real shelf.
    coverUrl: `https://is1-ssl.mzstatic.com/image/thumb/Soak/${appleId}/600x900bb.jpg`,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId,
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

/** Instruments the page from its first script: long animation frames, the tap's time, and a frame recorder. */
function instrument() {
  type Loaf = { start: number; duration: number; blocking: number; scripts: { invoker: string; fn: string; src: string; duration: number }[] }
  const perf = {
    loafs: [] as Loaf[],
    frames: [] as number[],
    recording: false,
    tapAt: 0,
    startAt: 0,
    landAt: 0,
    restAt: 0,
    heroAt: 0,
  }
  Object.assign(window, { __perf: perf })
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & {
        blockingDuration: number
        scripts: { invoker: string; sourceFunctionName: string; sourceURL: string; duration: number }[]
      })[]) {
        perf.loafs.push({
          start: entry.startTime,
          duration: entry.duration,
          blocking: entry.blockingDuration,
          scripts: entry.scripts.map((script) => ({ invoker: script.invoker, fn: script.sourceFunctionName, src: script.sourceURL, duration: script.duration })),
        })
      }
    }).observe({ type: 'long-animation-frame', buffered: true })
  } catch {
    // No Long Animation Frames API: the frames' gaps still tell.
  }
  for (const type of ['pointerdown', 'touchstart', 'click'])
    addEventListener(type, () => perf.recording && !perf.tapAt && (perf.tapAt = performance.now()), { capture: true })
  Object.assign(window, {
    __record() {
      Object.assign(perf, { frames: [], recording: true, tapAt: 0, startAt: 0, landAt: 0, restAt: 0, heroAt: 0 })
      const step = (now: number) => {
        if (!perf.recording) return
        perf.frames.push(now)
        const over = document.querySelector('[data-testid="shell.flight"]')
        const flying = Boolean(over?.hasAttribute('data-moving'))
        if (perf.tapAt && flying && !perf.startAt) perf.startAt = now
        if (perf.startAt && !flying && !perf.landAt) perf.landAt = now
        if (perf.tapAt && !perf.heroAt && [...document.querySelectorAll('[data-flight="hero"] [data-cover]')].some((cover) => !cover.closest('[data-flight-layer]')))
          perf.heroAt = now
        if (perf.landAt && !perf.restAt && !document.querySelector('.flight-cover, .flight-held')) perf.restAt = now
        requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    },
  })
}

/** Stops the recorder and reads the flight it saw. */
async function flightOf(page: Page): Promise<Flight> {
  // Two more frames: the landing may have come in the very frame the recorder had already looked at.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  return page.evaluate(() => {
    const perf = (window as unknown as { __perf: { loafs: { start: number; duration: number }[]; frames: number[]; recording: boolean; tapAt: number; startAt: number; landAt: number; restAt: number; heroAt: number } }).__perf
    perf.recording = false
    const { tapAt, startAt, landAt } = perf
    const restAt = perf.restAt || landAt
    const FRAME = 1000 / 60
    let dropped = 0
    let worst = 0
    const frames = perf.frames.filter((t) => t >= startAt && t <= landAt)
    for (let i = 1; i < frames.length; i++) {
      const gap = frames[i]! - frames[i - 1]!
      worst = Math.max(worst, gap)
      if (gap > FRAME * 1.5) dropped += Math.round(gap / FRAME) - 1
    }
    const loafs = perf.loafs.filter((loaf) => loaf.start + loaf.duration >= tapAt && loaf.start <= restAt)
    return {
      start: startAt && tapAt ? Math.round(startAt - tapAt) : -1,
      fly: landAt && startAt ? Math.round(landAt - startAt) : -1,
      hero: perf.heroAt && tapAt ? Math.round(perf.heroAt - tapAt) : -1,
      dropped,
      worst: Math.round(worst),
      loafs: loafs.length,
      loafMs: Math.round(loafs.reduce((sum, loaf) => sum + loaf.duration, 0)),
      loafMax: Math.round(Math.max(0, ...loafs.map((loaf) => loaf.duration))),
    }
  })
}

/** The page at rest: what the flight left behind, and the document's and the heap's size (after a collection). */
async function stateOf(page: Page, cdp: CDPSession | null): Promise<State> {
  await cdp?.send('HeapProfiler.collectGarbage')
  const metrics = cdp ? (await cdp.send('Performance.getMetrics')).metrics : []
  const metric = (name: string) => metrics.find((entry) => entry.name === name)?.value ?? -1
  const inPage = await page.evaluate(() => ({
    leftovers: document.querySelectorAll('.flight-cover, .flight-held, [data-flight-hidden]').length,
    moving: [...document.querySelectorAll('[data-moving]'), ...(document.documentElement.hasAttribute('data-flight-pose') ? [document.documentElement] : [])]
      .map((element) => (element as HTMLElement).dataset.testid ?? element.tagName.toLowerCase())
      .join(','),
    animations: document.getAnimations().length,
    covers: document.querySelectorAll('[data-cover]').length,
    elements: document.getElementsByTagName('*').length,
  }))
  return { ...inPage, nodes: metric('Nodes'), listeners: metric('JSEventListeners'), heapMb: cdp ? Math.round((metric('JSHeapUsedSize') / 1048576) * 10) / 10 : -1 }
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}
/** Least-squares slope per round. */
const slope = (values: number[]) => {
  const n = values.length
  const mx = (n - 1) / 2
  const my = values.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  values.forEach((y, x) => {
    num += (x - mx) * (y - my)
    den += (x - mx) ** 2
  })
  return den ? num / den : 0
}

function report(rounds: Round[]): string {
  const head = 'round | push start hero fly drop loaf(n/ms) | pop start fly drop loaf(n/ms) | left moving anims covers elems nodes listeners heapMB | requests failed kB inflight@push inflight@pop loafRoundMs'
  const lines = rounds.map((r) =>
    [
      String(r.round).padStart(5),
      `push ${r.push.start} ${r.push.hero} ${r.push.fly} ${r.push.dropped} ${r.push.loafs}/${r.push.loafMs}`,
      `pop ${r.pop.start} ${r.pop.fly} ${r.pop.dropped} ${r.pop.loafs}/${r.pop.loafMs}`,
      `${r.leftovers} ${r.moving || '-'} ${r.animations} ${r.covers} ${r.elements} ${r.nodes} ${r.listeners} ${r.heapMb}`,
      `${r.requests} ${r.failed} ${r.kb} ${r.inFlightAtPush} ${r.inFlightAtPop} ${r.loafRoundMs}`,
    ].join(' | '),
  )
  const third = Math.max(1, Math.floor(rounds.length / 3))
  const series: [string, (r: Round) => number][] = [
    ['push.start', (r) => r.push.start],
    ['push.fly', (r) => r.push.fly],
    ['push.dropped', (r) => r.push.dropped],
    ['push.loafMs', (r) => r.push.loafMs],
    ['pop.start', (r) => r.pop.start],
    ['pop.fly', (r) => r.pop.fly],
    ['pop.dropped', (r) => r.pop.dropped],
    ['pop.loafMs', (r) => r.pop.loafMs],
    ['animations', (r) => r.animations],
    ['elements', (r) => r.elements],
    ['nodes', (r) => r.nodes],
    ['listeners', (r) => r.listeners],
    ['heapMb', (r) => r.heapMb],
    ['requests', (r) => r.requests],
    ['failed', (r) => r.failed],
    ['kB', (r) => r.kb],
    ['inFlightAtPush', (r) => r.inFlightAtPush],
    ['loafRoundMs', (r) => r.loafRoundMs],
    ['push.hero', (r) => r.push.hero],
  ]
  const summary = series.map(([name, of]) => {
    const all = rounds.map(of)
    const first = all.slice(0, third)
    const last = all.slice(-third)
    return `${name.padEnd(13)} first ${third}: median ${median(first)} [${Math.min(...first)}–${Math.max(...first)}]  last ${third}: median ${median(last)} [${Math.min(...last)}–${Math.max(...last)}]  slope/round ${slope(all).toFixed(2)}`
  })
  return [head, ...lines, '', ...summary].join('\n')
}

test(`the flight does not get worse round after round (${BROWSER}, ${FROM}, ${ROUNDS} rounds, CPU ÷${BROWSER === 'chromium' ? CPU : 1}, ${NET})`, { tag: '@perf' }, async ({ page, context }, testInfo) => {
  // Covers answered here, never fetched; every other host refused (as e2e/fixtures.ts does).
  await context.route('**/functions/v1/goodreads-rating', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: '{"status":"not_found"}' }),
  )
  await context.route(/^https:\/\/is\d-ssl\.mzstatic\.com\//, (route) =>
    route.fulfill({ status: 200, contentType: 'image/jpeg', headers: { 'access-control-allow-origin': '*' }, body: appleCover() }),
  )
  await context.route(/^https:\/\/(?!is\d-ssl\.mzstatic\.com)(?!localhost)[^/]+\//, (route) => route.abort('blockedbyclient'))
  await context.addInitScript(instrument)

  const member = await signedIn(page)
  const library = createLibrary(member.client)
  const today = new Date().toISOString().slice(0, 10)
  for (let i = 0; i < 3; i++) expect((await library.addToLibrary(book('Reading', i), { status: 'reading', startedOn: today })).error).toBeFalsy()
  for (let i = 0; i < 8; i++) expect((await library.addToLibrary(book('Want', i))).error).toBeFalsy()
  // Ten at a time: a reader's Library of hundreds would take minutes one by one.
  for (let from = 0; from < FINISHED; from += 10) {
    const added = await Promise.all(
      Array.from({ length: Math.min(10, FINISHED - from) }, (_, i) => library.addToLibrary(book('Finished', from + i), { status: 'finished', endedOn: today })),
    )
    for (const result of added) expect(result.error).toBeFalsy()
  }
  await page.goto(FROM === 'home' ? '/' : '/library')
  await untilStill(page)
  await page.waitForTimeout(1500)

  // The covers on screen that open a Book: the rounds go through them in turn.
  const hrefs = await page.evaluate(() => {
    const seen = new Set<string>()
    for (const cover of document.querySelectorAll('[data-flight="page"] a[href^="/book/"] [data-cover]')) {
      const box = cover.getBoundingClientRect()
      if (box.top >= 60 && box.bottom <= innerHeight - 100 && box.width > 0) seen.add(cover.closest('a')!.getAttribute('href')!)
    }
    return [...seen]
  })
  expect(hrefs.length, 'covers on screen to open').toBeGreaterThan(1)

  const cdp = BROWSER === 'chromium' ? await context.newCDPSession(page) : null
  await cdp?.send('Performance.enable')
  await cdp?.send('Emulation.setCPUThrottlingRate', { rate: CPU })
  if (cdp && NET === 'slow') {
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 300, downloadThroughput: 200_000, uploadThroughput: 100_000 })
  }
  // The stack's traffic (its REST and functions), counted from here on.
  const stackCall = (url: string) => /\/(rest|functions)\/v1\//.test(url)
  const traffic = { requests: 0, failed: 0, bytes: 0, inFlight: 0 }
  const open = new Map<import('@playwright/test').Request, number>()
  page.on('request', (request) => {
    if (!stackCall(request.url())) return
    traffic.requests++
    traffic.inFlight++
    open.set(request, Date.now())
  })
  const settle = (request: import('@playwright/test').Request, finished: boolean) => {
    if (!stackCall(request.url())) return
    traffic.inFlight--
    // A HEAD (the year's count) is reported aborted by the slowed network even when it is answered: not a failure.
    if (!finished && request.method() !== 'HEAD') traffic.failed++
    if (!finished && process.env.FLIGHT_DEBUG) console.log(`failed after ${Date.now() - (open.get(request) ?? Date.now())}ms: ${request.failure()?.errorText} ${request.method()} ${request.url().slice(0, 120)}`)
    open.delete(request)
    if (finished) void request.sizes().then((sizes) => (traffic.bytes += sizes.responseBodySize), () => {})
  }
  page.on('requestfinished', (request) => settle(request, true))
  page.on('requestfailed', (request) => settle(request, false))
  const rounds: Round[] = []
  const baseline = await stateOf(page, cdp)
  for (let round = 1; round <= ROUNDS; round++) {
    const href = hrefs[(round - 1) % hrefs.length]!
    Object.assign(traffic, { requests: 0, failed: 0, bytes: 0 })
    const roundAt = await page.evaluate(() => performance.now())
    const inFlightAtPush = traffic.inFlight
    await page.evaluate(() => (window as unknown as { __record(): void }).__record())
    await page.locator(`[data-flight="page"] a[href="${href}"] [data-cover]`).first().tap()
    await expect(page.getByTestId('book.hero')).toBeVisible()
    await untilStill(page)
    await expect(page.locator('.flight-cover, .flight-held')).toHaveCount(0, { timeout: 10_000 })
    const push = await flightOf(page)
    await page.waitForTimeout(400)

    await page.evaluate(() => (window as unknown as { __record(): void }).__record())
    const inFlightAtPop = traffic.inFlight
    if (process.env.FLIGHT_DEBUG) console.log(`round ${round} pop tap, in flight:\n${[...open].map(([r, t]) => `  ${Date.now() - t}ms ${r.method()} ${r.url().slice(0, 160)}`).join('\n')}`)
    await page.getByTestId('book.back').tap()
    await expect(page.getByTestId(FROM === 'home' ? 'home.title' : 'library.entry').first()).toBeVisible()
    await untilStill(page)
    await expect(page.locator('.flight-cover, .flight-held')).toHaveCount(0, { timeout: 10_000 })
    const pop = await flightOf(page)
    const state = await stateOf(page, cdp)
    await page.waitForTimeout(400)
    // Long frames anywhere in the round, flights or not (what lands between them shows here).
    const loafRoundMs = await page.evaluate(
      (since) => Math.round((window as unknown as { __perf: { loafs: { start: number; duration: number }[] } }).__perf.loafs.filter((loaf) => loaf.start >= since).reduce((sum, loaf) => sum + loaf.duration, 0)),
      roundAt,
    )
    rounds.push({ round, push, pop, ...state, requests: traffic.requests, failed: traffic.failed, kb: Math.round(traffic.bytes / 1024), inFlightAtPush, inFlightAtPop, loafRoundMs })
  }
  await cdp?.send('Emulation.setCPUThrottlingRate', { rate: 1 })

  const table = report(rounds)
  console.log(`baseline: ${JSON.stringify(baseline)}\n${table}`)
  await testInfo.attach('rounds', { body: JSON.stringify({ baseline, rounds }, null, 1), contentType: 'application/json' })
  if (OUT) {
    mkdirSync(OUT, { recursive: true })
    writeFileSync(join(OUT, `${BROWSER}-${FROM}-${NET}-${testInfo.repeatEachIndex}.json`), JSON.stringify({ baseline, rounds }, null, 1))
  }
  // What a flight puts up, it takes down: nothing of it is left once the page is at rest.
  for (const r of rounds) expect(r.leftovers, `round ${r.round}: flight elements left`).toBe(0)
})
