// Five home-screen icon ideas for issue #83, drawn as SVG and laid out on one review page.
//
//   ICON_TOOLS=/path/to/dir-with-opentype.js-and-wawoff2 node design/icons/ideas/build.mjs [page.html]
//
// Design exploration only: nothing here ships. The script turns Newsreader (the Fontsource
// files the app already uses) into outlines with opentype.js, so every SVG is plain paths and
// needs no font at runtime. It writes, per idea, into design/icons/ideas/<n>-<slug>/:
//
//   icon.svg        the full-colour adaptive icon on its 108 dp canvas (Chrome's maskable icon);
//                   the mark sits inside the 66 dp safe zone (a circle of radius 33 round the centre)
//   monochrome.svg  the same mark as one alpha shape (the manifest's `purpose: "monochrome"`),
//                   the launcher tints it for themed icons
//   favicon.svg     the full-bleed square with the mark enlarged for 32 and 16 px
//
// and the self-contained review page (inline SVG, CSS and fonts; no requests) to the path given,
// /tmp/libellus-icons/index.html by default. Colours come from design/tokens.json.
//
// opentype.js and wawoff2 are not dependencies of the repo: install them in a scratch directory
// (`npm i opentype.js wawoff2`) and point ICON_TOOLS at it. Fonts are read from web/node_modules
// (after `pnpm install` in web/) or from FONTSOURCE_DIR (a node_modules/@fontsource directory).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '../../..')
const require = createRequire(join(process.env.ICON_TOOLS ?? '/tmp/icon-tools', 'package.json'))
const opentype = require('opentype.js')
const { decompress } = require('wawoff2')

const fontsource = process.env.FONTSOURCE_DIR ?? join(repo, 'web/node_modules/@fontsource')
const fontFile = (family, file) => join(fontsource, family, 'files', file)
if (!existsSync(fontFile('newsreader', 'newsreader-latin-800-italic.woff2'))) {
  throw new Error(`Newsreader not found under ${fontsource}: run pnpm install in web/ or set FONTSOURCE_DIR.`)
}

const tokens = JSON.parse(readFileSync(join(repo, 'design/tokens.json'), 'utf8'))
const tok = (name, theme) => {
  const v = tokens.color[name].$value
  return typeof v === 'string' ? v : v[theme]
}
const C = {
  room: tok('surface', 'dark'), // #0e0c0a, the night room
  paperRoom: tok('surface', 'light'),
  ink: tok('ink', 'dark'), // #eee7dc
  inkDay: tok('ink', 'light'),
  lamp: tok('accent', 'dark'), // #efb768
  lampDay: tok('accent', 'light'), // #b8782a
  cloth4: tok('cloth4'),
  cloth6: tok('cloth6'),
  clothInk: tok('clothInk'), // #f1e3c8
}

// ---------------------------------------------------------------- fonts → paths

const fonts = {}
async function loadFont(key) {
  if (fonts[key]) return fonts[key]
  const woff2 = readFileSync(fontFile('newsreader', `newsreader-latin-${key}.woff2`))
  const ttf = await decompress(woff2)
  fonts[key] = opentype.parse(ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength))
  return fonts[key]
}
await loadFont('400-italic')
await loadFont('800-italic')

/** A glyph's outline with its origin (baseline, left) at x, y; `size` is the em in canvas units. */
function glyph(key, ch, x, y, size) {
  return fonts[key].charToGlyph(ch).getPath(x, y, size).toPathData(2)
}
const advance = (key, ch, size) => (fonts[key].charToGlyph(ch).advanceWidth / fonts[key].unitsPerEm) * size

// ---------------------------------------------------------------- geometry helpers

const r2 = (n) => Math.round(n * 100) / 100
/** A circle as four cubics (so it samples like every other path). */
function circle(cx, cy, r) {
  const k = 0.5523 * r
  return `M${r2(cx + r)} ${r2(cy)}C${r2(cx + r)} ${r2(cy + k)} ${r2(cx + k)} ${r2(cy + r)} ${r2(cx)} ${r2(cy + r)}` +
    `C${r2(cx - k)} ${r2(cy + r)} ${r2(cx - r)} ${r2(cy + k)} ${r2(cx - r)} ${r2(cy)}` +
    `C${r2(cx - r)} ${r2(cy - k)} ${r2(cx - k)} ${r2(cy - r)} ${r2(cx)} ${r2(cy - r)}` +
    `C${r2(cx + k)} ${r2(cy - r)} ${r2(cx + r)} ${r2(cy - k)} ${r2(cx + r)} ${r2(cy)}Z`
}
const bez = (p0, p1, p2, p3, t) => {
  const u = 1 - t
  return [0, 1].map((i) => u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i])
}
/** Points on an absolute M/L/C/Q/Z path, curves sampled, for the safe-zone fit. */
function sample(d) {
  const tokens = d.match(/[MLCQZ]|-?\d*\.?\d+(?:e-?\d+)?/gi)
  const pts = []
  let i = 0, cmd = '', cur = [0, 0], start = [0, 0]
  const num = () => Number(tokens[i++])
  while (i < tokens.length) {
    if (/[MLCQZ]/i.test(tokens[i])) cmd = tokens[i++].toUpperCase()
    if (cmd === 'M') { cur = [num(), num()]; start = cur; pts.push(cur); cmd = 'L' }
    else if (cmd === 'L') { cur = [num(), num()]; pts.push(cur) }
    else if (cmd === 'C') {
      const a = [num(), num()], b = [num(), num()], c = [num(), num()]
      for (let t = 1; t <= 16; t++) pts.push(bez(cur, a, b, c, t / 16))
      cur = c
    } else if (cmd === 'Q') {
      const a = [num(), num()], c = [num(), num()]
      for (let t = 1; t <= 16; t++) {
        const s = t / 16, u = 1 - s
        pts.push([0, 1].map((j) => u * u * cur[j] + 2 * u * s * a[j] + s * s * c[j]))
      }
      cur = c
    } else if (cmd === 'Z') { cur = start }
  }
  return pts
}

