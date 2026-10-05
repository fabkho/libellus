import { onBeforeUnmount, shallowRef, watch, type Ref } from 'vue'

/**
 * Which rows of a scrolling list have come near its view: within `margin` of
 * the list's own visible part (default: one list height above and below).
 * A row stays near once it has been. For covers that should start loading
 * before they scroll in (issue #63): the browser's `loading="lazy"` does that
 * by itself, except under a `mask-image` (the search list's fade), where
 * Chromium starts an image only once it is inside the list. Measured against
 * the list itself, the margin holds there too.
 *
 * Rows hand themselves in with `observe` as a function ref and carry
 * `data-near-key`; `has(key)` tells whether one is near. Without
 * IntersectionObserver every row counts as near.
 */
export function useNearView(root: Ref<HTMLElement | null>, margin = '100% 0px') {
  const near = shallowRef<ReadonlySet<string>>(new Set())
  const supported = typeof IntersectionObserver !== 'undefined'
  // Rows mount before their list, so they wait here until there is an observer.
  const waiting = new Set<Element>()
  let observer: IntersectionObserver | null = null

  watch(
    root,
    (element) => {
      observer?.disconnect()
      observer = null
      if (!element || !supported) return
      observer = new IntersectionObserver(
        (entries) => {
          const added = entries
            .filter((entry) => entry.isIntersecting)
            .map((entry) => (entry.target as HTMLElement).dataset.nearKey)
            .filter((key): key is string => Boolean(key) && !near.value.has(key!))
          if (added.length) near.value = new Set([...near.value, ...added])
        },
        { root: element, rootMargin: margin },
      )
      for (const row of waiting) if (element.contains(row)) observer.observe(row)
      waiting.clear()
    },
    { flush: 'post' },
  )

  onBeforeUnmount(() => observer?.disconnect())

  return {
    /** A function ref for each row. */
    observe(row: Element | { $el?: Element } | null) {
      const element = row instanceof Element ? row : (row?.$el ?? null)
      if (!element || !supported) return
      if (observer) observer.observe(element)
      else waiting.add(element)
    },
    has: (key: string) => !supported || near.value.has(key),
  }
}
