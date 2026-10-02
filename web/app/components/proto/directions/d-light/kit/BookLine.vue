<script setup lang="ts">
// The book a sheet is about: small cover, title, author — so the sheet keeps
// its context while it covers the page.
import { formatAuthors } from '../../../data'
import Cover from './Cover.vue'

defineProps<{ book: { title: string; authors: string[]; coverUrl: string | null } }>()
</script>

<template>
  <div class="k-bookline">
    <Cover :book="book" :width="30" />
    <div class="text">
      <span class="dl-title title dl-truncate">{{ book.title }}</span>
      <span class="author dl-truncate">{{ formatAuthors(book.authors) }}</span>
    </div>
  </div>
</template>

<style scoped>
.k-bookline {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 2px 0 14px;
}

.text {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.title {
  font-size: calc(16px * var(--dl-title-k));
  line-height: 1.15;
}

.author {
  font-size: 13px;
  color: var(--dl-ink-3);
}
</style>
