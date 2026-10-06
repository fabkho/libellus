import { useStatsStore } from '~/stores/stats'

/** How a sheet is put back (components/ui/Sheet.vue, `restore`): where its list was scrolled. */
export interface SheetRestore {
  scroll: number
}

/**
 * A sheet that leads to a Book page comes back (issue #78, and Home's "Read in
 * 2026"): a Book opened from it, and Back from that Book returns to the page with
 * the sheet open again, as an iOS sheet stays under the screen pushed from it.
 * Any change of page closes a sheet (components/ui/Sheet.vue), so the page
 * keeps what was open and puts it back. Only Back from that Book does — the
 * page opened any other way starts without it.
 *
 * `sheet` says what is open (null: nothing); `reopen` opens it again. The page
 * binds the returned `restore` to the sheet (`UiSheet`'s `restore`): the sheet
 * then opens as it was left (no rise, no scrim fading in, its list scrolled
 * where it was) rather than as a fresh one does. `testid` is the sheet whose
 * scroll is kept.
 */
export function useSheetRestore<T>({ testid, sheet, reopen }: { testid: string; sheet: () => T | null; reopen: (kept: T) => void }) {
  const stats = useStatsStore()
  const route = useRoute()
  const restore = ref<SheetRestore | null>(null)

  const scrollOf = () =>
    document.querySelector<HTMLElement>(`[data-testid="${testid}"] [data-sheet-body]`)?.scrollTop ?? 0

  // Once the sheet is closed again, the next opening is a fresh one.
  watch(sheet, (now) => now === null && (restore.value = null), { flush: 'sync' })

  onBeforeRouteLeave((to) => {
    const open = sheet()
    stats.keptSheet =
      open !== null && to.path.startsWith('/book/') ? { page: route.fullPath, sheet: open, scroll: scrollOf() } : null
  })

  // Mounted afresh, or shown again from the router's cache of pages: either way, once.
  function back() {
    const kept = stats.keptSheet
    stats.keptSheet = null
    // Back from the book: this page's history entry points forward to it.
    const fromBook = String(window.history.state?.forward ?? '').startsWith('/book/')
    if (!kept || kept.page !== route.fullPath || !fromBook) return
    restore.value = { scroll: kept.scroll }
    reopen(kept.sheet as T)
  }
  onMounted(back)
  onActivated(back)

  return { restore }
}
