<script setup lang="ts">
// Design round #78, A + B: the authors read more than once — B's fan of their
// covers, the name, A's tally marks and the count; the average in mono.
import { average, type Stats } from './model'

withDefaults(defineProps<{ stats: Stats; limit?: number }>(), { limit: 5 })
</script>

<template>
  <section v-if="stats.authors.length" id="authors" class="flex flex-col gap-xs" data-testid="proto.authors">
    <h2 class="eyebrow mb-xs">Authors you return to</h2>
    <div v-for="a in stats.authors.slice(0, limit)" :key="a.name" class="flex items-center gap-md py-xs">
      <span class="fan relative flex shrink-0" aria-hidden="true">
        <UiCover
          v-for="(b, i) in a.books.slice(-3).reverse()"
          :key="b.key"
          :style="{ '--i': i }"
          :title="b.title"
          :authors="b.authors"
          :src="coverSrc(b.cover, 'sm')"
          :thumbhash="b.thumbhash"
          :colors="b.colors"
          size="sm"
        />
      </span>
      <span class="flex min-w-0 flex-1 flex-col gap-xs">
        <span class="truncate text-body">{{ a.name }}</span>
        <span class="ticks" aria-hidden="true"><span v-for="i in a.count" :key="i" class="tick" :class="{ fifth: i % 5 === 0 }" /></span>
      </span>
      <span class="flex shrink-0 flex-col items-end gap-xxs">
        <span class="text-title tabular-nums">{{ a.count }}</span>
        <span v-if="a.rating" class="figures text-meta text-ink-faint">★ {{ average(a.rating) }}</span>
      </span>
    </div>
  </section>
</template>

<style scoped>
.fan {
  width: calc(var(--size-cover-sm) + 2 * var(--spacing-ms));
}
.fan > * {
  position: relative;
  z-index: calc(3 - var(--i));
}
.fan > * + * {
  margin-left: calc(var(--spacing-ms) - var(--size-cover-sm));
}
.ticks {
  display: flex;
  gap: var(--spacing-xs);
}
.tick {
  width: var(--stroke-rule);
  height: var(--spacing-ms);
  background: var(--color-ink-faint);
}
.tick.fifth {
  margin-right: var(--spacing-xs);
}
</style>
