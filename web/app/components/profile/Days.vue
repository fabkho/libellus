<script setup lang="ts">
// The days read lately (issue #78, A's calendar): five Monday-first weeks up
// to today as dots, a day read larger the more pages it read, today in the
// lamp colour; beside them the days read of the last 30 and the pages on a
// day read. From the days of progress (issue #68), so it says since when they
// are kept. Gentle on purpose: which days and how much, never a run to keep.
//
// While the reading record loads (`days` null) the calendar is already there,
// today included (the weeks only depend on the date): its days quiet dots
// that a soft wave crosses corner to corner, the figures beside them
// placeholders. When the days come, each dot takes its size and tint in
// place (docs/MOTION.md, Loading).
//
// A day that was read is a button (`pick`: the day) that opens the books it was
// read in; a day not read stays a quiet dot, nothing to press. The button sits
// over the dot, out of the grid's sizing (absolutely placed in the dot's cell): it
// covers the cell and half the gaps around it, all the room the grid has, while the
// dot keeps its size and the grid its shape.
import { readingDaysSummary, type ReadingDay } from '~/data/stats'
import { addDays, isoDay, parseDay } from '~/utils/dates'

const props = defineProps<{ days: readonly ReadingDay[] | null; since: string | null }>()
defineEmits<{ pick: [day: string] }>()
const { t } = useI18n()
const { count, weekdayLetter, dayLong } = useFigures()
const { formatDay } = useDays()
const loading = computed(() => props.days === null)
const arriving = useArrival(() => loading.value)

/** The days the calendar shows while they load: the same weeks, nothing read yet. */
function emptyDays(): ReadingDay[] {
  const today = isoDay()
  const weekday = (parseDay(today).getDay() + 6) % 7
  return Array.from({ length: 28 + weekday + 1 }, (_, i) => ({ day: addDays(today, i - (28 + weekday)), read: false, pages: 0 }))
}

// Monday-first weeks ending today.
const cells = computed(() => {
  if (!props.days) return emptyDays()
  const today = props.days.at(-1)
  if (!today) return []
  const weekday = (parseDay(today.day).getDay() + 6) % 7
  return props.days.slice(-(28 + weekday + 1))
})
const top = computed(() => Math.max(...cells.value.map((c) => c.pages), 1))
const size = (pages: number) => (pages === 0 ? 1 : pages < top.value / 3 ? 2 : pages < (top.value * 2) / 3 ? 3 : 4)
/** A day with a read to open: the days kept before they named their reads (a record on the device) are plain dots until the next load. */
const opens = (c: ReadingDay) => c.read && (c.reads?.length ?? 0) > 0
const dayLabel = (c: ReadingDay) =>
  c.pages > 0 ? t('profile.days.dayRead', { date: dayLong(c.day), count: count(c.pages) }, c.pages) : t('profile.days.dayReadNoPages', { date: dayLong(c.day) })
const summary = computed(() => readingDaysSummary(props.days ?? [], 30))
/** How far along the loading wave a day's dot is: from the top left corner to the bottom right. */
const wave = (i: number) => ((i % 7) + Math.floor(i / 7)) / 12
</script>

<template>
  <section id="days" class="flex flex-col gap-md" data-testid="profile.days">
    <div class="flex items-baseline justify-between gap-md">
      <h2 class="eyebrow">{{ t('profile.days.title') }}</h2>
      <span v-if="since" class="figures text-meta text-ink-faint" :class="{ arrive: arriving }">{{ t('profile.days.since', { date: formatDay(since) }) }}</span>
      <span v-else-if="loading" class="since flex items-center" aria-hidden="true"><span class="skeleton wave" /></span>
    </div>
    <div class="flex gap-lg">
      <div
        class="calendar grid shrink-0 grid-cols-7 gap-x-sm gap-y-xs"
        :role="loading ? undefined : 'group'"
        :aria-hidden="loading || undefined"
        :aria-label="loading ? undefined : t('profile.days.label', { read: count(summary.read), count: count(summary.count) })"
      >
        <span v-for="c in cells.slice(0, 7)" :key="`w${c.day}`" class="figures text-center text-meta text-ink-ghost" aria-hidden="true">{{ weekdayLetter(c.day) }}</span>
        <template v-for="(c, i) in cells" :key="c.day">
          <span v-if="!loading && opens(c)" class="slot">
            <span class="cell" :class="[`s${size(c.pages)}`, 'read', i === cells.length - 1 && 'today']" aria-hidden="true" data-read="true" />
            <button type="button" class="hit" :aria-label="dayLabel(c)" :data-testid="`profile.day.${c.day}`" @click="$emit('pick', c.day)" />
          </span>
          <span
            v-else
            class="cell"
            :class="[loading ? 'waiting wave' : `s${size(c.pages)}`, c.read && 'read', i === cells.length - 1 && 'today']"
            :style="loading ? { '--wave': wave(i) } : undefined"
            aria-hidden="true"
            :data-read="c.read || undefined"
          />
        </template>
      </div>
      <div class="flex min-w-0 flex-1 flex-col justify-end gap-md pb-xxs">
        <div class="flex flex-col gap-xxs">
          <span v-if="loading" class="figure flex items-center" aria-hidden="true"><span class="skeleton wave" :style="{ '--wave': 0.4 }" /></span>
          <span v-else class="figure text-title tabular-nums" :class="{ arrive: arriving }" data-testid="profile.daysRead">{{ count(summary.read) }}<span class="text-ink-faint">/{{ summary.count }}</span></span>
          <span class="eyebrow">{{ t('profile.days.read') }}</span>
        </div>
        <div class="flex flex-col gap-xxs">
          <span v-if="loading" class="figure flex items-center" aria-hidden="true"><span class="skeleton wave" :style="{ '--wave': 0.55 }" /></span>
          <span v-else class="figure text-title tabular-nums" :class="{ arrive: arriving }" data-testid="profile.pagesADay">{{ summary.perDay === null ? '–' : count(summary.perDay) }}</span>
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
/* A day read: the dot in its cell, and over it the button, the cell and half the gaps (x: sm, y: xs) around
   it, which is all the room the grid has. Placed, not in the flow, so the grid is the size it was. */
.slot {
  position: relative;
  display: grid;
  place-items: center;
}
.hit {
  position: absolute;
  inset: calc(var(--spacing-xs) / -2) calc(var(--spacing-sm) / -2);
  border-radius: var(--radius-sm);
}
.hit:active {
  background: var(--color-fill);
}
.cell {
  --d: var(--spacing-xs);
  justify-self: center;
  align-self: center;
  width: var(--d);
  height: var(--d);
  border-radius: var(--radius-pill);
  background: var(--color-hairline-strong);
  /* The days landing: each dot grows or tints into what its day was. */
  transition:
    width var(--duration-standard) var(--ease-standard),
    height var(--duration-standard) var(--ease-standard),
    background-color var(--duration-standard) var(--ease-standard);
}
/* A day not loaded yet: a quiet dot the size of a day read a little, in the wave. */
.cell.waiting {
  --d: var(--spacing-sm);
  background: var(--color-fill-strong);
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
/* The two figures' line, held by their placeholders too. */
.figure {
  height: var(--text-title--line-height);
}
.figure > .skeleton {
  width: var(--spacing-xxl);
  height: calc(var(--text-title--line-height) * 0.66);
}
.since {
  height: var(--text-meta--line-height);
}
.since > * {
  width: calc(var(--spacing-xxxl) + var(--spacing-xl));
  height: 62%;
}
</style>