/**
 * Places a mark (drawn in any coordinates) on the 108 canvas: its bounding box centred, scaled
 * so that no point lies further than `radius` from the centre. radius 33 = the 66 dp safe zone.
 */
function fit(paths, radius, nudge = [0, 0]) {
  const pts = paths.flatMap(sample)
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2
  const reach = Math.max(...pts.map(([x, y]) => Math.hypot(x - cx, y - cy)))
  const k = radius / reach
  const tx = 54 + nudge[0] - k * cx, ty = 54 + nudge[1] - k * cy
  const T = (x, y) => [r2(k * x + tx), r2(k * y + ty)]
  const box = { w: r2(k * (Math.max(...xs) - Math.min(...xs))), h: r2(k * (Math.max(...ys) - Math.min(...ys))) }
  return { k, tx, ty, T, box, transform: `matrix(${Number(k.toFixed(5))} 0 0 ${Number(k.toFixed(5))} ${r2(tx)} ${r2(ty)})` }
}

// ---------------------------------------------------------------- the ideas
//
// Each idea: `mono` is the silhouette (alpha only; `monoRule: 'evenodd'` turns inner contours into
// holes, `knock` cuts shapes out with a mask), `fg` the full-colour mark in the same coordinates,
// `bg` the canvas behind it (108 units, full bleed). `radius` is how far the mark may reach from
// the centre on the adaptive canvas, `favRadius` on the favicon. All ids are prefixed by `u`, so several copies can live in one page.

const glow = (u, cx, cy, r, color, alpha) => `
  <radialGradient id="${u}" cx="${cx}" cy="${cy}" r="${r}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="${color}" stop-opacity="${alpha}"/>
    <stop offset="0.35" stop-color="${color}" stop-opacity="${alpha * 0.35}"/>
    <stop offset="1" stop-color="${color}" stop-opacity="0"/>
  </radialGradient>`

const ideas = []

// 0 — today, for reference: what render-icons.mjs draws now (Newsreader 400 italic, maskable 0.72).
{
  const s = 1000, l = glyph('400-italic', 'l', 0, 0, s)
  const ix = advance('400-italic', 'l', s) + 6
  const i = glyph('400-italic', 'ı', ix, 0, s)
  const dot = [ix + 268, -655, 60]
  ideas.push({
    id: 'today', short: 'Today', n: '00', slug: 'today', name: 'Today', today: true,
    line: 'What ships now: “li” in Newsreader Regular italic, the i’s dot the lamp, the mark at 72 % of the maskable canvas.',
    mono: [l, i, circle(...dot)],
    radius: 22, monoRadius: 16, favRadius: 40,
    fg: (u, f) => `<defs>${glow(`${u}g`, dot[0], dot[1], dot[2] * 3.2, C.lamp, 0.55)}</defs>
      <path d="${l}${i}" fill="${C.ink}"/><circle cx="${dot[0]}" cy="${dot[1]}" r="${dot[2] * 3.2}" fill="url(#${u}g)"/>
      <circle cx="${dot[0]}" cy="${dot[1]}" r="${dot[2]}" fill="${C.lamp}"/>`,
    bg: (u, f) => { const [x, y] = f.T(dot[0], dot[1]); return `<defs>${glow(`${u}b`, x, y, 46, C.lamp, 0.3)}</defs><rect width="108" height="108" fill="${C.room}"/><rect width="108" height="108" fill="url(#${u}b)"/>` },
  })
}

// 1 — li, lit: the wordmark's start redrawn in Newsreader ExtraBold italic, filling the safe zone.
{
  const s = 1000, l = glyph('800-italic', 'l', 0, 0, s)
  const ix = advance('800-italic', 'l', s) + 4
  const i = glyph('800-italic', 'ı', ix, 0, s)
  const dot = [ix + 330, -640, 112] // where the i's own dot sits, a little larger: the lamp
  ideas.push({
    id: 'lit', short: 'li, lit', n: '01', slug: 'li-lit', name: 'li, lit',
    line: 'The current mark, kept but redrawn heavy: “li” in Newsreader ExtraBold italic as large as the safe zone allows, the dot of the i the lamp.',
    mono: [l, i, circle(...dot)],
    radius: 31, favRadius: 47, nudge: [0, 0.5],
    fg: (u) => `<defs>${glow(`${u}g`, dot[0], dot[1], dot[2] * 3, C.lamp, 0.6)}</defs>
      <path d="${l}${i}" fill="${C.ink}"/><circle cx="${dot[0]}" cy="${dot[1]}" r="${dot[2] * 3}" fill="url(#${u}g)"/>
      <circle cx="${dot[0]}" cy="${dot[1]}" r="${dot[2]}" fill="${C.lamp}"/>`,
    bg: (u, f) => { const [x, y] = f.T(dot[0], dot[1]); return `<defs>${glow(`${u}b`, x, y, 58, C.lamp, 0.26)}</defs><rect width="108" height="108" fill="${C.room}"/><rect width="108" height="108" fill="url(#${u}b)"/>` },
    note: 'Closest to today and to the wordmark, so nothing to relearn. ExtraBold italic doubles the stem weight, which is what the tinted circle needs; the price is that “li” stays two narrow letters: at 16 px the l and the i are two slanted bars and only the amber dot says “lamp”. The hairline serifs fill in below 32 px, harmless but no longer Newsreader-ish.',
  })
}

