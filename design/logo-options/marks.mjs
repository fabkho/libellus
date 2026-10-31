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

// ------------------------------------------------------------------ 7 · Ribbon in the gutter

function ribbonGutter(variant) {
  // An open book seen from the front, the pages sagging into the gutter, and the ribbon hanging out
  // of the gutter below it. The ribbon's top is a V that follows the pages' lower edges a 2.5-unit
  // gap away, so it seems to come out of the book and stays apart in the monochrome mark.
  const fav = variant === 'fav'
  const pages = 'M48.4 33C40 23 24 21 12 25V61C24 57 40 59 48.4 69Z' + 'M51.6 33C60 23 76 21 88 25V61C76 57 60 59 51.6 69Z'
  const ribbon = fav ? 'M44.5 66.5L50 71L55.5 66.5V94L50 88L44.5 94Z' : 'M46 68.6L50 71.5L54 68.6V94L50 88L46 94Z'
  return [
    { role: 'main', d: pages },
    { role: 'accent', d: ribbon },
  ]
}

// ------------------------------------------------------------------ 8 · Reading glasses

function readingGlasses(variant) {
  // Reading glasses: two round rims and a keyhole bridge, the lamp caught as a glint in one lens.
  const fav = variant === 'fav'
  const R = 19 // rim, outer radius
  const t = fav ? 7.5 : 6 // rim thickness
  const ring = (cx, cy) => {
    const r = R - t
    return (
      `M${cx} ${cy - R}A${R} ${R} 0 1 1 ${cx} ${cy + R}A${R} ${R} 0 1 1 ${cx} ${cy - R}Z` +
      `M${cx} ${f(cy - r)}A${f(r)} ${f(r)} 0 1 0 ${cx} ${f(cy + r)}A${f(r)} ${f(r)} 0 1 0 ${cx} ${f(cy - r)}Z`
    )
  }
  const cy = 56
  // the bridge: an arch from rim to rim over the nose
  const bridge = fav ? `M45 52Q50 41 55 52L53 54.5Q50 47.5 47 54.5Z` : `M45.5 51Q50 41.5 54.5 51L52.6 53Q50 47 47.4 53Z`
  // the temples: short arms leaving each rim at its upper outer edge
  const temples = fav ? '' : 'M14.6 46.5L7 43.5L8 40.5L16.4 43.4Z' + 'M85.4 46.5L93 43.5L92 40.5L83.6 43.4Z'
  const parts = [{ role: 'main', d: ring(30, cy) + ring(70, cy) + bridge + temples }]
  // the glint: a short diagonal pill in the right lens
  const g = fav ? 'M66 45.5L74 45.5L68 57.5L62 57.5Z' : 'M67.6 46L74.4 46L69.2 56L62.4 56Z'
  parts.push({ role: 'accent', d: roundedPolygonFrom(g, 1.4) })
  return parts
}

/** A straight-edged path "Mx yLx y…Z" with its corners rounded. */
function roundedPolygonFrom(d, r) {
  const pts = d
    .replace(/[MZ]/g, '')
    .split('L')
    .map((p) => p.trim().split(/\s+/).map(Number))
  return roundedPolygon(pts, r)
}

// ------------------------------------------------------------------ 9 · Book B

function bookB(variant) {
  // A B built from books: one standing (the stem) and two lying on top of each other beside it,
  // their rounded spines making the bowls; each lying book shows its page block as a curved band.
  const fav = variant === 'fav'
  const x = fav ? 37 : 39 // where the lying books start (a gap from the standing one)
  const stem = roundedPolygon([[20, 10], [37 - (fav ? 0 : 1), 10], [37 - (fav ? 0 : 1), 90], [20, 90]], 2)
  const stemD = stem
  // upper book: y 10–47, its spine a half circle of r 18.5 ending at x 70
  const up = `M${x} 10H51.5A18.5 18.5 0 0 1 51.5 47H${x}Z`
  // lower book: y 50–90 (49.5 in the favicon), r 20, ending at x 76
  const lowTop = fav ? 48.5 : 50
  const lr = (90 - lowTop) / 2
  const low = `M${x} ${lowTop}H56A${lr} ${lr} 0 0 1 56 90H${x}Z`
  // page blocks: a band 2.5 wide, 6 inside each curved spine, running along the straight edges too
  const band = (y0, y1, cx, rOuter) => {
    const o = rOuter - 6
    const i = o - 2.5
    const cy = (y0 + y1) / 2
    return (
      `M${x + 6} ${f(cy - o)}H${cx}A${o} ${o} 0 0 1 ${cx} ${f(cy + o)}H${x + 6}V${f(cy + i)}H${cx}` +
      `A${i} ${i} 0 0 0 ${cx} ${f(cy - i)}H${x + 6}Z`
    )
  }
  return [
    { role: 'main', d: stemD, evenodd: true },
    { role: 'accent', d: up + (fav ? '' : band(10, 47, 51.5, 18.5)), evenodd: true },
    { role: 'main', d: low + (fav ? '' : band(lowTop, 90, 56, lr)), evenodd: true },
  ]
}

