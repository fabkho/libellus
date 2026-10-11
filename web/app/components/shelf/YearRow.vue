<script setup lang="ts">
// A year in review's Books as Regal's row (#23), every member's own
// (stores/shelf.ts): the Books of her shelf finished that year, from January at the left, a sheet and the month between
// months, in a card under the months. The row scrolls sideways and lets the
// page scroll on; a Book tapped breaks out to the whole screen (ShelfRow).
// Show all opens that year's Stack full screen (`/profile/shelf?year=`, #214).
// Before the library file has come (no Books yet) it stands without its
// count, the card its plain surface, as the Profile's does.
import type { ShelfBook } from '~/data/shelf'

defineProps<{ year: number; books: readonly ShelfBook[] }>()
const { t } = useI18n()
const { count } = useFigures()
</script>

<template>
  <section id="shelf" :aria-label="t('shelf.year.title')" class="flex flex-col gap-md" data-testid="yearInReview.shelf">
    <div class="flex h-(--size-button-sm) items-center justify-between gap-md">
      <h2 class="eyebrow">
        {{ t('shelf.year.title') }}
        <span v-if="books.length" class="figures ml-xs text-ink-faint" data-testid="yearInReview.shelfCount">{{ count(books.length) }}</span>
      </h2>
      <UiButton
        v-if="books.length"
        tone="quiet"
        size="sm"
        :to="`/profile/shelf?year=${year}`"
        :aria-label="t('shelf.year.allLabel', { year, count: count(books.length) }, books.length)"
        data-testid="yearInReview.shelfAll"
      >
        {{ t('shelf.card.all') }}<UiIcon name="chevron" :size="13" />
      </UiButton>
    </div>
    <ShelfRowCard :year="year" :label="t('shelf.year.rowLabel', { year })" data-testid="yearInReview.shelfRow" />
  </section>
</template>
