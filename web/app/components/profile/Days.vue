<script setup lang="ts">
// The days read lately (issue #78, A's calendar): five Monday-first weeks up
// to today as dots, a day read larger the more pages it read, today in the
// lamp colour; beside them the days read of the last 30 and the pages on a
// day read. From the days of progress (issue #68), so it says since when they
// are kept. Gentle on purpose: which days and how much, never a run to keep.
import { readingDaysSummary, type ReadingDay } from '~/data/stats'

const props = defineProps<{ days: readonly ReadingDay[]; since: string }>()
const { t } = useI18n()
const { count, weekdayLetter } = useFigures()
const { formatDay } = useDays()

// Monday-first weeks ending today.
const cells = computed(() => {
  const today = props.days.at(-1)
  if (!today) return []
  const weekday = (parseDay(today.day).getDay() + 6) % 7
  return props.days.slice(-(28 + weekday + 1))
})
const top = computed(() => Math.max(...cells.value.map((c) => c.pages), 1))
const size = (pages: number) => (pages === 0 ? 1 : pages < top.value / 3 ? 2 : pages < (top.value * 2) / 3 ? 3 : 4)
const summary = computed(() => readingDaysSummary(props.days, 30))
</script>

<template>
  <section id="days" class="flex flex-col gap-md" data-testid="profile.days">
    <div class="flex items-baseline justify-between gap-md">
      <h2 class="eyebrow">{{ t('profile.days.title') }}</h2>
      <span class="figures text-meta text-ink-faint">{{ t('profile.days.since', { date: formatDay(since) }) }}</span>
    </div>
    <div class="flex gap-lg">
      <div class="calendar grid shrink-0 grid-cols-7 gap-x-sm gap-y-xs" role="img" :aria-label="t('profile.days.label', { read: count(summary.read), count: count(summary.count) })">
        <span v-for="c in cells.slice(0, 7)" :key="`w${c.day}`" class="figures text-center text-meta text-ink-ghost" aria-hidden="true">{{ weekdayLetter(c.day) }}</span>
        <span
          v-for="(c, i) in cells"
          :key="c.day"
          class="cell"
          :class="[`s${size(c.pages)}`, c.read && 'read', i === cells.length - 1 && 'today']"
          aria-hidden="true"
          :data-read="c.read || undefined"
        />
      </div>
      <div class="flex min-w-0 flex-1 flex-col justify-end gap-md pb-xxs">
        <div class="flex flex-col gap-xxs">
          <span class="text-title tabular-nums" data-testid="profile.daysRead">{{ count(summary.read) }}<span class="text-ink-ghost">/{{ summary.count }}</span></span>
          <span class="eyebrow">{{ t('profile.days.read') }}</span>
        </div>
        <div class="flex flex-col gap-xxs">
          <span class="text-title tabular-nums" data-testid="profile.pagesADay">{{ summary.perDay === null ? '–' : count(summary.perDay) }}</span>
          <span class="eyebrow">{{ t('profile.days.perDay') }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.calendar {
  grid-auto-rows: var(--spacing-md);
}
.cell {
  --d: var(--spacing-xs);
  justify-self: center;
  align-self: center;
  width: var(--d);
  height: var(--d);
  border-radius: var(--radius-pill);
  background: var(--color-hairline-strong);
}
.cell.read {
  background: var(--color-ink-muted);
}
.cell.s2 {
  --d: var(--spacing-sm);
}
.cell.s3 {
  --d: var(--spacing-ms);
}
.cell.s4 {
  --d: var(--spacing-md);
}
.cell.today {
  background: var(--color-accent);
  box-shadow: 0 0 0 var(--stroke-focus) var(--color-accent-soft);
}
</style>
