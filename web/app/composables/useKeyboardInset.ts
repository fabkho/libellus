import type { Ref } from 'vue'
import { keyboardInsetOf, layoutHeightOf } from '~/utils/keyboard'

/**
 * How much of the layout viewport the on-screen keyboard covers, in px (0
 * while it is down, or where there is no visual viewport). iOS lays the
 * keyboard over the page instead of resizing it, so its height is read from
 * the visual viewport: whatever of the layout viewport's height the visual
 * viewport neither shows nor has scrolled past. Chrome on Android resizes the
 * page instead (`interactive-widget=resizes-content`, nuxt.config.ts): the
 * layout viewport shrinks with the visual one, this reads 0 and nothing is
 * lifted twice (utils/keyboard.ts). In the installed iOS app it is reported as the
 * keyboard starts to move, so whatever follows it (the search palette, a
 * sheet) rides up on the keyboard's own curve (`--duration-keyboard`,
 * `--ease-keyboard`); in Safari with its toolbar expanded only at the end
 * (WebKit bug 265578).
 *
 * Listens only while `active` is true and reads 0 otherwise, so a closed sheet
 * holds no listeners and does not start the next opening lifted.
 */
export function useKeyboardInset(active: () => boolean): Readonly<Ref<number>> {
  const inset = ref(0)

  function measure() {
    const layout = layoutHeightOf(window.innerHeight, document.documentElement.clientHeight)
    inset.value = keyboardInsetOf(layout, window.visualViewport ?? null)
  }

  function listen(on: boolean) {
    const method = on ? 'addEventListener' : 'removeEventListener'
    window.visualViewport?.[method]('resize', measure)
    window.visualViewport?.[method]('scroll', measure)
  }

  if (import.meta.client) {
    watch(
      active,
      (isActive) => {
        listen(isActive)
        if (isActive) measure()
        else inset.value = 0
      },
      { immediate: true },
    )
    onUnmounted(() => listen(false))
  }

  return inset
}
