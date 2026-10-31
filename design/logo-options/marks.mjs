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

// ------------------------------------------------------------------ 10 · Lamp B

function lampB(variant) {
  // Bookmark B and Lamp over the page in one: a constructed B whose upper bowl is the lamp, a
  // lit disc, over a cream lower bowl; the stem stands 3 units apart (joined in the favicon).
  const fav = variant === 'fav'
  const x = fav ? 38 : 41 // where the lower bowl starts
  const stem = roundedPolygon([[20, 8], [38, 8], [38, 92], [20, 92]], [2, 2, 2, 2])
  // lower bowl: centre (54, 69.5), r 22.5, 11 thick; its counter opens onto the gap like Bookmark B's
  const bowl = `M${x} 47H54A22.5 22.5 0 0 1 54 92H${x}Z` + `M${x} 58H54A11.5 11.5 0 0 1 54 81H${x}Z`
  // the lamp: as wide as the lower bowl, 3 units above it
  const r = 18
  const cx = 59
  const cy = 26
  const lamp = `M${cx} ${cy - r}A${r} ${r} 0 1 1 ${cx} ${cy + r}A${r} ${r} 0 1 1 ${cx} ${cy - r}Z`
  return [
    { role: 'main', d: stem + bowl, evenodd: true },
    { role: 'accent', d: lamp },
  ]
}

// ------------------------------------------------------------------ 11 · Reading lamp

function readingLamp(variant) {
  // A pendant reading lamp over an open book: cord, bell shade, the bulb glowing under it, and the
  // pages in its light. The lamp of the design's first principle, drawn as a lamp.
  const fav = variant === 'fav'
  const cord = fav ? 'M47.5 2H52.5V26H47.5Z' : 'M48.6 4H51.4V26H48.6Z'
  const shade = 'M17 62C20 40 32 25 50 24C68 25 80 40 83 62Z'
  const bulbR = fav ? 12 : 10.5
  const bulb = `M${50 - bulbR} 65.5A${bulbR} ${bulbR} 0 0 0 ${50 + bulbR} 65.5Z`
  const g = fav ? 2 : 1.6
  const t = fav ? 9 : 7 // page height at the outer edge
  const book = fav
    ? ''
    : `M${f(50 - g)} 84C42 79 28 77.5 14 80.5V${80.5 + t}C28 ${84.5} 42 86 ${f(50 - g)} 91Z` +
      `M${f(50 + g)} 84C58 79 72 77.5 86 80.5V${80.5 + t}C72 ${84.5} 58 86 ${f(50 + g)} 91Z`
  return [
    { role: 'main', d: cord + shade + book },
    { role: 'accent', d: bulb },
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
    n: 10,
    slug: '10-lamp-b',
    name: 'Lamp B',
    kind: 'Lettermark, Bookmark B + the lamp',
    parts: lampB,
    room: { top: '#2a1e1c', bottom: '#120c0b', glow: [59, 26], glowStrength: 0.36 },
    icon: { main: CREAM, accent: AMBER },
    font: { family: 'geist-sans', weight: 600, style: 'normal', tracking: -0.03 },
    text: 'BetterReads',
    palette: 'The app\'s Night room warmed toward today\'s leather (#2a1e1c → #120c0b), cream B, the lamp amber with its glow. A slight shift.',
    rationale:
      'The two options you liked, in one mark: the constructed B of Bookmark B, whose upper bowl has become the lamp of Lamp over the page, a lit disc glowing in a dark room. It says the name (B) and the design\'s founding image (a reading lamp in a dark room) at once, and nothing else; there is no ribbon and no book, so it is the most reduced of the four. The disc keeps its gap at every size, so even at 16 px it is a cream B with an amber light in it (the stem joins the lower bowl there). Goodreads is a brown serif "g" on beige; this is a geometric capital in cream with a warm light, on near-black.',
  },
  {
    n: 11,
    slug: '11-reading-lamp',
    name: 'Reading lamp',
    kind: 'The lamp itself, over an open book',
    parts: readingLamp,
    room: { top: '#3d2633', bottom: '#21141c', glow: [50, 70], glowStrength: 0.42 },
    icon: { main: CREAM, accent: AMBER },
    font: { family: 'newsreader', weight: 500, style: 'normal', tracking: -0.01 },
    text: 'BetterReads',
    palette: 'Shift: a deep wine room (cloth1 #3b2430, deepened), cream shade and pages, the bulb amber with its pool of light.',
    rationale:
      'A pendant reading lamp hanging over an open book, the bulb glowing under its shade and the pages lying in its light. It is the sibling of Lamp over the page: the same idea (one warm light over a book, the app\'s "reading lamp in a dark room"), told as an object instead of a sunrise, so it reads as "reading at night" from across a room. Its silhouette (a bell shade on a cord) is unlike any book app on a home screen. At 16 px the book drops out of the favicon and the shade and the amber bulb remain, which still says "lamp". Nothing of Goodreads: no letter, no serif, no brown and beige; a wine-dark room with one light.',
  },
]