// ------------------------------------------------------------------ the options

const CREAM = '#f1e3c8' // clothInk: type on a Placeholder cover
const AMBER = '#efb768' // accent (dark) / highlightLamp

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
  {
    n: 7,
    slug: '7-ribbon-in-the-gutter',
    name: 'Ribbon in the gutter',
    kind: 'Open book + bookmark ribbon',
    parts: ribbonGutter,
    room: { top: '#2b3b4f', bottom: '#19222e', glow: [50, 30] },
    icon: { main: CREAM, accent: AMBER },
    font: { family: 'newsreader', weight: 500, style: 'normal', tracking: -0.01 },
    text: 'BetterReads',
    palette: 'Shift: a midnight-blue room (cloth2 #22303f, deepened), cream pages, the ribbon in lamp amber.',
    rationale:
      'An open book with its ribbon hanging out of the gutter: the oldest sign for "a book I am in the middle of", and the thing BetterReads keeps for you (where you are, how far, since when). It joins the two marks you liked: the ribbon of Bookmark B and the open book of Lamp over the page, and it is the plainest, most immediately legible of the set. The ribbon starts a hair below the gutter, its top a V that follows the pages, so the monochrome mark keeps it apart; at 16 px it is a cream book with an amber strip, which holds. Nothing of Goodreads: no letter, no serif, no brown; a midnight room with one warm strip of colour.',
  },
  {
    n: 8,
    slug: '8-reading-glasses',
    name: 'Reading glasses',
    kind: 'Read better: the glasses you read with',
    parts: readingGlasses,
    fit: { fav: 29.5 },
    room: { top: '#211c18', bottom: '#0e0c0a', glow: [70, 44], glowStrength: 0.32 },
    icon: { main: CREAM, accent: AMBER },
    font: { family: 'newsreader', weight: 500, style: 'italic', tracking: -0.015 },
    text: 'BetterReads',
    palette: 'The app\'s own Night room (surface #0e0c0a, surfaceStage), cream rims (clothInk), the lamp as the glint. No shift.',
    rationale:
      'A pair of reading glasses, the lamp caught as a glint in one lens. It is the name taken literally (read better: see the page more clearly) and the most human of the options, the object that sits on every reader\'s nightstand. It is not a book, which makes it stand out on a home screen full of book apps, and it owns a shape (two rings) that no other reading app uses. Two rings and a bridge survive anything; at 16 px the rims thicken and the temples drop. On the app\'s near-black Night room with the one amber light it is pure "Night Reader". Goodreads has no glasses and no dark ground; the lock-up uses Newsreader Italic, warmer than the app\'s upright titles.',
  },
  {
    n: 9,
    slug: '9-book-b',
    name: 'Book B',
    kind: 'Lettermark built from books',
    parts: bookB,
    room: { top: '#284442', bottom: '#162827', glow: [64, 20] },
    icon: { main: CREAM, accent: AMBER },
    font: { family: 'geist-sans', weight: 600, style: 'normal', tracking: -0.03 },
    text: 'BetterReads',
    palette: 'Shift: a deep petrol room (new, between cloth2 and cloth3), cream books, the top book in lamp amber.',
    rationale:
      'A capital B made of books: one standing upright as the stem, two lying on top of each other beside it, their rounded spines the bowls, each showing its page block as a curved band; the top one, the book you are on, is lit. It is the sibling of Bookmark B (also a B, also geometric) but built from a pile of books instead of a ribbon, so it reads as "BetterReads" and "books" at once, from a little further away. At 16 px the bands drop and it is a solid two-tone B. Goodreads is a lowercase serif "g" in brown; this is a constructed capital in cream and amber on petrol.',
  },
]
