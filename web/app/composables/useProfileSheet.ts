import { useStatsStore, type ProfileSheet } from '~/stores/stats'

/**
 * The sheet of a month's books or a star row's, on the Profile or a year in
 * review (issue #78). Any change of page closes a sheet (components/ui/Sheet.vue);
 * this one comes back: a book opened from it, and Back from that book returns
 * to the page with the sheet open again, as an iOS sheet stays under the
 * screen pushed from it. Only Back from that book does — the page opened any
 * other way starts without it.
 *
 * `sheet` is what is open (null: none); `shown` keeps the last one while the
 * sheet slides away, so its content does not empty out under it.
 */
export function useProfileSheet() {
  const stats = useStatsStore()
  const route = useRoute()

  const sheet = ref<ProfileSheet | null>(null)
  const shown = ref<ProfileSheet | null>(null)
  watch(sheet, (now) => now && (shown.value = now))
  const open = computed({
    get: () => sheet.value !== null,
    set: (isOpen: boolean) => !isOpen && (sheet.value = null),
  })

  onBeforeRouteLeave((to) => {
    stats.keptSheet = sheet.value && to.path.startsWith('/book/') ? { page: route.fullPath, sheet: sheet.value } : null
  })

  // Mounted afresh, or shown again from the router's cache of pages: either way, once.
  function reopen() {
    const kept = stats.keptSheet
    stats.keptSheet = null
    // Back from the book: this page's history entry points forward to it.
    const fromBook = String(window.history.state?.forward ?? '').startsWith('/book/')
    if (!kept || kept.page !== route.fullPath || !fromBook) return
    // Once the page is in and the history settled, so the sheet's own entry goes on top of it.
    void nextTick(() => requestAnimationFrame(() => (sheet.value = kept.sheet)))
  }
  onMounted(reopen)
  onActivated(reopen)

  return { sheet, shown, open }
}
