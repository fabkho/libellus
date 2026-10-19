import { createScreenWake, type WakeLockApi } from '~/data/screenWake'

/**
 * Keeps the screen on while `wanted` is true and the page is visible (data/screenWake.ts); let go when it turns
 * false and when the component goes. The import page uses it while the lookups run: a phone that turns its screen
 * off stops the import (the app is then in the background).
 */
export function useScreenWake(wanted: () => boolean) {
  let wake: ReturnType<typeof createScreenWake> | null = null
  onMounted(() => {
    wake = createScreenWake((navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock, document)
    watch(wanted, (on) => wake?.want(on), { immediate: true })
  })
  onUnmounted(() => {
    wake?.dispose()
    wake = null
  })
}
