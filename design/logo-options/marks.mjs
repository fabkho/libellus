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

// ------------------------------------------------------------------ helpers for drawn creatures

/** Maps every coordinate pair of an absolute M/L/C/Q path (no arcs) through `fn`. */
const mapPath = (d, fn) =>
  d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x, y) => {
    const [a, b] = fn(Number(x), Number(y))
    return `${f(a)} ${f(b)}`
  })
const mirrorX = (d) => mapPath(d, (x, y) => [100 - x, y])
const rotate = (d, deg, cx = 50, cy = 50) => {
  const a = (deg * Math.PI) / 180
  return mapPath(d, (x, y) => [cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)])
}
/** An ellipse as four cubic curves (so it can be rotated with the rest). `ccw` reverses it. */
function ellipse(cx, cy, rx, ry, ccw = false) {
  const k = 0.5523
  const P = (x, y) => `${f(x)} ${f(y)}`
  if (ccw)
    return (
      `M${P(cx, cy - ry)}C${P(cx - k * rx, cy - ry)} ${P(cx - rx, cy - k * ry)} ${P(cx - rx, cy)}` +
      `C${P(cx - rx, cy + k * ry)} ${P(cx - k * rx, cy + ry)} ${P(cx, cy + ry)}` +
      `C${P(cx + k * rx, cy + ry)} ${P(cx + rx, cy + k * ry)} ${P(cx + rx, cy)}` +
      `C${P(cx + rx, cy - k * ry)} ${P(cx + k * rx, cy - ry)} ${P(cx, cy - ry)}Z`
    )
  return (
    `M${P(cx, cy - ry)}C${P(cx + k * rx, cy - ry)} ${P(cx + rx, cy - k * ry)} ${P(cx + rx, cy)}` +
    `C${P(cx + rx, cy + k * ry)} ${P(cx + k * rx, cy + ry)} ${P(cx, cy + ry)}` +
    `C${P(cx - k * rx, cy + ry)} ${P(cx - rx, cy + k * ry)} ${P(cx - rx, cy)}` +
    `C${P(cx - rx, cy - k * ry)} ${P(cx - k * rx, cy - ry)} ${P(cx, cy - ry)}Z`
  )
}

// ------------------------------------------------------------------ 14 · Luna moth

function lunaMoth(variant) {
  // The moon moth, seen from above: its fore wings are the two pages of an open book (their leading
  // edges the pages' top edges, rising from the gutter), its hind wings run out into long tails that
  // end in a swallowtail cut like a bookmark ribbon, and its body, the spine, is lit amber.
  // Feathery antennae make it a moth rather than a butterfly.
  const fav = variant === 'fav'
  const fore = 'M44 27C36 17.5 21 12 6 13.5C7.5 27 12.5 39 21 46C29.5 49.5 38 48 44 43.5Z'
  const hind =
    'M44 46.5C36 46 25.5 49.5 21.5 57C18.5 63.5 21.5 69.5 27.5 72C29.5 79.5 30 87.5 28 95.5' +
    'L33.4 91.2L37.6 96.2C39.4 87 41.4 77.5 43.6 69.5C45 62 44.6 53.5 44 46.5Z'
  const feeler = 'M48.6 15.2C45.6 10 40.6 5.6 33.6 4.2C36.4 8.8 41.4 13 47.4 16.4Z'
  const main = fore + hind + mirrorX(fore + hind) + (fav ? '' : feeler + mirrorX(feeler))
  const body = ellipse(50, 42, fav ? 4.6 : 3.8, 19.5) + ellipse(50, 17.6, fav ? 4.6 : 4, fav ? 4.6 : 4)
  return [
    { role: 'main', d: main },
    { role: 'accent', d: body },
  ]
}

// ------------------------------------------------------------------ 15 · Firefly

