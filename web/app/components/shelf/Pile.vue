<script setup lang="ts">
// The shelf before its 3D (#23): the Books as Regal's Stack lays them, flat on
// top of each other with their Spines out, drawn as plain slabs in each
// Spine's colour (from the library file), as thick as the Book is long. It
// stands in while Regal and three.js load (the shelf, a year in review) and is
// the Profile card's picture. Light enough to draw at once: no images, no
// WebGL. Slabs settle in one after another over `standard`; at once with
// Reduce Motion. A Book without a colour is a quiet fill.
import type { ShelfBook } from '~/data/shelf'

const props = withDefaults(defineProps<{ books: readonly ShelfBook[]; limit?: number; settle?: boolean }>(), {
  limit: 18,
  settle: true,
})

/** A stable number from 0 to 1 per Book: its slab's width and offset never change between visits. */
function shade(id: string, salt: number): number {
  let hash = salt
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return (hash % 1000) / 1000
}

const slabs = computed(() =>
  props.books.slice(0, props.limit).map((book, index) => ({
    id: book.id,
    colour: book.spine,
    // Thickness: a typical Book (~320 pages) is three steps, from one to six.
    thickness: Math.min(6, Math.max(1, Math.round((book.pages ?? 320) / 110))),
    // Width 78–100 % of the pile, nudged sideways a little, as a hand-stacked pile is.
    width: 78 + Math.round(shade(book.id, 7) * 22),
    shift: Math.round((shade(book.id, 13) - 0.5) * 8),
    index,
  })),
)
</script>

<template>
  <div class="pile flex flex-col items-center" :class="settle && 'settle'" aria-hidden="true">
    <span
      v-for="slab in slabs"
      :key="slab.id"
      class="slab rounded-cover-sm"
      :style="{
        '--slab-colour': slab.colour ?? undefined,
        '--slab-thickness': slab.thickness,
        '--slab-width': `${slab.width}%`,
        '--slab-shift': `${slab.shift}%`,
        '--slab-index': slab.index,
      }"
    />
  </div>
</template>

<style scoped>
.pile {
  gap: var(--stroke-hairline);
}
.slab {
  display: block;
  width: var(--slab-width);
  height: calc(var(--spacing-xs) + var(--spacing-xxs) * var(--slab-thickness));
  translate: var(--slab-shift) 0;
  background-color: var(--slab-colour, var(--color-fill-strong));
  /* The page edges' light along the top, the board's shade at the bottom: a slab reads as a Book. */
  box-shadow:
    inset 0 var(--stroke-hairline) 0 color-mix(in srgb, var(--color-ink) 22%, transparent),
    inset 0 calc(var(--stroke-hairline) * -2) 0 color-mix(in srgb, var(--color-surface) 35%, transparent);
}
.settle .slab {
  animation: slab-settle var(--duration-standard) var(--ease-standard) both;
  animation-delay: calc(var(--slab-index) * var(--duration-instant) / 3);
}
@keyframes slab-settle {
  from {
    opacity: 0;
    translate: var(--slab-shift) calc(var(--spacing-sm) * -1);
  }
}
@media (prefers-reduced-motion: reduce) {
  .settle .slab {
    animation: none;
  }
}
</style>
