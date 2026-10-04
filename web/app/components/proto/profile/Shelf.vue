<script setup lang="ts">
// Design round #78: a shelf of covers that scrolls sideways past the screen's
// edge (B's five stars), with its count.
import type { Read } from './model'

defineProps<{ title: string; reads: readonly Read[]; testid: string }>()
</script>

<template>
  <section v-if="reads.length" id="fives" class="flex flex-col gap-sm" :data-testid="testid">
    <div class="flex items-baseline justify-between">
      <h2 class="eyebrow">{{ title }}</h2>
      <span class="figures text-meta text-ink-faint">{{ reads.length }}</span>
    </div>
    <div class="-mx-screen flex gap-ms overflow-x-auto px-screen pt-xs pb-md">
      <UiCover
        v-for="r in reads"
        :key="r.id"
        class="shrink-0"
        :title="r.book.title"
        :authors="r.book.authors"
        :src="coverSrc(r.book.cover, 'md')"
        :thumbhash="r.book.thumbhash"
        :colors="r.book.colors"
        size="md"
      />
    </div>
  </section>
</template>
