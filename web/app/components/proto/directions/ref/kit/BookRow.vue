<script setup lang="ts">
// One Book in a list: cover, title, author, then whatever the list adds —
// `meta` under the author (dates, Rating, source), `trailing` on the right.
import { formatAuthors } from '../../../data'
import Cover from './Cover.vue'

defineProps<{ book: { title: string; authors: string[]; coverUrl: string | null }; coverWidth?: number }>()
</script>

<template>
  <div class="flex items-center gap-3 border-b border-neutral-200 py-[10px]">
    <Cover :book="book" :width="coverWidth ?? 44" />
    <div class="flex min-w-0 flex-1 flex-col gap-[2px]">
      <span class="truncate text-[16px] leading-snug font-semibold">{{ book.title }}</span>
      <span class="truncate text-[14px] text-neutral-600">{{ formatAuthors(book.authors) }}</span>
      <slot name="meta" />
    </div>
    <slot name="trailing" />
  </div>
</template>
