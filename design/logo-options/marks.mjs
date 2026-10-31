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

// ------------------------------------------------------------------ 25 · Night window

function nightWindow(variant) {
  // A window lit at night, four amber panes in a cream frame on a sill, and books on the inner sill
  // standing as silhouettes against the light: someone is up reading.
  const fav = variant === 'fav'
  const frame = roundedPolygon([[20, 10], [80, 10], [80, 82], [20, 82]], 4)
  const inner = (x0, y0, x1, y1, r = 1.2) => roundedPolygon([[x0, y0], [x0, y1], [x1, y1], [x1, y0]], r) // counter-clockwise: a hole
  const t = fav ? 6.5 : 5 // frame
  const m = fav ? 5 : 3.6 // mullions
  const xL = 20 + t
  const xR = 80 - t
  const yT = 10 + t
  const yB = 82 - t
  const xm = 50
  const ym = 44
  const g = fav ? 0 : 2.2 // the dark gap between frame and glass
  const holes = inner(xL, yT, xm - m / 2, ym - m / 2) + inner(xm + m / 2, yT, xR, ym - m / 2) + inner(xL, ym + m / 2, xm - m / 2, yB) + inner(xm + m / 2, ym + m / 2, xR, yB)
  const sill = roundedPolygon([[13, 85.5], [87, 85.5], [87, 91.5], [13, 91.5]], 1.5)
  const pane = (x0, y0, x1, y1) => roundedPolygon([[x0 + g, y0 + g], [x1 - g, y0 + g], [x1 - g, y1 - g], [x0 + g, y1 - g]], 1)
  let glass = pane(xL, yT, xm - m / 2, ym - m / 2) + pane(xm + m / 2, yT, xR, ym - m / 2) + pane(xm + m / 2, ym + m / 2, xR, yB)
  // the lower-left pane, with three books standing on the inner sill cut out of the light
  const bl = [xL + g, ym + m / 2 + g, xm - m / 2 - g, yB - g]
  glass += roundedPolygon([[bl[0], bl[1]], [bl[2], bl[1]], [bl[2], bl[3]], [bl[0], bl[3]]], 1)
  if (!fav) {
    const foot = bl[3]
    glass += inner(29, foot - 15, 33.4, foot) + inner(34.8, foot - 12, 39.6, foot)
    // a third book leaning against the second
    glass += roundedPolygon([[41, foot], [44.6, foot], [48.6 - g, foot - 11.6], [45.4 - g, foot - 13]], 0.6).replace(/^M/, 'M')
  }
  return [
    { role: 'main', d: frame + holes + sill },
    { role: 'accent', d: glass, evenodd: true },
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
    n: 6,
    status: 'chosen',
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
    n: 1,
    status: 'backlog',
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
    n: 25,
    status: 'backlog',
    slug: '25-night-window',
    name: 'Night window',
    kind: 'A lit window, books on the sill',
    parts: nightWindow,
    room: { top: '#1d3536', bottom: '#0e1a1b', glow: [50, 46], glowStrength: 0.32 },
    icon: { main: CREAM, accent: AMBER },
    font: { family: 'newsreader', weight: 500, style: 'normal', tracking: -0.01 },
    text: 'BetterReads',
    palette: 'Shift: a deep ink-teal night (new), a cream window frame and sill, the panes in lamp amber with the books as silhouettes.',
    rationale:
      'A window lit at night, seen from outside: four warm panes in a cream frame, and on the inner sill three books standing as silhouettes against the light. Someone is up reading. It is the design\'s first principle (a reading lamp in a dark room) seen from the street, and it is calm, warm and a little nostalgic, like the app. The window is a strong, simple grid, so at 16 px it is four amber panes in a frame (the books drop). Nothing of Goodreads: no letter, no brown; a lit window in a teal night.',
  },
]