// 2 — the open book is an i: the book is the stem, the lamp hangs over the spine as its dot.
{
  const pageL = 'M53 57C46 51 36 49 27 51L27 72C36 70 46 71.5 53 76Z'
  const pageR = 'M55 57C62 51 72 49 81 51L81 72C72 70 62 71.5 55 76Z'
  const cover = 'M24 74C36 72 47 74.5 54 79C61 74.5 72 72 84 74L84 77.8C72 75.8 61 78.3 54 82.8C47 78.3 36 75.8 24 77.8Z'
  const dot = [54, 41, 6.6]
  // Lines of text: the top edge's curve, lowered and trimmed, as polylines.
  const lines = (side) => [6, 10, 14, 18].map((dy) => {
    const p0 = [53, 57], p1 = [46, 51], p2 = [36, 49], p3 = [27, 51]
    const pts = []
    for (let t = 0.1; t <= 0.86; t += 0.04) {
      const [x, y] = bez(p0, p1, p2, p3, t)
      pts.push([side < 0 ? x : 108 - x, y + dy - (dy * 0.12 * (1 - t))])
    }
    return `<polyline points="${pts.map((p) => p.map(r2).join(',')).join(' ')}"/>`
  }).join('')
  ideas.push({
    id: 'book', short: 'Book', n: '02', slug: 'open-book', name: 'The open book',
    line: 'An open book seen from the front, the lamp floating over its spine — together they read as a lower-case i.',
    mono: [pageL, pageR, cover, circle(...dot)],
    radius: 31, favRadius: 48, nudge: [0, 0],
    fg: (u) => `<defs>${glow(`${u}g`, dot[0], dot[1], 22, C.lamp, 0.65)}
        <radialGradient id="${u}p" cx="54" cy="52" r="34" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff6e3"/><stop offset="1" stop-color="#d9c5a2"/></radialGradient></defs>
      <circle cx="${dot[0]}" cy="${dot[1]}" r="22" fill="url(#${u}g)"/>
      <path d="${cover}" fill="${C.lampDay}"/>
      <path d="${pageL}${pageR}" fill="url(#${u}p)"/>
      <g fill="none" stroke="${C.inkDay}" stroke-opacity="0.2" stroke-width="1.1" stroke-linecap="round">${lines(-1)}${lines(1)}</g>
      <circle cx="${dot[0]}" cy="${dot[1]}" r="${dot[2]}" fill="${C.lamp}"/>`,
    bg: (u, f) => { const [x, y] = f.T(dot[0], dot[1]); return `<defs>${glow(`${u}b`, x, y, 60, C.lamp, 0.24)}</defs><rect width="108" height="108" fill="${C.room}"/><rect width="108" height="108" fill="url(#${u}b)"/>` },
    note: 'The most “book tracker” of the five and readable by anyone who has never seen the app. The silhouette (a wide V with a dot) holds up in the tinted circle; the cover band and the spine gap are 2–3 dp, so at 48 px they are about 1.5 px and close up on low-density screens — the shape still reads. At 16 px it becomes a generic book emoji with a dot; it loses the Newsreader voice entirely.',
  })
}

// 3 — under the lamp: a shade, its cone of light, an open book knocked out where the light lands.
{
  const shade = 'M39 35C39 24.5 45.5 18 54 18C62.5 18 69 24.5 69 35Z'
  const cone = 'M42.5 38.5L65.5 38.5L80 77C64 81.5 44 81.5 28 77Z'
  const bookL = 'M53 64C49 61 43.5 60 38.5 61L38.5 72.5C43.5 71.6 49 72.2 53 74.6Z'
  const bookR = 'M55 64C59 61 64.5 60 69.5 61L69.5 72.5C64.5 71.6 59 72.2 55 74.6Z'
  ideas.push({
    id: 'lamp', short: 'Lamp', n: '03', slug: 'under-the-lamp', name: 'Under the lamp',
    line: 'Design D’s empty-state drawing as an icon: a reading lamp throws its cone of light on an open book.',
    mono: [shade, cone + bookL + bookR],
    radius: 31.5, favRadius: 48,
    fg: (u) => `<defs><linearGradient id="${u}c" x1="0" y1="38" x2="0" y2="80" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="${C.lamp}" stop-opacity="0.95"/><stop offset="1" stop-color="${C.lamp}" stop-opacity="0.38"/></linearGradient></defs>
      <path d="${cone}" fill="url(#${u}c)"/>
      <path d="${bookL}${bookR}" fill="${C.clothInk}"/>
      <ellipse cx="54" cy="36.5" rx="8" ry="3" fill="#fff1d6"/>
      <path d="${shade}" fill="${C.ink}"/>`,
    bg: (u) => `<rect width="108" height="108" fill="${C.room}"/>`,
    monoRule: 'evenodd',
    note: 'The strongest silhouette at launcher size: a solid trapezoid under a dome is unmistakable, and nothing else on a home screen looks like it. In colour the cone is a soft amber gradient, in the themed icon it has to be one solid shape, so the two versions differ more than in the other ideas (and Android 16’s automatic theming, which works from the colour icon, would see a gradient). Below 32 px the book in the light is only a notch.',
  })
}

