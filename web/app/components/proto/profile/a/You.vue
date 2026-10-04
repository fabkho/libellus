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
  readWords,
  statsOf,
  wantToRead,
  type Year,
} from '../model'

const props = defineProps<{ year: Year; month: number | null }>()
const emit = defineEmits<{ year: [year: Year]; month: [month: number | null] }>()

const stats = computed(() => statsOf(props.year))
const isAll = computed(() => props.year === 'all')
const thisMonth = Number(TODAY.slice(5, 7)) - 1
const barLabels = computed(() => (isAll.value ? [...stats.value.perYear].reverse().map((p) => `’${String(p.year).slice(2)}`) : Array.from({ length: 12 }, (_, m) => monthLetter(m))))
const lit = computed(() => (isAll.value ? stats.value.perYear.length - 1 : props.year === THIS_YEAR ? thisMonth : null))


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

    <ProtoProfileFigures :stats="stats" />

    <section id="months" class="flex flex-col gap-md">
      <div class="flex items-baseline justify-between">
        <h2 class="eyebrow">{{ isAll ? 'By year' : 'By month' }}</h2>
        <span v-if="!isAll" class="figures text-meta text-ink-faint">Tap a month</span>
      </div>
      <ProtoProfileBars :values="stats.months" :labels="barLabels" :lit="lit" :pickable="!isAll" tall testid="a.months" @pick="emit('month', $event)" />
    </section>

    <ProtoProfileDays v-if="year === THIS_YEAR || isAll" />

    <section id="ratings" class="flex flex-col gap-md">
      <div class="flex items-baseline justify-between">
        <h2 class="eyebrow">Ratings</h2>
        <span class="figures text-meta text-ink-faint">{{ stats.rated }} rated · {{ stats.fives.length }} with five</span>
      </div>
      <ProtoProfileStarBars :stats="stats" />
    </section>

    <ProtoProfileRecords :stats="stats" />

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
