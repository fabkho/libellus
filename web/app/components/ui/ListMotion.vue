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
withDefaults(defineProps<{ tag?: string }>(), { tag: 'div' })

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
    :tag="tag"
    name="list-motion"
    :css="false"
    :data-moving="moving > 0 || undefined"
    @enter="onEnter"
    @after-enter="clean"
    @leave="onLeave"
    @leave-cancelled="clean"
  >
    <slot />
  </TransitionGroup>
</template>

<!-- Not scoped: the move class lands on the slot's elements, which are the caller's. -->
<style>
.list-motion-move {
  transition: transform var(--duration-standard) var(--ease-standard);
}
</style>
