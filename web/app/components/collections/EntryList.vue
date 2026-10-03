<script setup lang="ts">
// A Collection's Books in her order (D's collection): numbered like a reading
// list, each row a small cover, the serif title, the author and the Status,
// and a grip on the right. Dragging the grip lifts the row and the others make
// room as it passes; letting go puts it there and saves the order (Follow the
// finger: the row moves 1:1, the rest glide over `quick`). The grip is a
// button, too: with it focused, the arrow keys move the Book one place up or
// down (Home / End: to the top or the end), and a live region says where it
// went. On a phone, holding a row still lifts it as well. Tapping a row opens
// the book page.
import type { LibraryEntry } from '~/data/library'
import { useBookStore } from '~/stores/book'
import { useCollectionsStore } from '~/stores/collections'

const props = defineProps<{ collectionId: string; entries: readonly LibraryEntry[] }>()

const { t } = useI18n()
const collections = useCollectionsStore()
const books = useBookStore()
// A move saves the order: offline the rows stay put and the grips say why (#15).
const online = useOnline()

const hintId = useId()

const authorsOf = (entry: LibraryEntry) => formatAuthors(entry.book.authors, t('common.etAl'))
/** A row's number: where it is, or while a row is being dragged, where it will be. */
function place(index: number): string {
  const current = drag.value
  let at = index
  if (current) {
    if (index === current.index) at = current.target
    else if (current.target > current.index && index > current.index && index <= current.target) at = index - 1
    else if (current.target < current.index && index >= current.target && index < current.index) at = index + 1
  }
  return String(at + 1).padStart(2, '0')
}

// ------------------------------------------------------------------- drag

type Drag = {
  index: number
  entryId: string
  pointerId: number
  /** Where the finger went down, in page coordinates (so scrolling counts). */
  startY: number
  lastClientY: number
  /** Each row's top and height in page coordinates, as laid out when the drag began. */
  rows: { top: number; height: number }[]
  target: number
  dy: number
}

const drag = ref<Drag | null>(null)
/** The lifted row gliding into its new place after the finger let go. */
const settling = ref(false)
/** For one frame after a move lands: no transitions, so nothing slides back. */
const still = ref(false)

const list = useTemplateRef<HTMLOListElement>('list')

function rowRects() {
  const rows = list.value ? [...list.value.querySelectorAll<HTMLElement>(':scope > li')] : []
  return rows.map((row) => {
    const rect = row.getBoundingClientRect()
    return { top: rect.top + window.scrollY, height: rect.height }
  })
}

function lift(element: HTMLElement, pointerId: number, clientY: number, index: number) {
  const entry = props.entries[index]
  if (!entry) return
  try {
    element.setPointerCapture(pointerId)
  } catch {
    // The pointer is gone already (lifted by a hold whose finger just left): nothing to drag.
    return
  }
  drag.value = {
    index,
    entryId: entry.id,
    pointerId,
    startY: clientY + window.scrollY,
    lastClientY: clientY,
    rows: rowRects(),
    target: index,
    dy: 0,
  }
  announcement.value = t('collection.lifted', { title: entry.book.title })
  autoScroll()
}

/** The grip lifts its row at once, for a mouse and a finger alike. */
function onPointerdown(event: PointerEvent, index: number) {
  if (event.button !== 0 || drag.value || settling.value || !online.value) return
  event.preventDefault()
  event.stopPropagation()
  swallowClick = false
  cancelHold()
  lift(event.currentTarget as HTMLElement, event.pointerId, event.clientY, index)
}

// Anywhere else on a row, a finger that holds still lifts it (D: "hold a row
// to move it"); one that moves first is scrolling, and a quick tap opens the
// book page as before. The mouse keeps to the grip.
const HOLD_MS = 350
const HOLD_SLOP = 8
let hold: { timer: number; pointerId: number; x: number; y: number } | null = null
/** Set when a hold lifted a row, so the tap that ends it does not open the book page. */
let swallowClick = false

function onRowPointerdown(event: PointerEvent, index: number) {
  swallowClick = false
  if (event.pointerType === 'mouse' || drag.value || settling.value || !online.value) return
  cancelHold()
  const element = event.currentTarget as HTMLElement
  const { pointerId, clientX, clientY } = event
  hold = {
    pointerId,
    x: clientX,
    y: clientY,
    timer: window.setTimeout(() => {
      hold = null
      lift(element, pointerId, clientY, index)
      swallowClick = Boolean(drag.value)
      if (drag.value) navigator.vibrate?.(10)
    }, HOLD_MS),
  }
}

// Move, up and cancel are heard on the window: a finger that leaves the row
// (or the hold that never captured it) still ends what it started.
function onWindowPointermove(event: PointerEvent) {
  if (hold && hold.pointerId === event.pointerId) {
    if (Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > HOLD_SLOP) cancelHold()
    return
  }
  onPointermove(event)
}

function cancelHold() {
  if (hold) window.clearTimeout(hold.timer)
  hold = null
}

function onRowClick(event: MouseEvent) {
  if (!swallowClick) return
  swallowClick = false
  event.preventDefault()
  event.stopPropagation()
}

