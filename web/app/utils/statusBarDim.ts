/**
 * The status bar under a sheet's scrim (docs/parity.md, Sheets; issue A6).
 *
 * In the installed app on Android (`display: standalone`) the system draws the
 * status bar outside the web viewport and colours it from the `theme-color`
 * tags. A scrim is a translucent layer *inside* the viewport and cannot paint
 * into that bar, so with a sheet open the page dims and the bar does not. While
 * a layer (sheet, confirmation) is open the bar takes the colour it would have
 * if the scrim reached it: the scrim laid over the colour the tag has now, once
 * per open layer (a confirmation over a sheet dims twice, as the page does).
 * Closing the last layer gives every tag back what it had.
 *
 * Framework-free so Vitest pins it in plain Node. The tags are read and written
 * directly, as the reader's room does (Reader.vue, takeOverTheme): the head
 * manager rewrites a tag only when its own value changes, which cannot happen
 * under an open sheet (the page is inert), and a tag someone else repainted in
 * the meantime is left as it is on release.
 */

export type DimTag = { getAttribute: (name: string) => string | null; setAttribute: (name: string, value: string) => void }

/** The slice of Document the dimmer touches; `document` fits. */
export type DimDocument = {
  querySelectorAll: (selector: string) => ArrayLike<DimTag>
}

type Rgba = { r: number; g: number; b: number; a: number }

const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value))

/** `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()` in both the comma and the space syntax, `/ alpha` or `%` included. Null for anything else. */
export function parseColor(input: string): Rgba | null {
  const text = input.trim().toLowerCase()
  // Four digits as well as three, and eight as well as six: the minifier writes `rgb(26 20 14 / 0.38)`
  // as `#1a140e61` (Lightning CSS, a production build), and a scrim read as no colour at all means no
  // dim at all — the tags then keep their own colour and the status bar stays bright under a sheet.
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text)
  if (hex) {
    // A short form is one digit a channel, alpha included; doubling each digit is what makes it rgba.
    const digits = hex[1]!.length <= 4 ? [...hex[1]!].map((d) => d + d).join('') : hex[1]!
    const n = parseInt(digits, 16)
    return digits.length === 8
      ? { r: (n >>> 24) & 255, g: (n >>> 16) & 255, b: (n >>> 8) & 255, a: (n & 255) / 255 }
      : { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 }
  }
  const fn = /^rgba?\(\s*([^)]*?)\s*\)$/.exec(text)
  if (!fn) return null
  const parts = fn[1]!.split(/\s*[,/]\s*|\s+/).filter(Boolean)
  if (parts.length !== 3 && parts.length !== 4) return null
  const channel = (part: string) => (part.endsWith('%') ? (parseFloat(part) / 100) * 255 : parseFloat(part))
  const [r, g, b] = parts.slice(0, 3).map(channel) as [number, number, number]
  const a = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])
  if ([r, g, b, a].some(Number.isNaN)) return null
  return { r: clamp(r, 255), g: clamp(g, 255), b: clamp(b, 255), a: clamp(a, 1) }
}

const toHex = (c: Rgba) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

/** `scrim` laid over `base`, as `#rrggbb`; null when either is not a colour or the base is not opaque. */
export function blendOver(scrim: string, base: string): string | null {
  const top = parseColor(scrim)
  const under = parseColor(base)
  if (!top || !under || under.a !== 1) return null
  const mix = (t: number, u: number) => t * top.a + u * (1 - top.a)
  return toHex({ r: mix(top.r, under.r), g: mix(top.g, under.g), b: mix(top.b, under.b), a: 1 })
}

type Held = { tag: DimTag; before: string; showing: string }

/**
 * `scrim` answers the scrim colour at the time a layer opens (the token resolves
 * per theme, so it is read each time). `acquire` returns the layer's release,
 * which is safe to call more than once.
 */
export function createStatusBarDim(doc: DimDocument, scrim: () => string) {
  let held: Held[] = []
  let depth = 0

  function paint() {
    for (const entry of held) {
      let colour: string | null = entry.before
      for (let i = 0; i < depth && colour; i++) colour = blendOver(scrim(), colour)
      if (!colour) continue
      entry.tag.setAttribute('content', colour)
      entry.showing = colour
    }
  }

  function restore() {
    for (const { tag, before, showing } of held) {
      if (tag.getAttribute('content') === showing) tag.setAttribute('content', before)
    }
    held = []
  }

  return {
    /** How many layers hold the bar dimmed. */
    get depth() {
      return depth
    },
    acquire(): () => void {
      depth += 1
      if (depth === 1) {
        const tags = doc.querySelectorAll('meta[name="theme-color"]')
        for (let i = 0; i < tags.length; i++) {
          const tag = tags[i]!
          const before = tag.getAttribute('content')
          if (before) held.push({ tag, before, showing: before })
        }
      }
      paint()
      let released = false
      return () => {
        if (released) return
        released = true
        depth -= 1
        if (depth === 0) restore()
        else paint()
      }
    },
  }
}

let shared: ReturnType<typeof createStatusBarDim> | null = null

/** The page's own dimmer: the real `<head>` tags, and the scrim token as the root resolves it. */
export function dimStatusBar(): () => void {
  shared ??= createStatusBarDim(document, () => getComputedStyle(document.documentElement).getPropertyValue('--color-scrim'))
  return shared.acquire()
}