// 4 — two ribbons: "li" set as two bookmark ribbons, the short one under the lamp.
{
  const sk = 0.176 // tan 10°: Newsreader's italic slant
  const P = (x, y) => `${r2(x + (53 - y) * sk)} ${r2(y)}`
  const ribbon = (x0, x1, top, bottom, notch) => {
    const mid = (x0 + x1) / 2
    return `M${P(x0, top)}L${P(x1, top)}L${P(x1, bottom)}L${P(mid, bottom - notch)}L${P(x0, bottom)}Z`
  }
  const tall = ribbon(35, 47, 22, 84, 6.5)
  const short = ribbon(57, 69, 47, 84, 6.5)
  const [dx, dy] = P(63, 35.5).split(' ').map(Number)
  const dot = [dx, dy, 6.6]
  ideas.push({
    id: 'ribbons', short: 'Ribbons', n: '04', slug: 'two-ribbons', name: 'Two ribbons',
    line: '“li” built from two bookmark ribbons hanging out of a cloth cover, slanted like the italic, the lamp as the dot.',
    mono: [tall, short, circle(...dot)],
    radius: 31.5, favRadius: 48, nudge: [-0.5, 0],
    fg: (u) => `<defs>${glow(`${u}g`, dot[0], dot[1], 20, C.lamp, 0.7)}
        <linearGradient id="${u}r" x1="0" y1="20" x2="0" y2="86" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fbf0db"/><stop offset="1" stop-color="${C.clothInk}"/></linearGradient></defs>
      <path d="${tall}${short}" fill="url(#${u}r)"/>
      <circle cx="${dot[0]}" cy="${dot[1]}" r="20" fill="url(#${u}g)"/>
      <circle cx="${dot[0]}" cy="${dot[1]}" r="${dot[2]}" fill="${C.lamp}"/>`,
    bg: (u, f) => { const [x, y] = f.T(dot[0], dot[1]); return `<defs>
        <linearGradient id="${u}c" x1="0" y1="0" x2="0" y2="108" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#5a302c"/><stop offset="1" stop-color="${C.cloth6}"/></linearGradient>
        ${glow(`${u}b`, x, y, 50, C.lamp, 0.22)}</defs>
      <rect width="108" height="108" fill="url(#${u}c)"/><rect width="108" height="108" fill="url(#${u}b)"/>
      <rect y="0" width="108" height="3" fill="#000" fill-opacity="0.18"/>` },
    note: 'Geometric, so it is the crispest at every size: flat-topped bars and V tails survive 16 px, and the shape is still “li”. The cloth-red ground (a Placeholder cover’s cloth) makes it the only idea that stands out in colour on a busy home screen; in the themed icon that colour is gone and what is left is a clean, bold glyph close in weight to the neighbours. It is the least literary: no Newsreader left in it.',
  })
}

// 5 — the reading-room window: an arched window, lit, with an italic L standing in it.
{
  const arch = 'M35 80L35 46C35 35.5 43.5 27 54 27C64.5 27 73 35.5 73 46L73 80Z'
  // the L's box (Newsreader ExtraBold italic: x −34…646, y −676…47 per 1000) centred in the
  // window's lower part, its foot clear of the jambs
  const size = 41
  const lb = { x1: -34 * size / 1000, x2: 646 * size / 1000, y1: -676 * size / 1000, y2: 47 * size / 1000 }
  const lx = 54 - (lb.x1 + lb.x2) / 2, ly = 74 - lb.y2
  const Lpath = glyph('800-italic', 'L', lx, ly, size)
  ideas.push({
    id: 'window', short: 'Window', n: '05', slug: 'reading-room', name: 'The reading room',
    line: 'A lit, arched reading-room window seen from the dark street, a Newsreader italic L standing in the light.',
    // The glyph's contours overlap (foot serif over the stem), so it is knocked out with a mask,
    // not with an even-odd hole.
    mono: [arch], knock: [Lpath],
    radius: 31.5, favRadius: 48,
    fg: (u) => `<defs><linearGradient id="${u}w" x1="0" y1="27" x2="0" y2="80" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#ffdca0"/><stop offset="0.55" stop-color="${C.lamp}"/><stop offset="1" stop-color="#c98a3e"/></linearGradient></defs>
      <path d="${arch}" fill="url(#${u}w)"/><path d="${Lpath}" fill="${C.room}"/>`,
    bg: (u, f) => { const [x, y] = f.T(54, 56); return `<defs>${glow(`${u}b`, x, y, 62, C.lamp, 0.2)}</defs><rect width="108" height="108" fill="${C.room}"/><rect width="108" height="108" fill="url(#${u}b)"/>` },
    note: 'A tall, simple tombstone silhouette — like the shield of a password manager, it reads instantly in a themed row and keeps the serif voice through the knocked-out L. The L itself is the weak point: counters cut out of a 48 px shape are 3 px strokes, fine on a phone (3× density) but mushy at 16 px, where the favicon becomes an amber arch with a dark mark. The arch is narrow, so it looks a size smaller than square glyphs next to it.',
  })
}
// today has no note; give it one for the page
ideas[0].note = 'Regular weight at 72 % of the canvas: fine in colour, but Android 16 themes it automatically (we ship no monochrome icon) and the hairline “li” comes out thin and small next to every other app.'

// ---------------------------------------------------------------- per-idea SVG parts

