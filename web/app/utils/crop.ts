/**
 * The geometry of the photo's crop (issue #156): pure, so Vitest checks it
 * (`tests/avatar.test.ts`) and a native port copies it line by line. The
 * pointer handling on top of it is `composables/useCrop.ts`.
 *
 * The model: a square viewport of `viewport` CSS pixels. The picture is drawn
 * at `coverScale × zoom`, so at zoom 1 its short side exactly fills the square.
 * `x`/`y` are where the picture's top-left corner sits relative to the
 * viewport's; the picture always covers the whole square, so both are ≤ 0.
 * (After Trappist's photo step, the owner's other app.)
 */

export type Size = { width: number; height: number }
export type CropState = { zoom: number; x: number; y: number }
/** A square of the original picture, in its own pixels. */
export type CropRect = { x: number; y: number; size: number }
export type Point = { x: number; y: number }

/** How far in a member may zoom: four times the cover size. */
export const MAX_ZOOM = 4
/** One step of the zoom buttons and the keyboard's + and −. */
export const ZOOM_STEP = 0.25
/** How far the arrow keys move the picture, in CSS pixels. */
export const PAN_STEP = 16

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** The scale at which the picture's short side fills the square. */
export function coverScale(image: Size, viewport: number): number {
  return viewport / Math.min(image.width, image.height)
}

export function clampZoom(zoom: number): number {
  return clamp(Number.isFinite(zoom) ? zoom : 1, 1, MAX_ZOOM)
}

/** Moves the picture back so it covers the square again; the zoom is clamped too. */
export function clampPan(state: CropState, image: Size, viewport: number): CropState {
  const zoom = clampZoom(state.zoom)
  const scale = coverScale(image, viewport) * zoom
  return {
    zoom,
    x: clamp(state.x, viewport - image.width * scale, 0),
    y: clamp(state.y, viewport - image.height * scale, 0),
  }
}

/** Zoom 1, centred: the largest square in the middle of the picture. */
export function initialCrop(image: Size, viewport: number): CropState {
  const scale = coverScale(image, viewport)
  return { zoom: 1, x: (viewport - image.width * scale) / 2, y: (viewport - image.height * scale) / 2 }
}

export function panBy(state: CropState, dx: number, dy: number, image: Size, viewport: number): CropState {
  return clampPan({ ...state, x: state.x + dx, y: state.y + dy }, image, viewport)
}

/**
 * Zooms while the point under `focus` (viewport coordinates: a pinch's middle,
 * the mouse, the square's centre for the slider and the keys) stays where it is.
 */
export function zoomAround(state: CropState, zoom: number, focus: Point, image: Size, viewport: number): CropState {
  const next = clampZoom(zoom)
  const ratio = next / state.zoom
  return clampPan(
    { zoom: next, x: focus.x - (focus.x - state.x) * ratio, y: focus.y - (focus.y - state.y) * ratio },
    image,
    viewport,
  )
}

/** The square to cut out of the original picture, in its own pixels. */
export function cropRect(state: CropState, image: Size, viewport: number): CropRect {
  const { zoom, x, y } = clampPan(state, image, viewport)
  const scale = coverScale(image, viewport) * zoom
  const size = Math.min(viewport / scale, image.width, image.height)
  return { x: clamp(-x / scale, 0, image.width - size), y: clamp(-y / scale, 0, image.height - size), size }
}

/** The same crop in a square of another size (a rotated phone, a resized window). */
export function rescale(state: CropState, from: number, to: number, image: Size): CropState {
  if (from <= 0 || to <= 0) return state
  const ratio = to / from
  return clampPan({ zoom: state.zoom, x: state.x * ratio, y: state.y * ratio }, image, to)
}

/** The distance and middle of two touches, for the pinch. */
export function pinch(a: Point, b: Point): { distance: number; middle: Point } {
  return { distance: Math.hypot(a.x - b.x, a.y - b.y), middle: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
}
