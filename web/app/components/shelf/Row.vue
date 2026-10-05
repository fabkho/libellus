<script setup lang="ts">
// Regal's row (the layer's RegalBooksRow, #23): the Stack turned on its side,
// one horizontal row of Spines for a card (the Profile's Your shelf, a year in
// review). Like `ShelfStage`, only ever loaded through `LazyShelfRow`, so it
// and Regal stay in the `regal` chunk (regal.config.ts) that only the owner's
// screens fetch; it brings Regal's fonts with it.
//
// The row scrolls sideways under the finger and lets the page scroll up and
// down. A Book tapped breaks out: it comes to the middle of the whole screen,
// its details in Regal's sheet (a phone) or card (wider), over the header and
// the tab bar (`--regal-row-z-index` below), and lands back in the row on Back
// (the round button, Escape, a tap beside it, or the system's Back, which
// Regal answers with a history entry of its own: useBackDismiss keeps the
// router out of it). It fills the box it is put in (a positioned one).
import '#build/nuxt-fonts-global.css'

const props = defineProps<{
  /** Only the Books finished in this year, starting at January; null for the newest of all. */
  year?: number | null
  /** Only the newest this many Books; null for all of them. */
  limit?: number | null
  /** What the row is, for assistive technology. */
  label?: string
}>()
const emit = defineEmits<{
  /** The Library is in and the row is drawing it (or Regal is showing why it can't). */
  ready: []
}>()

const { books, error } = useLibrary()
let told = false
watch(
  [books, error],
  () => {
    if (told || (!books.value.length && !error.value)) return
    told = true
    // A frame for the canvas to take its size and draw the first Spines.
    requestAnimationFrame(() => emit('ready'))
  },
  { immediate: true, flush: 'post' },
)
</script>

<template>
  <RegalBooksRow class="shelf-row" inspect="viewport" :year="props.year ?? null" :limit="props.limit ?? null" :label="props.label ?? ''" />
</template>

<style scoped>
/* It fills the box its card gives it. Doubled class: Regal's own rule for its
   root (a minimum height) is as specific and may load later. */
.shelf-row.shelf-row {
  position: absolute;
  inset: 0;
  min-height: 0;
}
</style>

<style>
/* A Book broken out of the row is drawn in a box Regal moves to <body>, over
   the whole screen: above the header and the tab bar (z 20), the search (30,
   40) and a cover's flight (45), under the barcode scanner (80), which never
   opens over the Profile. */
:root {
  --regal-row-z-index: 50;
}
</style>
