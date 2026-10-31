// The six BetterReads logo directions: geometry and colours.
//
// Every mark is drawn in a 100 × 100 box (y down). A part is one path with a role:
//   main    the mark's body (cream on the icon's room, ink on paper, cream on the night room)
//   accent  the lamp (amber), or whatever the option lights
//   track   the unlit rest (option 4's last quarter of a star)
// `parts(variant)` returns the parts for 'full' (icon, lock-up, monochrome) or 'fav'
// (the favicon: fewer, heavier details so it survives 16 px).
// build.mjs fits the parts into each canvas; nothing here knows about sizes.

/** A polygon with rounded corners: each corner is cut back by `r` along both edges and bridged by a quadratic curve. */
export function roundedPolygon(points, radii) {
  const n = points.length
  const r = (i) => (Array.isArray(radii) ? radii[i] : radii)
  const f = (v) => String(Number(v.toFixed(2)))
  let d = ''
  for (let i = 0; i < n; i++) {
    const p = points[i]
    const prev = points[(i - 1 + n) % n]
    const next = points[(i + 1) % n]
    const toward = (q, dist) => {
      const len = Math.hypot(q[0] - p[0], q[1] - p[1])
      return [p[0] + ((q[0] - p[0]) / len) * dist, p[1] + ((q[1] - p[1]) / len) * dist]
    }
    const a = toward(prev, r(i))
    const b = toward(next, r(i))
    d += `${i === 0 ? 'M' : 'L'}${f(a[0])} ${f(a[1])}Q${f(p[0])} ${f(p[1])} ${f(b[0])} ${f(b[1])}`
  }
  return d + 'Z'
}

const f = (v) => String(Number(v.toFixed(2)))

// ------------------------------------------------------------------ 1 · Bookmark B

function bookmarkB(variant) {
  // The ribbon is the B's stem, running past the baseline into a swallowtail.
  // The bowls are one "3"-shaped piece beside it, a 3-unit gap away (none in the favicon).
  const gap = variant === 'fav' ? 0 : 3
  const x = 38 + gap // where the bowls start
  const ribbon = 'M20 8H38V97L29 89L20 97Z'
  // Upper bowl: centre (54, 28), r 20. Lower bowl: centre (54, 63), r 26. They meet at (68.70, 41.56).
  const bowls =
    `M${x} 8H54A20 20 0 0 1 68.7 41.56A26 26 0 0 1 54 89H${x}Z` +
    `M${x} 19H54A9 9 0 0 1 54 37H${x}Z` +
    `M${x} 48H54A15 15 0 0 1 54 78H${x}Z`
  return [
    { role: 'accent', d: ribbon },
    { role: 'main', d: bowls, evenodd: true },
  ]
}

// ------------------------------------------------------------------ 2 · Rising shelf

function risingShelf(variant) {
  // Three books on a shelf, each taller than the last; the tallest, lit, leans forward off the row.
  // Flat tops, different widths and the shelf keep it a shelf, not a signal-strength chart.
  const fav = variant === 'fav'
  const foot = fav ? 86 : 83 // books stand 3 units above the shelf (on it in the favicon)
  const rot = (p, [px, py], deg) => {
    const a = (deg * Math.PI) / 180
    const dx = p[0] - px
    const dy = p[1] - py
    return [px + dx * Math.cos(a) - dy * Math.sin(a), py + dx * Math.sin(a) + dy * Math.cos(a)]
  }
  const book = (x0, x1, top, lean = 0) => {
    const pivot = [x1, foot]
    const R = (p) => (lean ? rot(p, pivot, lean) : p)
    let d = roundedPolygon([[x0, foot], [x0, top], [x1, top], [x1, foot]].map(R), [0.8, 1.6, 1.6, 0.8])
    if (!fav) {
      // two bands knocked out of the spine, near its head and its foot
      for (const [y0, y1] of [[top + 5, top + 7.5], [foot - 9, foot - 6.5]]) {
        const q = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(R)
        d += `M${q.map((p) => `${f(p[0])} ${f(p[1])}`).join('L')}Z`
      }
    }
    return d
  }
  const shelf = roundedPolygon([[12, 86], [88, 86], [88, 91], [12, 91]], 1.5)
  return [
    { role: 'main', d: book(17, 31, 52) + book(34, 50, 38) + shelf, evenodd: true },
    { role: 'accent', d: book(54, 69, 22, 8), evenodd: true },
  ]
}

