/**
 * Perf harness: what the sign-in screen costs to download, from a first launch (no service worker, empty
 * cache, no session), on a throttled Chromium. Counts what the page asks the app's host for until the
 * sign-in form shows, and again after the idle work (the vitals chunks, the service worker's install)
 * has had time to start; the numbers are over the wire (brotli), as CDP reports them.
 *
 *   pnpm perf:signin [--profile slow4g-4x] [--runs 5] [--settle 9000] [--path /]
 *
 * Needs the build (pnpm perf:build) served (pnpm perf:serve). No stack is needed: nobody is signed in.
 * `--path` is the address a signed-out visitor opens (a deep link: /book/x, /f/<token>). Prints one line
 * per run and the median; the list of chunks of the last run is printed with `--files`.
 */
import { launch, netLog, PROFILES, throttle } from './browser'
import { APP_URL } from './env'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
const arg = (name: string, fallback: string) => {
  const at = process.argv.indexOf(`--${name}`)
  return at < 0 ? fallback : (process.argv[at + 1] ?? fallback)
}
const has = (name: string) => process.argv.includes(`--${name}`)
const profile = PROFILES[arg('profile', 'slow4g-4x')]!
const runs = Number(arg('runs', '5'))
const settle = Number(arg('settle', '9000'))
const path = has('path') ? arg('path', '/') : '/'
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!
const kb = (n: number) => (n / 1024).toFixed(1)

const browser = await launch(profile)
const rows: { shown: number; settled: number; files: number; filesShown: number; ms: number; final: string }[] = []
let last: string[] = []
for (let i = 0; i < runs; i++) {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true, serviceWorkers: 'allow', colorScheme: 'dark' })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await throttle(cdp, profile)
  const net = await netLog(page, cdp)
  const t0 = Date.now()
  await page.goto(`${APP_URL}${path}`, { waitUntil: 'commit' })
  await page.getByTestId('signIn.title').waitFor({ timeout: 60_000 })
  const ms = Date.now() - t0
  const app = () => net.entries.filter((e) => e.host === 'app' && /\/_nuxt\/[^/]+\.(js|css)$/.test(new URL(e.url).pathname))
  const shown = app()
  const sumShown = shown.reduce((a, e) => a + e.transfer, 0)
  const filesShown = shown.length
  await page.waitForTimeout(settle)
  const all = app()
  rows.push({ shown: sumShown, settled: all.reduce((a, e) => a + e.transfer, 0), files: all.length, filesShown, ms, final: new URL(page.url()).pathname })
  last = all.map((e) => `${kb(e.transfer).padStart(6)} ${new URL(e.url).pathname}`)
  const r = rows.at(-1)!
  console.log(`run ${i + 1}: shown ${kb(r.shown)} KB in ${r.filesShown} files (${r.ms} ms) · after ${settle / 1000}s ${kb(r.settled)} KB in ${r.files} files · at ${r.final}`)
  await context.close()
}
await browser.close()
console.log(`${profile.name} ${path}: median shown ${kb(median(rows.map((r) => r.shown)))} KB · median after settle ${kb(median(rows.map((r) => r.settled)))} KB · files ${median(rows.map((r) => r.files))} · tap-free time to form ${median(rows.map((r) => r.ms))} ms`)
if (has('files')) console.log(last.join('\n'))
