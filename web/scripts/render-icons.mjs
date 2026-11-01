// Renders BetterReads' app icons into public/ (issues #15, #86, #448): `node scripts/render-icons.mjs`.
//
// The sources are the SVGs in design/icons/app/ (Lamp over the page, see its README; the round that
// drew it is design/logo-options/6-lamp-over-page/): the mark is already drawn as paths, so nothing
// here needs a font. Rendered by Playwright's Chromium (already a dev dependency for the flows), then
// written as PNGs, a favicon.ico and a copy of favicon.svg.
//
//   icon-192.png, icon-512.png    the manifest's icons (`any`): icon.svg with its room taken away — the mark
//                                 alone, transparent, so a launcher and Chrome's own launch surface draw
//                                 it on a background instead of a plum tile
//   icon-maskable-512.png         `maskable`: the same mark on one flat night, full bleed — a maskable is a tile, so
//                                 its room is the manifest's background_color and Android's launch screen, which paints
//                                 that colour behind it, shows the mark alone with no tile edge (#461)
//   icon-monochrome-512.png       `monochrome`: monochrome.svg, alpha only, for themed icons
//   apple-touch-icon.png          180 × 180, opaque, from icon-ios.svg; iOS rounds the corners itself and
//                                 leaves a transparent square black
//   favicon.svg                   favicon.svg as is (rounded corners, the mark enlarged)
//   favicon.ico                   favicon.svg at 32 and 16 px
//   shortcut-<name>-96.png        96 px, from design/icons/app/shortcuts/<name>.svg: the manifest's app shortcuts (#91)
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
// The room the icons are drawn on: the same token the manifest paints its background_color with, so the two
// cannot drift apart (#461).
const surface = JSON.parse(readFileSync(new URL('../design/tokens.json', web), 'utf8')).color.surface.$value.dark
// icon.svg's room: a plum gradient and an amber glow, two full-bleed 108 dp rects.
const ROOM = /<rect width="108" height="108" fill="url\(#[^)]*\)"\/>/g
// The mark alone, for the manifest's `any` icons (#461): the icon's own 108 dp canvas with its room taken
// away — the pages and the lamp on nothing. The mark keeps the place it has in the icon, inside the 66 dp
// safe zone, so a launcher's mask or Android's circle cannot clip it.
svg.mark = svg.icon.replace(ROOM, '')
if (svg.mark === svg.icon) throw new Error('icon.svg has no full-bleed room rects to take away: the `any` icons would carry the plum tile')
// The same mark on the night, for `maskable` (#461). A maskable cannot be transparent — it is the whole tile
// a launcher crops — so its room becomes one flat night instead: Android's launch screen paints that colour
// and the tile's edge disappears into it, which is the mark alone on the night room, drawn by Android itself.
svg.maskable = svg.mark.replace('<g transform=', `<rect width="108" height="108" fill="${surface}"/>\n<g transform=`)
if (svg.maskable === svg.mark) throw new Error('icon.svg has no mark group to put the night room behind: the maskable would be a hole')

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
/** A PNG that has to be transparent around the mark: RGBA, and all four corners at alpha 0. */
async function checkTransparent(png, name) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  const alphaAt = (x, y) => data[(y * info.width + x) * info.channels + 3]
  if (info.channels !== 4) throw new Error(`${name} has no alpha channel (${info.channels} channels): the mark would sit on a tile`)
  for (const [x, y] of [[0, 0], [info.width - 1, 0], [0, info.height - 1], [info.width - 1, info.height - 1]]) {
    if (alphaAt(x, y) !== 0) throw new Error(`${name}: the corner at ${x}, ${y} is not transparent (alpha ${alphaAt(x, y)})`)
  }
}
/** A PNG that has to be one flat colour at its edges: every corner exactly `hex` and opaque, so a launcher's crop
 * and Android's launch screen see no tile edge. */
async function checkFlat(png, name, hex) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  const want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  for (const [x, y] of [[0, 0], [info.width - 1, 0], [0, info.height - 1], [info.width - 1, info.height - 1]]) {
    const at = (y * info.width + x) * info.channels
    const px = [data[at], data[at + 1], data[at + 2], info.channels === 4 ? data[at + 3] : 255]
    if (px.join() !== [...want, 255].join()) throw new Error(`${name}: the corner at ${x}, ${y} is ${px.join(', ')}, not ${hex}: Android's launch screen would show a tile edge`)
  }
}

const icon192 = await render('mark', 192)
const icon512 = await render('mark', 512)
await checkTransparent(icon192, 'icon-192.png')
await checkTransparent(icon512, 'icon-512.png')
writeFileSync(out('icon-192.png'), icon192)
writeFileSync(out('icon-512.png'), icon512)
const maskable = await render('maskable', 512)
await checkFlat(maskable, 'icon-maskable-512.png', surface)
writeFileSync(out('icon-maskable-512.png'), maskable)
writeFileSync(out('icon-monochrome-512.png'), await render('monochrome', 512))
writeFileSync(out('apple-touch-icon.png'), await render('icon-ios', 180))
copyFileSync(source('favicon'), out('favicon.svg'))
for (const name of SHORTCUTS) writeFileSync(out(`shortcut-${name}-96.png`), await render(`shortcut-${name}`, 96))

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