// ------------------------------------------------------------------ 3 · Read-tick

function readTick(variant) {
  // An open book seen from the front, its short left page dipping into the gutter and the long right
  // page rising out of it: a tick. Under each page block a strip of the cover shows.
  const fav = variant === 'fav'
  const gl = fav ? 40 : 38.5 // gutter, left page's edge
  const gr = fav ? 40 : 41.5 // gutter, right page's edge
  const t = fav ? 20 : 16 // page block height (measured vertically)
  const pageL = `M14 46Q26 50 ${gl} 64V${64 + t}Q26 ${50 + t} 14 ${46 + t}Z`
  const pageR = `M${gr} 64Q60 34 88 20V${20 + t}Q60 ${34 + t} ${gr} ${64 + t}Z`
  const parts = [{ role: 'main', d: pageL + pageR }]
  if (!fav) {
    const a = t + 2.5 // knock-out between pages and cover
    const b = t + 7 // cover strip's lower edge
    const coverL = `M14 ${f(46 + a)}Q26 ${f(50 + a)} ${gl} ${f(64 + a)}V${f(64 + b)}Q26 ${f(50 + b)} 14 ${f(46 + b)}Z`
    const coverR = `M${gr} ${f(64 + a)}Q60 ${f(34 + a)} 88 ${f(20 + a)}V${f(20 + b)}Q60 ${f(34 + b)} ${gr} ${f(64 + b)}Z`
    parts.push({ role: 'accent', d: coverL + coverR })
  }
  return parts
}

// ------------------------------------------------------------------ 4 · Quarter star

function quarterStar(variant) {
  // A five-pointed star in four quarters around its centre, three lit clockwise from twelve like a
  // progress ring, the last (upper left) still its track: 3¾ stars, and three quarters through a book.
  const cx = 50
  const cy = 53
  const R = 42
  const r = R * 0.47
  const pts = []
  for (let i = 0; i < 10; i++) {
    const a = (-90 + i * 36) * (Math.PI / 180)
    const rad = i % 2 === 0 ? R : r
    pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)])
  }
  const star = roundedPolygon(pts, pts.map((_, i) => (i % 2 === 0 ? 5 : 2.5)))
  const g = variant === 'fav' ? 2 : 1.4 // half the cut
  const lit = `M${f(cx + g)} 0H100V100H0V${f(cy + g)}H${f(cx + g)}Z`
  const track = `M0 0H${f(cx - g)}V${f(cy - g)}H0Z`
  return [
    { role: 'accent', d: star, clip: lit },
    { role: 'track', d: star, clip: track },
  ]
}

// ------------------------------------------------------------------ 5 · br (wordmark-first)

function brMonogram(variant, { glyphs }) {
  // "br" outlined from Newsreader Italic 600 (the wordmark's face), resting on a short rule:
  // the focused field's rule, the caret's line. Glyph outlines come from build.mjs (opentype).
  const parts = [{ role: 'main', d: glyphs.br.d }]
  if (variant === 'fav') return parts // at 16 px the letters need every pixel; the rule goes
  const { x1, x2 } = glyphs.br.box
  const ruleY = glyphs.br.baseline + 8
  parts.push({ role: 'accent', d: roundedPolygon([[x1 + 2, ruleY], [x2 - 4, ruleY], [x2 - 4, ruleY + 7], [x1 + 2, ruleY + 7]], 1.5) })
  return parts
}

// ------------------------------------------------------------------ 6 · Lamp over the page

function lampPage(variant) {
  // An open book, its pages lifting from the gutter, and the lamp rising behind it like the sun
  // over a horizon: only the part of the disc above the pages shows, a gap away from them.
  const fav = variant === 'fav'
  const g = fav ? 2 : 1.6 // half the gutter
  const left = `M${f(50 - g)} 70C42 58 26 56 10 62V78C26 72 42 74 ${f(50 - g)} 86Z`
  const right = `M${f(50 + g)} 70C58 58 74 56 90 62V78C74 72 58 74 ${f(50 + g)} 86Z`
  const r = fav ? 20 : 18.5
  const cy = 55
  const disc = `M50 ${f(cy - r)}A${r} ${r} 0 1 1 50 ${f(cy + r)}A${r} ${r} 0 1 1 50 ${f(cy - r)}Z`
  // the sky: everything above the pages' top edges, lifted by the gap
  const k = fav ? 4.5 : 4
  const sky = `M0 0H100V${f(62 - k)}H90C74 ${f(56 - k)} 58 ${f(58 - k)} 50 ${f(70 - k)}C42 ${f(58 - k)} 26 ${f(56 - k)} 10 ${f(62 - k)}H0Z`
  return [
    { role: 'main', d: left + right },
    { role: 'accent', d: disc, clip: sky },
  ]
}

