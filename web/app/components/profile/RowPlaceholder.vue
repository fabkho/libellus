<script setup lang="ts">
// A Profile row while the reading record loads (docs/MOTION.md, Loading): the
// box of its small cover and the lines of its text as placeholders, at the
// height of the row that will take its place — a record's (`label` over the
// title, `figure` at the right) or an author's (a fan of covers, the name and
// the tally, the count at the right). `wave` is its place in the loading wave.
// Hidden from assistive tech: there is nothing to read yet.
withDefaults(defineProps<{ wave?: number; label?: boolean; figure?: boolean; fan?: boolean }>(), { wave: 0, label: false, figure: false, fan: false })
</script>

<template>
  <div v-if="fan" class="flex items-center gap-md py-xs" aria-hidden="true">
    <span class="fan flex shrink-0">
      <span class="cover skeleton wave" :style="{ '--wave': wave }" />
      <span v-for="i in 2" :key="i" class="edge-of-cover wave" :style="{ '--wave': wave + i * 0.03 }" />
    </span>
    <span class="flex min-w-0 flex-1 flex-col gap-xs">
      <span class="line body"><span class="skeleton wave w-3/5" :style="{ '--wave': wave + 0.05 }" /></span>
      <span class="line tally"><span class="skeleton wave w-1/4" :style="{ '--wave': wave + 0.1 }" /></span>
    </span>
    <span class="line title"><span class="skeleton wave w-(--spacing-ml)" :style="{ '--wave': wave + 0.15 }" /></span>
  </div>
  <div v-else class="flex items-center gap-inset py-sm" aria-hidden="true">
    <span class="cover skeleton wave" :style="{ '--wave': wave }" />
    <span class="flex min-w-0 flex-1 flex-col gap-xxs">
      <span v-if="label" class="line eyebrow-line"><span class="skeleton wave w-1/4" :style="{ '--wave': wave + 0.05 }" /></span>
      <span class="line callout"><span class="skeleton wave w-3/5" :style="{ '--wave': wave + 0.1 }" /></span>
    </span>
    <span v-if="figure" class="line caption"><span class="skeleton wave w-(--spacing-xxl)" :style="{ '--wave': wave + 0.15 }" /></span>
  </div>
</template>

<style scoped>
/* A small cover's box (UiCover `sm`). */
.cover {
  flex-shrink: 0;
  width: var(--size-cover-sm);
  aspect-ratio: 2 / 3;
  border-radius: var(--radius-cover-sm);
}
/* An author's fan, as ProfileAuthors lays it: the first cover, and of the two behind it the edge that shows. */
.fan {
  width: calc(var(--size-cover-sm) + 2 * var(--spacing-ms));
}
.edge-of-cover {
  width: var(--spacing-ms);
  border-radius: 0 var(--radius-cover-sm) var(--radius-cover-sm) 0;
  background: var(--color-fill);
}
/* A line of text: its line height, with a bar about as tall as its letters. */
.line {
  display: flex;
  align-items: center;
}
.line > * {
  height: 62%;
}
.eyebrow-line {
  height: var(--text-eyebrow--line-height);
}
.callout {
  height: var(--text-callout--line-height);
}
.caption {
  height: var(--text-caption--line-height);
}
.body {
  height: var(--text-body--line-height);
}
.tally {
  height: var(--spacing-ms);
}
.title {
  height: var(--text-title--line-height);
}
</style>
