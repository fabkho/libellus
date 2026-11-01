/**
 * The launch takeover, on the emulator (docs/plans/new-logo.md, B; docs/MOTION.md, "Launch takeover").
 * Not part of CI and not a Playwright test (no `.spec`): it records a real launch of the installed app and
 * measures what Chrome (or Android) drew before the app did.
 *
 *   pnpm tsx e2e/android/launch.ts --base http://localhost:3102 --out /tmp/libellus-launch --tap 168 547
 *
 * `--tap x y` is the launcher icon, in device pixels (find it by a screenshot of the home screen; long-press
 * it to see it is BetterReads). The script force-stops Chrome, records the screen for `--seconds`, taps the
 * icon, cuts the recording into frames and writes `<name>-frames.png` (a strip of the launch) and
 * `<name>-launch-screen.png` (the frame the system drew). From those it measures the launch screen's icon and
 * its mark in device pixels and in CSS px (the device's density), which is what the frame in
 * app/spa-loading-template.html has to match; `main.css` ("The launch takeover") carries the numbers.
 *
 * Then it attaches to the running app over the DevTools protocol and checks the frame is gone once the app
 * has mounted: no `[data-launch-frame]`, nothing of it left anywhere in the DOM, no animation still running,
 * and the page is in `display-mode: standalone` (so the frame was the app's and not a tab's).
 *
 * The stack's API port and the app's are reversed into the device, so the phone's localhost is the Mac's.
 * docs/TESTING.md has the emulator, the install ("Add to Home screen", once, by hand) and the member.
 *
 * The emulator's Chrome only opens its DevTools socket (and only skips its first-run screens) while
 * `chrome-command-line` is on the device (docs/TESTING.md, "Booting it"; the script writes it), so the last
 * frames of the recording carry Chrome's own banner about that file: it is the harness, not the app.
 */
import { execFileSync, spawn } from 'node:child_process'
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium, type Browser, type Page } from '@playwright/test'
import sharp from 'sharp'
import { stack } from '../../tests/support/stack'

const { values: args } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://localhost:3102' },
    out: { type: 'string', default: '/tmp/libellus-launch' },
    name: { type: 'string', default: 'launch' },
    tap: { type: 'string' },
    seconds: { type: 'string', default: '6' },
    serial: { type: 'string' },
  },
})

const OUT = args.out!
mkdirSync(OUT, { recursive: true })
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const ADB = process.env.ANDROID_HOME ? join(process.env.ANDROID_HOME, 'platform-tools', 'adb') : 'adb'
function adb(...command: string[]): Buffer {
  return execFileSync(ADB, [...(args.serial ? ['-s', args.serial] : []), ...command], { maxBuffer: 128 * 1024 * 1024 })
}
const shell = (command: string) => adb('shell', command).toString()

/** The app's port, the stack's API port and Chrome's DevTools socket, through the Mac. */
function connectPorts() {
  const appPort = new URL(args.base!).port || '80'
  for (const port of [appPort, new URL(stack.url).port]) adb('reverse', `tcp:${port}`, `tcp:${port}`)
  adb('forward', 'tcp:9333', 'localabstract:chrome_devtools_remote')
}

/** The screen in device pixels, and the density that turns them into CSS px (the page's `devicePixelRatio`). */
function screen() {
  const [width, height] = shell('wm size').match(/(\d+)x(\d+)\s*$/)!.slice(1).map(Number)
  const density = Number(shell('wm density').match(/Override density: (\d+)/)?.[1] ?? shell('wm density').match(/Physical density: (\d+)/)![1])
  return { width: width!, height: height!, density, dpr: density / 160 }
}

type Box = { x: number; y: number; width: number; height: number }
const centre = (box: Box) => ({ x: +(box.x + box.width / 2).toFixed(2), y: +(box.y + box.height / 2).toFixed(2) })

/**
 * What one screen full of pixels holds, in device pixels: the launch screen's icon (its plum room, the
 * manifest's icon the system drew) and the mark inside it (the cream pages, the amber lamp — the only warm,
 * light pixels there). The app's own name is below the icon and is not measured.
 */
