// Draws Libellus' app icons into public/ (issue #15): `node scripts/render-icons.mjs`.
//
// The mark is the start of the wordmark — "li" in Newsreader italic, the ink of
// the dark theme — in D's night room, with the dot of the i as the lamp: the
// accent, glowing. The colours come from design/tokens.json and the face from
// the Fontsource file the app ships, so the icon is drawn from the same
// sources as the screens. Rendered by Playwright's Chromium (already a dev
// dependency for the flows), then written as PNGs and a favicon.ico.
//
//   icon-192.png, icon-512.png   the manifest's icons (`any`): the room fills the square
//   icon-maskable-512.png        `maskable`: the mark well inside the safe zone (the inner 80 %)
//   apple-touch-icon.png         180 × 180, opaque; iOS rounds the corners itself
//   favicon.ico                  32 and 16 px, the mark a little larger to stay legible
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const web = new URL('../', import.meta.url)
const tokens = JSON.parse(readFileSync(new URL('../design/tokens.json', web), 'utf8'))
const color = (name) => tokens.color[name].$value
const room = color('surface').dark
const ink = color('ink').dark
const lamp = color('accent').dark
const font = readFileSync(new URL('node_modules/@fontsource/newsreader/files/newsreader-latin-400-italic.woff2', web)).toString('base64')

/**
 * One icon as a page. `scale` is the mark's size against the square: 1 for the
 * full-bleed icons, smaller for the maskable one (its corners may be cut to a
 * circle), larger for the favicon (a few pixels have to read as letters).
 */
function page(size, scale) {
  const unit = (size / 100) * scale
  return `<!doctype html><html><head><style>
    @font-face { font-family: Mark; src: url(data:font/woff2;base64,${font}) format('woff2'); font-style: italic; }
    html, body { margin: 0; }
    .icon { position: relative; width: ${size}px; height: ${size}px; overflow: hidden; background: ${room}; }
    /* The lamp's light: a warm pool around the dot, fading into the room. */
    .light { position: absolute; inset: 0;
      background: radial-gradient(circle at ${50 + 11.5 * scale}% ${52 - 22.5 * scale}%, color-mix(in srgb, ${lamp} 30%, transparent) 0, color-mix(in srgb, ${lamp} 9%, transparent) ${18 * scale}%, transparent ${46 * scale}%); }
    .mark { position: absolute; left: 50%; top: 52%; transform: translate(-50%, -50%);
      font: italic 400 ${62 * unit}px/1 Mark; letter-spacing: ${0.6 * unit}px; color: ${ink}; white-space: nowrap; }
    .mark .i { position: relative; }
    /* The i's dot is the lamp: placed over the dotless ı, glowing. */
    .dot { position: absolute; left: 68%; top: ${5.2 * unit}px; width: ${6.6 * unit}px; height: ${6.6 * unit}px;
      border-radius: 50%; background: ${lamp}; transform: translateX(-50%);
      box-shadow: 0 0 ${5 * unit}px ${1.2 * unit}px color-mix(in srgb, ${lamp} 55%, transparent), 0 0 ${14 * unit}px ${4 * unit}px color-mix(in srgb, ${lamp} 22%, transparent); }
  </style></head><body>
    <div class="icon"><div class="light"></div><div class="mark">l<span class="i">ı<span class="dot"></span></span></div></div>
  </body></html>`
}

const browser = await chromium.launch()
const context = await browser.newContext({ deviceScaleFactor: 1 })
const tab = await context.newPage()

async function render(size, scale) {
  await tab.setViewportSize({ width: size, height: size })
  await tab.setContent(page(size, scale))
  await tab.evaluate(() => document.fonts.ready)
  return tab.locator('.icon').screenshot({ type: 'png' })
}

const out = (name) => new URL(`public/${name}`, web)
writeFileSync(out('icon-192.png'), await render(192, 0.9))
writeFileSync(out('icon-512.png'), await render(512, 0.9))
writeFileSync(out('icon-maskable-512.png'), await render(512, 0.72))
writeFileSync(out('apple-touch-icon.png'), await render(180, 0.9))

// favicon.ico: an ICO directory around PNG images (every current browser reads PNG inside ICO).
const favicons = [await render(32, 1.25), await render(16, 1.3)]
const sizes = [32, 16]
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
