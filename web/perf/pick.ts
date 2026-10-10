/**
 * PROTOTYPE (#259, Pick my next book) — not part of `pnpm e2e` nor of `pnpm perf`: a Playwright
 * script that drives the whole pick for each animation variant on a phone (390 × 844 @ 3, touch,
 * dark, motion on) against a running app, records a video and a frame strip per variant, and in a
 * second pass measures the deal's frame cost on a throttled CPU (rAF gaps, long frames, LoAF).
 *
 *   PICK_APP=http://localhost:3100 PICK_SUPABASE_URL=http://127.0.0.1:55791 \
 *   PICK_STACK_DIR=/tmp/libellus-pick-stack pnpm perf:pick [--variants deck,stack,wheel] [--cpu 4] [--runs 3] [--no-demo] [--no-measure]
 *
 * Needs: the app served (dev or a build) with the stack it talks to, and the dev member seeded
 * (`pnpm seed:dev`: dev@libellus.local with ~50 Want to read). Out: /tmp/pick-next-demo/ and the
 * worktree's `.shots/` (untracked): `<variant>.webm`, `<variant>-strip.png`, `<variant>-*.png`,
 * `frames.json`. Tag: @prototype.
 *
 * It writes to the dev member's Library: one variant ends with Accept (a Book starts).
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'

const { values: args } = parseArgs({
  options: {
    variants: { type: 'string', default: 'deck,stack,wheel' },
    cpu: { type: 'string', default: '4' },
    runs: { type: 'string', default: '3' },
    'no-demo': { type: 'boolean', default: false },
    'no-measure': { type: 'boolean', default: false },
    deal: { type: 'string', default: '' },
    headed: { type: 'boolean', default: false },
  },
})

const APP = process.env.PICK_APP ?? 'http://localhost:3100'
const SUPABASE_URL = process.env.PICK_SUPABASE_URL ?? 'http://127.0.0.1:55791'
const STACK_DIR = process.env.PICK_STACK_DIR ?? '/tmp/libellus-pick-stack'
const EMAIL = process.env.PICK_EMAIL ?? 'dev@libellus.local'
const OUT = '/tmp/pick-next-demo'
const SHOTS = new URL('../../.shots/', import.meta.url).pathname
const VARIANTS = args.variants!.split(',') as ('deck' | 'stack' | 'wheel')[]
const LETTER = { deck: 'a', stack: 'b', wheel: 'c' } as const
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
mkdirSync(OUT, { recursive: true })
mkdirSync(SHOTS, { recursive: true })

function keys() {
  const status = execFileSync('supabase', ['status', '-o', 'json', '--workdir', STACK_DIR], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  const parsed = JSON.parse(status.replace(/^[^{]*/, '')) as Record<string, string>
  return { anon: parsed.ANON_KEY!, service: parsed.SERVICE_ROLE_KEY! }
}

/** A session for the dev member, as the sign-in's last step makes it (admin link → verifyOtp), in supabase-js' storage entry. */
async function session(): Promise<Record<string, string>> {
  const { anon, service } = keys()
  const admin = createClient(SUPABASE_URL, service, { auth: { persistSession: false } })
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: EMAIL })
  if (link.error) throw new Error(`no session for ${EMAIL}: ${link.error.message} (pnpm seed:dev?)`)
  const store: Record<string, string> = {}
  const storage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v), removeItem: (k: string) => void delete store[k] }
  const client = createClient(SUPABASE_URL, anon, { auth: { storage, persistSession: true, autoRefreshToken: false } })
  const verified = await client.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'magiclink' })
  if (verified.error) throw verified.error
  return { [`sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`]: Object.values(store)[0]! }
}

async function context(browser: Browser, auth: Record<string, string>, video: string | null): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark',
    reducedMotion: 'no-preference',
    ...(video ? { recordVideo: { dir: video, size: { width: 390, height: 844 } } } : {}),
  })
  await ctx.addInitScript('window.__name = (fn) => fn')
  await ctx.addInitScript((s: Record<string, string>) => {
    for (const [k, v] of Object.entries(s)) if (!localStorage.getItem(k)) localStorage.setItem(k, v)
    // Home's install hint and import offer stay away, as for a member who has been here before.
    localStorage.setItem('libellus-install-hint', String(Date.now()))
    const w = window as unknown as Record<string, unknown>
    w.__loaf = []
    try {
      new PerformanceObserver((l) => (w.__loaf as PerformanceEntry[]).push(...l.getEntries())).observe({ type: 'long-animation-frame', buffered: true })
    } catch {}
  }, auth)
  return ctx
}

const tap = (page: Page, testid: string, nth = 0) => page.getByTestId(testid).nth(nth).tap()