async function measure(file: string) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  const px = (x: number, y: number) => {
    const i = (y * width + x) * channels
    return [data[i]!, data[i + 1]!, data[i + 2]!] as const
  }
  // The box holds the smallest (x, y) and the largest (width, height) seen so far: one pass, no second shape.
  const grow = (box: Box, x: number, y: number) => {
    box.x = Math.min(box.x, x)
    box.y = Math.min(box.y, y)
    box.width = Math.max(box.width, x)
    box.height = Math.max(box.height, y)
  }
  const mark: Box = { x: Infinity, y: Infinity, width: 0, height: 0 }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = px(x, y)
      // The mark's own colours (clothInk #f1e3c8, accent #efb768).
      if (r > 150 && r > b + 40 && g > b + 10) grow(mark, x, y)
    }
  }
  const box = (b: Box): Box | null => (Number.isFinite(b.x) ? { x: b.x, y: b.y, width: b.width - b.x + 1, height: b.height - b.y + 1 } : null)
  // The icon's room (#3c3251 → #211b2e) around the mark: blue-leaning, unlike the night room, the mark and the
  // status bar's own pixels further up and down.
  const tile: Box = { x: Infinity, y: Infinity, width: 0, height: 0 }
  if (box(mark)) {
    const markHeight = mark.height - mark.y
    const top = Math.max(0, mark.y - 3 * markHeight)
    const bottom = Math.min(height, mark.height + 3 * markHeight)
    for (let y = top; y < bottom; y++) {
      for (let x = 0; x < width; x++) {
        const [r, g, b] = px(x, y)
        if (b - r >= 10 && b >= 45 && r >= 20) grow(tile, x, y)
      }
    }
  }
  return { tile: box(tile), mark: box(mark), screen: { width, height } }
}

/** Every frame of the recording, and a strip of a few of them for the pull request. */
async function frames(mp4: string) {
  const dir = join(OUT, 'frames')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  execFileSync('ffmpeg', ['-v', 'quiet', '-y', '-i', mp4, '-fps_mode', 'passthrough', join(dir, '%03d.png')], { stdio: 'ignore' })
  const count = execFileSync('sh', ['-c', `ls ${join(dir)} | wc -l`]).toString().trim()
  return { dir, count: Number(count) }
}

/**
 * A launch: Chrome stopped, the screen recorded, the icon tapped. The most frames a strip can show is
 * `--frames`, evenly taken from the recording, each downscaled to a thumb.
 */
/** Chrome's DevTools socket, its skipped first run — and its banner: one command line, as docs/TESTING.md has it. */
function devTools() {
  shell('echo \"_ --disable-fre --no-default-browser-check --no-first-run\" > /data/local/tmp/chrome-command-line')
  shell('am set-debug-app --persistent com.android.chrome')
}

async function record(tap: [number, number]) {
  const device = screen()
  // A recorder left over from a run that was cut short refuses the next one ("encoder failed to start"), and
  // the file it leaves has a frame or two: clear both before this one.
  shell('killall screenrecord; true')
  shell('rm -f /sdcard/launch.mp4')
  shell('am force-stop com.android.chrome')
  await sleep(1500)
  // The recorder has to stay in a live shell: backgrounded inside one `adb shell` that then exits, it stops.
  const recorder = spawn(ADB, [...(args.serial ? ['-s', args.serial] : []), 'shell', `screenrecord --time-limit ${args.seconds} --bit-rate 12000000 /sdcard/launch.mp4`], { stdio: 'ignore' })
  await sleep(1000)
  shell(`input tap ${tap[0]} ${tap[1]}`)
  // The launcher has its pages: an icon tapped on the wrong one starts nothing, and the recording would be of
  // the launcher. Chrome's process is the sign that the launch really happened.
  for (let attempt = 0; attempt < 10 && !shell('ps -A | grep -c chrome').trim().replace('0', ''); attempt++) await sleep(500)
  if (shell('ps -A | grep -c chrome').trim() === '0') throw new Error(`Nothing started: no Chrome after the tap at ${tap.join(',')} (is BetterReads on the launcher page that is showing?)`)
  await sleep(Number(args.seconds) * 1000 + 2000)
  recorder.kill()
  const mp4 = join(OUT, `${args.name}.mp4`)
  adb('pull', '/sdcard/launch.mp4', mp4)
  const { dir, count } = await frames(mp4)
  if (count < 10) throw new Error(`The recording has ${count} frames: screenrecord was refused or cut short (docs/TESTING.md).`)
  return { mp4, dir, count, device }
}