function firefly(variant) {
  // A firefly seen from above, carrying its own reading light: its wing covers are a book's two
  // covers, closed along the spine and just parting at the tail, where the lantern glows amber.
  // Drawn upright, then tilted 18° into flight.
  const fav = variant === 'fav'
  const head = ellipse(50, 17.5, fav ? 5.4 : 4.6, fav ? 4.8 : 4.2)
  const shield = ellipse(50, 30.5, fav ? 11 : 10, fav ? 7.6 : 7)
  const cover = fav
    ? 'M48.8 40.2C44 39.6 38.4 40.8 37.2 46.2C35.6 55.4 37.6 64.6 42.6 71.2C45.6 70.6 47.8 67.8 48.8 63.8Z'
    : 'M48.2 40.2C44 39.6 38.8 40.8 37.8 46C36.4 55 38.2 64 43 70.6C45.4 70.2 47.2 67.6 48.2 63.8Z'
  const feeler = 'M48.4 14.4C46.8 9.6 43 5.6 37.6 3.6L36.8 5.4C41.4 7.4 44.6 10.8 46.2 15.2Z'
  const lantern = ellipse(50, 83.5, fav ? 9 : 8, fav ? 10.5 : 9.5)
  const main = head + shield + cover + mirrorX(cover) + (fav ? '' : feeler + mirrorX(feeler))
  // a little wider than drawn: a stout, friendly beetle rather than a thin one
  const tilt = (d) => rotate(mapPath(d, (x, y) => [50 + (x - 50) * 1.3, y]), 18)
  return [
    { role: 'main', d: tilt(main) },
    { role: 'accent', d: tilt(lantern) },
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
    n: 14,
    slug: '14-luna-moth',
    name: 'Luna moth',
    kind: 'The moon moth: book-page wings, ribbon tails',
    parts: lunaMoth,
    room: { top: '#26344d', bottom: '#111927', glow: [50, -4], glowStrength: 0.34 },
    icon: { main: CREAM, accent: AMBER },
    font: { family: 'newsreader', weight: 500, style: 'italic', tracking: -0.015 },
    text: 'BetterReads',
    palette: 'Shift: a midnight-navy room (cloth2 #22303f, deepened), cream wings, the body in lamp amber; the room\'s light comes from above.',
    rationale:
      'The luna moth, the moon moth, flying toward the light at the top of the icon. Its fore wings are the two pages of an open book, their leading edges rising out of the gutter like a page\'s top edge; its long hind-wing tails end in a swallowtail cut, the bookmark ribbon of Bookmark B; and its body, the book\'s spine, is lit amber. Feathery antennae and the trailing tails make it unmistakably a moth, and a particular one, rather than a generic butterfly. It is a character for a night reader: the creature that cannot leave the lamp alone. At 16 px the antennae drop and the silhouette (wide wings, two long tails) carries it. Nothing of Goodreads: no letter, no brown; cream and amber on midnight.',
  },
  {
    n: 15,
    slug: '15-firefly',
    name: 'Firefly',
    kind: 'A night creature with its own reading light',
    parts: firefly,
    room: { top: '#24352b', bottom: '#101a14', glow: [39.6, 81.9], glowStrength: 0.5 },
    icon: { main: CREAM, accent: AMBER },
    font: { family: 'newsreader', weight: 500, style: 'normal', tracking: -0.01 },
    text: 'BetterReads',
    palette: 'Shift: a summer-night green room (cloth3 #2c3a2e, deepened), a cream firefly, its lantern in lamp amber with a strong glow.',
    rationale:
      'A firefly, carrying its own light: the night reader who brings the lamp along. Seen from above, its two wing covers are a book\'s two covers, closed along the spine and just parting at the tail, where the lantern glows in the design\'s amber, and it flies up and to the right, which is the "better". Where a moth comes to the light, the firefly is the light, so the mark is warm and a little playful while staying calm, and it is a character people remember. It is a simple stack of shapes (head, shield, two covers, a glowing drop), so at 16 px it is still a cream beetle with an amber light at its tail (the antennae drop). Nothing of Goodreads: no letter, no brown; cream and amber in a dark summer night.',
  },
]