/** The candidates page with five Books from the Want to read list and one from search. */
async function choose(page: Page, variant: string, shot: (name: string) => Promise<string>) {
  const deal = args.deal ? `&deal=${args.deal}` : ''
  await page.goto(`${APP}/library?pick=1&variant=${LETTER[variant as keyof typeof LETTER]}${deal}`)
  await page.getByTestId('library.pick').waitFor({ timeout: 30_000 })
  await sleep(600)
  await shot('1-entry')
  await tap(page, 'library.pick')
  await page.getByTestId('pick.item').first().waitFor()
  for (const at of [0, 3, 6, 10, 15]) await tap(page, 'pick.item', at)
  await page.getByTestId('pick.search').fill('klara and the sun')
  const result = page.locator('[data-testid="pick.result"]:not([disabled])').first()
  await result.waitFor({ timeout: 15_000 }).then(() => result.tap()).catch(() => console.log('  (search found nothing to add: five from the list)'))
  await sleep(500)
  await page.evaluate(() => window.scrollTo(0, 0))
  await sleep(300)
  await shot('2-choose')
}

/** Frames of the deal: a screenshot every `every` ms until the bar is there. */
async function filmDeal(page: Page, prefix: string, shot: (name: string) => Promise<string>, every = 450) {
  const frames: string[] = []
  const t0 = Date.now()
  for (let i = 0; i < 16; i++) {
    if (await page.getByTestId('pick.bar').isVisible()) break
    frames.push(await shot(`${prefix}-${String(i).padStart(2, '0')}`))
    await sleep(Math.max(0, every - ((Date.now() - t0) % every)))
  }
  return frames
}

async function strip(files: string[], to: string) {
  const width = 260
  const height = Math.round((width * 844) / 390)
  const tiles = await Promise.all(files.map((f) => sharp(f).resize(width, height).png().toBuffer()))
  const gap = 8
  await sharp({ create: { width: tiles.length * (width + gap) - gap, height, channels: 3, background: '#0e0c0a' } })
    .composite(tiles.map((input, i) => ({ input, left: i * (width + gap), top: 0 })))
    .png()
    .toFile(to)
}

async function demo(browser: Browser, auth: Record<string, string>, variant: 'deck' | 'stack' | 'wheel') {
  const videoDir = join(OUT, `video-${variant}`)
  rmSync(videoDir, { recursive: true, force: true })
  const ctx = await context(browser, auth, videoDir)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`  pageerror: ${e.message}`))
  const shot = async (name: string) => {
    const file = join(OUT, `${variant}-${name}.png`)
    await page.screenshot({ path: file })
    return file
  }
  await choose(page, variant, shot)
  await tap(page, 'pick.go')
  const deal1 = await filmDeal(page, '3-deal', shot)
  await page.getByTestId('pick.bar').waitFor({ timeout: 15_000 })
  await sleep(900)
  const result = await shot('4-result')
  await tap(page, 'pick.other', 1)
  await sleep(400)
  const other = await shot('5-other')
  await tap(page, 'pick.decline')
  const deal2 = await filmDeal(page, '6-deal2', shot, 500)
  await page.getByTestId('pick.bar').waitFor({ timeout: 15_000 })
  await sleep(900)
  const second = await shot('7-result2')
  let end: string
  if (variant === 'wheel') {
    // Decline until none is left: the last one comes without a deal, then the quiet end.
    for (let i = 0; i < 8; i++) {
      if (await page.getByTestId('pick.emptyTitle').isVisible()) break
      await page.getByTestId('pick.decline').waitFor({ timeout: 15_000 })
      await sleep(300)
      if (await page.getByTestId('pick.round').innerText().then((t) => /last/i.test(t))) await shot('8-last')
      await tap(page, 'pick.decline')
      await page.getByTestId('pick.bar').waitFor({ timeout: 15_000 })
      await page.waitForFunction(() => !document.querySelector('[data-testid="pick.stage"]'), null, { timeout: 15_000 })
      await sleep(500)
    }
    end = await shot('9-end')
  } else {
    await tap(page, 'pick.accept')
    // A Book from search opens the Add sheet on Currently reading: its button adds it.
    const add = page.getByTestId('add.submit')
    if (await add.isVisible({ timeout: 1500 }).catch(() => false)) {
      await sleep(500)
      await shot('8-add')
      await add.tap()
    }
    await page.getByTestId('pick.accepted').waitFor({ timeout: 15_000 })
    await sleep(500)
    end = await shot('9-accepted')
  }
  const video = page.video()
  await ctx.close()
  const recorded = video ? await video.path() : null
  const frames = [join(OUT, `${variant}-1-entry.png`), join(OUT, `${variant}-2-choose.png`), ...pickSome(deal1, 5), result, other, ...pickSome(deal2, 2), second, end]
  const stripFile = join(OUT, `${variant}-strip.png`)
  await strip(frames, stripFile)
  if (recorded) renameSync(recorded, join(OUT, `${variant}.webm`))
  rmSync(videoDir, { recursive: true, force: true })
  for (const file of [`${variant}.webm`, `${variant}-strip.png`]) copyFileSync(join(OUT, file), join(SHOTS, file))
  console.log(`  ${variant}: ${OUT}/${variant}.webm, ${variant}-strip.png (${frames.length} frames)`)
}