/**
 * The launch screen's frame: the one where the room is the screen and the icon's plum tile is in it. The
 * launcher before it and the app after it fail one or both (the wallpaper is not the room, the app has no
 * plum), and the app's own night room has the room but never the tile.
 */
async function launchScreen(dir: string, count: number) {
  let best: { file: string; plum: number } | null = null
  for (let i = 1; i <= count; i++) {
    const file = join(dir, `${String(i).padStart(3, '0')}.png`)
    const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true })
    let room = 0
    let plum = 0
    let warm = 0
    let seen = 0
    for (let p = 0; p < data.length; p += info.channels * 97) {
      const [r, g, b] = [data[p]!, data[p + 1]!, data[p + 2]!]
      seen++
      if (Math.abs(r - 14) + Math.abs(g - 12) + Math.abs(b - 10) <= 18) room++
      // The icon's room (#3c3251 → #211b2e): blue-leaning, and darker than the mark.
      if (b - r >= 10 && b >= 45 && r >= 20) plum++
      if (r > 150 && r > b + 40 && g > b + 10) warm++
    }
    if (room / seen < 0.9) continue
    // The launch screen is the plum tile; the takeover's own frame is the room lit warm, which is not plum.
    if (!best || plum - warm > best.plum) best = { file, plum: plum - warm }
  }
  if (!best) throw new Error('No launch screen in the recording: nothing was mostly the night room (#0e0c0a).')
  const file = join(OUT, `${args.name}-launch-screen.png`)
  copyFileSync(best.file, file)
  return { file, frame: Number(best.file.slice(-7, -4)) }
}

/**
 * The takeover's own frame, in the recording: the night room with the mark where the launch screen had it and
 * no plum tile (so it is the page, not the system). Measured the same way, for the numbers next to the launch
 * screen's.
 */
async function takeoverFrame(dir: string, count: number, launchScreenMark: Box | null) {
  if (!launchScreenMark) return null
  let best: { file: string; room: number } | null = null
  for (let i = 1; i <= count; i++) {
    const file = join(dir, `${String(i).padStart(3, '0')}.png`)
    const measured = await measure(file)
    if (!measured.mark) continue
    const mark = measured.mark
    if (Math.abs(mark.width - launchScreenMark.width) > 6) continue
    if (measured.tile) continue
    const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true })
    let room = 0
    let seen = 0
    for (let p = 0; p < data.length; p += info.channels * 97) {
      seen++
      if (Math.abs(data[p]! - 14) + Math.abs(data[p + 1]! - 12) + Math.abs(data[p + 2]! - 10) <= 18) room++
    }
    if (room / seen < 0.5) continue
    if (!best || room / seen > best.room) best = { file, room: room / seen }
  }
  if (!best) return null
  return { file: best.file, ...(await measure(best.file)) }
}

/** A strip of evenly taken frames, so a pull request can show the whole launch at a glance. */
async function strip(dir: string, count: number, from: number, device: { width: number; height: number }) {
  // From the launch screen to the app: what the handover is, without the launcher before it.
  const picks = 8
  const take = Array.from({ length: picks }, (_, i) => Math.min(count, from + Math.round((i * (count - from)) / (picks - 1))))
  const thumb = Math.round(device.height / 3)
  const width = Math.round(device.width / 3)
  const tiles = await Promise.all(
    take.map((n) => sharp(join(dir, `${String(n).padStart(3, '0')}.png`)).resize({ width }).toBuffer()),
  )
  const file = join(OUT, `${args.name}-frames.png`)
  await sharp({ create: { width: width * picks, height: thumb, channels: 3, background: '#0e0c0a' } })
    .composite(tiles.map((input, i) => ({ input, left: i * width, top: 0 })))
    .png()
    .toFile(file)
  return { file, frames: take }
}

/**
 * This build, not the one the service worker kept: the shell it precached is the previous release until the
 * member takes an update, so the registration and the caches go before the launch that is measured.
 */
async function fresh(page: Page) {
  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map((registration) => registration.unregister()))
    const kept = await caches.keys()
    await Promise.all(kept.map((name) => caches.delete(name)))
  })
}

/** Chrome's DevTools socket takes a moment after a launch: connect, retried. */
async function openChrome() {
  adb('forward', 'tcp:9333', 'localabstract:chrome_devtools_remote')
  for (let attempt = 0; attempt < 15; attempt++) {
    const browser = await chromium.connectOverCDP('http://localhost:9333').catch(() => null)
    if (browser) return browser
    await sleep(1000)
  }
  throw new Error('Chrome’s DevTools socket (tcp:9333) is not there: docs/TESTING.md, "Booting it".')
}

