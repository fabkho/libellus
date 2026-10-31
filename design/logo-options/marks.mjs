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

// ------------------------------------------------------------------ helpers for round 8

/** A straight bar from (x1, y1) to (x2, y2), `w` wide, as a polygon. */
function bar(x1, y1, x2, y2, w) {
  const len = Math.hypot(x2 - x1, y2 - y1)
  const nx = (-(y2 - y1) / len) * (w / 2)
  const ny = ((x2 - x1) / len) * (w / 2)
  const P = (x, y) => `${f(x)} ${f(y)}`
  return `M${P(x1 + nx, y1 + ny)}L${P(x2 + nx, y2 + ny)}L${P(x2 - nx, y2 - ny)}L${P(x1 - nx, y1 - ny)}Z`
}
const circle = (cx, cy, r) => ellipse(cx, cy, r, r)

// ------------------------------------------------------------------ 20 · Page kite

function pageKite(variant) {
  // A page flown as a kite: four panels around the spars (two cream, two lit amber), two printed
  // lines on one of them, and a tail tied with bookmark-ribbon bows.
  const fav = variant === 'fav'
  const g = fav ? 0.9 : 1.3 // half a spar
  const tl = roundedPolygon([[56 - g, 10.5], [56 - g, 32 - g], [32.5, 32 - g]], 1)
  const tr = roundedPolygon([[56 + g, 10.5], [79.5, 32 - g], [56 + g, 32 - g]], 1)
  const bl = roundedPolygon([[56 - g, 32 + g], [56 - g, 66], [32.5, 32 + g]], 1)
  const br = roundedPolygon([[56 + g, 32 + g], [79.5, 32 + g], [56 + g, 66]], 1)
  const print = fav ? '' : 'M59.6 39.2H73V41.6H59.6Z' + 'M59.6 45.4H68.6V47.8H59.6Z'
  const tail = fav ? '' : 'M55 68.6C50.6 77.6 44.6 80.6 40.4 86.4C37.4 90.4 33.6 92.6 28.8 96.4L30.6 98C35.4 94.2 39.2 92 42.4 87.8C46.6 82 52.6 79 57 69.4Z'
  const bow = (x, y) => roundedPolygon([[x - 5, y - 3.6], [x, y], [x - 5, y + 3.6]], 0.8) + roundedPolygon([[x + 5, y - 3.6], [x, y], [x + 5, y + 3.6]], 0.8)
  const parts = [
    { role: 'main', d: tl + br + print + tail, evenodd: true },
    { role: 'accent', d: tr + bl },
  ]
  if (!fav) parts.push({ role: 'accent', d: bow(47.6, 79.4) + bow(36.4, 90.2) })
  return parts
}

// ------------------------------------------------------------------ 21 · Balloon

function balloon(variant) {
  // A hot-air balloon lit like the lamp (amber, rising: "better"), carrying a book as its basket.
  const fav = variant === 'fav'
  const env = 'M50 8C66.6 8 78 20.4 78 36C78 51.6 65.4 59.6 59 69H41C34.6 59.6 22 51.6 22 36C22 20.4 33.4 8 50 8Z'
  const gore = 'M45.4 9.4C38.6 22.4 38.6 47.4 44.6 68.6L47 68.6C41.4 47.4 41.4 22.4 47.8 9.2Z'
  const ropes = fav ? bar(43.6, 71, 44.6, 80, 3) + bar(56.4, 71, 55.4, 80, 3) : bar(43.2, 71.2, 44.2, 80.2, 1.8) + bar(56.8, 71.2, 55.8, 80.2, 1.8)
  const book = roundedPolygon([[38.5, 82], [61.5, 82], [61.5, 94], [38.5, 94]], [1.5, 2.5, 2.5, 1.5])
  const pages = fav ? '' : 'M56.4 84.4H58.6V91.6H56.4Z' // the fore-edge line, knocked out
  return [
    { role: 'accent', d: env + (fav ? '' : gore + mirrorX(gore)), evenodd: true },
    { role: 'main', d: ropes + book + pages, evenodd: true },
  ]
}

// ------------------------------------------------------------------ 22 · Lighthouse

