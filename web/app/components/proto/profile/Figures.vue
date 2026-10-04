<script setup lang="ts">
// Design round #78: A's four figures — books, pages, average, days a book —
// for a year or all of them, each with a mono line under it.
import { FIRST_DAY, TODAY, YEARS, average, n, type Stats } from './model'

const props = defineProps<{ stats: Stats }>()
const isAll = computed(() => props.stats.year === 'all')
/** Under the count: the re-reads and the books not finished (#10's DNF), else the pace. */
const booksLine = computed(() => {
  const parts = [props.stats.rereads.length ? `${props.stats.rereads.length} read again` : null, props.stats.abandoned.length ? `${props.stats.abandoned.length} DNF` : null].filter(Boolean)
  if (parts.length) return parts.join(' · ')
  if (isAll.value) return `${(props.stats.books / ((YEARS.length - 1) * 12 + Number(TODAY.slice(5, 7)) - Number(FIRST_DAY.slice(5, 7)) + 1)).toFixed(1)} a month`
  return '\u00a0'
})
</script>

<template>
  <section class="grid grid-cols-2 border-y-(length:--stroke-hairline) border-hairline-strong" data-testid="proto.figures">
    <div class="flex flex-col gap-xs border-r-(length:--stroke-hairline) border-b-(length:--stroke-hairline) border-hairline py-md pr-md">
      <span class="eyebrow">Books</span>
      <span class="text-figure tabular-nums" data-testid="proto.books">{{ stats.books }}</span>
      <span class="figures truncate text-meta text-ink-faint">{{ booksLine }}</span>
    </div>
    <div class="flex flex-col gap-xs border-b-(length:--stroke-hairline) border-hairline py-md pl-md">
      <span class="eyebrow">Pages</span>
      <span class="text-figure tabular-nums">{{ stats.pages >= 10000 ? `${(stats.pages / 1000).toFixed(1)}k` : n(stats.pages) }}</span>
      <span class="figures text-meta text-ink-faint">{{ stats.pagesMissing ? `${stats.pagesMissing} without a count` : `${n(Math.round(stats.pages / Math.max(stats.books, 1)))} a book` }}</span>
    </div>
    <div class="flex flex-col gap-xs border-r-(length:--stroke-hairline) border-hairline py-md pr-md">
      <span class="eyebrow">Average</span>
      <span class="text-figure tabular-nums">{{ average(stats.average) }}</span>
      <span class="figures text-meta text-ink-faint">{{ stats.unrated ? `${stats.unrated} not rated yet` : `${stats.rated} rated` }}</span>
    </div>
    <div class="flex flex-col gap-xs py-md pl-md">
      <span class="eyebrow">Days a book</span>
      <span class="text-figure tabular-nums">{{ stats.medianDays ?? '–' }}</span>
      <span class="figures text-meta text-ink-faint">usually, start to finish</span>
    </div>
  </section>
</template>