for (const idea of ideas) {
  idea.fit = fit(idea.mono, idea.radius, idea.nudge)
  idea.monoFit = idea.monoRadius ? fit(idea.mono, idea.monoRadius, idea.nudge) : idea.fit
  idea.favFit = fit(idea.mono, idea.favRadius, idea.nudge)
  const rule = idea.monoRule ?? 'nonzero'
  idea.full = (u) => `${idea.bg(`${u}bg`, idea.fit)}<g transform="${idea.fit.transform}">${idea.fg(`${u}fg`, idea.fit)}</g>`
  idea.monoBody = (u, fill) => idea.knock
    ? `<mask id="${u}k" maskUnits="userSpaceOnUse" x="0" y="0" width="108" height="108"><rect width="108" height="108" fill="#fff"/><path fill="#000" transform="${idea.monoFit.transform}" d="${idea.knock.join('')}"/></mask>` +
      `<g mask="url(#${u}k)"><g transform="${idea.monoFit.transform}"><path fill="${fill}" fill-rule="${rule}" d="${idea.mono.join('')}"/></g></g>`
    : `<g transform="${idea.monoFit.transform}"><path fill="${fill}" fill-rule="${rule}" d="${idea.mono.join('')}"/></g>`
  idea.fav = (u) => `<clipPath id="${u}clip"><rect width="108" height="108" rx="22"/></clipPath><g clip-path="url(#${u}clip)">${idea.bg(`${u}bg`, idea.favFit)}<g transform="${idea.favFit.transform}">${idea.fg(`${u}fg`, idea.favFit)}</g></g>`
}

// ---------------------------------------------------------------- source files