// While a row is lifted, the finger moves the row, not the page.
function onTouchmove(event: TouchEvent) {
  if (drag.value) event.preventDefault()
}
onMounted(() => {
  list.value?.addEventListener('touchmove', onTouchmove, { passive: false })
  window.addEventListener('pointermove', onWindowPointermove)
  window.addEventListener('pointerup', onWindowPointerup)
  window.addEventListener('pointercancel', onWindowPointercancel)
})
onBeforeUnmount(() => {
  list.value?.removeEventListener('touchmove', onTouchmove)
  window.removeEventListener('pointermove', onWindowPointermove)
  window.removeEventListener('pointerup', onWindowPointerup)
  window.removeEventListener('pointercancel', onWindowPointercancel)
  cancelHold()
  cancelAnimationFrame(frame)
  window.clearTimeout(settleTimer)
})

function follow(clientY: number) {
  const current = drag.value
  if (!current) return
  current.lastClientY = clientY
  const first = current.rows[0]!
  const last = current.rows.at(-1)!
  const own = current.rows[current.index]!
  // The row stays within the list.
  const min = first.top - own.top
  const max = last.top + last.height - own.height - own.top
  current.dy = Math.min(max, Math.max(min, clientY + window.scrollY - current.startY))
  const centre = own.top + current.dy + own.height / 2
  let target = 0
  current.rows.forEach((row, j) => {
    if (j !== current.index && row.top + row.height / 2 < centre) target++
  })
  current.target = target
}

function onPointermove(event: PointerEvent) {
  if (drag.value?.pointerId === event.pointerId) follow(event.clientY)
}

// Near the top or bottom of the screen the page scrolls on its own, so a Book
// can travel further than one screen.
let frame = 0
function autoScroll() {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(function step() {
    const current = drag.value
    if (!current) return
    const edge = 2 * Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--size-touch') || '44')
    const y = current.lastClientY
    const speed = y > window.innerHeight - edge ? 1 : y < edge ? -1 : 0
    if (speed) {
      window.scrollBy(0, speed * 8)
      follow(y)
    }
    frame = requestAnimationFrame(step)
  })
}

function offsetOf(index: number): number {
  const current = drag.value
  if (!current) return 0
  if (index === current.index) {
    if (!settling.value) return current.dy
    // Into its new place: the height of the rows it passed.
    const span = (current.target > current.index ? current.rows.slice(current.index + 1, current.target + 1) : current.rows.slice(current.target, current.index))
      .reduce((sum, row) => sum + row.height, 0)
    return current.target > current.index ? span : -span
  }
  const height = current.rows[current.index]!.height
  if (current.target > current.index && index > current.index && index <= current.target) return -height
  if (current.target < current.index && index >= current.target && index < current.index) return height
  return 0
}

function onWindowPointerup(event: PointerEvent) {
  if (hold?.pointerId === event.pointerId) cancelHold()
  onPointerup(event)
}

function onWindowPointercancel(event: PointerEvent) {
  if (hold?.pointerId === event.pointerId) cancelHold()
  onPointercancel(event)
}

/** A long press on a phone would open the link's menu; while holding a row, it does not. */
function onContextmenu(event: Event) {
  if (hold || drag.value) event.preventDefault()
}

function onPointerup(event: PointerEvent) {
  const current = drag.value
  if (!current || current.pointerId !== event.pointerId || settling.value) return
  cancelAnimationFrame(frame)
  settling.value = true
  // Let the row glide into its place, then make the move real.
  settleTimer = window.setTimeout(() => land(current), durationOf('--duration-quick'))
}

function onPointercancel(event: PointerEvent) {
  const current = drag.value
  if (!current || current.pointerId !== event.pointerId || settling.value) return
  cancelAnimationFrame(frame)
  current.target = current.index
  settling.value = true
  settleTimer = window.setTimeout(() => land(current), durationOf('--duration-quick'))
}

let settleTimer = 0

function land(current: Drag) {
  still.value = true
  const { index, target, entryId } = current
  drag.value = null
  settling.value = false
  if (target !== index) {
    const title = props.entries.find((entry) => entry.id === entryId)?.book.title ?? ''
    collections.move(props.collectionId, entryId, target)
    announcement.value = t('collection.moved', { title, place: target + 1, count: props.entries.length })
  } else {
    announcement.value = t('collection.dropped')
  }
  requestAnimationFrame(() => requestAnimationFrame(() => (still.value = false)))
}

function durationOf(token: string): number {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 0
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
  return value.endsWith('ms') ? Number.parseFloat(value) : Number.parseFloat(value) * 1000 || 0
}


function rowStyle(index: number) {
  const offset = offsetOf(index)
  return offset ? { transform: `translateY(${offset}px)` } : undefined
}

// --------------------------------------------------------------- keyboard

const announcement = ref('')

