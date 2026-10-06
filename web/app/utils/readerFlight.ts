/**
 * The opening transition (docs/MOTION.md, Push to a book, carried one step
 * further): the cover on the book page flies to where the book's own cover
 * page will be, and hands off to it; Back flies it home. Live elements and
 * Web Animations, like useBookFlight: a copy of the cover in a fixed layer,
 * moved by `transform` and cropped by `clip-path` only (no layout per frame).
 *
 * The copy is laid out at the page's box and drawn at the hero's: a uniform
 * scale to the hero's size plus a crop to its 2:3 (the hero's cover is
 * `object-fit: cover`, the page's is the whole image), so it never stretches.
 */
import type { Box } from '~/utils/flight'

/** The box an image of `ratio` (width / height) takes fitted inside `area` (contain). */
export function fitBox(area: Box, ratio: number): Box {
  const width = Math.min(area.width, area.height * ratio)
  const height = width / ratio
  return { left: area.left + (area.width - width) / 2, top: area.top + (area.height - height) / 2, width, height }
}

/**
 * The pose that draws a copy laid out at `at` over `look` instead, cropped to
 * `look`'s shape with its corner `radius`: translate + uniform scale + inset.
 */
export function poseOf(at: Box, look: Box, radius: number): Keyframe {
  const s = Math.max(look.width / at.width, look.height / at.height)
  const cropX = (at.width - look.width / s) / 2
  const cropY = (at.height - look.height / s) / 2
  const dx = look.left - at.left - s * cropX
  const dy = look.top - at.top - s * cropY
  const r = (n: number) => Math.round(n * 100) / 100
  return {
    transform: `translate(${r(dx)}px, ${r(dy)}px) scale(${r(s * 1e4) / 1e4})`,
    clipPath: `inset(${r(cropY)}px ${r(cropX)}px round ${r(radius / s)}px)`,
  }
}

export const REST: Keyframe = { transform: 'translate(0px, 0px) scale(1)', clipPath: 'inset(0px 0px round 0px)' }

/** A copy of the cover image laid out at `at` in `layer`. */
export function coverCopy(layer: HTMLElement, src: string, at: Box): HTMLElement {
  const box = document.createElement('div')
  Object.assign(box.style, {
    position: 'fixed',
    left: `${at.left}px`,
    top: `${at.top}px`,
    width: `${at.width}px`,
    height: `${at.height}px`,
    transformOrigin: '0 0',
    willChange: 'transform, clip-path, opacity',
    boxShadow: 'var(--elevation-cover)',
  })
  const image = document.createElement('img')
  image.src = src
  image.alt = ''
  image.decoding = 'sync'
  Object.assign(image.style, { width: '100%', height: '100%', objectFit: 'cover', display: 'block' })
  box.append(image)
  layer.append(box)
  return box
}

export function rectOf(element: Element): Box {
  const { left, top, width, height } = element.getBoundingClientRect()
  return { left, top, width, height }
}

/** The natural ratio of an image, once it is decoded. */
export async function ratioOf(src: string): Promise<number> {
  const image = new Image()
  image.src = src
  try {
    await image.decode()
  } catch {
    return 2 / 3
  }
  return image.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : 2 / 3
}
