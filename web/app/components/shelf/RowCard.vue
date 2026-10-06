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
// The row mounts with its screen, even below the fold: it draws its Spines
// off screen, and Regal holds its intro until the card is first seen
// (`intro="visible"`, fabkho/regal#80), so the Books are there the moment she
// scrolls to them and the intro plays where it is seen.
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

// A head start for a visit that came straight here (shared with the shell's warm-up when that has run).
onMounted(() => warmShelfRow(props.year ?? null))
</script>

<template>
  <div ref="frame" class="card relative overflow-hidden rounded-lg" :class="!bare && 'bg-surface-raised shadow-raised edge-faint'">
    <LazyShelfRow :year="year" :limit="limit" :label="label" />
  </div>
</template>

<style scoped>
.card {
  height: 18rem;
}
</style>
