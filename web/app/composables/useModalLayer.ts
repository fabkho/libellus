import type { Ref } from 'vue'
import { dimStatusBar } from '~/utils/statusBarDim'

/**
 * What a sheet or a dialog does to the rest of the app while it is open, as on
 * iOS: everything else stops taking part (the page, the search palette, a
 * sheet under a dialog — `inert`, so neither a tap nor Tab nor VoiceOver
 * reaches it), the page stops scrolling under it, focus moves into it and
 * goes back to whatever opened it once it closes.
 *
 * Layers stack: a dialog over a sheet makes the sheet inert too, and closing
 * the dialog gives the sheet back. Every layer is teleported to `<body>`, so
 * "everything else" is every other child of `<body>` (`#__nuxt` included).
 *
 * The system Back closes the top-most layer instead of leaving the page, and
 * a change of page closes them all (`close`, useBackDismiss.ts).
 *
 * `useModalShown` tells the screens whether any layer is still on screen
 * (open, or on its way out), so they can hold a list change back until the
 * sheet that caused it has gone (`useSettled`).
 */
type Layer = {
  /** The layer's own elements (its scrim and panel), direct children of `<body>`. */
  elements: () => (HTMLElement | null | undefined)[]
  /** What had focus when it opened: it gets it back on close. */
  trigger: HTMLElement | null
}

const stack: Layer[] = []
/** How many layers are on screen: open, or still leaving. */
const shownLayers = ref(0)
/** The elements this module made inert (it never undoes an `inert` it did not set). */
const madeInert = new Set<HTMLElement>()
/** The root's own `overflow` before the first layer locked it; null while unlocked. */
let lockedOverflow: string | null = null

/** Brings `inert` and the scroll lock in line with the stack. */
function apply() {
  const top = stack.at(-1)
  const keep = (top?.elements() ?? []).filter((el): el is HTMLElement => Boolean(el))
  for (const child of Array.from(document.body.children)) {
    if (!(child instanceof HTMLElement) || child instanceof HTMLScriptElement) continue
    const covered = Boolean(top) && !keep.some((el) => el === child || child.contains(el))
    if (covered && !child.inert) {
      child.inert = true
      madeInert.add(child)
    } else if (!covered && madeInert.has(child)) {
      child.inert = false
      madeInert.delete(child)
    }
  }
  for (const el of madeInert) if (!el.isConnected) madeInert.delete(el)

  const root = document.documentElement
  if (top && lockedOverflow === null) {
    lockedOverflow = root.style.overflow
    root.style.overflow = 'hidden'
  } else if (!top && lockedOverflow !== null) {
    root.style.overflow = lockedOverflow
    lockedOverflow = null
  }
}

function contains(layer: Layer, node: Node | null) {
  return Boolean(node) && layer.elements().some((el) => el?.contains(node))
}

/**
 * Makes the component a modal layer while `open` is true. `elements` are its
 * scrim and panel (both teleported to `<body>`); `initialFocus` picks what
 * gets focus once it is open (the panel itself, or a field that should have the
 * keyboard in the opening tap; a sheet whose field waits for its rise names the panel and moves
 * focus itself later). `close` is how the layer closes itself: the system Back
 * and a change of page call it. Bind `afterLeave` to the panel's
 * `<Transition>`, so the layer counts as shown until it has left.
 */
export function useModalLayer(
  open: Ref<boolean>,
  {
    elements,
    initialFocus,
    close,
  }: {
    elements: () => (HTMLElement | null | undefined)[]
    initialFocus: () => HTMLElement | null | undefined
    close: () => void
  },
) {
  useBackDismiss(open, close)
  let layer: Layer | null = null
  let shown = false

  let undim: (() => void) | null = null

  function markShown(value: boolean) {
    if (value === shown) return
    shown = value
    shownLayers.value += value ? 1 : -1
    // The status bar of the installed app is outside the viewport, so the scrim cannot reach it:
    // it takes the scrim's colour for as long as the layer is on screen (utils/statusBarDim.ts).
    if (!import.meta.client) return
    if (value) undim = dimStatusBar()
    else {
      undim?.()
      undim = null
    }
  }

  async function enter() {
    if (layer) return
    const active = document.activeElement
    layer = { elements, trigger: active instanceof HTMLElement && active !== document.body ? active : null }
    stack.push(layer)
    markShown(true)
    await nextTick()
    if (layer !== stack.at(-1)) return
    // Focus first, while the trigger is still reachable, then shut the rest.
    // A field that already has focus keeps it. UiSheet's `initialFocus` names
    // the panel while its field waits for the rise (stage 1: focus is inside
    // at once for the trap and VoiceOver; stage 2, in UiSheet, moves it to the
    // field once the sheet is in place, utils/sheetFocus.ts).
    const target = initialFocus()
    if (!contains(layer, document.activeElement)) target?.focus({ preventScroll: true })
    apply()
  }

  function leave() {
    const closing = layer
    if (!closing) return
    layer = null
    const index = stack.indexOf(closing)
    if (index !== -1) stack.splice(index, 1)
    // A layer opened from this one (Progress → Finish) gives focus back to
    // where this one came from, since its own trigger is leaving with it.
    for (const other of stack) if (other.trigger && contains(closing, other.trigger)) other.trigger = closing.trigger
    apply()
    const active = document.activeElement
    const focusInside = !active || active === document.body || contains(closing, active)
    if (focusInside && closing.trigger?.isConnected) closing.trigger.focus({ preventScroll: true })
  }

  watch(open, (isOpen) => {
    if (!import.meta.client) return
    if (isOpen) void enter()
    else leave()
  })

  onUnmounted(() => {
    if (!import.meta.client) return
    leave()
    markShown(false)
  })

  return { afterLeave: () => markShown(false) }
}

/** Whether a sheet or dialog is on screen: open, or still on its way out. */
export function useModalShown(): Readonly<Ref<boolean>> {
  return computed(() => shownLayers.value > 0)
}
