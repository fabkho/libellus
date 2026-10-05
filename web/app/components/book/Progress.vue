<script setup lang="ts">
// How far the member is in a Book they are reading, on the book page (issues
// #39, #68; design round #65, direction D): the hairline bar in the lamp
// colour; four figures: the page "of 608" (the page count that counts, a tap
// away from her own total, #60) or, without a page count, the percent read
// with "Add pages"; how much is done (or left); the pace a day; the days to go.
// Then the last three weeks as bars, today lit, and "Last time · Yesterday · 24
// pages" with Update progress, which opens the sheet. Nothing here edits by
// itself. The reading log sits under the book's actions (ProgressLog.vue).
// The bar and the row under it (the value in words at the left, Update progress
// at the right) are always there, so a read never tracked has the tracked layout's
// skeleton (issue #81, after #79): its row says "Not started · 224 pages". The
// figures, chart and "Last time" open in below the row with a fade (UiReveal, the
// rule is `progressShownOf`), so the first save moves nothing but the fill and the
// words; a value without a day yet shows the figures but no chart.
// Updating works offline too: it waits to sync (#93).
import type { LibraryEntry } from '~/data/library'
import { progressFraction, progressOf } from '~/data/progress'
import { progressStarted } from '~/data/progressDays'
import { useReadingStore } from '~/stores/reading'

const props = defineProps<{ entry: LibraryEntry }>()

const { t, n } = useI18n()
const reading = useReadingStore()
const text = useProgressText()
const {
  pageCount,
  unit,
  position,
  end,
  atEnd,
  amounts,
  pace,
  daysLeft,
  lastTime,
  shown,
  dayWords,
  amountWords,
} = useReadingDays(() => props.entry)

const progress = computed(() => progressOf(props.entry.latestSession))
const words = computed(() => text(progress.value, pageCount.value))
const pages = computed(() => unit.value === 'page')
const done = computed(() => Math.round((Math.min(position.value, end.value) / end.value) * 100))
const own = computed(() => props.entry.pageCountOverride != null)
const started = computed(() => progressStarted(progress.value))
// What the row says before anything is tracked (#81): where the read stands and how long the book is.
const notStarted = computed(() => {
  if (progress.value && 'percent' in progress.value) return t('book.progress.notStartedPercent')
  return pageCount.value ? t('book.progress.notStarted', { count: n(pageCount.value) }, pageCount.value) : t('book.progress.notStartedNoCount')
})
const chart = computed(() => amounts(21))
const chartLabel = computed(() =>
  t('book.progress.chartLabel', { count: 21, amount: amountWords(chart.value.reduce((sum, d) => sum + d.amount, 0)) }),
)
</script>

<template>
  <div class="mb-ml" data-testid="book.progress">
    <UiProgress
      :fraction="progressFraction(progress, pageCount)"
      :label="t('book.progress.label')"
      :value-text="words.value"
      data-testid="book.progressBar"
    />
    <div class="flex items-center justify-between gap-ms pt-sm">
      <p class="figures min-w-0 truncate text-meta" :class="started ? 'text-ink-muted' : 'text-ink-faint'" data-testid="book.progressText">
        {{ started ? words.value : notStarted }}
      </p>
      <UiButton tone="quiet" size="sm" class="shrink-0" data-testid="book.updateProgress" @click="reading.openProgress(entry)">
        {{ t('book.progress.update') }}
      </UiButton>
    </div>

    <UiReveal :show="shown !== 'none'" data-testid="book.progressStats">
      <div class="pt-md">
        <dl class="grid grid-cols-4 gap-sm" data-testid="book.progressFigures">
          <div class="flex flex-col gap-xs">
            <dt class="eyebrow">{{ pages ? t('book.progress.figurePage') : t('book.progress.figureRead') }}</dt>
            <dd class="figures text-callout" data-testid="book.progressValue">
              {{ pages ? n(position) : t('book.progress.percent', { percent: position }) }}
            </dd>
            <dd>
              <button
                type="button"
                class="total figures text-meta text-ink-faint enabled:hover:text-ink"
                :aria-label="pages ? t('book.progress.totalEdit', { count: n(pageCount ?? 0) }) : undefined"
                data-testid="book.progressTotal"
                @click="reading.openProgress(entry, { total: true })"
              >
                {{ pages ? t('book.progress.totalOf', { count: n(pageCount ?? 0) }) : t('book.progress.figureAddPages') }}
              </button>
            </dd>
          </div>
          <div class="flex flex-col gap-xs">
            <dt class="eyebrow">{{ pages ? t('book.progress.figureDone') : t('book.progress.figureLeft') }}</dt>
            <dd class="figures text-callout" data-testid="book.progressPercent">
              {{ t('book.progress.percent', { percent: pages ? done : 100 - done }) }}
            </dd>
            <dd v-if="own" class="figures text-meta text-ink-faint">{{ t('book.progress.figureOwn') }}</dd>
          </div>
          <div class="flex flex-col gap-xs">
            <dt class="eyebrow">{{ t('book.progress.figureDay') }}</dt>
            <dd class="figures text-callout" data-testid="book.progressPace">
              {{ pace ? (pages ? n(pace) : t('book.progress.percent', { percent: pace })) : t('book.progress.figureNone') }}
            </dd>
            <dd v-if="pages" class="figures text-meta text-ink-faint">{{ t('book.progress.figurePages') }}</dd>
          </div>
          <div class="flex flex-col gap-xs">
            <dt class="eyebrow">{{ t('book.progress.figureToGo') }}</dt>
            <dd class="figures text-callout" data-testid="book.progressToGo">
              {{ daysLeft !== null ? n(daysLeft) : t('book.progress.figureNone') }}
            </dd>
            <dd class="figures text-meta text-ink-faint">{{ t('book.progress.figureDaysUnit') }}</dd>
          </div>
        </dl>
      </div>
    </UiReveal>

    <UiReveal :show="shown === 'days'">
      <div class="pt-md">
        <ProgressSpark :amounts="chart" size="lg" :label="chartLabel" data-testid="book.progressChart" />
      </div>
    </UiReveal>

    <UiReveal :show="atEnd || !!lastTime">
      <p class="figures pt-sm text-meta text-ink-faint" data-testid="book.lastTime">
        <span v-if="atEnd" class="text-body text-ink">{{ t('book.progress.atEndLine') }}</span>
        <template v-else-if="lastTime">
          <span class="eyebrow mr-sm">{{ t('book.progress.lastTime') }}</span>{{ t('book.progress.lastTimeLine', { day: dayWords(lastTime.day), amount: amountWords(lastTime.amount) }) }}
        </template>
      </p>
    </UiReveal>
  </div>
</template>

<style scoped>
/* "of 608": a dotted underline says it can be changed; 44 pt tall to tap. */
.total {
  min-height: var(--size-touch);
  margin-block: calc((var(--size-touch) - 1lh) / -2);
  text-align: left;
  text-decoration: underline dotted var(--color-ink-ghost);
  text-underline-offset: var(--spacing-xs);
}
</style>
