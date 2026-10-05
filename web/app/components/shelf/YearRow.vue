<script setup lang="ts">
// A year in review's Books as Regal's row (#23), for the owner only (the page
// renders it for her alone, stores/shelf.ts): the Books of the library file
// finished that year, from January at the left, a sheet and the month between
// months, in a card under the months. The row scrolls sideways and lets the
// page scroll on; a Book tapped breaks out to the whole screen (ShelfRow).
// Before the library file has come (no Books yet) it stands without its
// count, the card holding the stand-in's slabs, as the Profile's does.
import type { ShelfBook } from '~/data/shelf'

defineProps<{ year: number; books: readonly ShelfBook[] }>()
const { t } = useI18n()
const { count } = useFigures()
</script>

<template>
  <section id="shelf" :aria-label="t('shelf.year.title')" class="flex flex-col gap-md" data-testid="yearInReview.shelf">
    <div class="flex h-(--size-button-sm) items-center gap-md">
      <h2 class="eyebrow">
        {{ t('shelf.year.title') }}
        <span v-if="books.length" class="figures ml-xs text-ink-ghost" data-testid="yearInReview.shelfCount">{{ count(books.length) }}</span>
      </h2>
    </div>
    <ShelfRowCard :books="books" :year="year" :label="t('shelf.year.rowLabel', { year })" data-testid="yearInReview.shelfRow" />
  </section>
</template>
