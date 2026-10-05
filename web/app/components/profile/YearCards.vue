<script setup lang="ts">
// The years in review (issue #78, B's cards): one card per year with a
// finished read, newest first, lit by that year's favourite cover — the year
// large, how many books, the favourite's cover and title. Each opens its year
// in review. Scrolls sideways without a scroll bar.
import type { YearFigures } from '~/data/stats'

defineProps<{ years: readonly YearFigures[] }>()
const { t } = useI18n()
const { count } = useFigures()
</script>

<template>
  <section id="years" class="flex flex-col gap-md" data-testid="profile.yearCards">
    <h2 class="eyebrow">{{ t('profile.years.title') }}</h2>
    <div class="scrollbar-none -mx-screen flex gap-ms overflow-x-auto px-screen pb-md">
      <NuxtLink
        v-for="y in years"
        :key="y.year"
        :to="`/profile/${y.year}`"
        class="card relative flex shrink-0 flex-col gap-sm overflow-hidden rounded-lg bg-surface-raised p-inset shadow-raised edge-faint active:opacity-80"
        :data-testid="`profile.yearCard.${y.year}`"
      >
        <UiAmbient :colors="y.favourite?.book.coverColors ?? null" shape="card" />
        <span class="relative flex items-start justify-between gap-sm">
          <span class="flex flex-col gap-xs">
            <span class="text-figure tabular-nums">{{ y.year }}</span>
            <span class="figures text-meta text-ink-muted">{{ t('profile.years.books', { count: count(y.books) }, y.books) }}</span>
          </span>
          <UiCover
            v-if="y.favourite"
            :title="y.favourite.book.title"
            :authors="y.favourite.book.authors"
            :src="coverSrc(y.favourite.book.coverUrl, 'md')"
            :thumbhash="y.favourite.book.coverThumbhash"
            :colors="y.favourite.book.coverColors"
            size="md"
            glow
          />
        </span>
        <span v-if="y.favourite" class="relative mt-auto flex flex-col gap-xxs">
          <span class="eyebrow">{{ t('profile.years.favourite') }}</span>
          <span class="book-title truncate text-callout">{{ y.favourite.book.title }}</span>
        </span>
      </NuxtLink>
    </div>
  </section>
</template>

<style scoped>
.card {
  width: calc(var(--size-cover-xl) * 1.6);
  min-height: calc(var(--size-cover-xl) * 1.2);
}
</style>
