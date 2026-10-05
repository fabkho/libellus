// Renders the Android app's icons from design/icons/app/ (#90): `node android/scripts/render-icons.mjs`.
//
// Bubblewrap (`bubblewrap update`) fetches the web manifest's PNGs and lays them out the way a
// WebAPK does: the maskable icon shrunk into a white adaptive background, no monochrome layer
// (its monochrome icon only becomes the notification icon), a 300 dp splash. This script runs
// after it and replaces those with Libellus' own layers, drawn from the same SVG sources as the
// web icons (design/icons/app/README.md):
//
//   mipmap-*/ic_launcher_background.png   icon.svg without the mark: the leather-red room, 108 dp
//   mipmap-*/ic_launcher_foreground.png   icon.svg's mark alone (ribbons and lamp), 108 dp
//   mipmap-*/ic_launcher_monochrome.png   monochrome.svg, 108 dp: the launcher tints it for themed icons
//   mipmap-anydpi-v26/ic_launcher.xml     the adaptive icon of the three layers above
//   mipmap-*/ic_launcher.png              favicon.svg (rounded square), 48 dp, for Android 7 and older
//   drawable-*/splash.png                 the rounded icon, 128 dp, centred on a transparent 300 dp
//                                         canvas; the splash's background is #0e0c0a (twa-manifest.json)
//   drawable-*/shortcut_<n>_maskable.png  shortcuts/<name>.svg, 108 dp, full bleed
//   drawable-anydpi-v26/shortcut_<n>.xml  the shortcut's adaptive icon, without Bubblewrap's grey inset
//   drawable-*/shortcut_<n>.png           shortcuts/<name>.svg, 48 dp, for Android 7 and older
//   store_icon.png, docs/play/icon-512.png   icon.svg at 512 px: the Play listing's icon (Play rounds it)
//
// Rendered by Playwright's Chromium from web/ (a dev dependency there already), as
// web/scripts/render-icons.mjs does for the web icons.
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const android = new URL('../', import.meta.url)
const root = new URL('../', android)
const res = new URL('app/src/main/res/', android)
const require = createRequire(new URL('web/package.json', root))
const { chromium } = require('@playwright/test')

const source = (name) => readFileSync(new URL(`design/icons/app/${name}.svg`, root), 'utf8')
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
// The order of twa-manifest.json's shortcuts: Bubblewrap names them shortcut_0, _1, _2.
const SHORTCUTS = ['search', 'progress', 'library']

const browser = await chromium.launch()
const tab = await browser.newPage({ deviceScaleFactor: 1 })

/**
 * One SVG at `size` px square on a transparent background. `keep` trims the icon to one layer:
 * 'room' drops the mark (the `<g transform>` holding ribbons and lamp), 'mark' drops the room
 * (the full-bleed rects outside it). `inset` draws it smaller, centred on the `size` canvas.
 */
async function render(svg, size, { keep = 'all', inset = 0 } = {}) {
  await tab.setViewportSize({ width: size, height: size })
  const drawn = size - 2 * inset
  await tab.setContent(
    `<!doctype html><style>html,body{margin:0;background:transparent}#c{width:${size}px;height:${size}px;display:grid;place-items:center}svg{display:block;width:${drawn}px;height:${drawn}px}</style><div id="c">${svg}</div>`,
  )
  await tab.evaluate((keep) => {
    const svg = document.querySelector('svg')
    if (keep === 'room') svg.querySelector(':scope > g[transform]').remove()
    if (keep === 'mark') svg.querySelectorAll(':scope > rect').forEach((rect) => rect.remove())
  }, keep)
  return tab.locator('#c').screenshot({ type: 'png', omitBackground: true })
}

function write(url, png) {
  mkdirSync(new URL('./', url), { recursive: true })
  writeFileSync(url, png)
}

const icon = source('icon')
const monochrome = source('monochrome')
const favicon = source('favicon')

for (const [density, scale] of Object.entries(DENSITIES)) {
  const mipmap = (name) => new URL(`mipmap-${density}/${name}`, res)
  const drawable = (name) => new URL(`drawable-${density}/${name}`, res)
  const dp = (value) => Math.round(value * scale)

  write(mipmap('ic_launcher_background.png'), await render(icon, dp(108), { keep: 'room' }))
  write(mipmap('ic_launcher_foreground.png'), await render(icon, dp(108), { keep: 'mark' }))
  write(mipmap('ic_launcher_monochrome.png'), await render(monochrome, dp(108)))
  write(mipmap('ic_launcher.png'), await render(favicon, dp(48)))
  // Bubblewrap's single-layer adaptive icon; the three layers above replace it.
  rmSync(mipmap('ic_maskable.png'), { force: true })

  write(drawable('splash.png'), await render(favicon, dp(300), { inset: dp(86) }))

  for (const [n, name] of SHORTCUTS.entries()) {
    const shortcut = source(`shortcuts/${name}`)
    write(drawable(`shortcut_${n}_maskable.png`), await render(shortcut, dp(108)))
    write(drawable(`shortcut_${n}.png`), await render(shortcut, dp(48)))
  }
}

const adaptive = (layers) => `<?xml version="1.0" encoding="utf-8"?>
<!-- Written by android/scripts/render-icons.mjs (#90); \`bubblewrap update\` overwrites it, so run the script after it. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
${layers}
</adaptive-icon>
`
writeFileSync(
  new URL('mipmap-anydpi-v26/ic_launcher.xml', res),
  adaptive(`    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />`),
)
for (const n of SHORTCUTS.keys()) {
  writeFileSync(
    new URL(`drawable-anydpi-v26/shortcut_${n}.xml`, res),
    adaptive(`    <background android:drawable="@drawable/shortcut_${n}_maskable" />
    <foreground android:drawable="@android:color/transparent" />`),
  )
}

const store = await render(icon, 512)
writeFileSync(new URL('store_icon.png', android), store)
write(new URL('docs/play/icon-512.png', root), store)

await browser.close()
