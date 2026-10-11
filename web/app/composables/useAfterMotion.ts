import type { Ref } from 'vue'
import { followAfterMotion } from '~/utils/motion'

/**
 * `source` as a screen shows it: it follows the source, but a change waits until
 * nothing moves (the cover's flight, its hand-over, a View Transition: `afterMotion`).
 * The first value is there at once, so what the device already knows stands in the
 * first frame; what arrives late opens its room after the cover has landed, not while
 * the hero is still rising under it (docs/MOTION.md, Push to a book, "Late arrivals").
 */
export function useAfterMotion<T>(source: () => T): Readonly<Ref<T>> {
  const shown = shallowRef(source()) as Ref<T>
  watch(
    source,
    followAfterMotion((value) => (shown.value = value)),
  )
  return shown
}
