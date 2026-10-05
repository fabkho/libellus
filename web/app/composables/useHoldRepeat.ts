/** How long a press waits before it starts repeating, ms. */
const HOLD_DELAY_MS = 380

/**
 * Press and hold for a − / + button (the progress wheel's, issue #68): one step on
 * the press, then, held, repeating faster and in bigger strides (1, then 5, then
 * 10 at a time), so a few hundred pages are a short hold away. Bind `start` to
 * `pointerdown` and `stop` to `pointerup`, `pointerleave` and `pointercancel`;
 * a keyboard press (Enter, Space) is `click` with `detail` 0: `once` handles it.
 */
export function useHoldRepeat(step: (times: number) => void) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let count = 0

  function stop() {
    if (timer) clearTimeout(timer)
    timer = null
    count = 0
  }

  function start(event: PointerEvent) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    stop()
    step(1)
    const repeat = () => {
      count++
      step(count > 20 ? 10 : count > 8 ? 5 : 1)
      timer = setTimeout(repeat, count > 4 ? 60 : 110)
    }
    timer = setTimeout(repeat, HOLD_DELAY_MS)
  }

  /** A click that no pointer made (the keyboard): one step. */
  function once(event: MouseEvent) {
    if (event.detail === 0) step(1)
  }

  onBeforeUnmount(stop)
  return { start, stop, once }
}
