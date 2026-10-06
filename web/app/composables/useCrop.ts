import {
  clampPan,
  cropRect,
  initialCrop,
  PAN_STEP,
  panBy,
  pinch,
  rescale,
  ZOOM_STEP,
  zoomAround,
  type CropRect,
  type CropState,
  type Point,
  type Size,
} from '~/utils/crop'

/**
 * The crop's gestures over its geometry (utils/crop.ts): one finger or the
 * mouse moves the picture, two fingers pinch, the wheel and the slider zoom,
 * and the keyboard does both (arrows move, + and − zoom) for whoever cannot
 * drag. `viewport()` is read on every gesture, so a rotated phone keeps working;
 * `open` places a picture at zoom 1, centred. (Adapted from Trappist's.)
 */
export function useCrop(viewport: () => number) {
  const state = reactive<CropState>({ zoom: 1, x: 0, y: 0 })
  const image = shallowRef<Size | null>(null)
  const pointers = new Map<number, Point>()
  let lastPinch: { distance: number; middle: Point } | null = null

  function set(next: CropState) {
    state.zoom = next.zoom
    state.x = next.x
    state.y = next.y
  }

  function open(size: Size) {
    image.value = size
    pointers.clear()
    lastPinch = null
    set(initialCrop(size, viewport()))
  }

  function local(event: PointerEvent | WheelEvent): Point {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    return { x: event.clientX - box.left, y: event.clientY - box.top }
  }

  function onPointerDown(event: PointerEvent) {
    ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
    pointers.set(event.pointerId, local(event))
    lastPinch = null
  }

  function onPointerMove(event: PointerEvent) {
    const picture = image.value
    const previous = pointers.get(event.pointerId)
    if (!picture || !previous) return
    const point = local(event)
    pointers.set(event.pointerId, point)
    const size = viewport()
    if (pointers.size === 1) return set(panBy(state, point.x - previous.x, point.y - previous.y, picture, size))
    const [a, b] = [...pointers.values()]
    const now = pinch(a!, b!)
    if (lastPinch && lastPinch.distance > 0) {
      const zoomed = zoomAround(state, state.zoom * (now.distance / lastPinch.distance), now.middle, picture, size)
      set(panBy(zoomed, now.middle.x - lastPinch.middle.x, now.middle.y - lastPinch.middle.y, picture, size))
    }
    lastPinch = now
  }

  function onPointerUp(event: PointerEvent) {
    pointers.delete(event.pointerId)
    lastPinch = null
  }

  function onWheel(event: WheelEvent) {
    if (!image.value) return
    event.preventDefault()
    set(zoomAround(state, state.zoom * Math.exp(-event.deltaY / 400), local(event), image.value, viewport()))
  }

  /** The slider, the buttons and the keys: zoom around the square's centre. */
  function setZoom(zoom: number) {
    if (!image.value) return
    const size = viewport()
    set(zoomAround(state, zoom, { x: size / 2, y: size / 2 }, image.value, size))
  }

  /** Arrows move the picture under the circle, + and − zoom; true when the key was one of them. */
  function onKey(event: KeyboardEvent): boolean {
    const picture = image.value
    if (!picture) return false
    const size = viewport()
    const step = event.shiftKey ? PAN_STEP * 4 : PAN_STEP
    // The picture moves the way the arrow points, as if dragged.
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    const move = moves[event.key]
    if (move) {
      set(panBy(state, move[0], move[1], picture, size))
      return true
    }
    if (event.key === '+' || event.key === '=') return (setZoom(state.zoom + ZOOM_STEP), true)
    if (event.key === '-' || event.key === '_') return (setZoom(state.zoom - ZOOM_STEP), true)
    return false
  }

  /** The square changed size: the same crop, scaled along. */
  function resize(from: number, to: number) {
    if (image.value && from !== to) set(rescale(state, from, to, image.value))
  }

  function rect(): CropRect | null {
    return image.value ? cropRect(state, image.value, viewport()) : null
  }

  /** Where and how large to draw the picture in the square, in CSS pixels. */
  function placement() {
    const picture = image.value
    if (!picture) return null
    const size = viewport()
    const { zoom, x, y } = clampPan(state, picture, size)
    const scale = (size / Math.min(picture.width, picture.height)) * zoom
    return { x, y, width: picture.width * scale, height: picture.height * scale }
  }

  return { state, open, onPointerDown, onPointerMove, onPointerUp, onWheel, onKey, setZoom, resize, rect, placement }
}