async function onKeydown(event: KeyboardEvent, index: number) {
  if (!online.value) return
  const count = props.entries.length
  const to =
    event.key === 'ArrowUp' ? index - 1
    : event.key === 'ArrowDown' ? index + 1
    : event.key === 'Home' ? 0
    : event.key === 'End' ? count - 1
    : null
  if (to === null) return
  event.preventDefault()
  if (to < 0 || to >= count || to === index || drag.value) return
  const entry = props.entries[index]!
  collections.move(props.collectionId, entry.id, to)
  announcement.value = t('collection.moved', { title: entry.book.title, place: to + 1, count })
  // The focus stays with the Book it moved.
  await nextTick()
  list.value?.querySelector<HTMLElement>(`[data-entry="${entry.id}"] [data-grip]`)?.focus()
}
</script>

<template>
  <div>
    <ol ref="list" class="relative list-none" :class="(drag || still) && 'select-none'" data-testid="collection.entries">
      <li
        v-for="(entry, index) in entries"
        :key="entry.id"
        class="row relative flex items-center gap-ms rounded-md pl-sm"
        :class="[
          drag?.index === index && 'lifted',
          drag && drag.index !== index && 'making-room',
          drag?.index === index && settling && 'settling',
          still && 'still',
        ]"
        :style="rowStyle(index)"
        :data-entry="entry.id"
        data-testid="collection.entry"
        @pointerdown="onRowPointerdown($event, index)"
        @click.capture="onRowClick"
        @contextmenu="onContextmenu"
      >
        <UiPressLink
          :to="`/book/${entry.book.id}`"
          class="flex min-w-0 flex-1 items-center gap-ms py-sm"
          data-testid="collection.entryLink"
          @press="books.prefetch(entry.book.id)"
        >
          <span class="index figures w-(--size-star-lg) shrink-0 text-meta text-ink-faint" aria-hidden="true">{{ place(index) }}</span>
          <UiCover
            :title="entry.book.title"
            :authors="entry.book.authors"
            :src="coverSrc(entry.book.coverUrl, 'xs')"
            :thumbhash="entry.book.coverThumbhash"
            :colors="entry.book.coverColors"
            size="xs"
            :eager="index < 10"
          />
          <span class="flex min-w-0 flex-1 flex-col gap-xxs">
            <span class="book-title truncate text-body-large" data-testid="collection.entryTitle">{{ entry.book.title }}</span>
            <span class="flex min-w-0 items-center gap-sm text-caption text-ink-muted">
              <span class="truncate">{{ authorsOf(entry) }}</span>
              <span class="dot shrink-0" aria-hidden="true" />
              <span class="shrink-0" :class="entry.status === 'reading' ? 'text-accent' : 'text-ink-faint'">{{ t(`status.${entry.status}`) }}</span>
            </span>
          </span>
        </UiPressLink>
        <button
          type="button"
          class="grip flex size-(--size-touch) shrink-0 items-center justify-center rounded-pill disabled:opacity-50"
          :class="drag?.index === index ? 'text-ink' : 'text-ink-ghost'"
          :disabled="!online"
          :aria-label="online ? t('collection.move', { title: entry.book.title }) : t('common.offline')"
          :aria-describedby="hintId"
          data-grip
          data-testid="collection.grip"
          @pointerdown="onPointerdown($event, index)"
          @keydown="onKeydown($event, index)"
          @click.prevent
        >
          <UiIcon name="grip" :size="18" />
        </button>
      </li>
    </ol>
    <p :id="hintId" class="sr-only">{{ t('collection.moveHint') }}</p>
    <p class="sr-only" aria-live="polite" data-testid="collection.announcement">{{ announcement }}</p>
  </div>
</template>

<style scoped>
.row {
  transition: transform var(--duration-quick) var(--ease-standard);
}

/* A hairline between rows, from the cover on, as in a list (the index column is a large star wide). */
.row + .row::before {
  position: absolute;
  top: 0;
  right: var(--spacing-sm);
  left: calc(var(--spacing-sm) + var(--size-star-lg) + var(--spacing-ms));
  height: var(--stroke-hairline);
  content: '';
  background: var(--color-hairline);
}

/* The row under the finger: raised over the others, a little larger, no transition but the finger's. */
.lifted {
  z-index: 2;
  background: var(--color-surface-sheet);
  box-shadow:
    inset 0 0 0 var(--stroke-hairline) var(--color-hairline-strong),
    var(--shadow-sheet);
  transition: none;
  scale: 1.035;
}

.lifted::before,
.lifted + .row::before {
  display: none;
}

.lifted .index {
  color: var(--color-accent);
}

.settling {
  transition: transform var(--duration-quick) var(--ease-standard);
}

.still {
  transition: none;
}

/* Holding a row lifts it: no text selection or link menu on the way. */
.row {
  -webkit-touch-callout: none;
  user-select: none;
}

.grip {
  touch-action: none;
  cursor: grab;
}

.lifted .grip {
  cursor: grabbing;
}

.dot {
  width: var(--spacing-xxs);
  height: var(--spacing-xxs);
  border-radius: var(--radius-pill);
  background: currentColor;
}

@media (prefers-reduced-motion: reduce) {
  .row,
  .settling {
    transition: none;
  }
}
</style>