/** The app's own page in that Chrome: the installed app, not one of its tabs. */
const app = (browser: Browser) => browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().startsWith(args.base!))

/**
 * The app once it has mounted: the frame has to be gone, and nothing of it left anywhere.
 */
async function afterMount(page: Page) {
  await page.locator('[data-testid="signIn.email"], [data-testid="home.title"]').first().waitFor({ timeout: 60_000 })
  // The frame leaves over `exit` (200 ms) or, with Reduce Motion, over `standard` (250 ms): a second is enough.
  await sleep(1200)
  return page.evaluate(() => ({
    displayMode: matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser',
    frame: document.querySelectorAll('[data-launch-frame], .launch-frame, .launch-frame-glow, .launch-frame-mark').length,
    nuxtLoader: document.getElementById('__nuxt-loader') !== null,
    // Nothing of the frame anywhere: no element, no data URI left in a node (the app's own animations, the
    // loading wave and the like, are its own and are only counted here).
    dataUriImages: document.querySelectorAll('img[src^="data:image/png"]').length,
    animations: document.getAnimations().length,
    body: [...document.body.children].map((node) => node.id || node.className || node.tagName),
  }))
}

async function main() {
  connectPorts()
  const tap = args.tap ? (args.tap.split(/[ ,]+/).map(Number) as [number, number]) : null
  if (!tap) throw new Error('--tap x y: the launcher icon in device pixels (long-press it: it is BetterReads)')

  devTools()
  // The app as the device has it now: its shell cleared and fetched again in a tab, so the launch below is
  // this build's (the service worker keeps the previous release's shell until the member takes an update).
  shell('am force-stop com.android.chrome')
  await sleep(1000)
  shell(`am start -a android.intent.action.VIEW -d ${args.base}/ com.android.chrome`)
  await sleep(4000)
  const priming = await openChrome()
  const tab = app(priming)
  if (tab) {
    await fresh(tab)
    await tab.goto(args.base!)
    console.log(`shell: ${await tab.evaluate(() => [...document.styleSheets].map((sheet) => sheet.href).find((href) => href?.includes('/_nuxt/entry.')))}`)
  }
  await priming.close()

  const launch = await record(tap)
  const screen = await launchScreen(launch.dir, launch.count)
  const stripResult = await strip(launch.dir, launch.count, screen.frame, launch.device)
  const measured = await measure(screen.file)
  const takeover = await takeoverFrame(launch.dir, launch.count, measured.mark)
  const { dpr } = launch.device
  const css = (box: Box | null) =>
    box && { x: +(box.x / dpr).toFixed(2), y: +(box.y / dpr).toFixed(2), width: +(box.width / dpr).toFixed(2), height: +(box.height / dpr).toFixed(2), centre: { x: +(centre(box).x / dpr).toFixed(2), y: +(centre(box).y / dpr).toFixed(2) } }

  // The launch is over: the app is on screen, and its DevTools socket is there for the check below.
  const browser = await openChrome()
  const page = app(browser)
  if (!page) throw new Error(`No page of ${args.base} in Chrome: the app is open, but not where this script looked.`)
  const after = await afterMount(page)

  const report = {
    app: args.base,
    device: { ...launch.device, cssWidth: +(launch.device.width / dpr).toFixed(2), cssHeight: +(launch.device.height / dpr).toFixed(2) },
    recording: { file: launch.mp4, frames: launch.count, strip: stripResult },
    launchScreen: { file: screen.file, device: measured, css: { tile: css(measured.tile), mark: css(measured.mark) } },
    takeover: takeover && { file: takeover.file, mark: css(takeover.mark) },
    afterMount: after,
  }
  writeFileSync(join(OUT, `${args.name}.json`), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))

  const failures = [
    after.frame !== 0 && `the frame is still in the DOM (${after.frame} nodes)`,
    after.nuxtLoader && 'Nuxt’s SPA loading wrapper is still in the DOM',
    after.displayMode !== 'standalone' && 'the page is a browser tab, not the installed app',
  ].filter(Boolean)
  await browser.close()
  if (failures.length) {
    console.error(`\nFAILED: ${failures.join('; ')}`)
    process.exitCode = 1
  }
}

await main()
