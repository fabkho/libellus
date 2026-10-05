<script setup lang="ts">
// The owner's Books as Regal's row in a card (#23): the Profile's Your shelf
// (the newest, up to a cap) and a year in review (that year's, from January).
// Only the owner's screens render it (stores/shelf.ts). A card like the
// Profile's others (`bare`, in a sheet: none of that, it sits on the sheet); the row fills it edge to edge, scrolls sideways under the
// finger and lets the page scroll on; a Book tapped breaks out to the whole
// screen (ShelfRow).
//
// The 3D is fetched only once the card comes near the view (Regal and
// three.js are the `regal` chunk, `LazyShelfRow`); until it has drawn, the
// Books stand in a row of slabs in their Spines' colours (ShelfPile), the
// newest at the middle as the row starts there, or a year's January at the middle, as the row rests.
import type { ShelfBook } from '~/data/shelf'

const props = defineProps<{
  /** The Books the row shows, newest first (the stand-in's slabs). */
  books: readonly ShelfBook[]
  /** Only this year's Books, the row starting at January. */
  year?: number | null
  /** Only the newest this many Books. */
  limit?: number | null
  /** What the row is, for assistive technology. */
  label: string
  /** No surface, border or shadow: the row sits on what it stands on (inside a sheet). */
  bare?: boolean
}>()

// The stand-in shows what the row shows first: the newest, or the year's first, in the card's middle.
const STAND_IN = 28
const standIn = computed(() =>
  props.year ? [...props.books].reverse().slice(0, STAND_IN) : props.books.slice(0, STAND_IN).reverse(),
)

// Near the view (a screen above or below it): time to fetch the 3D.
const frame = ref<HTMLElement | null>(null)
const near = ref(false)
const ready = ref(false)
let observer: IntersectionObserver | null = null
onMounted(() => {
  if (typeof IntersectionObserver === 'undefined') return void (near.value = true)
  observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      near.value = true
      observer?.disconnect()
    },
    { rootMargin: '100% 0px' },
  )
  if (frame.value) observer.observe(frame.value)
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div ref="frame" class="card relative overflow-hidden rounded-lg" :class="!bare && 'bg-surface-raised shadow-raised edge-faint'" :data-ready="ready || undefined">
    <LazyShelfRow v-if="near" :year="year" :limit="limit" :label="label" class="row-3d" :class="ready && 'ready'" @ready="ready = true" />
    <Transition name="hand-over">
      <!-- Where the row stands its Books: under the months' dates, over the title of the one in focus. -->
      <div v-if="!ready" class="stand-in pointer-events-none absolute inset-x-0 flex" :class="year ? 'justify-start' : 'justify-end'">
        <ShelfPile :books="standIn" :limit="STAND_IN" axis="row" />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.card {
  height: 18rem;
}
.stand-in {
  top: 20%;
  bottom: 18%;
  /* The row stands the first Book (a year's January, else the newest) in the
     card's middle, half a slab from the centre, as it does at rest. */
  padding-inline: calc(50% - var(--spacing-sm));
}
.row-3d {
  opacity: 0;
  transition: opacity var(--duration-standard) var(--ease-standard);
}
.row-3d.ready {
  opacity: 1;
}
.hand-over-leave-active {
  transition: opacity var(--duration-standard) var(--ease-standard);
}
.hand-over-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .row-3d,
  .hand-over-leave-active {
    transition: none;
  }
}
</style>
