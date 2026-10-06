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
// the tab bar (`--regal-row-z-index` below), and lands back in the row on
// BookSheet's Done, Escape, a tap beside it, a drag of the sheet's grabber or
// the system's Back, which Regal answers with a history entry of its own
// (useBackDismiss keeps the router out of it). Regal's round Back is off
// (`:back-button="false"`): Done is the one way the sheet shows. It fills the
// box it is put in (a positioned one).
//
// It wears the app's theme, light or dark, as the card it stands in does:
// `regal-themed` maps Regal's `--regal-*` tokens onto D's, and `theme="auto"`
// follows the nearest `data-theme` (the app's), also for the parts Regal moves
// to <body> when a Book breaks out. The details' meta line and actions are
// D's own (BookSheet, through Regal's `#detail` slot): a quieter cousin of the
// app's sheets, where the shelf page's Stack (ShelfStage) uses D's pills.
import '#build/nuxt-fonts-global.css'
import '~/assets/css/regal-themed.css'

const props = defineProps<{
  /** Only the Books finished in this year, starting at January; null for the newest of all. */
  year?: number | null
  /** Only the newest this many Books; null for all of them. */
  limit?: number | null
  /** What the row is, for assistive technology. */
  label?: string
}>()

// The card mounts the row with its screen, so one can be up while the file is still on its way and fail
// with it (the Profile then says so and offers Try again). Regal keeps that failure for the page, and the
// row mounted again on the retry would show it instead of asking: forget it, so the new row reads the file afresh.
const { error } = useLibrary()
if (error.value) useState<string | null>('regal:library-loaded').value = null
</script>

<template>
  <RegalBooksRow class="shelf-row regal-themed" theme="auto" inspect="viewport" :year="props.year ?? null" :limit="props.limit ?? null" :label="props.label ?? ''" :back-button="false">
    <!-- The whole details, Libellus' own (BookSheet): Regal keeps the container, its fade and the Book's gestures. -->
    <template #detail="{ book, close, flip, face, sheet }">
      <ShelfBookSheet :book="book" :face="face" :sheet="sheet" @close="close" @flip="flip" />
    </template>
  </RegalBooksRow>
</template>

<style scoped>
/* It fills the box its card gives it. Doubled class: Regal's own rule for its
   root (a minimum height) is as specific and may load later. */
.shelf-row.shelf-row {
  position: absolute;
  inset: 0;
  min-height: 0;
}

/* A Book broken out of the row is drawn in a box Regal moves to <body>, over
   the whole screen: above the header and the tab bar (z 20), the search (30,
   40) and a cover's flight (45), under the barcode scanner (80), which never
   opens over the Profile. Regal carries the token to <body> with the box.
   A row inside a sheet (z 50; Home's "Read in 2026") has to break out above
   it: the sheet sets `--shelf-row-z` (55, under a dialog's 60) and the row
   takes it, as the sheet's content inherits it. */
.shelf-row {
  --regal-row-z-index: var(--shelf-row-z, 50);
}
</style>
