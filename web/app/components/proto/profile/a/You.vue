<script setup lang="ts">
// Direction A "Ledger": a fourth tab, You. The account leaves the avatar menu
// for a page of its own, and the page is mostly the reading in figures: a year
// to look at (this one first, or all of them), the four numbers that sum it
// up, the books by month (a month opens its books), how the ratings fall,
// the days read lately, the records, the authors you return to, and the
// account at the end. Figures first, words second; no goals, no streak to keep.
import {
  FIRST_DAY,
  finishedIn,
  MEMBER,
  THIS_YEAR,
  TODAY,
  YEARS,
  dayMonth,
  monthLetter,
  monthName,
  monthYear,
  n,
  plural,
  readWords,
  readingDaysSummary,
  average,
  statsOf,
  wantToRead,
  weekdayLetter,
  type Year,
} from '../model'

const props = defineProps<{ year: Year; month: number | null }>()
const emit = defineEmits<{ year: [year: Year]; month: [month: number | null] }>()

const stats = computed(() => statsOf(props.year))
const isAll = computed(() => props.year === 'all')
const thisMonth = Number(TODAY.slice(5, 7)) - 1
const barLabels = computed(() => (isAll.value ? [...stats.value.perYear].reverse().map((p) => `’${String(p.year).slice(2)}`) : Array.from({ length: 12 }, (_, m) => monthLetter(m))))
const lit = computed(() => (isAll.value ? stats.value.perYear.length - 1 : props.year === THIS_YEAR ? thisMonth : null))

// Monday-first weeks, ending today: five rows.
const weekday = (new Date(`${TODAY}T12:00:00`).getDay() + 6) % 7
const days = readingDaysSummary(28 + weekday + 1)
const last30 = readingDaysSummary(30)
const topPages = Math.max(...days.cells.map((c) => c.pages), 1)
const size = (pages: number) => (pages === 0 ? 1 : pages < topPages / 3 ? 2 : pages < (topPages * 2) / 3 ? 3 : 4)

/** The books of the month the member tapped, in the order she finished them. */
const monthReads = computed(() =>
  props.month === null || isAll.value
    ? []
    : finishedIn(props.year)
        .filter((r) => Number(r.ended!.slice(5, 7)) === props.month! + 1)
        .reverse(),
)
const sheetOpen = computed({
  get: () => props.month !== null,
  set: (open: boolean) => !open && emit('month', null),
})
const records = computed(() =>
  [
    stats.value.longest && { label: 'Longest', read: stats.value.longest, figure: `${n(stats.value.longest.pages!)} p.` },
    stats.value.shortest && { label: 'Shortest', read: stats.value.shortest, figure: `${n(stats.value.shortest.pages!)} p.` },
    stats.value.fastest && { label: 'Quickest', read: stats.value.fastest, figure: plural(stats.value.fastest.days!, 'day') },
    stats.value.slowest && { label: 'Took its time', read: stats.value.slowest, figure: plural(stats.value.slowest.days!, 'day') },
  ].filter((r): r is NonNullable<typeof r> => Boolean(r)),
)
</script>