function pickSome<T>(list: T[], n: number): T[] {
  if (list.length <= n) return list
  return Array.from({ length: n }, (_, i) => list[Math.round((i * (list.length - 1)) / (n - 1))]!)
}

/** One deal on a throttled CPU: rAF gaps from Pick to the bar, long frames, LoAF. */
async function measure(browser: Browser, auth: Record<string, string>, variant: 'deck' | 'stack' | 'wheel', cpu: number) {
  const ctx = await context(browser, auth, null)
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await choose(page, variant, async () => '')
  // The deal's code and covers once, unthrottled (a warm second pick is what is measured).
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu })
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>
    const gaps: number[] = []
    const times: number[] = []
    w.__gaps = gaps
    w.__times = times
    w.__rec = true
    ;(w.__loaf as unknown[]).length = 0
    let last = performance.now()
    const tick = (t: number) => {
      gaps.push(t - last)
      times.push(t)
      last = t
      if (w.__rec) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  const t0 = Date.now()
  await tap(page, 'pick.go')
  await page.getByTestId('pick.bar').waitFor({ timeout: 30_000 })
  const ms = Date.now() - t0
  const data = await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>
    w.__rec = false
    const loaf = (w.__loaf as PerformanceEntry[]).map((e) => ({ duration: e.duration, blocking: (e as unknown as { blockingDuration: number }).blockingDuration }))
    const marks = performance.getEntriesByType('mark').filter((m) => m.name.startsWith('regal:deal')).map((m) => m.name)
    const at = (name: string) => performance.getEntriesByName(name).at(-1)?.startTime ?? null
    return { gaps: w.__gaps as number[], times: w.__times as number[], loaf, loafAt: (w.__loaf as PerformanceEntry[]).map((e) => e.startTime), marks, start: at('pick:deal:start'), end: at('pick:deal:end') }
  })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  await ctx.close()
  // The deal itself: from `ready` (the motion starts) to the winner resting; the rest is the page's.
  const inDeal = (t: number) => data.start !== null && data.end !== null && t >= data.start && t <= data.end
  const gaps = data.gaps.slice(1).filter((_, i) => inDeal(data.times[i + 1]!))
  const whole = data.gaps.slice(1)
  const sorted = [...gaps].sort((a, b) => a - b)
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0
  return {
    variant,
    ms,
    frames: gaps.length,
    fps: Math.round((gaps.length / gaps.reduce((a, b) => a + b, 0)) * 1000 * 10) / 10,
    p50: Math.round(pct(0.5) * 10) / 10,
    p95: Math.round(pct(0.95) * 10) / 10,
    max: Math.round((sorted.at(-1) ?? 0) * 10) / 10,
    long: gaps.filter((g) => g > 33.4).length,
    dealMs: data.start !== null && data.end !== null ? Math.round(data.end - data.start) : null,
    loaf: data.loaf.filter((_, i) => inDeal(data.loafAt[i]!)).length,
    loafBlocking: Math.round(data.loaf.filter((_, i) => inDeal(data.loafAt[i]!)).reduce((a, e) => a + (e.blocking ?? 0), 0)),
    wholeLong: whole.filter((g) => g > 33.4).length,
    wholeMax: Math.round(Math.max(...whole) * 10) / 10,
    marks: data.marks,
  }
}

const auth = await session()
const browser = await chromium.launch({
  headless: !args.headed,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
})
if (!args['no-demo']) {
  console.log('demo: video and frame strip per variant')
  for (const variant of VARIANTS) await demo(browser, auth, variant)
}
if (!args['no-measure']) {
  const cpu = Number(args.cpu)
  const rows: Awaited<ReturnType<typeof measure>>[] = []
  console.log(`frame cost: Chromium, CPU ${cpu}x, ${args.runs} runs per variant (rAF gaps from Pick to the result; long = over 33.4 ms, two frames)`)
  for (const variant of VARIANTS)
    for (let run = 0; run < Number(args.runs); run++) {
      const row = await measure(browser, auth, variant, cpu)
      rows.push(row)
      console.log(`  ${variant} #${run + 1}: deal ${row.dealMs} ms, ${row.frames} frames, ${row.fps} fps, p50 ${row.p50} p95 ${row.p95} max ${row.max} ms, long ${row.long}, LoAF ${row.loaf} (${row.loafBlocking} ms blocking) · Pick→bar ${row.ms} ms: long ${row.wholeLong}, max ${row.wholeMax} ms`)
    }
  writeFileSync(join(OUT, 'frames.json'), JSON.stringify({ cpu, deal: args.deal || 'default', rows }, null, 2))
  copyFileSync(join(OUT, 'frames.json'), join(SHOTS, `frames${args.deal ? `-${args.deal}` : ''}.json`))
}
await browser.close()
console.log(readdirSync(SHOTS).join(' '))
