<script setup lang="ts">
// The owner's Books as Regal's row in a card (#23): the Profile's Your shelf
// (the newest, up to a cap) and a year in review (that year's, from January).
// Only the owner's screens render it (stores/shelf.ts). A card like the
// Profile's others (`bare`, in a sheet: none of that, it sits on the sheet); the row fills it edge to edge, scrolls sideways under the
// finger and lets the page scroll on; a Book tapped breaks out to the whole
// screen (ShelfRow).
//
// The card keeps its size (18rem) whatever is in it, so nothing shifts when
// the row arrives. The row appears with its intro and no loading step of
// ours: the owner's screens have already warmed Regal's chunk, the library file
// and the first Spines (useShelfPreload), so it draws its Spines on its first
// frame. While nothing is drawn (a first visit with no head start) the card is
// its plain surface: no slabs, no spinner.
//
// The row mounts as the card comes into the view, not with its screen: its
// intro plays once per mount, and on the Profile the card sits well below the
// figures, where an intro that played on arrival would be over before she
// scrolled to it. A screen away it asks for the warm-up again (the same call
// the shell made on idle, shared with it): a head start for a visit that came
// straight to the card.
import { warmShelfRow } from '~/composables/useShelfPreload'

const props = defineProps<{
  /** Only this year's Books, the row starting at January. */
  year?: number | null
  /** Only the newest this many Books. */
  limit?: number | null
  /** What the row is, for assistive technology. */
  label: string
  /** No surface, border or shadow: the row sits on what it stands on (inside a sheet). */
  bare?: boolean
}>()

const frame = ref<HTMLElement | null>(null)
/** The card is in view: the row mounts, and plays its intro where it is seen. */
const shown = ref(false)
const observers: IntersectionObserver[] = []

/** Calls `then` once, the first time the card comes within `margin` of the view. */
function once(margin: string, then: () => void) {
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      then()
    },
    { rootMargin: margin },
  )
  observers.push(observer)
  if (frame.value) observer.observe(frame.value)
}

onMounted(() => {
  if (typeof IntersectionObserver === 'undefined') return void (shown.value = true)
  // A screen away: warm it (shared with the shell's warm-up when that has run).
  once('100% 0px', () => warmShelfRow(props.year ?? null))
  // Its top edge in the upper three quarters of the view: the intro is seen.
  once('0px 0px -25% 0px', () => (shown.value = true))
})
onBeforeUnmount(() => observers.forEach((observer) => observer.disconnect()))
</script>

<template>
  <div ref="frame" class="card relative overflow-hidden rounded-lg" :class="!bare && 'bg-surface-raised shadow-raised edge-faint'">
    <LazyShelfRow v-if="shown" :year="year" :limit="limit" :label="label" />
  </div>
</template>

<style scoped>
.card {
  height: 18rem;
}
</style>
