import type { Ref } from 'vue'

/** How far a sheet or the search palette has to travel down before it lets go. */
const DISMISS_DISTANCE = 80
/** …or how fast a short flick has to be (px per ms). */
const DISMISS_VELOCITY = 0.5

/**
 * Swipe down to dismiss, for anything that rises from the bottom (UiSheet, the
 * search palette). Follows the finger while dragging (`offset`, px, only
 * downwards) and calls `dismiss` when the drag went far or fast enough;
 * otherwise the element springs back. Pointer events, so touch, pen and a
 * mouse drag all work. Bind `handlers` on the element that starts the drag.
 * Drags that start in an input or on a button are left alone, so typing and
 * tapping still work.
 */
export function useSwipeDown(dismiss: () => void) {
  const offset = ref(0)
  const dragging = ref(false)
  let start: { y: number; time: number; id: number } | null = null

  function onPointerdown(event: PointerEvent) {
    const target = event.target as HTMLElement | null
    if (target?.closest('input, textarea, button, a, [data-no-swipe]')) return
    start = { y: event.clientY, time: event.timeStamp, id: event.pointerId }
    dragging.value = true
    ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
  }

  function onPointermove(event: PointerEvent) {
    if (!start || event.pointerId !== start.id) return
    offset.value = Math.max(0, event.clientY - start.y)
  }

  function end(event: PointerEvent) {
    if (!start || event.pointerId !== start.id) return
    const distance = Math.max(0, event.clientY - start.y)
    const velocity = distance / Math.max(1, event.timeStamp - start.time)
    start = null
    dragging.value = false
    offset.value = 0
    if (distance > DISMISS_DISTANCE || (distance > 12 && velocity > DISMISS_VELOCITY)) dismiss()
  }

  const handlers = {
    pointerdown: onPointerdown,
    pointermove: onPointermove,
    pointerup: end,
    pointercancel: end,
  }

  /** Inline style for the dragged element: follows the finger, no transition while dragging. */
  const dragStyle = computed(() =>
    offset.value ? { transform: `translateY(${offset.value}px)`, transition: dragging.value ? 'none' : undefined } : {},
  )

  return { offset: offset as Readonly<Ref<number>>, dragging: dragging as Readonly<Ref<boolean>>, handlers, dragStyle }
}
