<script setup lang="ts">
// A Collection's Books in her order (D's collection): numbered like a reading
// list, each row a small cover, the serif title, the author and the Status,
// and a grip on the right. Dragging the grip lifts the row and the others make
// room as it passes; letting go puts it there and saves the order (Follow the
// finger: the row moves 1:1, the rest glide over `quick`). The grip is a
// button, too: with it focused, the arrow keys move the Book one place up or
// down (Home / End: to the top or the end), and a live region says where it
// went. On a phone, holding a row still lifts it as well. Tapping a row opens
// the book page. `sorted` (the page shows a sort of her order, not her order): the rows are not for
// moving then, so there is no grip (nothing to focus or drag) and holding a row does nothing.
//
// The finger's physics are `composables/useDragReorder.ts`; this screen says what the rows are, what a
// move means and what it is called in her words, and nothing about pointers.
import type { LibraryEntry } from '~/data/library'
import { offsetsFor, useDragReorder } from '~/composables/useDragReorder'
import { useBookStore } from '~/stores/book'
import { useCollectionsStore } from '~/stores/collections'

// Direct, as this screen asked before own covers: only the Library's row and the reel go through `/cover` (docs/plans/owned-covers.md §5).
const coverHosts = { ...useCoverHosts(), proxy: false }

const props = defineProps<{ collectionId: string; entries: readonly LibraryEntry[]; sorted?: boolean }>()

const { t } = useI18n()
const collections = useCollectionsStore()
const books = useBookStore()
// A move saves the order, offline too: it waits to sync (#93).

const hintId = useId()

const authorsOf = (entry: LibraryEntry) => formatAuthors(entry.book.authors, t('common.etAl'))
/** The words of the Book on a row, for the live region. */
const titleAt = (index: number) => props.entries[index]?.book.title ?? ''
/** What the polite live region says: the drag, the hold and the keyboard all word it. */
const announcement = ref('')

// ------------------------------------------------------------------- drag

const list = useTemplateRef<HTMLOListElement>('list')

/**
 * Each row's top and height in page coordinates, as laid out now: the `<ol>`'s own rows, nothing inside
 * them. The composable reads this once, at the lift, and keeps it (see its own note on the drift that
 * comes with it).
 */
function rowRects() {
  const rows = list.value ? [...list.value.querySelectorAll<HTMLElement>(':scope > li')] : []
  return rows.map((row) => {
    const rect = row.getBoundingClientRect()
    return { top: rect.top + window.scrollY, height: rect.height }
  })
}

const { drag, settling, still, gripDown, rowDown, contextmenu, clickCapture, rowTouchmove } = useDragReorder({
  count: () => props.entries.length,
  rows: rowRects,
  canLift: () => !props.sorted,
  // The move reaches the store from here, never from the composable (which holds nothing of this app):
  // `move` takes the entry's id, so a list that changed under the finger never moves the wrong Book.
  onCommit: (from, to) => collections.move(props.collectionId, props.entries[from]!.id, to),
  announce: (message) => (announcement.value = message),
  title: titleAt,
  msgs: {
    lifted: (title) => t('collection.lifted', { title }),
    moved: (title, _from, to) => t('collection.moved', { title, place: to + 1, count: props.entries.length }),
    dropped: t('collection.dropped'),
  },
})

// The list's own non-passive `touchmove`: while a row is lifted the finger moves the row, not the page. It
// goes on here (the composable hands the handler over), and both listeners the composable made for the
// window and this one are taken off in a single `onBeforeUnmount`.
onMounted(() => list.value?.addEventListener('touchmove', rowTouchmove, { passive: false }))
onBeforeUnmount(() => list.value?.removeEventListener('touchmove', rowTouchmove))

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

/**
 * Where every row sits, from `offsetsFor`: worked out once per change of the drag (the finger, a place, the
 * landing), not once per row per render.
 */
const offsets = computed(() => {
  const current = drag.value
  return current ? offsetsFor(current.rows, current.index, current.target, current.dy) : []
})

/** A row's style: its place in that table, or nothing at all while no row is lifted. */
function rowStyle(index: number) {
  const offset = offsets.value[index] ?? 0
  return offset ? { transform: `translateY(${offset}px)` } : undefined
}

// --------------------------------------------------------------- keyboard

async function onKeydown(event: KeyboardEvent, index: number) {
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
          sorted && 'pr-sm',
          drag?.index === index && 'lifted',
          drag && drag.index !== index && 'making-room',
          drag?.index === index && settling && 'settling',
          still && 'still',
        ]"
        :style="rowStyle(index)"
        :data-entry="entry.id"
        data-testid="collection.entry"
        @pointerdown="rowDown($event, index)"
        @click.capture="clickCapture"
        @contextmenu="contextmenu"
      >
        <UiPressLink
          :to="`/book/${entry.book.id}`"
          v-on="flightOf(`/book/${entry.book.id}`)"
          class="flex min-w-0 flex-1 items-center gap-ms py-sm"
          data-testid="collection.entryLink"
          @press="books.prefetch(entry.book.id)"
        >
          <span class="index figures w-(--size-star-lg) shrink-0 text-meta text-ink-faint" aria-hidden="true">{{ place(index) }}</span>
          <UiCover
            decorative
            :title="entry.book.title"
            :authors="entry.book.authors"
            v-bind="coverImage(entry.book, 'xs', coverHosts)"
            :thumbhash="entry.book.coverThumbhash"
            :colors="entry.book.coverColors"
            size="xs"
            :eager="index < 10"
          />
          <span class="flex min-w-0 flex-1 flex-col gap-xxs">
            <span class="book-title title-wrap text-body-large" data-testid="collection.entryTitle">{{ entry.book.title }}</span>
            <span class="flex min-w-0 items-center gap-sm text-caption text-ink-muted">
              <span class="truncate">{{ authorsOf(entry) }}</span>
              <span class="dot shrink-0" aria-hidden="true" />
              <span class="shrink-0" :class="entry.status === 'reading' ? 'text-accent-ink' : 'text-ink-faint'">{{ t(`status.${entry.status}`) }}</span>
            </span>
          </span>
        </UiPressLink>
        <button
          v-if="!sorted"
          type="button"
          class="grip flex size-(--size-touch) shrink-0 items-center justify-center rounded-pill disabled:opacity-50"
          :class="drag?.index === index ? 'text-ink' : 'text-ink-ghost'"
          :aria-label="t('collection.move', { title: entry.book.title })"
          :aria-describedby="hintId"
          data-grip
          data-testid="collection.grip"
          @pointerdown="gripDown($event, index)"
          @keydown="onKeydown($event, index)"
          @click.prevent
        >
          <UiIcon name="grip" :size="18" />
        </button>
      </li>
    </ol>
    <p v-if="!sorted" :id="hintId" class="sr-only">{{ t('collection.moveHint') }}</p>
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
