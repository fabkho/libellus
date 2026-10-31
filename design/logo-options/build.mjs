// Builds the BetterReads logo options in design/logo-options/ from marks.mjs:
// per option the SVG sources (icon, icon-ios, favicon, monochrome, four lock-ups) and a contact
// sheet (sheet.png), and one overview.png with every option side by side.
//
// It needs three things the repo does not install: Playwright (Chromium renders the sheets),
// opentype.js (outlines the lettering, so no SVG needs a font) and the Fontsource packages of the
// app's faces (Geist, Newsreader). Install them anywhere and point LOGO_DEPS at that folder:
//
//   mkdir -p /tmp/brlogo && cd /tmp/brlogo && npm init -y && \
//     npm i playwright opentype.js @fontsource/newsreader @fontsource/geist-sans @fontsource/geist-mono
//   LOGO_DEPS=/tmp/brlogo [CHROMIUM=/path/to/chrome-headless-shell] node design/logo-options/build.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OPTIONS, THEMES } from './marks.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const deps = process.env.LOGO_DEPS ?? '/tmp/brlogo'
const require = createRequire(join(deps, 'package.json'))
const opentype = require('opentype.js')
const { chromium } = require('playwright')

const f = (v) => String(Number(v.toFixed(2)))
const fontFile = (family, weight, style, ext = 'woff') =>
  join(deps, 'node_modules/@fontsource', family, 'files', `${family}-latin-${weight}-${style}.${ext}`)
const fonts = new Map()
function font(family, weight, style) {
  const key = `${family}-${weight}-${style}`
  if (!fonts.has(key)) {
    const b = readFileSync(fontFile(family, weight, style))
    fonts.set(key, opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)))
  }
  return fonts.get(key)
}

/** opentype's own toPathData rounds some values to NaN (opentype.js 2.0), so the path is written here. */
const pathData = (commands) =>
  commands
    .map((c) => {
      const n = (...v) => v.map(f).join(' ')
      if (c.type === 'M' || c.type === 'L') return c.type + n(c.x, c.y)
      if (c.type === 'C') return 'C' + n(c.x1, c.y1, c.x2, c.y2, c.x, c.y)
      if (c.type === 'Q') return 'Q' + n(c.x1, c.y1, c.x, c.y)
      return 'Z'
    })
    .join('')

/** `text` as one outlined path, baseline at (x, y), tracking in em. */
function outline(fnt, text, size, x, y, tracking = 0) {
  let d = ''
  const box = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity }
  let i = 0
  fnt.forEachGlyph(text, x, y, size, { kerning: true }, (glyph, gx, gy, fs) => {
    const p = glyph.getPath(gx + i++ * tracking * size, gy, fs)
    if (!p.commands.length) return
    const b = p.getBoundingBox()
    box.x1 = Math.min(box.x1, b.x1)
    box.y1 = Math.min(box.y1, b.y1)
    box.x2 = Math.max(box.x2, b.x2)
    box.y2 = Math.max(box.y2, b.y2)
    d += pathData(p.commands)
  })
  if (d.includes('NaN')) throw new Error(`outline("${text}") produced NaN`)
  return { d, box, baseline: y }
}

// ------------------------------------------------------------------ marks

const colourOf = (palette, role) => palette[role] ?? palette.main

/** The mark's parts as SVG, in its 100-box coordinates. `palette` maps roles to fills. */
function markParts(option, variant, palette, id) {
  const parts = option.parts(variant, option)
  let defs = ''
  let body = ''
  parts.forEach((p, i) => {
    let clip = ''
    if (p.clip) {
      const shape = typeof p.clip === 'string' ? `<path d="${p.clip}"/>` : `<rect x="${f(p.clip[0])}" y="0" width="${f(p.clip[1] - p.clip[0])}" height="100"/>`
      defs += `<clipPath id="${id}c${i}">${shape}</clipPath>`
      clip = ` clip-path="url(#${id}c${i})"`
    }
    body += `<path${p.evenodd ? ' fill-rule="evenodd"' : ''} fill="${colourOf(palette, p.role)}"${clip} d="${p.d}"/>`
  })
  return { defs, body }
}

// ------------------------------------------------------------------ measuring (Chromium)

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
const page = await browser.newPage({ deviceScaleFactor: 1 })

