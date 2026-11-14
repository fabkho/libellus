<script setup lang="ts">
// The pair of section rows under a Book's About text (V4, docs/plans/book-actions.md; the mock's `.secrows`,
// docs/prototypes/book-actions/v4.html; docs/parity.md, the Book page's layout and *Notes, the Book page section*): the Notes
// rows (components/notes/BookSection.vue, or its plain row, components/notes/BookButton.vue) and *Read together*
// (components/together/BookRow.vue) in **one** container, so they read as one thing with two ways in rather than as two
// sections that happen to follow each other.
//
// The group owns the whole box and nothing else: the outline's spacing, the fill, the radius (the base's grouped rows:
// `rounded-md bg-fill` is the mock's `.secrows` in the app's own tokens, not its raw `--color-fill`), the half-pixel hairline
// edge (`edge-faint`, `--stroke-hairline`) and the hairline between its rows (`divide-y divide-hairline`). The rows inside draw
// no box of their own — they are the slot. A part that has nothing to say (a Notes section with no counted note) draws nothing,
// and the hairline goes with it: the box never holds an empty row.
</script>

<template>
  <div class="relative px-ml pt-xl" data-testid="book.actionPair">
    <div class="divide-y divide-hairline overflow-hidden rounded-md bg-fill edge-faint">
      <slot />
    </div>
  </div>
</template>
