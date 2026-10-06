import type { AvatarRaster, AvatarType } from '~/data/avatar'
import type { CropRect } from '~/utils/crop'

/**
 * The browser's `AvatarRaster` (data/avatar.ts): the picked picture's square
 * drawn into a canvas and encoded by it. Encoding pixels from a canvas is what
 * strips the photo's EXIF (GPS, camera, time): nothing but the pixels goes in.
 *
 * Scaled down in halves rather than in one draw: Safari ignores
 * `imageSmoothingQuality` and samples a large step down coarsely, so a 3000 px
 * square drawn straight to 512 shimmers. Halving until the next step is the
 * target keeps every step a plain 2:1 average. The canvases of each side are
 * kept for the quality steps of the same side.
 */

/** Never more than 8× the target in one canvas: a 48 MP photo's square stays a few MB of memory. */
const FIRST_STEP_MAX = 8

function canvas(side: number): HTMLCanvasElement {
  const element = document.createElement('canvas')
  element.width = side
  element.height = side
  return element
}

function draw(target: HTMLCanvasElement, source: CanvasImageSource, sx: number, sy: number, size: number) {
  const context = target.getContext('2d')
  if (!context) throw new Error('no canvas')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(source, sx, sy, size, size, 0, 0, target.width, target.height)
}

export function canvasRaster(image: CanvasImageSource, rect: CropRect): AvatarRaster {
  const drawn = new Map<number, HTMLCanvasElement>()

  function at(side: number): HTMLCanvasElement {
    const kept = drawn.get(side)
    if (kept) return kept
    let current = canvas(Math.max(side, Math.min(Math.round(rect.size), side * FIRST_STEP_MAX)))
    // An opaque square: a transparent PNG would turn black as a JPEG.
    const context = current.getContext('2d')
    if (!context) throw new Error('no canvas')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, current.width, current.height)
    draw(current, image, rect.x, rect.y, rect.size)
    while (current.width > side) {
      const next = canvas(Math.max(side, Math.floor(current.width / 2)))
      draw(next, current, 0, 0, current.width)
      current = next
    }
    drawn.set(side, current)
    return current
  }

  return {
    encode(side: number, type: AvatarType, quality: number) {
      const target = at(side)
      return new Promise<Blob>((resolve, reject) =>
        target.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encoding failed'))), type, quality),
      )
    },
  }
}

/** Decodes a picked file into a picture the canvas can draw, upright (the browser applies the EXIF orientation). */
export function loadPicture(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('unreadable image'))
    }
    image.src = url
  })
}
