/**
 * Whether anything of the page runs under the tab bar's scroll edge (ShellTabBar,
 * docs/MOTION.md, Tab bar away). Every tab page ends in `clear-tab-bar` padding
 * (the bar's height, where it floats, and `xxl` more), so at the page's end, and
 * on a page that fits the screen, the edge has only the room colour behind it:
 * it is drawn only while the page's content has more than `xxl` still to scroll
 * under it. iOS does the same, a scroll edge is there only where scrolling
 * content meets the pinned control.
 *
 * Read on scroll, on resize and whenever the document changes size (a list
 * arriving, a page swapped in), and again after every change of page.
 */
export function useContentUnderBar(): Readonly<Ref<boolean>> {
  const route = useRoute()
  const under = ref(false)
  let clearance = 0

  function measure() {
    const root = document.documentElement
    const remaining = root.scrollHeight - Math.max(window.innerHeight, root.clientHeight) - window.scrollY
    under.value = remaining > clearance
  }

  let observer: ResizeObserver | undefined
  onMounted(() => {
    // `xxl`, from the theme: the room the page's last line keeps above the bar.
    clearance = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--spacing-xxl')) || 0
    measure()
    window.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure, { passive: true })
    observer = new ResizeObserver(measure)
    observer.observe(document.documentElement)
  })
  onUnmounted(() => {
    window.removeEventListener('scroll', measure)
    window.removeEventListener('resize', measure)
    observer?.disconnect()
  })
  watch(
    () => route.path,
    () => nextTick(measure),
  )

  return readonly(under)
}