// ------------------------------------------------------------------ the options

const CREAM = '#f1e3c8' // clothInk: type on a Placeholder cover
const AMBER = '#efb768' // accent (dark) / highlightLamp
const INK = '#1c1915'

/** Lock-up colours from tokens.json: ink and accent per theme; the track is ink at 20 % (starTrack). */
export const THEMES = {
  light: { surface: '#f4f0e9', raised: '#fbf9f5', main: '#1c1915', accent: '#b8782a', track: 'rgb(28 25 21 / 0.2)', text: '#1c1915', faint: 'rgb(28 25 21 / 0.62)' },
  dark: { surface: '#0e0c0a', raised: '#171512', main: '#eee7dc', accent: '#efb768', track: 'rgb(238 231 220 / 0.2)', text: '#eee7dc', faint: 'rgb(238 231 220 / 0.56)' },
}

export const OPTIONS = [
  {
    n: 1,
    slug: '1-bookmark-b',
    name: 'Bookmark B',
    kind: 'Lettermark, evolved from Two ribbons',
    parts: bookmarkB,
    room: { top: '#5a302c', bottom: '#43211f', glow: [78, 18] },
    icon: { main: CREAM, accent: AMBER },
    font: { family: 'geist-sans', weight: 600, style: 'normal', tracking: -0.03 },
    text: 'BetterReads',
    palette: 'Keeps today\'s leather-red room (cloth6) with cream (clothInk) and the lamp amber. No shift.',
    rationale:
      'A capital B whose stem is the bookmark ribbon from today\'s icon, running past the baseline into its swallowtail. It says the name and the act in one shape: B for BetterReads, the ribbon for "this is where I am in the book". It is the closest step from the current Two ribbons (same room, same ribbon, same amber), so the app keeps its face while the mark finally spells the new name. It scales on a strong vertical stem and two round bowls; in the favicon the 3-unit gap between ribbon and bowls closes so the B stays one solid letter at 16 px. Goodreads is a lowercase serif "g" in brown on beige; this is a constructed geometric capital in two tones with a ribbon tail, on oxblood.',
  },
  {
    n: 2,
    slug: '2-rising-shelf',
    name: 'Rising shelf',
    kind: 'Books + upward',
    parts: risingShelf,
    fit: { fav: 27 },
    room: { top: '#2b3b4f', bottom: '#19222e', glow: [80, 12] },
    icon: { main: CREAM, accent: AMBER },
    font: { family: 'geist-sans', weight: 500, style: 'normal', tracking: -0.025 },
    text: 'BetterReads',
    palette: 'Shift: the room moves from leather red to midnight blue (cloth2 #22303f, deepened). Cream and amber stay.',
    rationale:
      'Three books on a shelf, each taller than the last, and the tallest, lit by the lamp, leaning forward off the row as if it were being taken down to read. It goes up, which is the "better" in BetterReads (and the Profile\'s reading in figures), while flat tops, different widths and the shelf keep it a shelf rather than a chart. It is a few solid bars at heart, so it is among the sturdiest at 16 px (the spine bands drop out of the favicon and the books stand on the shelf). It shares nothing with Goodreads\' identity: no letter, no serif, no brown; a cool midnight room with one warm book in it.',
  },
  {
    n: 3,
    slug: '3-read-tick',
    name: 'Read-tick',
    kind: 'Open book that reads as a check',
    parts: readTick,
    room: { top: '#2f4134', bottom: '#1b261e', glow: [86, 14] },
    icon: { main: CREAM, accent: AMBER },
    font: { family: 'newsreader', weight: 500, style: 'normal', tracking: -0.01 },
    text: 'BetterReads',
    palette: 'Shift: a forest-green room (cloth3 #2c3a2e, deepened), cream pages, the cover strip in lamp amber.',
    rationale:
      'An open book seen from the front: the short left page dips into the gutter, the long right page rises out of it, and together they are a tick. Under each page block a strip of the amber cover shows, so up close it is unmistakably a book, from across the room it is a check: Finished, the moment the app is built around (want to read → reading → finished). Green is the colour of done and sits far from Goodreads\' brown; the lettering is Newsreader, the app\'s book-title face, upright. At 16 px the favicon merges the pages and drops the cover strip, leaving a bold tick.',
  },
  {
    n: 4,
    slug: '4-quarter-star',
    name: 'Quarter star',
    kind: 'Rating / reading-progress motif',
    parts: quarterStar,
    room: { top: '#211c18', bottom: '#0e0c0a', glow: [46, 46], glowStrength: 0.3 },
    icon: { main: CREAM, accent: AMBER, track: 'rgb(241 227 200 / 0.36)' },
    font: { family: 'geist-sans', weight: 500, style: 'normal', tracking: -0.025 },
    text: 'BetterReads',
    palette: 'The app\'s own Night room (surface #0e0c0a, surfaceStage) with the lamp amber; the track is starTrack. No shift.',
    rationale:
      'One star in four quarters, three of them lit clockwise from twelve the way a progress ring fills, the last still dim: 3¾ stars, the quarter-star rating BetterReads has and Goodreads does not, and three quarters through a book at the same time. It is the most "product" of the six: the mark is something the app actually shows. On the night room it is the lamp itself, the one warm light the design allows. A star survives any size; at 16 px the cuts widen so the dim quarter still reads. Goodreads uses whole stars and a serif "g"; here the cut star is the identity, in the app\'s near-black and amber. Risk: a star alone says "reviews" or "favourites"; the quarter cut is what makes it ours.',
  },
  {
    n: 5,
    slug: '5-br-monogram',
    name: 'br on the rule',
    kind: 'Wordmark-first monogram',
    parts: brMonogram,
    room: { top: '#f3c57c', bottom: '#e2a14c' },
    icon: { main: INK, accent: INK },
    font: { family: 'newsreader', weight: 600, style: 'italic', tracking: -0.02 },
    text: 'betterreads',
    lockupMark: 'tile',
    fit: { fav: 28 },
    palette: 'Shift: the lamp becomes the room (amber #efb768 → #e2a14c) with ink letters. The lock-up keeps the app\'s lowercase italic wordmark, a weight heavier.',
    rationale:
      'The first two letters of the wordmark, "br" in Newsreader Italic (the face the app already uses for "betterreads"), resting on a short rule: the focused field\'s line, the caret\'s baseline, the line you are on. It is the wordmark compressed into a tile, so icon and lock-up are one family. The amber room makes it the warmest, most visible icon on a home screen. It is the option nearest Goodreads\' territory (a serif lowercase letter), so it leans away on purpose: two letters not one, italic not roman, ink on saturated amber rather than brown on beige, and the rule. The favicon drops the rule so the letters can fill the tile: at 16 px they are still "br", if only just; this is the weakest of the six at that size.',
  },
  {
    n: 6,
    slug: '6-lamp-over-page',
    name: 'Lamp over the page',
    kind: 'Open book + the lamp rising',
    parts: lampPage,
    fit: { fav: 28 },
    room: { top: '#3c3251', bottom: '#211b2e', glow: [50, 46], glowStrength: 0.4 },
    icon: { main: CREAM, accent: AMBER },
    font: { family: 'newsreader', weight: 400, style: 'italic', tracking: -0.02 },
    text: 'BetterReads',
    palette: 'Shift: a dusk-plum room (cloth5 #30293f, lifted), cream pages, the lamp amber with its glow.',
    rationale:
      'An open book with the lamp rising behind it like the sun over a horizon: the design\'s founding image ("a reading lamp in a dark room") made into the mark, and a dawn that says better. It is calm, the way the app is calm, and the one option that is a picture rather than a sign. The half disc and the gull of the pages are simple enough to hold at 16 px (the gaps widen there). Its lettering is the app\'s current wordmark face, Newsreader Italic. Nothing of Goodreads: no letterform in the mark, a plum dusk instead of brown and cream.',
  },
]
