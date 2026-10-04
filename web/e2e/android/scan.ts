/**
 * Real-device check of the barcode scanner (#92): Chrome on the Android emulator,
 * driven over adb and the Chrome DevTools protocol (docs/TESTING.md). Not part
 * of CI and not a Playwright test.
 *
 *   pnpm tsx e2e/android/scan.ts --base http://localhost:3102 --out /tmp/libellus-92 --serial emulator-5554
 *
 * What is real: Chrome's own `BarcodeDetector` (it must report `ean_13`, or the
 * camera button is rightly hidden), the camera permission prompt, `getUserMedia`
 * and the emulator's camera (`hw.camera.back=emulated`: a moving test scene, no
 * barcode in it), real taps. The emulator's camera cannot be pointed at a book,
 * so the barcode comes in two other ways, both through Chrome's real detector:
 *   1. a still image of an EAN-13 (drawn in the page from the bars' encoding)
 *      handed to `BarcodeDetector.detect()` directly: what the detector reads;
 *   2. the scanner's own pipeline fed by a `getUserMedia` stood in for by a
 *      canvas stream that shows that image: the real <video>, the real detector
 *      loop, the haptic tick, the lookup and the navigation to the book page.
 * The camera permission is granted by hand the first time (the script stops and
 * says so, or taps "Allow while visiting the site" with --allow).
 *
 * The first run signs a fresh test member up (address on the test domain).
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium, type Page } from '@playwright/test'
import sharp from 'sharp'
import { appleAnswer, appleCover } from '../../tests/support/apple'
import { openLibraryAnswer } from '../../tests/support/openLibrary'
import { signUpMember } from '../../tests/support/member'
import { emailCooldown, readMailedCode, stack } from '../../tests/support/stack'

const { values: args } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://localhost:3102' },
    out: { type: 'string', default: '/tmp/libellus-92' },
    serial: { type: 'string', default: 'emulator-5554' },
    allow: { type: 'boolean', default: false },
  },
})
const OUT = args.out!
mkdirSync(OUT, { recursive: true })
process.env.LIBELLUS_TEST_RUN ??= 'android'

const ADB = process.env.ANDROID_HOME ? join(process.env.ANDROID_HOME, 'platform-tools', 'adb') : 'adb'
const adb = (...command: string[]) => execFileSync(ADB, ['-s', args.serial!, ...command], { maxBuffer: 64 * 1024 * 1024 })
const shell = (command: string) => adb('shell', command).toString()
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const ISBN = '9783641264864' // Piranesi, German edition: recorded (tests/fixtures)

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
  const box = await page.getByTestId(testid).first().boundingBox()
  if (!box) throw new Error(`${testid} is not on screen`)
  const x = Math.round(at.x - css.x * css.dpr + (box.x + box.width / 2) * css.dpr)
  const y = Math.round(at.y - css.y * css.dpr + (box.y + box.height / 2) * css.dpr)
  shell(`input tap ${x} ${y}`)
}

async function recorded(page: Page) {
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) })
  await page.route('https://itunes.apple.com/**', (route) => route.fulfill(json(appleAnswer(new URL(route.request().url())))))
  await page.route('https://openlibrary.org/**', (route) => route.fulfill(json(openLibraryAnswer(new URL(route.request().url())))))
  for (const pattern of [/^https:\/\/is\d-ssl\.mzstatic\.com\//, 'https://covers.openlibrary.org/**'])
    await page.route(pattern, (route) => route.fulfill({ status: 200, contentType: 'image/jpeg', headers: { 'access-control-allow-origin': '*' }, body: appleCover() }))
}

/** Draws an EAN-13 (quiet zones, guard bars, digits) on a canvas: the standard L/G/R encodings. */
const DRAW_EAN13 = `(isbn) => {
  const L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011']
  const G = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111']
  const R = ['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100']
  const P = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL']
  const d = [...isbn].map(Number)
  let bits = '101'
  for (let i = 0; i < 6; i++) bits += (P[d[0]][i] === 'L' ? L : G)[d[i + 1]]
  bits += '01010'
  for (let i = 7; i < 13; i++) bits += R[d[i]]
  bits += '101'
  const module = 6, quiet = 11 * module, w = bits.length * module + 2 * quiet, h = 120 * module / 2 + 3 * module
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const c = canvas.getContext('2d')
  c.fillStyle = '#fff'; c.fillRect(0, 0, w, h)
  c.fillStyle = '#000'
  const guard = (i) => i < 3 || (i >= 45 && i < 50) || i >= 92
  for (let i = 0; i < bits.length; i++) if (bits[i] === '1') c.fillRect(quiet + i * module, module, module, h - 2 * module - (guard(i) ? 0 : 5 * module))
  c.fillStyle = '#000'; c.font = (8 * module) + 'px monospace'
  c.fillText(isbn[0], 2, h - module); c.fillText(isbn.slice(1, 7), quiet + 4 * module, h - module / 2); c.fillText(isbn.slice(7), quiet + 51 * module, h - module / 2)
  return canvas
}`

