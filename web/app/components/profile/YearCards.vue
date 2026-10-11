<script setup lang="ts">
// The years in review (issue #78, B's cards): one card per year with a
// finished read, newest first, lit by that year's favourite cover — the year
// large, how many books, the favourite's cover and title. Each opens its year
// in review. Scrolls sideways without a scroll bar. While the reading record
// loads (`years` null), three cards stand with placeholders where the year,
// its count, the cover and the title will be, in the loading wave
// (docs/MOTION.md, Loading).
import type { YearFigures } from '~/data/stats'

// `base`: where a year opens, the Profile's own by default (another member's profile: `/friends/<member>`).
const props = withDefaults(defineProps<{ years: readonly YearFigures[] | null; base?: string }>(), { base: '/profile' })
const { t } = useI18n()
const { count } = useFigures()
const arriving = useArrival(() => !props.years)
</script>

<template>
  <section id="years" class="flex flex-col gap-md" data-testid="profile.yearCards">
    <h2 class="eyebrow">{{ t('profile.years.title') }}</h2>
    <div class="scrollbar-none -mx-screen flex gap-ms overflow-x-auto px-screen pb-md">
      <template v-if="!years">
        <span v-for="i in 3" :key="i" class="card flex shrink-0 flex-col gap-sm rounded-lg bg-surface-raised p-inset shadow-raised edge-faint" aria-hidden="true">
          <span class="flex items-start justify-between gap-sm">
            <span class="flex flex-col gap-xs">
              <span class="line figure-line"><span class="skeleton wave w-(--spacing-xxxl)" :style="{ '--wave': (i - 1) * 0.2 }" /></span>
              <span class="line meta-line"><span class="skeleton wave w-(--spacing-xxl)" :style="{ '--wave': (i - 1) * 0.2 + 0.05 }" /></span>
            </span>
            <span class="cover skeleton wave" :style="{ '--wave': (i - 1) * 0.2 + 0.1 }" />
          </span>
          <span class="mt-auto flex flex-col gap-xxs">
            <span class="line eyebrow-line"><span class="skeleton wave w-1/3" :style="{ '--wave': (i - 1) * 0.2 + 0.15 }" /></span>
            <span class="line callout-line"><span class="skeleton wave w-2/3" :style="{ '--wave': (i - 1) * 0.2 + 0.2 }" /></span>
          </span>
        </span>
      </template>
      <NuxtLink
        v-for="y in years ?? []"
        :key="y.year"
        :to="`${base}/${y.year}`"
        class="card relative flex shrink-0 flex-col gap-sm overflow-hidden rounded-lg bg-surface-raised p-inset shadow-raised edge-faint active:opacity-80"
        :class="{ arrive: arriving }"
        :data-testid="`profile.yearCard.${y.year}`"
      >
        <UiAmbient :colors="y.favourite?.book.coverColors ?? null" shape="card" />
        <span class="relative flex items-start justify-between gap-sm">
          <span class="flex flex-col gap-xs">
            <span class="text-figure tabular-nums">{{ y.year }}</span>
            <span class="figures text-meta text-ink-muted">{{ t('profile.years.books', { count: count(y.books) }, y.books) }}</span>
          </span>
          <UiCover
            decorative
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
          <span class="book-title title-wrap text-callout">{{ y.favourite.book.title }}</span>
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
/* The placeholders' lines at the heights of the text they stand for. */
.line {
  display: flex;
  align-items: center;
}
.line > * {
  height: 62%;
}
.figure-line {
  height: var(--text-figure--line-height);
}
.meta-line {
  height: var(--text-meta--line-height);
}
.eyebrow-line {
  height: var(--text-eyebrow--line-height);
}
.callout-line {
  height: var(--text-callout--line-height);
}
/* The favourite's cover (UiCover `md`). */
.cover {
  flex-shrink: 0;
  width: var(--size-cover-md);
  aspect-ratio: 2 / 3;
  border-radius: var(--radius-cover);
}
</style>
