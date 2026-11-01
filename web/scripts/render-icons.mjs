// Renders BetterReads' app icons into public/ (issues #15, #86, #448): `node scripts/render-icons.mjs`.
//
// The sources are the SVGs in design/icons/app/ (Lamp over the page, see its README; the round that
// drew it is design/logo-options/6-lamp-over-page/): the mark is already drawn as paths, so nothing
// here needs a font. Rendered by Playwright's Chromium (already a dev dependency for the flows), then
// written as PNGs, a favicon.ico and a copy of favicon.svg.
//
//   icon-192.png, icon-512.png    the manifest's icons (`any`): icon-ios.svg — the mark at 60 % of the
//                                 tile, which carries better at 192 and 512 px than icon.svg's framing
//   icon-maskable-512.png         `maskable`: icon.svg, full bleed — its mark sits inside the 66 dp safe zone of the 108 dp canvas
//   icon-monochrome-512.png       `monochrome`: monochrome.svg, alpha only, for themed icons
//   apple-touch-icon.png          180 × 180, opaque, from icon-ios.svg too; iOS rounds the corners itself
//   favicon.svg                   favicon.svg as is (rounded corners, the mark enlarged)
//   favicon.ico                   favicon.svg at 32 and 16 px
//   shortcut-<name>-96.png        96 px, from design/icons/app/shortcuts/<name>.svg: the manifest's app shortcuts (#91)
//   launch-mark-{128,256,384}.png the launch takeover's mark (PR B): the same 108 dp canvas without its plum room, alpha
//                                 only around the mark, at 1/2/3 device pixels per CSS pixel. The template below inlines the 3x one.
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'
import sharp from 'sharp'

const web = new URL('../', import.meta.url)
const source = (name) => new URL(`../design/icons/app/${name}.svg`, web)
const svg = Object.fromEntries(
  ['icon', 'icon-ios', 'monochrome', 'favicon'].map((name) => [name, readFileSync(source(name), 'utf8')]),
)
// The app shortcuts' icons share the app icon's room; each draws its own mark.
const SHORTCUTS = ['search', 'progress', 'library']
for (const name of SHORTCUTS) svg[`shortcut-${name}`] = readFileSync(source(`shortcuts/${name}`), 'utf8')

const browser = await chromium.launch()
const context = await browser.newContext({ deviceScaleFactor: 1 })
const tab = await context.newPage()

/** One SVG at `size` px square; the background stays transparent where the SVG leaves it so. */
async function renderMarkup(markup, size) {
  await tab.setViewportSize({ width: size, height: size })
  await tab.setContent(
    `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${markup}`,
  )
  return tab.locator('svg').screenshot({ type: 'png', omitBackground: true })
}
const render = (name, size) => renderMarkup(svg[name], size)

const out = (name) => new URL(`public/${name}`, web)
writeFileSync(out('icon-192.png'), await render('icon-ios', 192))
writeFileSync(out('icon-512.png'), await render('icon-ios', 512))
writeFileSync(out('icon-maskable-512.png'), await render('icon', 512))
writeFileSync(out('icon-monochrome-512.png'), await render('monochrome', 512))
writeFileSync(out('apple-touch-icon.png'), await render('icon-ios', 180))
copyFileSync(source('favicon'), out('favicon.svg'))
for (const name of SHORTCUTS) writeFileSync(out(`shortcut-${name}-96.png`), await render(`shortcut-${name}`, 96))

// The launch takeover's mark (PR B, docs/plans/new-logo.md, "The launch takeover"): the app icon with its
// plum room taken away — the pages and the lamp alone, on nothing — which the page's first paint draws over
// the night room (app/spa-loading-template.html; the CSS is main.css, "The launch takeover"). It is the
// icon's own 108 dp canvas, so the mark keeps the size and the place it has on the launch screen; measured
// there at 128 CSS px (e2e/android/launch.ts, on the emulator). Rendered at 1, 2 and 3 device pixels per CSS
// pixel, and the 3x one is inlined into that template as a data URI below, so the first paint fetches nothing.
const LAUNCH_CANVAS = 128
const launchMark = svg.icon.replace(/<rect width="108" height="108" fill="url\(#[^)]*\)"\/>/g, '')
if (launchMark === svg.icon) throw new Error('icon.svg has no full-bleed room rects to take away: the launch mark would carry the plum tile')
const launchPngs = []
for (const scale of [1, 2, 3]) {
  const png = await renderMarkup(launchMark, LAUNCH_CANVAS * scale)
  const { channels, hasAlpha } = await sharp(png).metadata()
  if (!hasAlpha || channels !== 4) throw new Error(`launch-mark-${LAUNCH_CANVAS * scale}.png has no alpha channel: the frame needs the mark alone`)
  writeFileSync(out(`launch-mark-${LAUNCH_CANVAS * scale}.png`), png)
  launchPngs.push(png)
}
{
  const template = new URL('app/spa-loading-template.html', web)
  const html = readFileSync(template, 'utf8')
  const start = '<!-- launch-mark:start -->'
  const end = '<!-- launch-mark:end -->'
  const from = html.indexOf(start)
  const to = html.indexOf(end)
  if (from < 0 || to < from) throw new Error('app/spa-loading-template.html lost its launch-mark markers')
  const inline = `<img class="launch-frame-mark" src="data:image/png;base64,${launchPngs[2].toString('base64')}" width="${LAUNCH_CANVAS}" height="${LAUNCH_CANVAS}" alt="">`
  writeFileSync(template, `${html.slice(0, from + start.length)}\n  ${inline}\n  ${html.slice(to)}`)
}

// favicon.ico: an ICO directory around PNG images (every current browser reads PNG inside ICO).
const sizes = [32, 16]
const favicons = [await render('favicon', 32), await render('favicon', 16)]
const header = Buffer.alloc(6 + 16 * favicons.length)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(favicons.length, 4)
let offset = header.length
favicons.forEach((png, i) => {
  const entry = 6 + 16 * i
  header.writeUInt8(sizes[i], entry)
  header.writeUInt8(sizes[i], entry + 1)
  header.writeUInt16LE(1, entry + 4)
  header.writeUInt16LE(32, entry + 6)
  header.writeUInt32LE(png.length, entry + 8)
  header.writeUInt32LE(offset, entry + 12)
  offset += png.length
})
writeFileSync(out('favicon.ico'), Buffer.concat([header, ...favicons]))

await browser.close()
console.log('Icons written to public/.')
