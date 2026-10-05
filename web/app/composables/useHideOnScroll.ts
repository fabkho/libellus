import type { Ref } from 'vue'
import { barAfterScroll, barHeld, barShown, type BarScroll } from '~/utils/hideOnScroll'

/**
 * Whether the tab bar is out of the way (issue #82, docs/MOTION.md, Tab bar
 * away): on every page it slides away while the member reads down and
 * comes back on a short scroll up, at the top and at the very end of the page
 * (utils/hideOnScroll.ts has the arithmetic).
 *
 * It only ever hides while `wanted` holds (the caller says when: no search, no
 * sheet) and Reduce Motion is off: with it on the bar stays where it is, as a
 * bar that pops in and out in place is more motion, not less. There is no
 * reliable way to tell on the web that a screen reader is running, so the bar
 * is kept reachable instead: focus moving into it (`reveal`, which a screen
 * reader's cursor and Tab both cause) brings it back.
 *
 * It shows at once and starts counting afresh whenever it may no longer hide,
 * the page changes, a field takes the keyboard, or the browser's toolbar comes back (a scroll up Chrome spends on
 * its toolbar). While the router is still putting a page in its place
 * (`data-moving` on the document, app/router.options.ts) the scroll is not the
 * member's: only the anchor follows it, as it does for any jump longer than a
 * screen in one event.
 *
 * `reveal` brings it back from outside (focus moving into the bar).
 */
export function useHideOnScroll(wanted: () => boolean): { hidden: Readonly<Ref<boolean>>; reveal: () => void } {
  const route = useRoute()
  /** Reduce Motion is on: the bar stays. */
  const reduced = ref(false)
  const active = () => wanted() && !reduced.value
  // Read on every scroll event, so not reactive; only whether it is away is.
  let state: BarScroll = barShown(0)
  const away = ref(false)
  const set = (next: BarScroll) => {
    state = next
    away.value = next.hidden
  }
  /** A field has the keyboard (or would on a phone). */
  const editing = ref(false)
  const hidden = computed(() => away.value && active() && !editing.value)

  const reveal = () => set(barShown(import.meta.client ? window.scrollY : 0))

  function onScroll() {
    const y = window.scrollY
    if (!active() || editing.value) {
      set(barShown(y))
      return
    }
    if (document.documentElement.hasAttribute('data-moving')) {
      set(barHeld(state, y))
      return
    }
    const root = document.documentElement
    const end = root.scrollHeight - Math.max(window.innerHeight, root.clientHeight)
    set(barAfterScroll(state, y, end, undefined, window.innerHeight))
  }

  // A browser's toolbar coming and going (Chrome on Android, Safari) changes
  // the viewport, not always the scroll: a short scroll up with Chrome's
  // toolbar away brings the toolbar back and leaves `scrollY` where it was.
  // The toolbar returning is the member scrolling up, so the bar returns with
  // it; the toolbar leaving moves the page's end, which may now be reached.
  let height = 0
  function onResize() {
    const shrunk = window.innerHeight < height
    height = window.innerHeight
    if (shrunk) reveal()
    else onScroll()
  }

  function onFocus(event: FocusEvent) {
    editing.value = takesKeyboard(event.target)
    if (editing.value) reveal()
  }
  function onBlur() {
    // `focusout` comes before the next `focusin`: read where focus went once it has landed.
    requestAnimationFrame(() => (editing.value = takesKeyboard(document.activeElement)))
  }

  const motion = import.meta.client ? window.matchMedia('(prefers-reduced-motion: reduce)') : undefined
  const onMotion = () => (reduced.value = Boolean(motion?.matches))

  onMounted(() => {
    onMotion()
    motion?.addEventListener('change', onMotion)
    reveal()
    height = window.innerHeight
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize, { passive: true })
    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', onBlur)
  })
  onUnmounted(() => {
    motion?.removeEventListener('change', onMotion)
    window.removeEventListener('scroll', onScroll)
    window.removeEventListener('resize', onResize)
    document.removeEventListener('focusin', onFocus)
    document.removeEventListener('focusout', onBlur)
  })

  watch(() => route.path, reveal)
  watch(active, (on) => {
    if (!on) reveal()
  })

  return { hidden: readonly(hidden) as Readonly<Ref<boolean>>, reveal }
}

/** An element that brings up the on-screen keyboard when focused. */
function takesKeyboard(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  if (!(target instanceof HTMLInputElement)) return false
  return !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(target.type)
}
