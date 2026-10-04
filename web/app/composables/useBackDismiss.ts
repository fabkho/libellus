import type { MaybeRefOrGetter } from 'vue'
import type { RouteLocationNormalized, Router, RouterHistory } from 'vue-router'

/**
 * The system Back closes what is open on top of the page — a sheet, a dialog,
 * the search, the avatar menu — instead of leaving the page (#62): Android's
 * back gesture and button, the browser's Back, iOS's edge swipe in a Safari
 * tab. Each open layer has a history entry of its own on top of the page's,
 * a copy of the page's entry (same address, same router state) marked with its
 * depth, so Back lands on the layer below and only closes the top one.
 *
 * - Closing a layer any other way (Cancel, the scrim, a swipe, Escape) takes
 *   its entry off again, so no Back is ever spent on something already gone.
 *   One layer closing as another opens (Progress → Finish) reuses the entry.
 * - Every change of page closes the sheets, dialogs and the menu: a page they
 *   were opened on never shows them on the next one. Before the router moves
 *   (a link, `router.push`/`replace`/`back`), the layers' entries come off
 *   first, so the page's history is exactly what it would be without them.
 *   The search (`keepOnRouteChange`) keeps its own rule (SearchOverlay.vue)
 *   and, if it stays open, gets a fresh entry on the new page.
 *
 * The router never sees a Back that only closes a layer: this module's
 * `popstate` listener is added before the router's own (`listenForBack`, from
 * router.options.ts), so it runs first and stops it.
 */
type Entry = { close: () => void; keepOnRouteChange: boolean }

/** Marks a layer's history entry with its depth (1 for the first layer). */
const KEY = 'libellusLayer'

/** The open layers, in the order they opened. */
const entries: Entry[] = []
/** How many layer entries are on top of the page's entry, as far as this module has asked for. */
let depth = 0
/** The page's own entry (its state and address), copied for each layer's entry. */
let base: { state: Record<string, unknown> | null; href: string } | null = null
/** Popstates this module caused itself and swallows. */
let pending = 0
/**
 * Where the router is moving (from this module's first guard to that
 * navigation's `afterEach`): no entries are added meanwhile. A navigation
 * cancelled by a newer one gets its `afterEach` while the newer one still runs,
 * so only the one this names clears it.
 */
let navigatingTo: RouteLocationNormalized | null = null
/** A traversal of the router's own (`router.back()`, or undoing a refused Back) is on its way: its popstate belongs to the router. */
let routerTraversal = false
let routerTraversalTimer: ReturnType<typeof setTimeout> | undefined
/** What waits for this module's own traversals to land. */
let waiting: (() => void)[] = []
let scheduled = false
let installed: Router | null = null
let listening = false
let watchdog: ReturnType<typeof setTimeout> | undefined

function layerDepth(state: unknown): number {
  const value = state && typeof state === 'object' ? (state as Record<string, unknown>)[KEY] : undefined
  return typeof value === 'number' ? value : 0
}

/** Runs `fn` once no traversal of this module's own is on its way. */
function whenSettled(fn: () => void) {
  if (pending === 0) fn()
  else waiting.push(fn)
}

function settle() {
  clearTimeout(watchdog)
  const run = waiting
  waiting = []
  for (const fn of run) fn()
}

/** A traversal that never fired its popstate (nothing to go back to) must not hold everything up. */
function expectPopstate() {
  pending++
  clearTimeout(watchdog)
  watchdog = setTimeout(() => {
    pending = 0
    settle()
    schedule()
  }, 1000)
}

/** The router's own traversal is on its way; like ours, it may never fire (nothing to go back to). */
function expectRouterTraversal() {
  routerTraversal = true
  clearTimeout(routerTraversalTimer)
  routerTraversalTimer = setTimeout(() => {
    routerTraversal = false
    schedule()
  }, 1000)
}

/** Brings the layer entries in line with the open layers. */
function reconcile() {
  scheduled = false
  if (pending > 0 || navigatingTo || routerTraversal) return
  const want = entries.length
  if (want > depth) {
    if (depth === 0) base = { state: history.state, href: location.href }
    for (let level = depth + 1; level <= want; level++) history.pushState({ ...base!.state, [KEY]: level }, '')
    depth = want
  } else if (want < depth) {
    const by = want - depth
    depth = want
    expectPopstate()
    history.go(by)
  }
}

function schedule() {
  if (scheduled) return
  scheduled = true
  void nextTick(reconcile)
}

/** Closes the layers a change of page closes, top-most first. */
function closeForRouteChange() {
  for (const entry of [...entries].reverse()) if (!entry.keepOnRouteChange) entry.close()
}