const svgFile = (body, title) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" width="108" height="108">\n<title>${title}</title>\n${body}\n</svg>\n`
for (const idea of ideas.filter((i) => !i.today)) {
  const dir = join(here, `${idea.n}-${idea.slug}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'icon.svg'), svgFile(idea.full('a'), `Libellus — ${idea.name} (adaptive, 108 dp canvas, mark inside the 66 dp safe zone)`))
  writeFileSync(join(dir, 'monochrome.svg'), svgFile(idea.monoBody('a', '#000'), `Libellus — ${idea.name} (monochrome, alpha only)`))
  writeFileSync(join(dir, 'favicon.svg'), svgFile(idea.fav('a'), `Libellus — ${idea.name} (favicon)`))
}

// ---------------------------------------------------------------- the review page

const b64 = (family, file) => readFileSync(fontFile(family, file)).toString('base64')
const fontFaces = [
  ['Newsreader', 'italic', 400, 'newsreader', 'newsreader-latin-400-italic.woff2'],
  ['Newsreader', 'normal', 500, 'newsreader', 'newsreader-latin-500-normal.woff2'],
  ['Geist', 'normal', 400, 'geist', 'geist-latin-400-normal.woff2'],
  ['Geist', 'normal', 500, 'geist', 'geist-latin-500-normal.woff2'],
  ['Geist Mono', 'normal', 400, 'geist-mono', 'geist-mono-latin-400-normal.woff2'],
].map(([fam, style, w, dir, file]) => `@font-face{font-family:'${fam}';font-style:${style};font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${b64(dir, file)}) format('woff2')}`).join('\n')

// Launcher masks on the 108 canvas; only the inner 72 dp (18–90) is ever visible.
const squircle = (() => {
  const pts = []
  for (let i = 0; i < 128; i++) {
    const t = (i / 128) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t)
    pts.push([54 + 36 * Math.sign(c) * Math.abs(c) ** 0.5, 54 + 36 * Math.sign(s) * Math.abs(s) ** 0.5])
  }
  return `M${pts.map((p) => p.map(r2).join(' ')).join('L')}Z`
})()
const masks = {
  circle: `<circle cx="54" cy="54" r="36"/>`,
  squircle: `<path d="${squircle}"/>`,
  rounded: `<rect x="18" y="18" width="72" height="72" rx="17"/>`,
}

// Material You tints, taken from the owner's home screen (a blue-green wallpaper).
const themed = {
  dark: { tile: '#27323d', glyph: '#c4dbf1' },
  light: { tile: '#d3e4f5', glyph: '#1d3851' },
}

// Stand-in neighbours: plain glyphs of the weight real themed icons have (~40 dp, bold).
const neighbours = {
  shield: { label: 'Vault', svg: (g, t) => `<path fill="${g}" d="M54 33L72 39.5V54C72 66 64 73.5 54 77C44 73.5 36 66 36 54V39.5Z"/><path fill="${t}" d="M54 39L66.5 43.5V54C66.5 62.5 61 68.5 54 71Z"/>` },
  camera: { label: 'Lens', svg: (g, t) => `<path fill="${g}" d="M37 42H46L49.5 37H58.5L62 42H71A3 3 0 0 1 74 45V68A3 3 0 0 1 71 71H37A3 3 0 0 1 34 68V45A3 3 0 0 1 37 42Z"/><circle cx="54" cy="56" r="9.5" fill="${t}"/><circle cx="54" cy="56" r="5.5" fill="${g}"/>` },
  bulb: { label: 'Notes', svg: (g, t) => `<path fill="${g}" d="M54 32C64 32 71 39.5 71 48.5C71 55 67.5 59 64.5 62.5C62.5 65 62 66.5 62 68.5H46C46 66.5 45.5 65 43.5 62.5C40.5 59 37 55 37 48.5C37 39.5 44 32 54 32Z"/><rect x="46" y="71" width="16" height="4" rx="2" fill="${g}"/><rect x="48.5" y="77" width="11" height="3.5" rx="1.75" fill="${g}"/>` },
  music: { label: 'Music', svg: (g, t) => `<circle cx="54" cy="54" r="21" fill="${g}"/><g fill="none" stroke="${t}" stroke-linecap="round"><path d="M42 48C50 45.5 59 46 67 50" stroke-width="3.6"/><path d="M43.5 55C50.5 53 58 53.5 64.5 57" stroke-width="3"/><path d="M45 61.5C51 60 57 60.5 62 63" stroke-width="2.5"/></g>` },
  chat: { label: 'Chat', svg: (g, t) => `<path fill="${g}" d="M54 34C66 34 75 42 75 52.5C75 63 66 71 54 71C51 71 48 70.5 45.5 69.5L36 74L38.5 65C35 61.5 33 57.3 33 52.5C33 42 42 34 54 34Z"/>` },
}

const use = (id) => `<use href="#${id}" width="108" height="108"/>`
const tile = (inner, mask, size = 48, extra = '') => `<svg class="tile" viewBox="18 18 72 72" width="${size}" height="${size}" aria-hidden="true"${extra}><g clip-path="url(#mask-${mask})">${inner}</g></svg>`
const themedTile = (body, scheme, mask = 'circle', size = 48) => tile(`<rect width="108" height="108" fill="${themed[scheme].tile}"/><g fill="${themed[scheme].glyph}" style="color:${themed[scheme].glyph}">${body}</g>`, mask, size)
const ideaMono = (idea) => use(`${idea.id}-mono`)
const app = (icon, label, cls = '') => `<div class="app ${cls}">${icon}<span>${label}</span></div>`

function themedRow(idea, scheme, mask) {
  const order = ['shield', 'camera', null, 'bulb', 'music']
  return order.map((k) => k
    ? app(themedTile(neighbours[k].svg(themed[scheme].glyph, themed[scheme].tile), scheme, mask), neighbours[k].label)
    : app(themedTile(ideaMono(idea), scheme, mask), 'Libellus', 'me')).join('')
}

const guides = `<path d="M0 0H108V108H0ZM18 18V90H90V18Z" fill-rule="evenodd" fill="#000" fill-opacity="0.38"/>
  <rect x="18" y="18" width="72" height="72" fill="none" stroke="#fff" stroke-opacity="0.45" stroke-width="0.4" stroke-dasharray="1.6 1.2"/>
  <circle cx="54" cy="54" r="33" fill="none" stroke="#7fd4ff" stroke-opacity="0.8" stroke-width="0.45" stroke-dasharray="1.6 1.2"/>`

function ideaSection(idea) {
  const sizeNote = `mark ${idea.fit.box.w}×${idea.fit.box.h} dp`
  return `
<section class="idea" id="${idea.id}">
  <header class="idea-head">
    <span class="num">${idea.n}</span>
    <div><h2>${idea.name}</h2><p class="line">${idea.line}</p></div>
  </header>
  <div class="hero">
    <figure><svg viewBox="0 0 108 108" width="256" height="256" class="canvas">${use(`${idea.id}-full`)}${guides}</svg>
      <figcaption>Adaptive icon, full 108 dp canvas · <i>dashed square</i> 72 dp visible · <i class="blue">dashed circle</i> 66 dp safe zone · ${sizeNote}</figcaption></figure>
    <figure><svg viewBox="0 0 108 108" width="256" height="256" class="canvas mono-canvas"><rect width="108" height="108" fill="#5d6670"/><g style="color:#fff" fill="#fff">${ideaMono(idea)}</g>${guides}</svg>
      <figcaption>${idea.today ? 'No monochrome icon ships today: this is roughly what Android 16 derives from the colour icon (as on the owner’s home screen)' : 'Monochrome icon (alpha only; the launcher tints it)'}</figcaption></figure>
  </div>

  <h3>On the home screen · 48 px · circle / squircle / rounded square</h3>
  <div class="walls">
    <div class="wall wall-light">${['circle', 'squircle', 'rounded'].map((m) => app(tile(use(`${idea.id}-full`), m), m)).join('')}</div>
    <div class="wall wall-dark">${['circle', 'squircle', 'rounded'].map((m) => app(tile(use(`${idea.id}-full`), m), m)).join('')}</div>
  </div>

  <h3>Themed icons (Material You) · next to typical neighbours</h3>
  <div class="walls">
    <div class="wall wall-light row">${themedRow(idea, 'light', 'squircle')}</div>
    <div class="wall wall-dark row">${themedRow(idea, 'dark', 'squircle')}</div>
  </div>
  <div class="walls">
    <div class="wall wall-light row">${themedRow(idea, 'light', 'circle')}</div>
    <div class="wall wall-dark row">${themedRow(idea, 'dark', 'circle')}</div>
  </div>

  <h3>Favicon · 32 and 16 px</h3>
  <div class="favs">
    ${['light', 'dark'].map((s) => `<div class="tabstrip ${s}">
      <div class="tab"><svg width="16" height="16" viewBox="0 0 108 108">${use(`${idea.id}-fav`)}</svg><span>Libellus</span></div>
      <div class="fav32"><svg width="32" height="32" viewBox="0 0 108 108">${use(`${idea.id}-fav`)}</svg><svg width="16" height="16" viewBox="0 0 108 108">${use(`${idea.id}-fav`)}</svg></div>
    </div>`).join('')}
  </div>

  <p class="note"><span class="eyebrow">Legibility</span>${idea.note}</p>
</section>`
}

const real = ideas.filter((i) => !i.today)
const today = ideas[0]

const sprite = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  ${Object.entries(masks).map(([k, v]) => `<clipPath id="mask-${k}">${v}</clipPath>`).join('')}
  ${ideas.map((i) => `<symbol id="${i.id}-full" viewBox="0 0 108 108">${i.full(`${i.id}F`)}</symbol>
  <symbol id="${i.id}-mono" viewBox="0 0 108 108">${i.monoBody(`${i.id}M`, 'currentColor')}</symbol>
  <symbol id="${i.id}-fav" viewBox="0 0 108 108">${i.fav(`${i.id}V`)}</symbol>`).join('\n')}
</defs></svg>`

const strip = (scheme) => `<div class="wall wall-${scheme} row strip">
  ${app(themedTile(ideaMono(today), scheme, 'squircle'), 'Today', 'today')}
  ${real.map((i) => app(themedTile(ideaMono(i), scheme, 'squircle'), `${i.n} ${i.short}`)).join('')}
</div>`
const stripFull = (scheme) => `<div class="wall wall-${scheme} row strip">
  ${app(tile(use('today-full'), 'circle'), 'Today', 'today')}
  ${real.map((i) => app(tile(use(`${i.id}-full`), 'circle'), `${i.n} ${i.short}`)).join('')}
</div>`

const css = `
${fontFaces}
:root{--room:${C.room};--raised:#171512;--ink:${C.ink};--muted:rgb(238 231 220/.64);--faint:rgb(238 231 220/.42);--hair:rgb(255 236 210/.085);--hair2:rgb(255 236 210/.16);--lamp:${C.lamp};color-scheme:dark}
@media (prefers-color-scheme:light){:root{--room:${C.paperRoom};--raised:#fbf9f5;--ink:${C.inkDay};--muted:rgb(28 25 21/.64);--faint:rgb(28 25 21/.45);--hair:rgb(40 30 20/.1);--hair2:rgb(40 30 20/.17);--lamp:${C.lampDay};color-scheme:light}}
:root[data-theme=dark]{--room:${C.room};--raised:#171512;--ink:${C.ink};--muted:rgb(238 231 220/.64);--faint:rgb(238 231 220/.42);--hair:rgb(255 236 210/.085);--hair2:rgb(255 236 210/.16);--lamp:${C.lamp};color-scheme:dark}
:root[data-theme=light]{--room:${C.paperRoom};--raised:#fbf9f5;--ink:${C.inkDay};--muted:rgb(28 25 21/.64);--faint:rgb(28 25 21/.45);--hair:rgb(40 30 20/.1);--hair2:rgb(40 30 20/.17);--lamp:${C.lampDay};color-scheme:light}
*{box-sizing:border-box}
html{background:var(--room);color:var(--ink);font:400 15px/1.45 Geist,system-ui,sans-serif;-webkit-text-size-adjust:100%}
body{margin:0;padding:0 20px 64px}
main{max-width:980px;margin:0 auto}
.top{position:relative;padding:40px 0 8px}
.top::before{content:"";position:absolute;inset:-40px -20px auto;height:260px;background:radial-gradient(ellipse at 30% 20%,rgb(239 183 104/.16),transparent 60%);pointer-events:none}
.eyebrow{display:block;font:400 11px/1 'Geist Mono',ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);margin-bottom:10px}
h1{font:400 italic 46px/1 Newsreader,serif;letter-spacing:-.02em;margin:0 0 12px}
h1 b{color:var(--lamp);font-weight:400}
.lede{color:var(--muted);max-width:66ch;margin:0 0 6px}
.lede strong{color:var(--ink);font-weight:500}
h2{font:500 24px/1.15 Newsreader,serif;letter-spacing:-.01em;margin:0}
h3{font:400 11px/1 'Geist Mono',ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);margin:26px 0 10px;font-weight:400}
.card,.idea{background:var(--raised);border-radius:20px;padding:20px;margin:22px 0;box-shadow:inset 0 0 0 .5px var(--hair2)}
.idea-head{display:flex;gap:14px;align-items:flex-start}
.num{font:400 12px/1 'Geist Mono',monospace;color:var(--lamp);border:1px solid currentColor;border-radius:99px;padding:5px 8px;margin-top:3px}
.line{color:var(--muted);margin:6px 0 0}
.hero{display:flex;flex-wrap:wrap;gap:20px;margin-top:20px}
.hero figure{margin:0;flex:1 1 256px;max-width:256px}
.canvas{display:block;width:100%;height:auto;border-radius:6px}
figcaption{font-size:12px;color:var(--faint);margin-top:8px;line-height:1.4}
figcaption i{font-style:normal;color:var(--muted)} figcaption i.blue{color:#5bb8e8}
.walls{display:grid;grid-template-columns:1fr 1fr;gap:10px}
@media (max-width:720px){.walls{grid-template-columns:1fr}}
.wall{display:flex;flex-wrap:wrap;justify-content:space-around;gap:10px 6px;padding:16px 10px 12px;border-radius:14px}
.wall-dark{background:radial-gradient(ellipse at 70% 0%,#3d6e72,transparent 70%),linear-gradient(160deg,#1f4a3a,#16303b 55%,#0f2430)}
.wall-light{background:radial-gradient(ellipse at 30% 0%,#ffffff,transparent 70%),linear-gradient(160deg,#cfe3e6,#e9efe6 55%,#d7e4ef)}
.app{display:flex;flex-direction:column;align-items:center;gap:5px;width:62px}
.app span{font:400 11px/1.15 system-ui,Roboto,sans-serif;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:66px}
.wall-dark .app span{color:#fff;text-shadow:0 1px 2px rgb(0 0 0/.6)}
.wall-light .app span{color:#1b2a33}
.tile{display:block}
.app.me span{font-weight:600}
.walls.single{grid-template-columns:1fr}
.strip .app{width:76px}
@media (max-width:520px){.wall{padding:14px 6px 10px;gap:10px 2px;flex-wrap:nowrap}.wall.strip{display:grid;grid-template-columns:repeat(3,1fr);justify-items:center}.app,.strip .app{width:54px}.app span{font-size:10.5px;max-width:58px}}
.favs{display:grid;grid-template-columns:1fr 1fr;gap:10px}
@media (max-width:520px){.favs{grid-template-columns:1fr}}
.tabstrip{display:flex;align-items:center;gap:14px;padding:10px 12px;border-radius:12px}
.tabstrip.light{background:#dfe3e8}.tabstrip.dark{background:#202124}
.tab{display:flex;align-items:center;gap:8px;padding:7px 12px;border-radius:9px;font:400 12px/1 system-ui,sans-serif;min-width:130px}
.light .tab{background:#fff;color:#1f1f1f}.dark .tab{background:#35363a;color:#e8eaed}
.fav32{display:flex;align-items:center;gap:10px;margin-left:auto}
.note{margin:22px 0 0;color:var(--muted);border-top:.5px solid var(--hair2);padding-top:14px}
.note .eyebrow{margin-bottom:8px}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px 22px;margin:0;padding:0;list-style:none}
.facts li{color:var(--muted);font-size:14px;padding-left:14px;position:relative}
.facts li::before{content:"";position:absolute;left:0;top:.6em;width:5px;height:5px;border-radius:50%;background:var(--lamp)}
.facts b{color:var(--ink);font-weight:500}
.theme-toggle{position:absolute;right:0;top:40px;font:400 11px/1 'Geist Mono',monospace;letter-spacing:.08em;text-transform:uppercase;background:none;border:.5px solid var(--hair2);color:var(--muted);border-radius:99px;padding:8px 12px;cursor:pointer}
nav.jump{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}
nav.jump a{font:400 12px/1 Geist,sans-serif;color:var(--muted);text-decoration:none;border:.5px solid var(--hair2);border-radius:99px;padding:7px 11px}
footer{color:var(--faint);font-size:12px;margin-top:30px}
code{font:400 12.5px 'Geist Mono',monospace;color:var(--ink)}
`

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Libellus · home-screen icon, five ideas (#83)</title>
<style>${css}</style></head>
<body>${sprite}
<main>
  <div class="top">
    <span class="eyebrow">Libellus · issue #83 · design exploration</span>
    <h1>Five icons for the <b>home screen</b></h1>
    <p class="lede">Android 16 tints every icon on a themed home screen. Libellus ships no monochrome icon, so Android themes the colour icon itself and the Regular-weight “li” comes out <strong>thin and small</strong> next to its neighbours. Five different marks follow, each with a solid silhouette meant for the tinted tile.</p>
    <button class="theme-toggle" type="button" onclick="var r=document.documentElement;r.dataset.theme=(r.dataset.theme||(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'))==='dark'?'light':'dark'">Night / Day</button>
    <nav class="jump">${real.map((i) => `<a href="#${i.id}">${i.n} ${i.name}</a>`).join('')}</nav>
  </div>

  <section class="card">
    <span class="eyebrow">Side by side · themed · 48 px · Today first</span>
    <div class="walls single">${strip('dark')}${strip('light')}</div>
    <h3>Full colour · circle mask</h3>
    <div class="walls single">${stripFull('dark')}${stripFull('light')}</div>
  </section>

  ${ideaSection(today).replace('class="idea"', 'class="idea today"')}
  ${real.map(ideaSection).join('\n')}

  <section class="card">
    <span class="eyebrow">For the build ticket</span>
    <ul class="facts">
      <li><b>Safe zone.</b> Every mark here is placed by code inside the 66 dp circle of the 108 dp canvas (Chrome’s maskable icon), so no launcher shape cuts it.</li>
      <li><b>Monochrome icon.</b> Ship it as <code>purpose: "monochrome"</code> (a transparent PNG, only alpha counts). Chrome’s WebAPK has not used it so far (Chromium issue 40277264), so on Android 16 the themed icon is <b>derived from the maskable icon</b>: keep the colour mark the same silhouette, in one light ink on the dark ground, glows behind it only.</li>
      <li><b>Existing installs.</b> Chrome holds back WebAPK icon updates that change more than ~11 % of the icon; a new icon may need a reinstall on the owner’s phone.</li>
      <li><b>Favicon.</b> The mark is enlarged on a full-bleed rounded square for 32 and 16 px; render the ICO from <code>favicon.svg</code>.</li>
      <li><b>Sources.</b> <code>design/icons/ideas/&lt;n&gt;-&lt;slug&gt;/{icon,monochrome,favicon}.svg</code>, drawn by <code>design/icons/ideas/build.mjs</code> from Newsreader outlines and <code>design/tokens.json</code>.</li>
    </ul>
  </section>
  <footer>Self-contained page: inline SVG, CSS and fonts; no requests. Themed tints sampled from the owner’s home screen; neighbours are generic stand-ins.</footer>
</main>
</body></html>`

const outPage = process.argv[2] ?? '/tmp/libellus-icons/index.html'
mkdirSync(dirname(outPage), { recursive: true })
writeFileSync(outPage, page)
for (const i of ideas) console.log(`${i.n} ${i.name.padEnd(18)} mark ${i.fit.box.w}×${i.fit.box.h} dp (k ${i.fit.k.toFixed(4)})`)
console.log(`Page: ${outPage} (${Math.round(page.length / 1024)} KB)`)
