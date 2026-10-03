import type { Ref } from 'vue'

/**
 * `source` as a screen shows it: it follows the source, but holds still while
 * a sheet or dialog is on screen (open, or on its way out) and while the screen
 * is not showing (a kept-alive tab in the background). So a Finish leaves the
 * card where it is while the sheet falls away, and the list changes after,
 * where the member sees it (a `<UiListMotion>` moves it); a Start on the book
 * page shows on Home when she comes back to it (docs/MOTION.md, "Move only
 * what changed").
 */
export function useSettled<T>(source: () => T): Readonly<Ref<T>> {
  const settled = shallowRef(source()) as Ref<T>
  const covered = useModalShown()
  // Only kept-alive screens are ever deactivated; anything else stays active.
  const active = ref(true)
  onActivated(() => (active.value = true))
  onDeactivated(() => (active.value = false))

  watch(
    [source, covered, active] as const,
    ([value, isCovered, isActive]) => {
      if (!isCovered && isActive) settled.value = value
    },
  )
  return settled
}