async function main() {
  const apiPort = new URL(stack.url).port
  for (const port of [new URL(args.base!).port, apiPort]) adb('reverse', `tcp:${port}`, `tcp:${port}`)
  adb('forward', 'tcp:9333', 'localabstract:chrome_devtools_remote')

  const browser = await chromium.connectOverCDP('http://localhost:9333')
  // Several tabs may be open: the one on screen is the visible one.
  let page: Page | undefined
  for (const candidate of browser.contexts().flatMap((context) => context.pages()))
    if (candidate.url().startsWith(args.base!) && (await candidate.evaluate(() => document.visibilityState === 'visible').catch(() => false))) page = candidate
  console.log('tab', page?.url())
  if (!page) throw new Error('No Chrome tab open: open Chrome on the device first.')
  await page.context().addInitScript('window.__name = (fn) => fn')
  await page.evaluate('window.__name = (fn) => fn')
  await recorded(page)
  // The WebAssembly decoder is for browsers without a native reader: on this Chrome it must never be asked for.
  const decoderRequests: string[] = []
  page.on('request', (request) => /zxing/i.test(request.url()) && decoderRequests.push(request.url()))

  // Android's own camera permission for Chrome (its second prompt); the site's prompt stays for the run to show.
  if (args.allow) shell('pm grant com.android.chrome android.permission.CAMERA')
  // A permission answered in an earlier run would skip the prompt this run photographs.
  await (await browser.newBrowserCDPSession()).send('Browser.resetPermissions').catch(() => undefined)

  // 1. What this Chrome can read.
  await page.goto(`${args.base}/`)
  await page.waitForLoadState('networkidle')
  const support = await page.evaluate(async () => ({
    hasDetector: 'BarcodeDetector' in window,
    formats: 'BarcodeDetector' in window ? await (window as any).BarcodeDetector.getSupportedFormats() : [],
    hasCamera: Boolean(navigator.mediaDevices?.getUserMedia),
    vibrate: typeof navigator.vibrate,
    ua: navigator.userAgent,
  }))
  console.log('support', JSON.stringify(support))

  // 2. A still image of the barcode, read by Chrome's detector.
  const read = await page.evaluate(async ({ draw, isbn }) => {
    const canvas = (0, eval)(draw)(isbn)
    const detector = new (window as any).BarcodeDetector({ formats: ['ean_13'] })
    const found = await detector.detect(canvas)
    return found.map((code: any) => ({ rawValue: code.rawValue, format: code.format }))
  }, { draw: DRAW_EAN13, isbn: ISBN })
  console.log('still image read by BarcodeDetector', JSON.stringify(read))

  // 3. Sign in (unless the tab already has a session).
  await page.locator('[data-testid="home.title"], [data-testid="signIn.email"]').first().waitFor()
  if (await page.getByTestId('signIn.email').count()) {
    const member = await signUpMember()
    await emailCooldown()
    await page.getByTestId('signIn.email').fill(member.email)
    await page.getByTestId('signIn.submit').click()
    await page.waitForURL(/\/verify$/)
    await page.getByTestId('verify.code').fill(await readMailedCode(member.email, 2))
  }
  await page.getByTestId('home.title').waitFor()
  console.log('home')

  // 4. The button, and the real camera.
  await tapReal(page, 'shell.tab.search')
  await sleep(1200)
  shell('input keyevent KEYCODE_BACK') // the keyboard
  await sleep(600)
  await screenshot('1-search-camera-button')
  await tapReal(page, 'search.scan')
  await sleep(1500)
  await screenshot('2-permission-or-camera')
  if (args.allow) {
    // The prompt is photographed above. Answering it with a tap is unreliable (its place moves with the
    // toolbar, and a dismissed prompt is remembered: three Backs and Chrome blocks the site), so it is
    // answered over the DevTools protocol, the way a member's "Allow while visiting the site" would.
    const origin = new URL(args.base!).origin
    await (await browser.newBrowserCDPSession()).send('Browser.setPermission', { permission: { name: 'videoCapture' }, setting: 'granted', origin } as never)
    await page.getByTestId('scan.close').click()
    await sleep(500)
    await tapReal(page, 'search.scan')
    await sleep(3000)
  }
  await screenshot('3-real-camera')
  console.log('state', await page.evaluate(() => ({
    video: Boolean(document.querySelector('[data-testid="scan.video"]')),
    denied: Boolean(document.querySelector('[data-testid="scan.denied"]')),
    torch: Boolean(document.querySelector('[data-testid="scan.torch"]')),
  })))
  // Back (the system key) closes the scanner and the camera goes off.
  shell('input keyevent KEYCODE_BACK')
  await sleep(800)
  console.log('after Back: scanner', await page.getByTestId('scan.overlay').count(), 'search', await page.getByTestId('search.overlay').count())
  await screenshot('4-after-back')

  // 5. The scanner's pipeline on a still image, as a canvas camera.
  await page.evaluate(async ({ draw, isbn }) => {
    const canvas = (0, eval)(draw)(isbn)
    const frame = document.createElement('canvas')
    frame.width = 720; frame.height = 540
    const c = frame.getContext('2d')!
    const paint = () => {
      c.fillStyle = '#222'; c.fillRect(0, 0, 720, 540)
      const scale = 0.9 * 720 / canvas.width
      c.drawImage(canvas, 720 * 0.05, (540 - canvas.height * scale) / 2, canvas.width * scale, canvas.height * scale)
    }
    paint(); setInterval(paint, 80)
    const stream = frame.captureStream(15)
    const ticks: number[] = ((window as any).__ticks = [])
    const vibrate = navigator.vibrate.bind(navigator)
    navigator.vibrate = (p: VibratePattern) => (ticks.push(p as number), vibrate(p))
    navigator.mediaDevices.getUserMedia = async () => stream
  }, { draw: DRAW_EAN13, isbn: ISBN })
  await tapReal(page, 'search.scan')
  await page.getByTestId('scan.video').waitFor()
  await sleep(300)
  await screenshot('5-still-image-scanning')
  await page.waitForURL(/\/book\//, { timeout: 15_000 })
  await page.getByTestId('book.title').waitFor()
  await sleep(800)
  console.log('decoder requests (none: the native reader was used)', JSON.stringify(decoderRequests))
  console.log('book page', page.url(), await page.getByTestId('book.title').innerText(), 'ticks', JSON.stringify(await page.evaluate(() => (window as any).__ticks)))
  await screenshot('6-book-page')
  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
