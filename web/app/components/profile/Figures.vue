<script setup lang="ts">
// A year's four figures (issue #78, A's grid): Books (with the re-reads and
// the DNF under it), Pages (with the reads without a count, or the pages a
// book), the Average Rating (with the ones not rated yet) and the Days a book
// (the median from start to finish). Between hairlines, two by two.
import type { YearFigures } from '~/data/stats'

const props = defineProps<{ figures: YearFigures }>()
const { t } = useI18n()
const { count, large, stars } = useFigures()

const booksLine = computed(() => {
  const f = props.figures
  const parts = [f.rereads ? t('profile.figures.rereads', { count: count(f.rereads) }) : null, f.abandoned ? t('profile.figures.dnf', { count: count(f.abandoned) }) : null]
  return parts.filter(Boolean).join(' · ')
})
const pagesLine = computed(() => {
  const f = props.figures
  if (f.pagesMissing) return t('profile.figures.pagesMissing', { count: count(f.pagesMissing) })
  return f.books ? t('profile.figures.pagesPerBook', { count: count(Math.round(f.pages / f.books)) }) : ''
})
const averageLine = computed(() => {
  const f = props.figures
  if (f.unrated) return t('profile.figures.unrated', { count: count(f.unrated) })
  return f.rated ? t('profile.figures.rated', { count: count(f.rated) }) : ''
})
</script>

<template>
  <section class="grid grid-cols-2 border-y-(length:--stroke-hairline) border-hairline-strong" data-testid="profile.figures">
    <div class="cell flex min-w-0 flex-col gap-xs border-r-(length:--stroke-hairline) border-b-(length:--stroke-hairline) border-hairline py-md pr-md">
      <span class="eyebrow">{{ t('profile.figures.books') }}</span>
      <span class="text-figure tabular-nums" data-testid="profile.books">{{ count(figures.books) }}</span>
      <span class="figures truncate text-meta text-ink-faint" data-testid="profile.booksLine">{{ booksLine }}</span>
    </div>
    <div class="cell flex min-w-0 flex-col gap-xs border-b-(length:--stroke-hairline) border-hairline py-md pl-md">
      <span class="eyebrow">{{ t('profile.figures.pages') }}</span>
      <span class="text-figure tabular-nums" data-testid="profile.pages">{{ large(figures.pages) }}</span>
      <span class="figures truncate text-meta text-ink-faint">{{ pagesLine }}</span>
    </div>
    <div class="cell flex min-w-0 flex-col gap-xs border-r-(length:--stroke-hairline) border-hairline py-md pr-md">
      <span class="eyebrow">{{ t('profile.figures.average') }}</span>
      <span class="text-figure tabular-nums" data-testid="profile.average">{{ stars(figures.average) }}</span>
      <span class="figures truncate text-meta text-ink-faint">{{ averageLine }}</span>
    </div>
    <div class="cell flex min-w-0 flex-col gap-xs py-md pl-md">
      <span class="eyebrow">{{ t('profile.figures.daysABook') }}</span>
      <span class="text-figure tabular-nums" data-testid="profile.daysABook">{{ figures.medianDays === null ? '–' : count(figures.medianDays) }}</span>
      <span class="figures truncate text-meta text-ink-faint">{{ t('profile.figures.usually') }}</span>
    </div>
  </section>
</template>

<style scoped>
/* A line with nothing to say keeps its height, so the four cells line up. */
.cell > :last-child {
  min-height: var(--text-meta--line-height);
}
</style>