function lighthouse(variant) {
  // A lighthouse built of three stacked books, its lantern the lamp, sending two beams out:
  // the friends' reads that guide you to your next one.
  const fav = variant === 'fav'
  const g = fav ? 1.6 : 2.2
  const at = (y) => 11.5 + (y - 47) * 0.17 // half the tower's width at height y (wider at the foot)
  const book = (y0, y1) => roundedPolygon([[50 - at(y0), y0], [50 + at(y0), y0], [50 + at(y1), y1], [50 - at(y1), y1]], 1.2)
  const tower = book(47, 61 - g / 2) + book(61 + g / 2, 75 - g / 2) + book(75 + g / 2, 90)
  const deck = roundedPolygon([[35, 40.5], [65, 40.5], [65, 44.5], [35, 44.5]], 1)
  const roof = roundedPolygon([[38.5, 22.5], [50, 12], [61.5, 22.5]], [1, 2, 1])
  const lantern = roundedPolygon([[42, 25.5], [58, 25.5], [58, 37.5], [42, 37.5]], 1.2)
  const beams = fav ? '' : roundedPolygon([[38.5, 31.5], [7, 22], [7, 41]], [1, 0.5, 0.5]) + roundedPolygon([[61.5, 31.5], [93, 22], [93, 41]], [1, 0.5, 0.5])
  return [
    { role: 'main', d: tower + deck + roof },
    { role: 'accent', d: lantern + beams },
  ]
}

// ------------------------------------------------------------------ 23 · Wax seal

function waxSeal(variant) {
  // A seal of amber wax pressed with a bookmark ribbon: an invitation, sealed. The ring and the
  // ribbon are pressed into the wax (knocked out), so the seal is one shape.
  const fav = variant === 'fav'
  const pts = []
  const lobes = 13
  for (let i = 0; i < lobes * 2; i++) {
    const a = (i / (lobes * 2)) * Math.PI * 2 - Math.PI / 2
    const r = i % 2 === 0 ? 41 : 37.6
    pts.push([50 + r * Math.cos(a), 50 + r * Math.sin(a)])
  }
  const blob = roundedPolygon(pts, 4.2)
  const ring = fav ? '' : circle(50, 50, 30.5) + ellipse(50, 50, 28, 28, true)
  const w = fav ? 9 : 7.5
  const ribbon = roundedPolygon([[50 - w, fav ? 27 : 30], [50 + w, fav ? 27 : 30], [50 + w, fav ? 74 : 70], [50, fav ? 65.5 : 63], [50 - w, fav ? 74 : 70]], [1.2, 1.2, 0.6, 0.4, 0.6])
  return [{ role: 'accent', d: blob + ring + ribbon, evenodd: true }]
}

// ------------------------------------------------------------------ 24 · Constellation

