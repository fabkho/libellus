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

// ------------------------------------------------------------------ 18 · Locked diary

function lockedDiary(variant) {
  // A book's cover with a keyhole cut through it, the keyhole's stem a bookmark ribbon with its
  // swallowtail, and the lamp's light showing through: what is inside is yours.
  const fav = variant === 'fav'
  const cover = roundedPolygon([[24, 10], [80, 10], [80, 90], [24, 90]], [3, 7, 7, 3])
  const spine = fav ? '' : 'M31 10H33.6V90H31Z' // the hinge line along the spine, knocked out
  // the keyhole, cut out: a round head (centre (54, 39), r 13.5) on a ribbon 15 wide with a swallowtail
  const keyhole = (k) => {
    const r = 13.5 - k
    const half = 7.5 - k
    const bottom = 78 - k
    const notch = 70.5 - k * 0.3
    const yJoin = 39 + Math.sqrt(r * r - half * half)
    return (
      `M${f(54 - half)} ${f(yJoin)}A${f(r)} ${f(r)} 0 1 1 ${f(54 + half)} ${f(yJoin)}` +
      `L${f(54 + half)} ${f(bottom)}L54 ${f(notch)}L${f(54 - half)} ${f(bottom)}Z`
    )
  }
  const g = fav ? 0 : 2.4 // the gap between the cut and the light inside it
  const parts = [{ role: 'main', d: cover + spine + keyhole(0), evenodd: true }]
  parts.push({ role: 'accent', d: keyhole(g) })
  return parts
}

// ------------------------------------------------------------------ 19 · Paper boat

function paperBoat(variant) {
  // A page folded into a paper boat: a printed hull (two lines of text knocked out), the folded
  // corners at its ends, and the middle fold standing up as an amber sail, lit by the lamp.
  const fav = variant === 'fav'
  const hull = roundedPolygon([[10, 58], [90, 58], [74, 80], [26, 80]], [1.5, 1.5, 3, 3])
  const lines = fav ? '' : 'M24 64.6H76V67H24Z' + 'M29 71.2H64V73.6H29Z'
  const flapL = roundedPolygon([[13, 54.5], [25.5, 38], [31, 54.5]], [1, 1.5, 1])
  const flapR = roundedPolygon([[87, 54.5], [74.5, 38], [69, 54.5]], [1, 1.5, 1])
  const sail = roundedPolygon([[50, 14], [67.5, 54.5], [32.5, 54.5]], [2, 1.2, 1.2])
  const water = fav ? '' : 'M14 88.6C24 85.4 34 85.4 44 88.6C54 91.8 64 91.8 74 88.6L86 86.4V89.2C76 91.4 64 95.2 54 92.2C44 89.2 34 88.4 24 91.2L14 91.2Z'
  return [
    { role: 'main', d: hull + lines + flapL + flapR + water, evenodd: true },
    { role: 'accent', d: sail },
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
    n: 18,
    slug: '18-locked-diary',
    name: 'Locked diary',
    kind: 'A keyhole through the cover, a ribbon for its stem',
    parts: lockedDiary,
    room: { top: '#4a2338', bottom: '#28121f', glow: [54, 44], glowStrength: 0.3 },
    icon: { main: CREAM, accent: AMBER },
    font: { family: 'newsreader', weight: 500, style: 'normal', tracking: -0.01 },
    text: 'BetterReads',
    palette: 'Shift: a deep-mulberry room (new, warmer than cloth1), a cream cover, the light through the keyhole in lamp amber.',
    rationale:
      'A book\'s cover with a keyhole cut through it, and the lamp\'s light showing through from inside. The keyhole\'s stem is the bookmark ribbon of Bookmark B, swallowtail and all, so a keyhole and a bookmark are the same shape. It says two true things about BetterReads at once: a book is a door into somewhere lit, and your reading here is yours (invite-only, private by default, no ads, no trackers), like a diary with a lock. It is a single bold shape with one warm opening, so it holds at 16 px (the hinge line drops and the light fills the keyhole). Nothing of Goodreads: no letter, no brown; cream and amber on mulberry.',
  },
  {
    n: 19,
    slug: '19-paper-boat',
    name: 'Paper boat',
    kind: 'A page folded into a boat, setting off',
    parts: paperBoat,
    room: { top: '#1e3a4c', bottom: '#0e1d28', glow: [80, 10], glowStrength: 0.26 },
    icon: { main: CREAM, accent: AMBER },
    font: { family: 'geist-sans', weight: 500, style: 'normal', tracking: -0.025 },
    text: 'BetterReads',
    palette: 'Shift: a night-sea blue room (new, cloth2 toward teal), a cream boat with its printed lines, the sail in lamp amber.',
    rationale:
      'A page torn from a book and folded into a paper boat, two lines of print still on its hull, its middle fold standing up as an amber sail, setting off over a little wave. Every book is a voyage (want to read, reading, finished), and the boat is made of the book itself. It is playful in the way a paper boat is, childhood and calm at once, and it sits far from every other reading app (books, stars, letters) and from Goodreads (no letter, no brown). The silhouette (a hull and three triangles) is clear at 16 px, where the print and the wave drop.',
  },
]
