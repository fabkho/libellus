import { onBeforeUnmount, watch, type Ref } from 'vue'

/**
 * Calls `more` when `target` (the end of a list inside a scrolling sheet) comes within `margin` of the view of its
 * nearest `[data-sheet-body]`: the next page of rows is drawn before the member scrolls to it, so the list seems to be
 * whole. `watching` re-arms it: a fresh observer reports where the end is as soon as it looks, so a page that still
 * leaves the end near asks for the next at once, and one that has moved it far away waits. Without IntersectionObserver
 * nothing happens by itself, and the target (a button in the list) is how the member asks.
 */
export function useMoreWhenNear(target: Ref<HTMLElement | null>, watching: () => unknown, more: () => void, margin = '0px 0px 100% 0px') {
  let observer: IntersectionObserver | null = null
  const stop = () => {
    observer?.disconnect()
    observer = null
  }
  watch(
    [target, watching],
    () => {
      stop()
      const el = target.value
      if (!el || typeof IntersectionObserver === 'undefined') return
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) more()
        },
        { root: el.closest<HTMLElement>('[data-sheet-body]'), rootMargin: margin },
      )
      observer.observe(el)
    },
    { flush: 'post' },
  )
  onBeforeUnmount(stop)
}