<template>
  <header class="bar-top relative z-20 px-screen">
    <div class="h-(--size-touch)" />
    <div class="flex min-w-0 flex-col gap-sm py-bar">
      <p class="eyebrow">Reading since {{ monthYear(FIRST_DAY) }}</p>
      <h1 class="truncate text-large-title" data-testid="a.title">{{ MEMBER.name }}</h1>
    </div>
  </header>

  <main class="clear-tab-bar flex flex-col gap-xl px-screen pt-md">
    <div role="group" aria-label="Year" class="-mx-screen flex gap-sm overflow-x-auto px-screen">
      <button
        v-for="y in [...YEARS, 'all' as const]"
        :key="y"
        type="button"
        :aria-pressed="year === y"
        class="figures inline-flex h-(--size-button-sm) shrink-0 items-center rounded-pill px-md text-caption"
        :class="year === y ? 'bg-ink text-on-ink' : 'edge text-ink-muted'"
        :data-testid="`a.year.${y}`"
        @click="emit('year', y)"
      >
        {{ y === 'all' ? 'All' : y }}
      </button>
    </div>

    <!-- The four figures. -->
    <section class="grid grid-cols-2 border-y-(length:--stroke-hairline) border-hairline-strong" data-testid="a.figures">
      <div class="flex flex-col gap-xs border-r-(length:--stroke-hairline) border-b-(length:--stroke-hairline) border-hairline py-md pr-md">
        <span class="eyebrow">Books</span>
        <span class="text-figure tabular-nums" data-testid="a.books">{{ stats.books }}</span>
        <span class="figures text-meta text-ink-faint">{{ isAll ? `${(stats.books / ((YEARS.length - 1) * 12 + Number(TODAY.slice(5, 7)) - Number(FIRST_DAY.slice(5, 7)) + 1)).toFixed(1)} a month` : stats.rereads.length ? `${stats.rereads.length} read again` : '\u00a0' }}</span>
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

    <section id="months" class="flex flex-col gap-md">
      <div class="flex items-baseline justify-between">
        <h2 class="eyebrow">{{ isAll ? 'By year' : 'By month' }}</h2>
        <span v-if="!isAll" class="figures text-meta text-ink-faint">Tap a month</span>
      </div>
      <ProtoProfileBars :values="stats.months" :labels="barLabels" :lit="lit" :pickable="!isAll" tall testid="a.months" @pick="emit('month', $event)" />
    </section>

    <section v-if="year === THIS_YEAR || isAll" id="days" class="flex flex-col gap-md" data-testid="a.days">
      <div class="flex items-baseline justify-between">
        <h2 class="eyebrow">Reading days</h2>
        <span class="figures text-meta text-ink-faint">since {{ dayMonth(days.since) }}</span>
      </div>
      <div class="flex gap-lg">
        <div class="cal grid shrink-0 grid-cols-7 gap-x-sm gap-y-xs">
          <span v-for="c in days.cells.slice(0, 7)" :key="`h${c.day}`" class="figures text-center text-meta text-ink-ghost">{{ weekdayLetter(c.day) }}</span>
          <span v-for="c in days.cells" :key="c.day" class="cell" :class="[`s${size(c.pages)}`, c.read && 'read', c.day === TODAY && 'today']" :title="`${dayMonth(c.day)}: ${c.pages} pages`" />
        </div>
        <div class="flex min-w-0 flex-col justify-end gap-sm pb-xxs">
          <p class="text-subhead">
            <span class="figures text-ink">{{ last30.read }}</span> <span class="text-ink-muted">of the last 30 days</span>
          </p>
          <p class="text-subhead">
            <span class="figures text-ink">{{ last30.perDay }}</span> <span class="text-ink-muted">pages on a day you read</span>
          </p>
          <p class="text-caption text-ink-faint">The bigger the dot, the more you read.</p>
        </div>
      </div>
    </section>

    <section id="ratings" class="flex flex-col gap-md">
      <div class="flex items-baseline justify-between">
        <h2 class="eyebrow">Ratings</h2>
        <span class="figures text-meta text-ink-faint">{{ stats.rated }} rated · {{ stats.fives.length }} with five</span>
      </div>
      <ProtoProfileStarBars :stats="stats" />
    </section>

    <section id="records" class="flex flex-col" data-testid="a.records">
      <h2 class="eyebrow mb-xs">Records</h2>
      <ProtoProfileBookRow v-for="r in records" :key="r.label" :book="r.read.book" :label="r.label" :figure="r.figure" />
    </section>

    <section v-if="stats.authors.length" id="authors" class="flex flex-col gap-sm" data-testid="a.authors">
      <h2 class="eyebrow">Authors you return to</h2>
      <div v-for="a in stats.authors.slice(0, 5)" :key="a.name" class="flex items-center gap-ms">
        <span class="min-w-0 flex-1 truncate text-body">{{ a.name }}</span>
        <span class="ticks" aria-hidden="true"><span v-for="i in a.count" :key="i" class="tick" :class="{ fifth: i % 5 === 0 }" /></span>
        <span class="figures w-(--size-button-sm) text-right text-caption text-ink-muted">{{ a.count }}</span>
      </div>
    </section>

    <section class="grid grid-cols-3 border-y-(length:--stroke-hairline) border-hairline-strong py-md" data-testid="a.also">
      <div class="flex flex-col gap-xs">
        <span class="text-title tabular-nums">{{ stats.rereads.length }}</span><span class="eyebrow">Read again</span>
      </div>
      <div class="flex flex-col gap-xs">
        <span class="text-title tabular-nums">{{ stats.abandoned.length }}</span><span class="eyebrow">Not finished</span>
      </div>
      <div class="flex flex-col gap-xs">
        <span class="text-title tabular-nums">{{ wantToRead.length }}</span><span class="eyebrow">Want to read</span>
      </div>
    </section>

    <ProtoProfileAccount />
  </main>

  <UiSheet v-model:open="sheetOpen" :title="month === null ? '' : `${monthName(month)} ${year}`" testid="aMonth">
    <div class="flex flex-col">
      <ProtoProfileBookRow v-for="r in monthReads" :key="r.id" :book="r.book">
        <UiStars v-if="r.rating" :quarters="r.rating" />
        <span v-else class="text-ink-ghost">Not rated</span>
        <span class="dot" aria-hidden="true" />{{ dayMonth(r.ended!) }}
        <template v-if="r.days"><span class="dot" aria-hidden="true" />{{ readWords(r) }}</template>
      </ProtoProfileBookRow>
    </div>
  </UiSheet>
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
.ticks {
  display: flex;
  gap: var(--spacing-xs);
}
.tick {
  width: var(--stroke-rule);
  height: var(--spacing-ms);
  background: var(--color-ink-faint);
}
.tick.fifth {
  margin-right: var(--spacing-xs);
}
.dot {
  width: var(--spacing-xxs);
  height: var(--spacing-xxs);
  border-radius: var(--radius-pill);
  background: currentColor;
}
</style>
