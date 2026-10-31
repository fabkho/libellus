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

// ------------------------------------------------------------------ 12 · Book left open

function tentedBook(variant) {
  // A book left open face-down, the way you put one down mid-chapter: the cover a chevron, the page
  // blocks a second chevron under it, curling at their ends. Together they point up.
  const fav = variant === 'fav'
  const A = [50, 22] // the spine, at the top
  const u = [-40 / Math.hypot(40, 50), 50 / Math.hypot(40, 50)] // down the left cover
  const n = [u[1], -u[0]] // across it, inward
  const pt = (t, o, side) => {
    const x = A[0] + u[0] * t + n[0] * o
    const y = A[1] + u[1] * t + n[1] * o
    return side < 0 ? [x, y] : [100 - x, y]
  }
  const cover = fav ? 8.5 : 7
  const gap = fav ? 3 : 2.5
  const block = fav ? 15 : 15
  const g = fav ? 1.4 : 1.8 // half the gutter between the page blocks
  // the cover: one chevron, rounded at the spine, its inner apex on the centre line
  const c = [pt(0, 0, -1), pt(64, 0, 1), pt(64, cover, 1), [50, A[1] + cover / n[0]], pt(64, cover, -1), pt(64, 0, -1)]
  const coverD = roundedPolygon(c, [4, 1.5, 1.5, 2, 1.5, 1.5])
  const o1 = cover + gap
  const o2 = o1 + block
  const tAt = (o) => (n[0] * o + g) / -u[0] // where the offset line meets the gutter
  const P = (p) => `${f(p[0])} ${f(p[1])}`
  // a page block: shorter than the cover, its free end a soft curve (the fanned page edges)
  const page = (side) => {
    const p1 = pt(tAt(o1), o1, side)
    const p2 = pt(55, o1, side)
    const p3 = pt(50.5, o2, side)
    const p4 = pt(tAt(o2), o2, side)
    return `M${P(p1)}L${P(p2)}C${P(pt(58.5, o1 + 5, side))} ${P(pt(55.5, o2 - 1, side))} ${P(p3)}L${P(p4)}Z`
  }
  const pagesD = page(-1) + page(1)
  return [
    { role: 'accent', d: coverD },
    { role: 'main', d: pagesD, evenodd: true },
  ]
}

// ------------------------------------------------------------------ 13 · Book moth

function bookMoth(variant) {
  // A night moth seen from above, drawn to the lamp: its fore wings are the two pages of an open
  // book (a page edge runs along each), its body the spine, lit amber.
  const fav = variant === 'fav'
  const mirror = (d) => d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x, y) => `${f(100 - Number(x))} ${y}`)
  const fore = 'M44 41C37 27 24 20 9 23C8 38 13 51 24 57C32 60.5 40 58 44 53.5Z'
  const hind = 'M44 59.5C37 59.5 28 63 24.5 70C21.5 77.5 26 85 33.5 84C40 83 44 75.5 44 67Z'
  const edge = 'M41.8 45.6C35.6 33.2 24.6 27.4 12.2 29.2L12.3 31.9C24 30.4 34.2 35.8 40 47.4Z' // knocked out of the fore wing
  const feeler = 'M48.2 27.5Q45.5 17.5 37.5 12.5L36.4 14.2Q43.2 18.8 46.1 28.1Z'
  const body = fav ? roundedPolygon([[46, 24], [54, 24], [54, 82], [46, 82]], 4) : roundedPolygon([[46.6, 27], [53.4, 27], [53.4, 81], [46.6, 81]], 3.4)
  const wings = fav ? fore + hind + mirror(fore) + mirror(hind) : fore + edge + hind + mirror(fore + edge) + mirror(hind)
  const parts = [{ role: 'main', d: wings + (fav ? '' : feeler + mirror(feeler)), evenodd: !fav }]
  parts.push({ role: 'accent', d: body })
  return parts
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
    n: 12,
    slug: '12-book-left-open',
    name: 'Book left open',
    kind: 'A book put down mid-chapter, pointing up',
    parts: tentedBook,
    fit: { ios: 70, adaptive: 33 },
    room: { top: '#36385f', bottom: '#1c1d37', glow: [50, 18] },
    icon: { main: CREAM, accent: AMBER },
    font: { family: 'geist-sans', weight: 500, style: 'normal', tracking: -0.025 },
    text: 'BetterReads',
    palette: 'Shift: a twilight-indigo room (new, a bluer sister of cloth5), the cover in lamp amber, the pages cream.',
    rationale:
      'A book left open face-down on the table, the way everyone puts a book down in the middle of a chapter: the amber cover a chevron, the cream page blocks a second chevron under it, curling at their ends. It is the universal sign for "I am reading this", the state BetterReads is built around, and its shape points up, which is the "better". It is calm and domestic rather than clever, and unlike any letter or app icon. Two nested chevrons are as robust as marks get: at 16 px it is an amber caret over a cream one. Goodreads is a serif "g" in brown on beige; this is a pictogram in amber and cream on twilight indigo.',
  },
  {
    n: 13,
    slug: '13-book-moth',
    name: 'Book moth',
    kind: 'A night moth, its wings an open book',
    parts: bookMoth,
    room: { top: '#2b3d31', bottom: '#16211a', glow: [50, 2], glowStrength: 0.34 },
    icon: { main: CREAM, accent: AMBER },
    font: { family: 'newsreader', weight: 500, style: 'normal', tracking: -0.01 },
    text: 'BetterReads',
    palette: 'Shift: a night-garden green room (cloth3 #2c3a2e, deepened), cream wings, the body in lamp amber; the room\'s light comes from above, where the lamp is.',
    rationale:
      'A moth seen from above, flying toward the light at the top of the icon: its fore wings are the two pages of an open book, each with a page edge running along it, its body the spine, lit amber. A moth is the night creature that cannot leave the lamp alone, which is what a good book does to its reader late at night; it carries the design\'s "reading lamp in a dark room" without drawing the lamp, and it gives BetterReads a character rather than a symbol, something friends can recognise and remember. Four wings and a bar hold at 16 px (the feelers and page edges drop). Nothing of Goodreads: no letter, no brown; a cream moth in a dark green night.',
  },
]
