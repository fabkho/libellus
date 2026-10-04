<script setup lang="ts">
// Direction C "In the Library": no new screen. The stats sit where the books
// already are. Finished opens with the years as columns (a year opens its
// review in a sheet); each year's pinned header carries its count, pages and
// average; each row says how long the read took and marks a second read.
// Currently reading opens with the days read lately. The account stays in the
// avatar menu, as today.
import {
  TODAY,
  YEARS,
  average,
  currentReads,
  dayMonth,
  finishedIn,
  readWords,
  readingDaysSummary,
  short,
  statsOf,
  wantToRead,
} from '../model'

type Segment = 'want_to_read' | 'reading' | 'finished'
const props = defineProps<{ segment: Segment; filter: 'all' | 'notFinished'; menu: boolean }>()
const emit = defineEmits<{ segment: [s: Segment]; filter: [f: 'all' | 'notFinished']; year: [y: number]; menu: [open: boolean] }>()
const { t } = useI18n()

const all = statsOf('all')
const counts = { want_to_read: wantToRead.length, reading: currentReads.length, finished: all.books }
const SEGMENTS: Segment[] = ['want_to_read', 'reading', 'finished']
const perYear = YEARS.map((y) => statsOf(y))
const columns = [...perYear].reverse()
const lately = readingDaysSummary(30)

const shown = computed(() => {
  const reads = props.filter === 'notFinished' ? statsOf('all').abandoned : [...finishedIn('all'), ...statsOf('all').abandoned].sort((a, b) => b.ended!.localeCompare(a.ended!))
  return YEARS.map((y) => ({ year: y, stats: perYear.find((s) => s.year === y)!, reads: reads.filter((r) => r.ended!.startsWith(String(y))) })).filter((g) => g.reads.length)
})
</script>