/** The mark's bounding box and its farthest point from the box's centre, sampled along every path. */
async function measure(option, variant) {
  const { body } = markParts(option, variant, { main: '#000' }, 'm')
  await page.setContent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="400" height="400"><g id="g">${body}</g></svg>`)
  return page.evaluate(() => {
    const g = document.getElementById('g')
    const b = g.getBBox()
    const cx = b.x + b.width / 2
    const cy = b.y + b.height / 2
    let maxR = 0
    for (const p of g.querySelectorAll('path')) {
      const len = p.getTotalLength()
      for (let i = 0; i <= 800; i++) {
        const pt = p.getPointAtLength((len * i) / 800)
        maxR = Math.max(maxR, Math.hypot(pt.x - cx, pt.y - cy))
      }
    }
    return { x: b.x, y: b.y, w: b.width, h: b.height, cx, cy, maxR }
  })
}

for (const o of OPTIONS) o.m = { full: await measure(o, 'full'), fav: await measure(o, 'fav') }

/** translate/scale that puts the mark's centre at (cx, cy) at scale s. */
const place = (m, s, cx, cy) => `translate(${f(cx - m.cx * s)} ${f(cy - m.cy * s)}) scale(${Number(s.toFixed(4))})`

// ------------------------------------------------------------------ the SVG sources

const svgOpen = (w, h, title) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(w)} ${f(h)}" width="${f(w)}" height="${f(h)}">\n<title>${title}</title>\n`

/** The room: a vertical gradient, and a soft pool of lamp light around `glow` (mark coordinates). */
function room(o, id, size, s, m, cx, cy, rx = 0) {
  const r = o.room
  let defs = `<linearGradient id="${id}bg" x1="0" y1="0" x2="0" y2="${size}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${r.top}"/><stop offset="1" stop-color="${r.bottom}"/></linearGradient>`
  let body = `<rect width="${size}" height="${size}"${rx ? ` rx="${rx}"` : ''} fill="url(#${id}bg)"/>`
  if (r.glow) {
    const gx = cx - m.cx * s + r.glow[0] * s
    const gy = cy - m.cy * s + r.glow[1] * s
    const k = r.glowStrength ?? 0.2
    defs += `<radialGradient id="${id}gl" cx="${f(gx)}" cy="${f(gy)}" r="${f(size * 0.5)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#efb768" stop-opacity="${k}"/><stop offset="0.4" stop-color="#efb768" stop-opacity="${f(k * 0.35)}"/><stop offset="1" stop-color="#efb768" stop-opacity="0"/></radialGradient>`
    body += `<rect width="${size}" height="${size}"${rx ? ` rx="${rx}"` : ''} fill="url(#${id}gl)"/>`
  }
  return { defs, body }
}

function iconSvg(o, kind) {
  const id = `o${o.n}${kind[0]}`
  if (kind === 'favicon') {
    const m = o.m.fav
    const s = (o.fit?.fav ?? 25) / Math.max(m.w, m.h)
    const rm = room(o, id, 32, s, m, 16, 16, 7)
    const mk = markParts(o, 'fav', o.icon, id)
    return (
      svgOpen(32, 32, `BetterReads — option ${o.n}, ${o.name} (favicon: rounded square, the mark simplified for 16 and 32 px)`) +
      `<defs>${rm.defs}${mk.defs}</defs>\n${rm.body}\n<g transform="${place(m, s, 16, 16)}">${mk.body}</g>\n</svg>\n`
    )
  }
  const m = o.m.full
  const s =
    kind === 'ios'
      ? Math.min((o.fit?.ios ?? 64) / Math.max(m.w, m.h), 41 / m.maxR)
      : Math.min((o.fit?.adaptive ?? 31) / m.maxR, 62 / Math.max(m.w, m.h))
  if (kind === 'monochrome') {
    const mk = markParts(o, 'full', { main: '#000' }, id)
    return (
      svgOpen(108, 108, `BetterReads — option ${o.n}, ${o.name} (monochrome, alpha only, inside the 66 dp safe zone)`) +
      (mk.defs ? `<defs>${mk.defs}</defs>\n` : '') +
      `<g transform="${place(m, s, 54, 54)}">${mk.body}</g>\n</svg>\n`
    )
  }
  const rm = room(o, id, 108, s, m, 54, 54)
  const mk = markParts(o, 'full', o.icon, id)
  const title =
    kind === 'ios'
      ? `BetterReads — option ${o.n}, ${o.name} (iOS: full square, the system rounds it; the mark at 60 % of the tile)`
      : `BetterReads — option ${o.n}, ${o.name} (adaptive, 108 dp canvas, mark inside the 66 dp safe zone; also maskable)`
  return svgOpen(108, 108, title) + `<defs>${rm.defs}${mk.defs}</defs>\n${rm.body}\n<g transform="${place(m, s, 54, 54)}">${mk.body}</g>\n</svg>\n`
}

/** The lock-up: mark and name side by side ('h') or the name under the mark ('v'), in a theme's colours. */
function lockupSvg(o, layout, theme) {
  const t = THEMES[theme]
  const fnt = font(o.font.family, o.font.weight, o.font.style)
  const size = 100
  const capH = (fnt.tables.os2.sCapHeight / fnt.unitsPerEm) * size
  const probe = outline(fnt, o.text, size, 0, 0, o.font.tracking)
  const tw = probe.box.x2 - probe.box.x1
  const m = o.m.full
  const tile = o.lockupMark === 'tile'
  const markH = layout === 'h' ? capH * (tile ? 1.9 : 1.75) : capH * 2.6
  const pad = 24
  const id = `o${o.n}${layout}${theme[0]}`
  let markW, markBody, defs
  if (tile) {
    markW = markH
    const sIcon = Math.min(64 / Math.max(m.w, m.h), 41 / m.maxR)
    const rm = room(o, id, 108, sIcon, m, 54, 54, 24)
    const mk = markParts(o, 'full', o.icon, id)
    defs = rm.defs + mk.defs
    const k = markH / 108
    markBody = (x, y) => `<g transform="translate(${f(x)} ${f(y)}) scale(${Number(k.toFixed(4))})">${rm.body}<g transform="${place(m, sIcon, 54, 54)}">${mk.body}</g></g>`
  } else {
    const s = Math.min(markH / m.h, (markH * 1.3) / m.w)
    markW = m.w * s
    const mk = markParts(o, 'full', t, id)
    defs = mk.defs
    markBody = (x, y) => `<g transform="${place(m, s, x + markW / 2, y + markH / 2)}">${mk.body}</g>`
  }
  let W, H, mark, text
  if (layout === 'h') {
    const gap = markH * 0.32
    W = pad * 2 + markW + gap + tw
    H = pad * 2 + markH
    mark = markBody(pad, pad)
    // the cap height's middle on the mark's middle
    const baseline = pad + markH / 2 + capH / 2
    text = outline(fnt, o.text, size, pad + markW + gap - probe.box.x1, baseline, o.font.tracking)
  } else {
    const gap = capH * 0.75
    W = pad * 2 + Math.max(markW, tw)
    H = pad * 2 + markH + gap + (probe.box.y2 - probe.box.y1)
    mark = markBody((W - markW) / 2, pad)
    const top = pad + markH + gap
    text = outline(fnt, o.text, size, (W - tw) / 2 - probe.box.x1, top - probe.box.y1, o.font.tracking)
  }
  const what = layout === 'h' ? 'side by side' : 'stacked'
  return (
    svgOpen(W, H, `BetterReads — option ${o.n}, ${o.name}: lock-up, ${what}, ${theme} theme (lettering outlined)`) +
    (defs ? `<defs>${defs}</defs>\n` : '') +
    `${mark}\n<path fill="${t.text}" d="${text.d}"/>\n</svg>\n`
  )
}

// ------------------------------------------------------------------ write the sources

const files = {}
for (const o of OPTIONS) {
  const dir = join(here, o.slug)
  mkdirSync(dir, { recursive: true })
  const out = {
    'icon.svg': iconSvg(o, 'adaptive'),
    'icon-ios.svg': iconSvg(o, 'ios'),
    'favicon.svg': iconSvg(o, 'favicon'),
    'monochrome.svg': iconSvg(o, 'monochrome'),
    'wordmark-light.svg': lockupSvg(o, 'h', 'light'),
    'wordmark-dark.svg': lockupSvg(o, 'h', 'dark'),
    'wordmark-stacked-light.svg': lockupSvg(o, 'v', 'light'),
    'wordmark-stacked-dark.svg': lockupSvg(o, 'v', 'dark'),
  }
  for (const [name, svg] of Object.entries(out)) writeFileSync(join(dir, name), svg)
  files[o.n] = out
}

// ------------------------------------------------------------------ rendering helpers

const uri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
const pngUri = (buf) => `data:image/png;base64,${buf.toString('base64')}`

/** An SVG rasterised at `size` px (1×), transparent where it is. */
async function raster(svg, size) {
  await page.setViewportSize({ width: Math.max(size, 64), height: Math.max(size, 64) })
  await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style><img src="${uri(svg)}">`)
  await page.waitForFunction(() => document.images[0].complete)
  return page.locator('img').screenshot({ type: 'png', omitBackground: true })
}

const woff2 = (family, weight, style) => readFileSync(fontFile(family, weight, style, 'woff2')).toString('base64')
const FONT_CSS = [
  ['Geist', 'geist-sans', 400, 'normal'],
  ['Geist', 'geist-sans', 500, 'normal'],
  ['Geist', 'geist-sans', 600, 'normal'],
  ['Geist Mono', 'geist-mono', 400, 'normal'],
  ['Newsreader', 'newsreader', 500, 'normal'],
  ['Newsreader', 'newsreader', 400, 'italic'],
]
  .map(([name, fam, w, st]) => `@font-face{font-family:'${name}';font-weight:${w};font-style:${st};src:url(data:font/woff2;base64,${woff2(fam, w, st)}) format('woff2')}`)
  .join('\n')

// iOS's continuous-corner squircle, as a superellipse (n = 5) in objectBoundingBox units.
const SQUIRCLE = (() => {
  const pts = []
  for (let i = 0; i < 160; i++) {
    const a = (i / 160) * Math.PI * 2
    const c = Math.cos(a)
    const s = Math.sin(a)
    pts.push([0.5 + 0.5 * Math.sign(c) * Math.abs(c) ** (2 / 5), 0.5 + 0.5 * Math.sign(s) * Math.abs(s) ** (2 / 5)])
  }
  return 'M' + pts.map(([x, y]) => `${x.toFixed(4)} ${y.toFixed(4)}`).join('L') + 'Z'
})()

// The neighbours on the mock home screens: generic apps, a gradient tile and a white glyph each.
// `g` uses currentColor so the themed (Material You) screen can tint it.
const NEIGHBOURS = [
  ['Mail', '#4b9bff', '#1c6fe6', '<rect x="27" y="36" width="54" height="38" rx="5" fill="currentColor"/><path d="M29 39l25 19 25-19" fill="none" stroke="#1c6fe6" stroke-opacity=".55" stroke-width="4"/>'],
  ['Calendar', '#ff6a5c', '#e2412f', '<rect x="30" y="34" width="48" height="44" rx="6" fill="currentColor"/><rect x="30" y="34" width="48" height="11" fill="#000" fill-opacity=".18"/><g fill="#e2412f" fill-opacity=".6"><rect x="37" y="51" width="8" height="7"/><rect x="50" y="51" width="8" height="7"/><rect x="63" y="51" width="8" height="7"/><rect x="37" y="63" width="8" height="7"/><rect x="50" y="63" width="8" height="7"/></g>'],
  ['Weather', '#5fb4ff', '#2b7fe0', '<circle cx="46" cy="46" r="13" fill="#ffd34d"/><path d="M40 74h30a11 11 0 0 0 0-22 15 15 0 0 0-29 3 10 10 0 0 0-1 19z" fill="currentColor"/>'],
  ['Notes', '#ffd862', '#f6b91c', '<g fill="currentColor"><rect x="30" y="38" width="48" height="5" rx="2.5"/><rect x="30" y="51" width="48" height="5" rx="2.5"/><rect x="30" y="64" width="34" height="5" rx="2.5"/></g>'],
  ['Camera', '#9ba1a8', '#5d636a', '<rect x="26" y="38" width="56" height="38" rx="8" fill="currentColor"/><rect x="42" y="32" width="24" height="10" rx="3" fill="currentColor"/><circle cx="54" cy="57" r="11" fill="#5d636a"/><circle cx="54" cy="57" r="6" fill="currentColor"/>'],
  ['Maps', '#7ed67f', '#3ba54d', '<path d="M30 80c10-14 30-10 30-26s18-18 24-24" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/><circle cx="44" cy="40" r="9" fill="#e2412f"/>'],
  ['Music', '#ff6584', '#e3304e', '<path d="M47 32l26-6v36a8 8 0 1 1-5-7.4V37l-16 4v27a8 8 0 1 1-5-7.4z" fill="currentColor"/>'],
  ['Clock', '#2c2c2e', '#111112', '<circle cx="54" cy="54" r="27" fill="currentColor"/><path d="M54 37v18l11 7" fill="none" stroke="#111" stroke-width="4.5" stroke-linecap="round"/>'],
  ['Podcasts', '#c06cf5', '#8c38d8', '<circle cx="54" cy="48" r="7" fill="currentColor"/><path d="M38 64a22 22 0 1 1 32 0M44 58a13 13 0 1 1 20 0" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><rect x="50" y="58" width="8" height="20" rx="4" fill="currentColor"/>'],
  ['Settings', '#a3a8ae', '#6a7077', '<circle cx="54" cy="54" r="22" fill="none" stroke="currentColor" stroke-width="10" stroke-dasharray="7 4.5"/><circle cx="54" cy="54" r="12" fill="none" stroke="currentColor" stroke-width="6"/>'],
  ['Messages', '#6ae26f', '#2fbf41', '<path d="M54 30c16 0 28 9.8 28 22s-12 22-28 22c-3 0-6-.3-8.6-1L33 78l3-10c-5-4-8-9.6-8-16 0-12.2 12-22 26-22z" fill="currentColor"/>'],
  ['Wallet', '#2a2a2c', '#0d0d0e', '<rect x="28" y="34" width="52" height="16" rx="4" fill="#4b9bff"/><rect x="28" y="44" width="52" height="16" rx="4" fill="#ffd34d"/><rect x="28" y="54" width="52" height="22" rx="4" fill="currentColor"/>'],
  ['Files', '#5aa9ff', '#2a78ea', '<path d="M28 40a5 5 0 0 1 5-5h14l6 6h22a5 5 0 0 1 5 5v26a5 5 0 0 1-5 5H33a5 5 0 0 1-5-5z" fill="currentColor"/>'],
  ['Fitness', '#1d1d1f', '#000000', '<g fill="none" stroke-width="7" stroke-linecap="round"><circle cx="54" cy="54" r="24" stroke="#ff375f" stroke-dasharray="120 200" transform="rotate(-90 54 54)"/><circle cx="54" cy="54" r="15" stroke="#a6ff00" stroke-dasharray="70 200" transform="rotate(-90 54 54)"/><circle cx="54" cy="54" r="6" stroke="#00e5ff" stroke-dasharray="25 200" transform="rotate(-90 54 54)"/></g>'],
  ['Phone', '#6ae26f', '#2fbf41', '<path d="M39 31l8-2 6 13-5 4c3 7 8 12 15 15l4-5 13 6-2 8c-1 3-4 5-7 5-21-2-38-19-40-40 0-3 2-6 5-7z" fill="currentColor"/>'],
  ['Browser', '#56b0ff', '#1d73ee', '<circle cx="54" cy="54" r="26" fill="none" stroke="currentColor" stroke-width="4"/><path d="M66 42l-8 16-16 8 8-16z" fill="currentColor"/>'],
]
const neighbourSvg = ([, top, bottom, g], themed) =>
  themed
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" style="color:${themed.fg}"><rect width="108" height="108" fill="${themed.bg}"/><g>${g.replace(/fill="#[0-9a-f]{3,6}"/gi, `fill="${themed.fg}"`).replace(/stroke="(#[0-9a-f]{3,6})"/gi, (_, c) => `stroke="${['#1c6fe6', '#111'].includes(c) ? themed.bg : themed.fg}"`)}</g></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" style="color:#fff"><defs><linearGradient id="n" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs><rect width="108" height="108" fill="url(#n)"/>${g}</svg>`

const MATERIAL = {
  light: { bg: '#e7dfd2', fg: '#4a3f2e', screen: 'linear-gradient(160deg,#efe6d8,#d9cdb9)' },
  dark: { bg: '#3a3329', fg: '#eadbc2', screen: 'linear-gradient(160deg,#25211c,#14110e)' },
}

const BASE_CSS = `${FONT_CSS}
*{box-sizing:border-box}html,body{margin:0}
body{font-family:Geist,system-ui,sans-serif;color:#1c1915;background:#e9e4da;-webkit-font-smoothing:antialiased}
.eyebrow{font-family:'Geist Mono',monospace;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:rgb(28 25 21 / .62)}
.serif{font-family:Newsreader,Georgia,serif}
.card{background:#fbf9f5;border-radius:22px;box-shadow:0 0 0 .5px rgb(28 25 21 / .12),0 8px 30px -12px rgb(28 25 21 / .18)}
.squircle{clip-path:url(#squircle)}
img{display:block}
.cap{font-family:'Geist Mono',monospace;font-size:11.5px;color:rgb(28 25 21 / .62);margin-top:10px;text-align:center;letter-spacing:.02em}
`
const SVG_DEFS = `<svg width="0" height="0" style="position:absolute"><clipPath id="squircle" clipPathUnits="objectBoundingBox"><path d="${SQUIRCLE}"/></clipPath></svg>`

/** An adaptive (108) icon cropped like a launcher does: the central 72 dp, in `shape`. */
const adaptive = (src, size, shape) =>
  `<div style="width:${size}px;height:${size}px;overflow:hidden;border-radius:${shape === 'circle' ? '50%' : shape === 'squircle' ? '30%' : '0'};position:relative"><img src="${src}" style="position:absolute;width:${size * 1.5}px;height:${size * 1.5}px;left:${-size * 0.25}px;top:${-size * 0.25}px"></div>`
/** A themed (Material You) icon: the monochrome mark tinted, on a tinted circle, cropped to 72 dp. */
const themedIcon = (monoSvg, size, mat) =>
  `<div style="width:${size}px;height:${size}px;border-radius:50%;overflow:hidden;background:${mat.bg};position:relative"><div style="position:absolute;width:${size * 1.5}px;height:${size * 1.5}px;left:${-size * 0.25}px;top:${-size * 0.25}px;background:${mat.fg};-webkit-mask:url(${uri(monoSvg)}) center/contain no-repeat"></div></div>`

function phoneIOS(ourSrc) {
  const icons = NEIGHBOURS.slice(0, 15)
  icons.splice(6, 0, ['BetterReads'])
  const cell = (n) =>
    n[0] === 'BetterReads'
      ? `<div class="ic"><img class="squircle" src="${ourSrc}" width="62" height="62"><span>BetterReads</span></div>`
      : `<div class="ic"><img class="squircle" src="${uri(neighbourSvg(n))}" width="62" height="62"><span>${n[0]}</span></div>`
  return `<div class="phone ios" style="background:linear-gradient(170deg,#e9d9c4 0%,#c9b8a6 45%,#8f8592 100%)">
    <div class="sb"><b>9:41</b><span>●●● ▮</span></div>
    <div class="grid">${icons.slice(0, 16).map(cell).join('')}</div>
    <div class="dock">${[NEIGHBOURS[14], NEIGHBOURS[15], NEIGHBOURS[10], NEIGHBOURS[6]].map((n) => `<img class="squircle" src="${uri(neighbourSvg(n))}" width="62" height="62">`).join('')}</div>
  </div>`
}
function phoneAndroid(ourSrc, monoSvg, themed) {
  const mat = MATERIAL.dark
  const icons = NEIGHBOURS.slice(0, 15)
  icons.splice(5, 0, ['BetterReads'])
  const one = (n) => {
    if (n[0] === 'BetterReads') return themed ? themedIcon(monoSvg, 58, mat) : adaptive(ourSrc, 58, 'circle')
    return themed
      ? `<img src="${uri(neighbourSvg(n, mat))}" width="58" height="58" style="border-radius:50%">`
      : `<img src="${uri(neighbourSvg(n))}" width="58" height="58" style="border-radius:50%">`
  }
  return `<div class="phone android" style="background:${themed ? mat.screen : 'linear-gradient(165deg,#3b4b5e 0%,#1d2633 60%,#121820 100%)'}">
    <div class="sb" style="color:#eee"><b>9:41</b><span>▾ ▮</span></div>
    <div class="clock">9:41<small>Tuesday, 6 October</small></div>
    <div class="grid">${icons.slice(0, 16).map((n) => `<div class="ic">${one(n)}<span>${n[0]}</span></div>`).join('')}</div>
    <div class="dock">${[NEIGHBOURS[14], NEIGHBOURS[10], NEIGHBOURS[15], NEIGHBOURS[4]].map(one).join('')}</div>
  </div>`
}
const PHONE_CSS = `
.phone{width:330px;height:690px;border-radius:46px;padding:16px 18px;position:relative;overflow:hidden;box-shadow:0 0 0 9px #111,0 0 0 10px #444,0 30px 60px -20px rgb(0 0 0 / .45);flex:none}
.phone .sb{display:flex;justify-content:space-between;font-size:13px;padding:2px 14px 0;color:#1c1915}
.phone .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:20px 8px;margin-top:34px}
.phone .ic{display:flex;flex-direction:column;align-items:center;gap:6px}
.phone .ic span{font-size:10.5px;color:#fff;text-shadow:0 1px 2px rgb(0 0 0 / .45);white-space:nowrap}
.phone .dock{position:absolute;left:14px;right:14px;bottom:16px;height:86px;border-radius:30px;background:rgb(255 255 255 / .3);backdrop-filter:blur(10px);display:flex;justify-content:space-around;align-items:center}
.phone.android .grid{margin-top:22px;gap:22px 8px}
.phone.android .dock{background:rgb(255 255 255 / .1);border-radius:40px}
.phone .clock{color:#f2f2f2;font-size:58px;font-weight:300;letter-spacing:-.03em;margin:26px 0 0 10px;line-height:1}
.phone .clock small{display:block;font-size:13px;letter-spacing:0;margin-top:6px;opacity:.8}
`

/** A Chrome-like tab strip, the option's favicon in the active tab at 16 px (raster `fav16`). */
function browserTabs(fav16, theme) {
  const dark = theme === 'dark'
  const c = dark ? { strip: '#1f1f22', tab: '#35363a', text: '#e8eaed', faint: '#9aa0a6', bar: '#35363a', field: '#202124' } : { strip: '#dfe2e7', tab: '#ffffff', text: '#202124', faint: '#5f6368', bar: '#ffffff', field: '#f1f3f4' }
  const other = (label, col) => `<div class="tb"><i style="background:${col}"></i><span>${label}</span></div>`
  return `<div class="browser" style="background:${c.strip};color:${c.text}">
    <div class="tabs"><div class="dots"><i></i><i></i><i></i></div>
      ${other('Inbox (3)', '#4b9bff')}
      <div class="tb on" style="background:${c.tab}"><img src="${fav16}" width="16" height="16" style="image-rendering:pixelated"><span>BetterReads · Home</span><em>×</em></div>
      ${other('Piranesi — Wikipedia', '#888')}${other('Open Library', '#c96a3a')}
    </div>
    <div class="bar" style="background:${c.bar}"><div class="field" style="background:${c.field};color:${c.faint}"><img src="${fav16}" width="16" height="16" style="opacity:0"> libellus.fabkho.dev</div></div>
  </div>`
}
const BROWSER_CSS = `
.browser{width:640px;border-radius:12px;overflow:hidden;box-shadow:0 0 0 .5px rgb(0 0 0 / .2),0 10px 30px -14px rgb(0 0 0 / .3);font-size:12px}
.browser .tabs{display:flex;align-items:flex-end;height:40px;padding:0 8px;gap:2px}
.browser .dots{display:flex;gap:7px;padding:0 12px 14px 6px}.browser .dots i{width:11px;height:11px;border-radius:50%;background:#ff5f57}.browser .dots i+i{background:#febc2e}.browser .dots i+i+i{background:#28c840}
.browser .tb{display:flex;align-items:center;gap:8px;height:32px;padding:0 12px;width:160px;border-radius:9px 9px 0 0;white-space:nowrap;overflow:hidden;opacity:.85}
.browser .tb i{width:16px;height:16px;border-radius:4px;flex:none;opacity:.8}
.browser .tb.on{opacity:1;width:190px}.browser .tb em{margin-left:auto;font-style:normal;opacity:.6}
.browser .bar{height:40px;padding:6px 10px}.browser .field{height:28px;border-radius:14px;display:flex;align-items:center;gap:8px;padding:0 12px;font-size:13px}
`

async function sheet(o) {
  const F = files[o.n]
  const fav = { 16: pngUri(await raster(F['favicon.svg'], 16)), 32: pngUri(await raster(F['favicon.svg'], 32)), 48: pngUri(await raster(F['favicon.svg'], 48)) }
  const ios = uri(F['icon-ios.svg'])
  const adapt = uri(F['icon.svg'])
  const mono = F['monochrome.svg']
  const swatch = (c, label) => `<div style="display:flex;align-items:center;gap:8px"><i style="width:22px;height:22px;border-radius:6px;background:${c};box-shadow:0 0 0 .5px rgb(0 0 0 / .2)"></i><span class="cap" style="margin:0">${label}</span></div>`
  const tile = (inner, label) => `<div style="display:flex;flex-direction:column;align-items:center">${inner}<div class="cap">${label}</div></div>`
  const guide = `<svg viewBox="0 0 108 108" width="168" height="168" style="position:absolute;inset:0"><circle cx="54" cy="54" r="33" fill="none" stroke="#fff" stroke-opacity=".8" stroke-dasharray="2 2" stroke-width=".6"/><rect x="18" y="18" width="72" height="72" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width=".5"/></svg>`
  const lock = (name, bg, h) => `<div style="background:${bg};height:${h}px;display:flex;align-items:center;justify-content:center;border-radius:18px;padding:20px"><img src="${uri(F[name])}" style="max-height:${h - 60}px;max-width:90%"></div>`
  const html = `<!doctype html><html><head><style>${BASE_CSS}${PHONE_CSS}${BROWSER_CSS}
  .wrap{width:2200px;padding:56px 64px 64px}
  .row{display:flex;gap:40px;align-items:flex-start}
  h1{font-family:Newsreader,serif;font-weight:500;font-size:52px;letter-spacing:-.02em;margin:6px 0 4px}
  .num{font-family:'Geist Mono',monospace;font-size:15px;color:#845418;letter-spacing:.1em}
  p.r{font-size:16.5px;line-height:1.55;max-width:1180px;margin:14px 0 0;color:rgb(28 25 21 / .86)}
  .sec{margin-top:44px}.sec>.eyebrow{margin-bottom:16px}
  </style></head><body>${SVG_DEFS}<div class="wrap">
  <div class="row" style="align-items:center;gap:48px">
    <img class="squircle" src="${ios}" width="200" height="200" style="flex:none;filter:drop-shadow(0 14px 24px rgb(0 0 0 / .25))">
    <div>
      <div class="num">OPTION ${o.n} · ${o.kind.toUpperCase()}</div>
      <h1>${o.name}</h1>
      <div style="display:flex;gap:22px;margin-top:10px">${swatch(o.room.top, 'room ' + o.room.top)}${swatch(o.room.bottom, o.room.bottom)}${swatch(o.icon.main, 'mark ' + o.icon.main)}${o.icon.accent !== o.icon.main ? swatch(o.icon.accent, 'lamp ' + o.icon.accent) : ''}</div>
      <div class="cap" style="text-align:left;margin-top:12px">${o.palette}</div>
      <p class="r">${o.rationale}</p>
    </div>
  </div>

  <div class="sec row">
    <div><div class="eyebrow" style="margin-bottom:22px">iOS home screen</div>${phoneIOS(ios)}</div>
    <div><div class="eyebrow" style="margin-bottom:22px">Android, adaptive (circle mask)</div>${phoneAndroid(adapt, mono, false)}</div>
    <div><div class="eyebrow" style="margin-bottom:22px">Android, themed icons (monochrome)</div>${phoneAndroid(adapt, mono, true)}</div>
    <div style="flex:1">
      <div class="eyebrow" style="margin-bottom:22px">The icon in every mask</div>
      <div class="card" style="padding:28px;display:grid;grid-template-columns:repeat(3,1fr);gap:26px 18px;justify-items:center">
        ${tile(`<div style="position:relative;width:168px;height:168px"><img src="${adapt}" width="168" height="168">${guide}</div>`, 'adaptive 108 dp · safe zone 66 dp')}
        ${tile(`<img class="squircle" src="${ios}" width="150" height="150" style="margin:9px">`, 'iOS · squircle')}
        ${tile(`<div style="margin:9px">${adaptive(adapt, 150, 'circle')}</div>`, 'maskable · circle')}
        ${tile(`<div style="margin:9px">${adaptive(adapt, 150, 'squircle')}</div>`, 'maskable · rounded square')}
        ${tile(`<div style="margin:9px">${themedIcon(mono, 150, MATERIAL.light)}</div>`, 'themed · light')}
        ${tile(`<div style="margin:9px">${themedIcon(mono, 150, MATERIAL.dark)}</div>`, 'themed · dark')}
      </div>
      <div class="eyebrow" style="margin:34px 0 16px">Monochrome</div>
      <div class="card" style="padding:24px 28px;display:flex;gap:30px;align-items:center">
        <div style="width:120px;height:120px;border-radius:14px;background:repeating-conic-gradient(#e7e2d8 0 25%,#f6f3ec 0 50%) 0 0/16px 16px;display:flex;align-items:center;justify-content:center"><div style="width:120px;height:120px;background:#1c1915;-webkit-mask:url(${uri(mono)}) center/contain no-repeat"></div></div>
        <div style="background:#1b1b1f;border-radius:14px;padding:12px 16px;color:#eee;font-size:13px;display:flex;align-items:center;gap:10px;width:200px">
          <b style="font-weight:500">9:41</b><div style="width:22px;height:22px;background:#eee;-webkit-mask:url(${uri(mono)}) center/150% no-repeat"></div><div style="width:22px;height:22px;opacity:.5;background:#eee;border-radius:50%"></div><span style="margin-left:auto">▾ ▮</span>
        </div>
        <div style="background:#fff;border-radius:18px;padding:14px 16px;width:330px;box-shadow:0 2px 10px -4px rgb(0 0 0 / .2);font-size:13px">
          <div style="display:flex;align-items:center;gap:8px;color:#5f6368"><div style="width:22px;height:22px;border-radius:50%;background:#845418;position:relative;overflow:hidden"><div style="position:absolute;inset:-25%;background:#fff;-webkit-mask:url(${uri(mono)}) center/contain no-repeat"></div></div>BetterReads · now</div>
          <div style="margin-top:6px;color:#202124"><b style="font-weight:500">Ida finished Piranesi</b><br><span style="color:#5f6368">★★★★¾ — “A house of tides and statues.”</span></div>
        </div>
      </div>
      <div class="cap" style="text-align:left">alpha only: the launcher tints it (themed icons), the status bar paints it white (notification badge, 24 dp)</div>
    </div>
  </div>

  <div class="sec row">
    <div>
      <div class="eyebrow">Favicon in a browser tab · real size (16 px at 1×)</div>
      <div style="display:flex;flex-direction:column;gap:18px">${browserTabs(fav[16], 'light')}${browserTabs(fav[16], 'dark')}</div>
    </div>
    <div style="flex:1">
      <div class="eyebrow">Favicon at real sizes, and its pixels</div>
      <div class="card" style="padding:26px 30px;display:flex;flex-direction:column;gap:22px">
        ${['#ffffff', '#202124']
          .map(
            (bg) => `<div style="display:flex;align-items:flex-end;gap:28px;background:${bg};padding:16px 20px;border-radius:12px;box-shadow:0 0 0 .5px rgb(0 0 0 / .12)">
          ${[16, 32, 48].map((s) => `<div style="display:flex;flex-direction:column;align-items:center;gap:8px"><img src="${fav[s]}" width="${s}" height="${s}" style="image-rendering:pixelated"><span class="cap" style="margin:0;color:${bg === '#ffffff' ? '#5f6368' : '#9aa0a6'}">${s}</span></div>`).join('')}
          <div style="margin-left:60px;display:flex;gap:22px;align-items:flex-end">
            <div style="display:flex;flex-direction:column;align-items:center;gap:8px"><img src="${fav[16]}" width="128" height="128" style="image-rendering:pixelated"><span class="cap" style="margin:0;color:${bg === '#ffffff' ? '#5f6368' : '#9aa0a6'}">16 px × 8</span></div>
            <div style="display:flex;flex-direction:column;align-items:center;gap:8px"><img src="${fav[32]}" width="128" height="128" style="image-rendering:pixelated"><span class="cap" style="margin:0;color:${bg === '#ffffff' ? '#5f6368' : '#9aa0a6'}">32 px × 4</span></div>
          </div></div>`,
          )
          .join('')}
      </div>
    </div>
  </div>

  <div class="sec">
    <div class="eyebrow">Wordmark lock-ups · light (surface #f4f0e9) and dark (surface #0e0c0a) · lettering outlined</div>
    <div class="row" style="gap:28px">
      <div style="flex:1;display:flex;flex-direction:column;gap:20px">${lock('wordmark-light.svg', THEMES.light.surface, 190)}${lock('wordmark-stacked-light.svg', THEMES.light.surface, 300)}</div>
      <div style="flex:1;display:flex;flex-direction:column;gap:20px">${lock('wordmark-dark.svg', THEMES.dark.surface, 190)}${lock('wordmark-stacked-dark.svg', THEMES.dark.surface, 300)}</div>
    </div>
  </div>
  </div></body></html>`
  await page.setViewportSize({ width: 2200, height: 1000 })
  await page.setContent(html, { waitUntil: 'load' })
  await page.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? 0 : new Promise((r) => (i.onload = i.onerror = r))))))
  await page.evaluate(() => document.fonts.ready)
  writeFileSync(join(here, o.slug, 'sheet.png'), await page.screenshot({ fullPage: true, type: 'png' }))
}

