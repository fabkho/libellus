<script setup lang="ts">
// Design round #78: A's reading days — five Monday-first weeks of dots up to
// today, a dot's size by the pages read that day, today in the lamp colour —
// with two figures beside it. From reading_progress_days, so "since" the first
// day kept.
import { TODAY, dayMonth, readingDaysSummary, weekdayLetter } from './model'

const weekday = (new Date(`${TODAY}T12:00:00`).getDay() + 6) % 7
const days = readingDaysSummary(28 + weekday + 1)
const last30 = readingDaysSummary(30)
const topPages = Math.max(...days.cells.map((c) => c.pages), 1)
const size = (pages: number) => (pages === 0 ? 1 : pages < topPages / 3 ? 2 : pages < (topPages * 2) / 3 ? 3 : 4)
</script>

<template>
  <section id="days" class="flex flex-col gap-md" data-testid="proto.days">
    <div class="flex items-baseline justify-between">
      <h2 class="eyebrow">Reading days</h2>
      <span class="figures text-meta text-ink-faint">since {{ dayMonth(days.since) }}</span>
    </div>
    <div class="flex gap-lg">
      <div class="cal grid shrink-0 grid-cols-7 gap-x-sm gap-y-xs">
        <span v-for="c in days.cells.slice(0, 7)" :key="`h${c.day}`" class="figures text-center text-meta text-ink-ghost">{{ weekdayLetter(c.day) }}</span>
        <span v-for="c in days.cells" :key="c.day" class="cell" :class="[`s${size(c.pages)}`, c.read && 'read', c.day === TODAY && 'today']" :title="`${dayMonth(c.day)}: ${c.pages} pages`" />
      </div>
      <div class="flex min-w-0 flex-1 flex-col justify-end gap-md pb-xxs">
        <div class="flex flex-col gap-xxs">
          <span class="text-title tabular-nums" data-testid="proto.daysRead">{{ last30.read }}<span class="text-ink-ghost">/30</span></span>
          <span class="eyebrow">Days read</span>
        </div>
        <div class="flex flex-col gap-xxs">
          <span class="text-title tabular-nums">{{ last30.perDay }}</span>
          <span class="eyebrow">Pages a day</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
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
.cal {
  grid-auto-rows: var(--spacing-md);
}
</style>
