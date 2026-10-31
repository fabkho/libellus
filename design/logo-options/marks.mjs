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

// ------------------------------------------------------------------ path helpers

/** Maps every coordinate pair of an absolute M/L/C/Q path (no arcs) through `fn`. */
const mapPath = (d, fn) =>
  d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x, y) => {
    const [a, b] = fn(Number(x), Number(y))
    return `${f(a)} ${f(b)}`
  })
const mirrorX = (d) => mapPath(d, (x, y) => [100 - x, y])
/** An ellipse as four cubic curves (so mapPath can move it with the rest). `ccw` reverses it. */
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

// ------------------------------------------------------------------ more path helpers

/** A straight bar from (x1, y1) to (x2, y2), `w` wide, as a polygon. */
function bar(x1, y1, x2, y2, w) {
  const len = Math.hypot(x2 - x1, y2 - y1)
  const nx = (-(y2 - y1) / len) * (w / 2)
  const ny = ((x2 - x1) / len) * (w / 2)
  const P = (x, y) => `${f(x)} ${f(y)}`
  return `M${P(x1 + nx, y1 + ny)}L${P(x2 + nx, y2 + ny)}L${P(x2 - nx, y2 - ny)}L${P(x1 - nx, y1 - ny)}Z`
}

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