function onPopState(event: PopStateEvent) {
  if (pending > 0) {
    // One of this module's own traversals has landed.
    event.stopImmediatePropagation()
    pending--
    if (pending === 0) settle()
    schedule()
    return
  }
  const state = event.state as Record<string, unknown> | null
  const level = layerDepth(state)
  // This page's own entry or one of its layers' entries: the address, the
  // router's place in the history and the route the router is on all agree.
  const onPage =
    base !== null &&
    location.href === base.href &&
    state?.position === base.state?.position &&
    state?.current === installed?.currentRoute.value.fullPath
  if (routerTraversal) {
    // The router's own: it sees it (it may be waiting to ignore it). Landed on
    // a layer's entry whose layer is gone, reconcile goes back off it.
    clearTimeout(routerTraversalTimer)
    routerTraversal = false
    if (onPage && level !== depth) {
      depth = level
      schedule()
    }
    return
  }
  if (!onPage || (level === 0 && depth === 0)) {
    // Another page (or the router's own entry): the router takes it, and the page's layers close.
    if (!onPage) base = null
    if (depth > 0 || entries.length) {
      depth = 0
      closeForRouteChange()
    }
    return
  }
  // Back (or Forward) between the page and its layers: no page change.
  event.stopImmediatePropagation()
  if (level < depth) {
    depth = level
    for (const entry of entries.slice(level).reverse()) entry.close()
  } else depth = level // Forward onto an entry whose layer is gone: reconcile goes back off it.
  schedule()
}

/**
 * Starts listening for Back. Called before the router creates its history, so
 * this listener runs before the router's and a Back that only closes a layer
 * never reaches it (listeners run in the order they were added).
 */
export function listenForBack() {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('popstate', onPopState)
}

function install(router: Router) {
  installed = router
  listenForBack()

  // A change of page closes the layers and takes their entries off first.
  router.beforeEach((to) => {
    navigatingTo = to
  })
  router.beforeResolve((to, from) => {
    if (to.fullPath !== from.fullPath) closeForRouteChange()
    if (depth === 0 && pending === 0) return
    return new Promise<void>((resolve) => {
      whenSettled(() => {
        if (depth > 0) {
          expectPopstate()
          history.go(-depth)
          depth = 0
        }
        whenSettled(resolve)
      })
    })
  })
  router.afterEach((to, from, failure) => {
    if (to !== navigatingTo) return
    navigatingTo = null
    if (!failure && to.fullPath !== from.fullPath) {
      // A new page: the old one's entries are history now.
      base = null
      closeForRouteChange()
    }
    schedule()
  })
  router.onError((_error, to) => {
    if (to !== navigatingTo) return
    navigatingTo = null
    schedule()
  })

  // `router.back()` / `router.go(-n)` from a page with layers open: one
  // traversal past the layers' entries, so the router lands where it meant to.
  const routerHistory: RouterHistory = router.options.history
  const go = routerHistory.go.bind(routerHistory)
  routerHistory.go = (delta, triggerListeners) =>
    whenSettled(() => {
      if (delta < 0 && depth > 0) {
        const by = delta - depth
        depth = 0
        expectRouterTraversal()
        closeForRouteChange()
        go(by, triggerListeners)
      } else {
        // Undoing a refused Back (`triggerListeners` false) lands where the
        // router waits to ignore the popstate: it has to reach the router.
        if (triggerListeners === false) expectRouterTraversal()
        go(delta, triggerListeners)
      }
    })
}

/**
 * Lets the system Back close this layer while `open` is true. `close` is how
 * the layer closes itself (it may refuse, as a dialog does while its action
 * runs: then its entry goes back on). `keepOnRouteChange`: a change of page
 * does not close it (the search, which has its own rule).
 */
export function useBackDismiss(
  open: MaybeRefOrGetter<boolean>,
  close: () => void,
  { keepOnRouteChange = false }: { keepOnRouteChange?: boolean } = {},
) {
  if (!import.meta.client) return
  if (!installed) install(useRouter())
  const entry: Entry = { close, keepOnRouteChange }

  function remove() {
    const index = entries.indexOf(entry)
    if (index === -1) return
    entries.splice(index, 1)
    schedule()
  }

  watch(
    () => toValue(open),
    (isOpen) => {
      if (isOpen && !entries.includes(entry)) {
        entries.push(entry)
        schedule()
      } else if (!isOpen) remove()
    },
    { immediate: true },
  )
  onUnmounted(remove)
}
