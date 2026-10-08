<script setup lang="ts">
// A list whose changes move in place (docs/MOTION.md, "Move only what
// changed"): an item that leaves fades away over `exit` while its room closes
// over `standard`, so the items after it slide up and the page grows shorter
// as smoothly; a new item opens its room and fades in over `standard`; items
// that only change places move there over `standard`. Interruptible (CSS
// transitions, retargeted from where they are; an item that comes back while
// it is leaving reopens from its current height), and with Reduce Motion the
// list simply changes. The children need keys and must be the list's items;
// pair it with `useSettled` so a change waits for the sheet that caused it.
//
// It never moves items for a list measured off the page. A kept-alive screen
// in the background is out of the document, where every box is 0,0; one that
// updates there (any reactive change it shows, whatever it is) would FLIP its
// items from the corner of the page once it is back on screen. A snapshot
// taken off the page is marked `data-detached` and moves nothing (the style
// below); an update that is measured on the page moves as ever.
//
// `still`: items are only ever added or removed, never reordered, so none is moved
// to a new place (no `-move` class). A list inside a sheet that is still rising
// needs it: the sheet's own travel between two renders would read as every item's
// own move, and the rows already there would be flung back by the distance.
withDefaults(defineProps<{ tag?: string; still?: boolean }>(), { tag: 'div', still: false })

/**
 * How many items are opening or closing their room. While any is, the list
 * carries `data-moving`: the page's height is still changing, so whatever needs
 * it in place (the Playwright flows measuring a scroll position) waits for it.
 */
const moving = ref(0)

/** The properties an item's room is made of: closing all of them to 0 takes it out of the list. */
const ROOM = ['height', 'paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'] as const

/** The list's gap, which a closed item would still leave behind: its margin takes it back. */
function gapAround(item: HTMLElement): { side: 'marginTop' | 'marginBottom'; gap: number } | null {
  const parent = item.parentElement
  if (!parent || (!item.previousElementSibling && !item.nextElementSibling)) return null
  const gap = Number.parseFloat(getComputedStyle(parent).rowGap) || 0
  return gap ? { side: item.previousElementSibling ? 'marginTop' : 'marginBottom', gap } : null
}

const group = ref<{ $el: Element } | null>(null)

/**
 * Marks the list when it is rendered off the page. Called from inside the
 * slot, so it runs in the group's own render, whatever caused it, right before
 * the group takes the items' positions and long before it reads them again.
 */
function offPage(): Record<string, never> {
  const list = group.value?.$el
  if (list) list.toggleAttribute('data-detached', !list.isConnected)
  return {}
}

const TRANSITION = [
  'height var(--duration-standard) var(--ease-standard)',
  'padding var(--duration-standard) var(--ease-standard)',
  'border-width var(--duration-standard) var(--ease-standard)',
  'margin var(--duration-standard) var(--ease-standard)',
].join(', ')

/** Ends a change once its room has finished moving (or at once, when nothing transitions). */
function whenSettled(item: HTMLElement, done: () => void) {
  let finished = false
  moving.value += 1
  const finish = () => {
    if (finished) return
    finished = true
    moving.value -= 1
    item.removeEventListener('transitionend', onEnd)
    window.clearTimeout(timer)
    done()
  }
  const onEnd = (event: TransitionEvent) => {
    if (event.target === item && event.propertyName === 'height') finish()
  }
  item.addEventListener('transitionend', onEnd)
  // A safety net: a transition that is cut short (Reduce Motion, a hidden tab) still ends.
  const timer = window.setTimeout(finish, (Number.parseFloat(getComputedStyle(item).transitionDuration) || 0) * 1000 + 100)
}

function onLeave(el: Element, done: () => void) {
  const item = el as HTMLElement
  const style = getComputedStyle(item)
  const gap = gapAround(item)
  // From what it is now (also mid-entry), to nothing.
  for (const property of ROOM) item.style[property] = style[property]
  item.style.overflow = 'hidden'
  item.style.pointerEvents = 'none'
  void item.offsetHeight
  item.style.transition = `${TRANSITION}, opacity var(--duration-exit) var(--ease-exit)`
  for (const property of ROOM) item.style[property] = '0px'
  item.style.opacity = '0'
  if (gap) item.style[gap.side] = `${-gap.gap}px`
  whenSettled(item, done)
}

function onEnter(el: Element, done: () => void) {
  const item = el as HTMLElement
  const style = getComputedStyle(item)
  const full = Object.fromEntries(ROOM.map((property) => [property, style[property]]))
  const gap = gapAround(item)
  for (const property of ROOM) item.style[property] = '0px'
  item.style.overflow = 'hidden'
  item.style.opacity = '0'
  if (gap) item.style[gap.side] = `${-gap.gap}px`
  void item.offsetHeight
  item.style.transition = `${TRANSITION}, opacity var(--duration-standard) var(--ease-standard)`
  for (const property of ROOM) item.style[property] = full[property]!
  item.style.opacity = '1'
  if (gap) item.style[gap.side] = '0px'
  whenSettled(item, done)
}

/** Leaves nothing behind: the item's own styles take over again. */
function clean(el: Element) {
  const item = el as HTMLElement
  for (const property of [...ROOM, 'overflow', 'opacity', 'transition', 'marginTop', 'marginBottom', 'pointerEvents'] as const) {
    item.style[property] = ''
  }
}
</script>

<template>
  <TransitionGroup
    ref="group"
    :tag="tag"
    name="list-motion"
    :move-class="still ? 'list-motion-still' : undefined"
    :css="false"
    :data-moving="moving > 0 || undefined"
    @enter="onEnter"
    @after-enter="clean"
    @leave="onLeave"
    @leave-cancelled="clean"
  >
    <slot v-bind="offPage()" />
  </TransitionGroup>
</template>

<!-- Not scoped: the move class lands on the slot's elements, which are the caller's. -->
<style>
:not([data-detached]) > .list-motion-move {
  transition: transform var(--duration-standard) var(--ease-standard);
}
</style>
