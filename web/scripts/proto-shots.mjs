#!/usr/bin/env node
/**
 * Screenshots of the design playground (/prototype): one PNG per direction ×
 * screen, and one per screen in Vergleich (all directions side by side).
 *
 *   node scripts/proto-shots.mjs [--url http://localhost:3022] [--out /tmp/libellus-proto]
 *                                [--only a,ref] [--screens home,book-new] [--query "a.palette=dusk"]
 *                                [--no-vergleich] [--scale 2]
 *
 * Needs a running dev server (`nuxt dev`); the route does not exist in
 * production builds. Headless WebKit, the engine of Safari on iPhone.
 * Files: <out>/<direction>--<screen>.png and <out>/vergleich--<screen>.png.
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium, webkit } from '@playwright/test'

const { values: args } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:3022' },
    out: { type: 'string', default: '/tmp/libellus-proto' },
    only: { type: 'string' },
    screens: { type: 'string' },
    query: { type: 'string', default: '' },
    'no-vergleich': { type: 'boolean', default: false },
    scale: { type: 'string', default: '2' },
    // Headless WebKit does not paint backdrop-filter; chromium shows the glass.
    browser: { type: 'string', default: 'webkit' },
  },
})

const base = args.url.replace(/\/$/, '')
const extra = args.query ? `&${args.query.replace(/^[?&]/, '')}` : ''
const list = (value) => (value ? value.split(',').map((s) => s.trim()).filter(Boolean) : null)

await mkdir(args.out, { recursive: true })
const browser = await (args.browser === 'chromium' ? chromium : webkit).launch()
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: Number(args.scale),
})
const page = await context.newPage()
page.on('pageerror', (error) => console.error(`  page error: ${error.message}`))

/** Load a playground URL and wait until every frame's covers and fonts are in. */
async function open(path) {
  await page.goto(`${base}${path}${extra}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-shot]')
  // The sticky header and the Nuxt devtools button would sit on top of frames.
  await page.addStyleTag({ content: '[data-proto-chrome], #nuxt-devtools-container { display: none !important; }' })
  await page.evaluate(async () => {
    await document.fonts.ready
    const settled = (img) =>
      img.complete ||
      new Promise((resolve) => {
        img.addEventListener('load', resolve, { once: true })
        img.addEventListener('error', resolve, { once: true })
      })
    await Promise.all([...document.images].map(settled))
  })
}

await page.goto(`${base}/prototype`, { waitUntil: 'networkidle' })
const index = await page.evaluate(() => window.__proto)
if (!index) throw new Error(`No playground at ${base}/prototype (is the dev server running?)`)

const directions = list(args.only) ?? index.directions
const screens = list(args.screens) ?? index.screens
const written = []

for (const direction of directions) {
  await open(`/prototype?d=${encodeURIComponent(direction)}`)
  for (const screen of screens) {
    const target = page.locator(`[data-shot="${direction}--${screen}"]`)
    if (!(await target.count())) continue
    const file = join(args.out, `${direction}--${screen}.png`)
    await target.screenshot({ path: file })
    written.push(file)
  }
  console.log(`${direction}: ${screens.length} screens`)
}

if (!args['no-vergleich']) {
  await page.setViewportSize({ width: Math.max(1600, index.directions.length * 440 + 120), height: 1000 })
  for (const screen of screens) {
    await open(`/prototype?mode=vergleich&s=${encodeURIComponent(screen)}`)
    const file = join(args.out, `vergleich--${screen}.png`)
    await page.locator(`[data-shot="vergleich--${screen}"]`).screenshot({ path: file })
    written.push(file)
  }
  console.log(`vergleich: ${screens.length} screens`)
}

await browser.close()
console.log(`${written.length} PNGs in ${args.out}`)
