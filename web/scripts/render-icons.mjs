// Renders Libellus' app icons into public/ (issues #15, #86): `node scripts/render-icons.mjs`.
//
// The sources are the three SVGs in design/icons/app/ (two ribbons, see its README): the mark is
// already drawn as paths, so nothing here needs a font. Rendered by Playwright's Chromium (already
// a dev dependency for the flows), then written as PNGs, a favicon.ico and a copy of favicon.svg.
//
//   icon-192.png, icon-512.png    the manifest's icons (`any`): icon.svg, the full square
//   icon-maskable-512.png         `maskable`: icon.svg again — its mark sits inside the 66 dp safe zone of the 108 dp canvas
//   icon-monochrome-512.png       `monochrome`: monochrome.svg, alpha only, for themed icons
//   apple-touch-icon.png          180 × 180, opaque; iOS rounds the corners itself
//   favicon.svg                   favicon.svg as is (rounded corners, the mark enlarged)
//   favicon.ico                   favicon.svg at 32 and 16 px
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const web = new URL('../', import.meta.url)
const source = (name) => new URL(`../design/icons/app/${name}.svg`, web)
const svg = Object.fromEntries(['icon', 'monochrome', 'favicon'].map((name) => [name, readFileSync(source(name), 'utf8')]))

const browser = await chromium.launch()
const context = await browser.newContext({ deviceScaleFactor: 1 })
const tab = await context.newPage()

/** One SVG at `size` px square; the background stays transparent where the SVG leaves it so. */
async function render(name, size) {
  await tab.setViewportSize({ width: size, height: size })
  await tab.setContent(
    `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg[name]}`,
  )
  return tab.locator('svg').screenshot({ type: 'png', omitBackground: true })
}

const out = (name) => new URL(`public/${name}`, web)
writeFileSync(out('icon-192.png'), await render('icon', 192))
writeFileSync(out('icon-512.png'), await render('icon', 512))
writeFileSync(out('icon-maskable-512.png'), await render('icon', 512))
writeFileSync(out('icon-monochrome-512.png'), await render('monochrome', 512))
writeFileSync(out('apple-touch-icon.png'), await render('icon', 180))
copyFileSync(source('favicon'), out('favicon.svg'))

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
