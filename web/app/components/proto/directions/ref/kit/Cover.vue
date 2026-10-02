<script setup lang="ts">
// A Book's cover at a fixed width (2:3), or the Placeholder cover — title and
// author on a plain surface — when there is no image (Manual books).
import { formatAuthors } from '../../../data'

defineProps<{
  book: { title: string; authors: string[]; coverUrl: string | null }
  /** Width in px; height follows 2:3. */
  width: number
}>()
</script>

<template>
  <div
    class="relative shrink-0 overflow-hidden rounded-[3px] border border-neutral-300 bg-neutral-200"
    :style="{ width: `${width}px`, height: `${Math.round(width * 1.5)}px` }"
  >
    <img v-if="book.coverUrl" :src="book.coverUrl" :alt="book.title" class="size-full object-cover" />
    <div v-else class="flex size-full flex-col justify-between p-[8%] text-neutral-600">
      <span class="text-[11px] leading-tight font-semibold" :style="{ fontSize: `${Math.max(8, width / 9)}px` }">{{
        book.title
      }}</span>
      <span class="text-[10px] leading-tight" :style="{ fontSize: `${Math.max(7, width / 12)}px` }">{{
        formatAuthors(book.authors)
      }}</span>
    </div>
  </div>
</template>