function constellation(variant) {
  // Stars joined into the outline of an open book, one of them lit amber: your reading as a map
  // of the night sky, the people you follow its other stars.
  const fav = variant === 'fav'
  const P = { lo: [10, 38], lm: [30, 31], gt: [50, 42], rm: [70, 31], ro: [90, 38], rb: [90, 62], gb: [50, 69], lb: [10, 62] }
  const w = fav ? 4.6 : 2.6
  const r = fav ? 5.2 : 3.6
  const lines = [['lo', 'lm'], ['lm', 'gt'], ['gt', 'rm'], ['rm', 'ro'], ['ro', 'rb'], ['rb', 'gb'], ['gb', 'lb'], ['lb', 'lo'], ['gt', 'gb']]
  const lit = 'gt'
  const gap = fav ? 8.5 : 9 // the lines stop short of the lit star
  let d = ''
  for (const [a, b] of lines) {
    let [x1, y1] = P[a]
    let [x2, y2] = P[b]
    const len = Math.hypot(x2 - x1, y2 - y1)
    if (a === lit) { x1 += ((x2 - x1) / len) * gap; y1 += ((y2 - y1) / len) * gap }
    if (b === lit) { x2 -= ((x2 - x1) / len) * gap; y2 -= ((y2 - y1) / len) * gap }
    d += bar(x1, y1, x2, y2, w)
  }
  for (const k of Object.keys(P)) if (k !== lit) d += circle(P[k][0], P[k][1], r)
  if (!fav) d += circle(24, 14, 2) + circle(80, 12, 1.6) + circle(62, 88, 1.8) + circle(20, 84, 1.4)
  // the lit star: a small five-pointed star
  const star = []
  for (let i = 0; i < 10; i++) {
    const a = (-90 + i * 36) * (Math.PI / 180)
    const rr = i % 2 === 0 ? (fav ? 8.5 : 7.8) : fav ? 4 : 3.4
    star.push([P[lit][0] + rr * Math.cos(a), P[lit][1] + rr * Math.sin(a)])
  }
  return [
    { role: 'main', d },
    { role: 'accent', d: roundedPolygon(star, star.map((_, i) => (i % 2 === 0 ? 1 : 0.6))) },
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
  {
    n: 20,
    slug: '20-page-kite',
    name: 'Page kite',
    kind: 'A printed page flown as a kite',
    parts: pageKite,
    room: { top: '#2b4a5c', bottom: '#132530', glow: [70, 18], glowStrength: 0.24 },
    icon: { main: CREAM, accent: AMBER },
    font: { family: 'geist-sans', weight: 500, style: 'normal', tracking: -0.025 },
    text: 'BetterReads',
    palette: 'Shift: a dusk-sky blue room (new), the kite in cream and lamp amber, its tail tied with amber ribbon bows.',
    rationale:
      'A page flown as a kite: four panels around the spars, two lit amber, two cream (one still carrying two lines of print), and a tail tied with little bookmark-ribbon bows. It is the paper boat\'s cousin (a page made into a toy that goes somewhere) but its direction is up, which is the "better", and a kite is lifted by the wind the way a good book lifts you. Light and joyful, and unlike any reading app. At 16 px it is a two-tone diamond (the print, tail and bows drop). Nothing of Goodreads: no letter, no brown; cream and amber in a dusk sky.',
  },
  {
    n: 21,
    slug: '21-balloon',
    name: 'Balloon',
    kind: 'A lit balloon rising, a book for its basket',
    parts: balloon,
    room: { top: '#4a2f4f', bottom: '#22152a', glow: [50, 36], glowStrength: 0.32 },
    icon: { main: CREAM, accent: AMBER },
    font: { family: 'newsreader', weight: 500, style: 'italic', tracking: -0.015 },
    text: 'BetterReads',
    palette: 'Shift: a twilight rose-violet room (new, between cloth1 and cloth5), the balloon in lamp amber, the book and ropes cream.',
    rationale:
      'A hot-air balloon lit from inside like the lamp, rising, with a book for its basket: a book takes you up and away, and rising is the "better" in BetterReads. The envelope is the design\'s one warm light, glowing in a twilight room, which keeps it calm rather than festive. The silhouette (a big amber drop over a small cream block) is about as legible as marks get: at 16 px it is still a balloon (the gores and the fore-edge line drop, the ropes thicken). Nothing of Goodreads: no letter, no brown; amber and cream at twilight.',
  },
  {
    n: 22,
    slug: '22-lighthouse',
    name: 'Lighthouse',
    kind: 'A tower of books, the lamp its light',
    parts: lighthouse,
    room: { top: '#2c3646', bottom: '#12171f', glow: [50, 31], glowStrength: 0.36 },
    icon: { main: CREAM, accent: AMBER },
    font: { family: 'geist-sans', weight: 600, style: 'normal', tracking: -0.03 },
    text: 'BetterReads',
    palette: 'Shift: a deep slate night (new), a cream tower, the lantern and its beams in lamp amber.',
    rationale:
      'A lighthouse whose tower is three books stacked on top of each other and whose lantern is the lamp, sending two beams out into the night. It is what the friends you follow are on BetterReads: a light that guides you to your next good book, without ads or algorithms. The design\'s "reading lamp in a dark room" becomes a lamp for others. Sturdy and clear: at 16 px it is a cream tower with an amber light at the top (the beams drop). Nothing of Goodreads: no letter, no brown; cream and amber on a slate night.',
  },
  {
    n: 23,
    slug: '23-wax-seal',
    name: 'Wax seal',
    kind: 'An invitation, sealed with a ribbon',
    parts: waxSeal,
    room: { top: '#27392d', bottom: '#111b14', glow: [50, 46], glowStrength: 0.26 },
    icon: { main: CREAM, accent: AMBER },
    font: { family: 'newsreader', weight: 500, style: 'normal', tracking: -0.01 },
    text: 'BetterReads',
    palette: 'Shift: a deep green room (cloth3, deepened), the seal in lamp amber with the ring and the ribbon pressed into it.',
    rationale:
      'A seal of amber wax pressed with a bookmark ribbon, the way an invitation or a letter between friends is sealed. BetterReads is invite-only, private by default and shared only with the people you let in; the seal says all three, and its ribbon is the bookmark of Bookmark B pressed into wax. It is one shape (the ring and the ribbon are impressions), so the monochrome mark is the icon itself, and at 16 px it is an amber disc with a ribbon in it (the ring drops). Nothing of Goodreads: no letter, no brown; amber wax on deep green.',
  },
  {
    n: 24,
    slug: '24-constellation',
    name: 'Constellation',
    kind: 'Stars joined into an open book, one lit',
    parts: constellation,
    room: { top: '#1f2449', bottom: '#0c0e21', glow: [50, 42], glowStrength: 0.3 },
    icon: { main: CREAM, accent: AMBER },
    font: { family: 'newsreader', weight: 400, style: 'italic', tracking: -0.02 },
    text: 'BetterReads',
    palette: 'Shift: a midnight-indigo sky (new), cream stars and lines, the lit star in lamp amber.',
    rationale:
      'Stars joined into the outline of an open book, the way old constellations draw pictures into the sky; the star at the top of the gutter is lit amber. Your reading as a map you draw over the years, and the people you follow as its other stars: connected, at a distance, by choice. It is the quietest and most poetic of the set and fits the Night Reader room. Lines and dots are the risk at small sizes, so the favicon thickens them to a bold open-book outline with an amber star. Nothing of Goodreads: no letter, no brown; a night sky.',
  },
  {
    n: 25,
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
