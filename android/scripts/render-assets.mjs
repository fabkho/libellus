// The rasters of the Android shell, drawn from design/icons/app/ (docs/ANDROID.md): `node scripts/render-assets.mjs`.
// regenerate.sh runs it after `bubblewrap update`, which writes its own versions of all of these
// (a WebAPK-style icon on white, its splash, grey shortcut tiles) over the top.
//
//   drawable-*/splash.png                the splash's last frame (the mark, the lamp's glow) on a transparent 288 dp
//                                        canvas: what the launcher's own splash view and then Chrome keep on
//                                        screen after the system's animated one (drawable/splash_icon_static.xml
//                                        draws the same frame as a vector: keep the numbers in step)
//   drawable-*/shortcut_<n>_maskable.png design/icons/app/shortcuts/<name>.svg at 108 dp, full bleed
//   drawable-anydpi-v26/shortcut_<n>.xml the shortcut's adaptive icon of that bitmap, no grey inset
//
// The launcher icon and the animated splash are vector drawables written by hand (res/drawable/*.xml);
// minSdk is 26, so Bubblewrap's legacy PNG icons and shortcuts are removed.
import { Resvg } from '@resvg/resvg-js'
import { mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs'

const android = new URL('../', import.meta.url)
const root = new URL('../', android)
const res = new URL('app/src/main/res/', android)
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
// The order of twa-manifest.json's shortcuts: Bubblewrap names them shortcut_0, _1, _2.
const SHORTCUTS = ['search', 'progress', 'library']

const png = (svg, px) => new Resvg(svg, { fitTo: { mode: 'width', value: px } }).render().asPng()
const put = (path, data) => {
  const url = new URL(path, res)
  mkdirSync(new URL('./', url), { recursive: true })
  writeFileSync(url, data)
}

// The splash's last frame: res/drawable/splash_icon_static.xml, in SVG.
const PAGES = 'M48.4 70C42 58 26 56 10 62V78C26 72 42 74 48.4 86ZM51.6 70C58 58 74 56 90 62V78C74 72 58 74 51.6 86Z'
const SUN = 'M50 36.5A18.5 18.5 0 1 1 50 73.5A18.5 18.5 0 1 1 50 36.5Z'
const SKY = 'M0 0H100V58H90C74 52 58 54 50 66C42 54 26 52 10 58H0Z'
const splash = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 288 288" width="288" height="288">
<defs><radialGradient id="g" cx="144" cy="134.6" r="90" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#efb768" stop-opacity="0.4"/><stop offset="0.4" stop-color="#efb768" stop-opacity="0.14"/><stop offset="1" stop-color="#efb768" stop-opacity="0"/></radialGradient><clipPath id="s"><path d="${SKY}"/></clipPath></defs>
<rect width="288" height="288" fill="url(#g)"/>
<g transform="translate(69 52.125) scale(1.5)"><g clip-path="url(#s)"><path fill="#efb768" d="${SUN}"/></g><path fill="#f1e3c8" d="${PAGES}"/></g>
</svg>`

// Bubblewrap's leftovers that minSdk 26 and the hand-written vectors make dead weight.
for (const entry of readdirSync(res)) {
  if (/^drawable-(m|h|xh|xxh|xxxh)dpi$/.test(entry)) for (const f of readdirSync(new URL(`${entry}/`, res))) if (/^shortcut_\d\.png$/.test(f)) rmSync(new URL(`${entry}/${f}`, res))
  if (/^mipmap-(m|h|xh|xxh|xxxh)dpi$/.test(entry)) rmSync(new URL(`${entry}/`, res), { recursive: true })
}
rmSync(new URL('drawable-anydpi/', res), { recursive: true, force: true })
rmSync(new URL('store_icon.png', android), { force: true })

for (const [density, scale] of Object.entries(DENSITIES)) {
  put(`drawable-${density}/splash.png`, png(splash, 288 * scale))
  SHORTCUTS.forEach((name, n) => {
    const svg = readFileSync(new URL(`design/icons/app/shortcuts/${name}.svg`, root), 'utf8')
    put(`drawable-${density}/shortcut_${n}_maskable.png`, png(svg, 108 * scale))
  })
}
SHORTCUTS.forEach((_, n) => {
  put(`drawable-anydpi-v26/shortcut_${n}.xml`, `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/shortcut_${n}_maskable" />
    <foreground android:drawable="@android:color/transparent" />
</adaptive-icon>
`)
})
console.log('Rendered splash.png and the shortcut icons.')