async function overview() {
  const current = readFileSync(join(here, '../icons/app/icon.svg'), 'utf8')
  const cols = []
  for (const o of OPTIONS) {
    const F = files[o.n]
    const f16 = pngUri(await raster(F['favicon.svg'], 16))
    const f32 = pngUri(await raster(F['favicon.svg'], 32))
    cols.push(`<div class="col card">
      <div class="n">${o.n}</div>
      <div class="name">${o.name}</div><div class="kind">${o.kind}</div>
      <img class="squircle" src="${uri(F['icon-ios.svg'])}" width="220" height="220" style="margin:22px auto 0;filter:drop-shadow(0 12px 20px rgb(0 0 0 / .22))">
      <div style="display:flex;justify-content:center;gap:16px;margin-top:22px;align-items:center">
        ${adaptive(uri(F['icon.svg']), 76, 'circle')}
        ${themedIcon(F['monochrome.svg'], 76, MATERIAL.light)}
        ${themedIcon(F['monochrome.svg'], 76, MATERIAL.dark)}
      </div>
      <div style="display:flex;justify-content:center;gap:10px;margin-top:20px">
        <div class="tab" style="background:#fff;color:#202124"><img src="${f16}" width="16" height="16">BetterReads</div>
        <div class="tab" style="background:#35363a;color:#e8eaed"><img src="${f16}" width="16" height="16">BetterReads</div>
      </div>
      <div style="display:flex;justify-content:center;gap:14px;margin-top:12px;align-items:flex-end"><img src="${f32}" width="32" height="32"><img src="${f16}" width="16" height="16"><span class="cap" style="margin:0">32 · 16 px</span></div>
      <div class="lk" style="background:${THEMES.light.surface}"><img src="${uri(F['wordmark-light.svg'])}"></div>
      <div class="lk" style="background:${THEMES.dark.surface}"><img src="${uri(F['wordmark-dark.svg'])}"></div>
    </div>`)
  }
  const html = `<!doctype html><html><head><style>${BASE_CSS}
  .wrap{width:2520px;padding:56px 56px 60px}
  .cols{display:grid;grid-template-columns:repeat(${OPTIONS.length},1fr);gap:22px;margin-top:36px}
  .col{padding:26px 20px 22px;display:flex;flex-direction:column}
  .n{font-family:'Geist Mono',monospace;font-size:44px;font-weight:400;color:#845418;line-height:1}
  .name{font-family:Newsreader,serif;font-weight:500;font-size:30px;letter-spacing:-.01em;margin-top:10px}
  .kind{font-family:'Geist Mono',monospace;font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:rgb(28 25 21 / .6);margin-top:4px;min-height:30px}
  .tab{display:flex;align-items:center;gap:7px;font-size:12px;padding:7px 11px;border-radius:9px;box-shadow:0 0 0 .5px rgb(0 0 0 / .15)}
  .lk{margin-top:14px;border-radius:14px;height:96px;display:flex;align-items:center;justify-content:center;padding:14px}
  .lk img{max-width:100%;max-height:62px}
  h1{font-family:Newsreader,serif;font-weight:500;font-size:56px;letter-spacing:-.02em;margin:0}
  </style></head><body>${SVG_DEFS}<div class="wrap">
    <div style="display:flex;align-items:flex-end;justify-content:space-between">
      <div><div class="eyebrow">BetterReads · logo options, round 3 · kept: 1 and 6 · new: 10 and 11</div><h1>Four directions for the new name</h1></div>
      <div style="display:flex;align-items:center;gap:14px"><span class="cap" style="margin:0;text-align:right">today:<br>Two ribbons</span><img class="squircle" src="${uri(current)}" width="72" height="72"></div>
    </div>
    <div class="cols">${cols.join('')}</div>
  </div></body></html>`
  await page.setViewportSize({ width: 2520, height: 1000 })
  await page.setContent(html, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  writeFileSync(join(here, 'overview.png'), await page.screenshot({ fullPage: true, type: 'png' }))
}

const only = process.argv[2] // `node build.mjs 3` renders one sheet (the sources are always all written)
for (const o of OPTIONS) if (!only || only === String(o.n)) await sheet(o)
if (!only || only === 'overview') await overview()
await browser.close()
console.log('written:', OPTIONS.map((o) => o.slug).join(', '), only ? `(sheet ${only})` : '+ overview.png')
