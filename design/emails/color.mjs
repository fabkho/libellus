// Colour maths for the email shell: tokens.json holds some colours as `rgb(r g b / a)`, which
// mail clients draw badly (Outlook's Word engine ignores alpha), so the shell flattens each one
// onto the surface it is drawn on and writes a plain `#rrggbb`.

/** `#rrggbb` or `rgb(r g b / a)` → [r, g, b, a], r, g, b in 0–255. Same grammar as build.mjs. */
export function parseColor(value) {
  const hex = /^#([0-9a-f]{6})$/i.exec(value)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1]
  }
  const rgb = /^rgb\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+))?\s*\)$/.exec(value)
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])]
  throw new Error(`Unsupported colour "${value}": use #rrggbb or rgb(r g b / a).`)
}

const toHex = ([r, g, b]) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

/** `value` drawn over the opaque colour `under`, as `#rrggbb`. */
export function flatten(value, under) {
  const [r, g, b, a] = parseColor(value)
  const [ur, ug, ub] = parseColor(under)
  return toHex([r * a + ur * (1 - a), g * a + ug * (1 - a), b * a + ub * (1 - a)])
}

const channel = (v) => {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const luminance = (hex) => {
  const [r, g, b] = parseColor(hex)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG contrast ratio of two opaque colours. */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