<template>
  <header class="bar-top relative z-30 px-screen">
    <div class="flex h-(--size-touch) items-center justify-end">
      <ProtoProfileCMenu :open="menu" @update:open="emit('menu', $event)" />
    </div>
    <div class="flex min-w-0 flex-col gap-sm py-bar">
      <h1 class="truncate text-large-title">{{ t('library.title') }}</h1>
    </div>
  </header>

  <main class="clear-tab-bar px-screen pt-lg">
    <div role="tablist" class="flex gap-ml border-b-(length:--stroke-hairline) border-hairline-strong">
      <button
        v-for="status in SEGMENTS"
        :key="status"
        type="button"
        role="tab"
        :aria-selected="segment === status"
        class="segment relative flex h-(--size-touch) items-center gap-xs text-body"
        :class="segment === status ? 'on text-ink' : 'text-ink-faint'"
        :data-testid="`c.segment.${status}`"
        @click="emit('segment', status)"
      >
        {{ t(`library.segment.${status}`) }}
        <span class="figures text-caption" :class="segment === status ? 'text-ink-muted' : 'text-ink-ghost'">{{ counts[status] }}</span>
      </button>
    </div>

    <!-- Want to read: as today. -->
    <div v-if="segment === 'want_to_read'" class="flex flex-col pt-xs">
      <ProtoProfileBookRow v-for="w in wantToRead.slice(0, 14)" :key="w.book.key" :book="w.book">{{ t('library.added', { date: dayMonth(w.added) }) }}</ProtoProfileBookRow>
    </div>

    <!-- Currently reading: the days read lately, then the cards. -->
    <div v-else-if="segment === 'reading'" class="flex flex-col gap-ms pt-md">
      <section class="flex flex-col gap-sm pb-xs" data-testid="c.lately">
        <div class="flex items-baseline justify-between gap-md">
          <span class="text-subhead"><span class="figures">{{ lately.read }}</span> <span class="text-ink-muted">reading days in the last 30</span></span>
          <span class="figures text-meta text-ink-faint">{{ lately.perDay }} pages a day</span>
        </div>
        <div class="days flex items-end justify-between" aria-hidden="true">
          <span v-for="c in lately.cells" :key="c.day" class="d" :class="[c.read && 'read', c.day === TODAY && 'today']" />
        </div>
      </section>
      <ProtoProfileReadingCard v-for="(read, i) in currentReads" :key="read.id" :read="read" :eager="i < 2" />
    </div>

    <!-- Finished: the years, then the books by year. -->
    <div v-else class="flex flex-col" data-testid="c.finished">
      <section id="summary" class="flex flex-col gap-md pt-md pb-xs" data-testid="c.summary">
        <div class="flex items-baseline justify-between gap-md">
          <span class="text-subhead"><span class="figures">{{ all.books }}</span> <span class="text-ink-muted">books since {{ YEARS.at(-1) }}</span></span>
          <span class="figures text-meta text-ink-faint">★ {{ average(all.average) }} · {{ short(all.pages) }} pages</span>
        </div>
        <ProtoProfileBars
          :values="columns.map((c) => c.books)"
          :labels="columns.map((c) => String(c.year))"
          :lit="columns.length - 1"
          pickable
          testid="c.years"
          @pick="emit('year', columns[$event]!.year as number)"
        />
      </section>

      <div role="group" class="flex gap-sm pt-md">
        <button
          v-for="name in ['all', 'notFinished'] as const"
          :key="name"
          type="button"
          :aria-pressed="filter === name"
          class="inline-flex h-(--size-button-sm) items-center gap-xs rounded-pill px-md text-subhead"
          :class="filter === name ? 'bg-ink text-on-ink' : 'edge text-ink-muted'"
          :data-testid="`c.filter.${name}`"
          @click="emit('filter', name)"
        >
          <UiIcon v-if="name === 'notFinished'" name="slash" :size="13" />
          {{ t(`library.filter.${name}`) }}
          <span class="figures text-caption" :class="filter === name ? 'opacity-55' : 'text-ink-faint'">{{ name === 'all' ? all.books : all.abandoned.length }}</span>
        </button>
      </div>

      <section v-for="group in shown" :id="`y${group.year}`" :key="group.year" class="flex flex-col">
        <button
          type="button"
          class="year sticky top-0 z-10 -mx-screen flex items-center justify-between bg-surface px-screen pt-md pb-xs text-left"
          :data-testid="`c.yearHeader.${group.year}`"
          @click="emit('year', group.year)"
        >
          <span class="eyebrow text-ink-muted">{{ group.year }}</span>
          <span v-if="filter === 'notFinished'" class="eyebrow text-ink-ghost">{{ group.reads.length }}</span>
          <span v-else class="figures flex items-center gap-sm text-meta text-ink-faint">
            <span class="text-ink-muted">{{ group.stats.books }}</span>
            <span class="dot" aria-hidden="true" />{{ short(group.stats.pages) }} p.
            <span class="dot" aria-hidden="true" />★ {{ average(group.stats.average) }}
            <UiIcon name="chevron" :size="12" class="-mr-xxs text-ink-ghost" />
          </span>
        </button>
        <ProtoProfileBookRow v-for="r in group.reads" :key="r.id" :book="r.book" :dim="r.outcome === 'abandoned'" :again="r.nth">
          <template v-if="r.outcome === 'abandoned'"><UiIcon name="slash" :size="11" />{{ t('library.notFinishedOn', { date: dayMonth(r.ended!) }) }}</template>
          <template v-else>
            <UiStars v-if="r.rating" :quarters="r.rating" />
            <span v-else class="text-ink-ghost">{{ t('rating.none') }}</span>
            <span class="dot" aria-hidden="true" />{{ dayMonth(r.ended!) }}
            <template v-if="r.days"><span class="dot" aria-hidden="true" />{{ readWords(r) }}</template>
          </template>
        </ProtoProfileBookRow>
      </section>
    </div>
  </main>
</template>

<style scoped>
.segment.on::after {
  position: absolute;
  right: 0;
  bottom: calc(-1 * var(--stroke-hairline));
  left: 0;
  height: var(--stroke-focus);
  content: '';
  background: var(--color-accent);
  box-shadow: 0 0 var(--spacing-sm) var(--color-accent-soft);
}
.year {
  top: env(safe-area-inset-top);
}
.dot {
  width: var(--spacing-xxs);
  height: var(--spacing-xxs);
  border-radius: var(--radius-pill);
  background: currentColor;
}
.days .d {
  width: var(--spacing-xs);
  height: var(--spacing-xs);
  border-radius: var(--radius-pill);
  background: var(--color-hairline-strong);
}
.days .d.read {
  height: var(--spacing-ms);
  background: var(--color-ink-faint);
}
.days .d.today {
  background: var(--color-accent);
}
</style>
