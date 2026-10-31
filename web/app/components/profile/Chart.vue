<script setup lang="ts">
// The Profile's reading chart (WP-08, backlog #11b/#11c): the books of a window as columns, following the year
// pills (`v-model:year`), with the capsule that switches the mode and steps the window (ChartNav.vue) under every
// pill. Under All: the overview, a column per year (a bar opens that year in review, `openYear`), the capsule's
// Months half reading "All years". Under a year: by month (that year) or by week (13 ISO weeks, the windows that
// touch the year). The arrows walk the pills along time, the overview after the newest year (‹ older, › newer:
// 2025 ‹ 2026 › All) and move the pill with every step in Months; the weeks' arrows stay in the year. Weeks
// picked under All open on the newest year's newest window and move the pill there. The figures of the window
// stand under the weeks (under the months they would repeat the figures of the pill's year, which the page
// shows just above) and a text alternative follows the window. The Profile and a member's page both draw it from a
// record's reads (`reads`); the mode and the weeks' window are `v-model` (stores/stats.ts and stores/memberProfile.ts
// keep them across a trip to a book). The rules of the windows and their ends: data/statsChart.ts.
//
// A bar with books opens that period's books (`pick`: a month's sheet, a week's). A swipe on the chart steps the
// window (touch and pen; the page still scrolls, `pan-y`), except one that starts within `EDGE` px of either
// screen edge, which is iOS's back-swipe and stays the system's. The weeks' full dates ride under the chart as its
// caption: the capsule names them by number.
import { yearsOf, type StatsRead, type StatsYear } from '~/data/stats'
import { WEEKS_SHOWN, canStep, chartBounds, clampRange, columnsOf, litColumn, stepRange, switchMode, windowFigures, yearColumnsOf, type ChartMode, type ChartRange } from '~/data/statsChart'
import type { ProfileSheet } from '~/stores/stats'
import { isoDay, parseDay } from '~/utils/dates'
import { dateFormat } from '~/utils/intl'

const props = withDefaults(
  defineProps<{
    /** The mode and the weeks' window (`v-model`). */
    modelValue: ChartRange
    /** The year in the pills (`v-model:year`): All, or a year with a finished read. */
    year: StatsYear
    /** The record's reads (a member's: the ones she shares). */
    reads: readonly StatsRead[]
    /** The record is on its way: the bars wave and the figures wait. */
    loading?: boolean
    /** Her ratings are shown: the Average figure stands (a member who hides them has none to show). */
    ratings?: boolean
  }>(),
  { loading: false, ratings: true },
)
const emit = defineEmits<{ 'update:modelValue': [range: ChartRange]; 'update:year': [year: StatsYear]; pick: [sheet: ProfileSheet]; openYear: [year: number] }>()
const { t, locale } = useI18n()
const { count, large, stars, monthLong, monthLetter } = useFigures()

const today = isoDay()
const bounds = computed(() => chartBounds(props.reads, today))
const scope = computed(() => ({ year: props.year, years: yearsOf(props.reads) }))
/** The window in view: what was kept, held to the ends of this record and to the year in the pills. */
const range = computed(() => clampRange(props.modelValue, bounds.value, scope.value))
/** Under All the columns are years (the overview, the Months half's). */
const byYear = computed(() => props.year === 'all')
const mode = computed(() => range.value.mode)
const columns = computed(() => (byYear.value ? yearColumnsOf(props.reads) : columnsOf(props.reads, range.value, props.year as number)))
const canPrev = computed(() => canStep(range.value, bounds.value, scope.value, -1))
const canNext = computed(() => canStep(range.value, bounds.value, scope.value, 1))
const lit = computed(() => litColumn(columns.value, today))

/** Which way the window last moved (the label slides in from that side). */
const direction = ref<-1 | 1>(1)
// A pill picked moves the label the way the years run too: time goes on to the right, the overview last.
watch(
  () => props.year,
  (now, was) => {
    direction.value = (now === 'all' ? Infinity : now) > (was === 'all' ? Infinity : was) ? 1 : -1
  },
)
function step(by: -1 | 1) {
  if (by < 0 ? !canPrev.value : !canNext.value) return
  direction.value = by
  const stepped = stepRange(range.value, bounds.value, scope.value, by)
  emit('update:modelValue', stepped.range)
  if (stepped.year !== props.year) emit('update:year', stepped.year)
}
function setMode(next: ChartMode) {
  const switched = switchMode(range.value, next, bounds.value, scope.value)
  if (next === 'weeks' && byYear.value && switched.year === props.year) return
  emit('update:modelValue', switched.range)
  if (switched.year !== props.year) emit('update:year', switched.year)
}
// The overview is Months: a pill that brings All (a pick, a step, the record losing the year) takes the kept mode back to Months, so the next year the member steps or picks opens on Months too.
watch(
  () => [props.year, props.modelValue.mode] as const,
  ([year, kept]) => {
    if (year === 'all' && kept !== 'months') emit('update:modelValue', { ...props.modelValue, mode: 'months' })
  },
  { immediate: true },
)

// ---------------------------------------------------------------------------------------------- names
const drawn = computed(() =>
  columns.value.map((c) =>
    byYear.value
      ? { ...c, label: `’${String(c.number).slice(2)}`, name: String(c.number) }
      : mode.value === 'months'
        ? { ...c, label: monthLetter(c.number), name: monthLong(c.number) }
        : { ...c, label: String(c.number), name: t('profile.weekLabel', { week: c.number }) },
  ),
)
const modeTitle = computed(() => (byYear.value ? t('profile.byYear') : mode.value === 'months' ? t('profile.byMonth') : t('profile.byWeek')))

/** "2026", or the weeks' numbers with their year: "KW 13–25 · 2026", across a year end "KW 52–12 · 2025/26". */
const label = computed(() => {
  if (byYear.value) return t('profile.allYears')
  if (mode.value === 'months') return String(props.year)
  const first = columns.value[0]!
  const last = columns.value[columns.value.length - 1]!
  const from = first.start.slice(0, 4)
  const to = last.end.slice(0, 4)
  return `${t('profile.weekLabel', { week: `${first.number}–${last.number}` })} · ${from === to ? to : `${from}/${to.slice(2)}`}`
})
/** The window's dates, the weeks' caption: "23 Mar – 21 Jun 2026", across a year end "15 Dec 2025 – 15 Mar 2026". */
const dates = computed(() => {
  const start = columns.value[0]!.start
  const end = columns.value[columns.value.length - 1]!.end
  const dayMonth = dateFormat(locale.value, { day: 'numeric', month: 'short' })
  const left = start.slice(0, 4) === end.slice(0, 4) ? dayMonth.format(parseDay(start)) : `${dayMonth.format(parseDay(start))} ${start.slice(0, 4)}`
  return `${left} – ${dayMonth.format(parseDay(end))} ${end.slice(0, 4)}`
})
const alt = computed(
  () =>
    `${modeTitle.value}${byYear.value ? '' : ` · ${mode.value === 'months' ? label.value : dates.value}`}. ` +
    drawn.value.map((c) => t('profile.columnLabel', { label: c.name, count: count(c.count) })).join('. '),
)

// ------------------------------------------------------------------------------------------- the figures
const inWindow = computed(() => windowFigures(columns.value))
const cells = computed(() => {
  const f = inWindow.value
  const all = [
    { key: 'books', label: t('profile.figures.books'), value: count(f.books) },
    { key: 'pages', label: t('profile.figures.pages'), value: f.pages ? large(f.pages) : '–' },
    { key: 'average', label: t('profile.figures.average'), value: stars(f.average) },
  ]
  return props.ratings ? all : all.filter((c) => c.key !== 'average')
})

// ---------------------------------------------------------------------------------------------- opening
function pick(key: number) {
  const column = columns.value.find((c) => c.key === key)
  if (!column) return
  if (byYear.value) return emit('openYear', column.number)
  emit('pick', mode.value === 'months' ? { kind: 'month', year: props.year as number, month: column.number } : { kind: 'week', start: column.start })
}

// ---------------------------------------------------------------------------------------------- swiping
const EDGE = 24
let dragFrom: number | null = null
/** A swipe that stepped must not also open the bar it ended on. */
let swiped = false
function dragStart(event: PointerEvent) {
  swiped = false
  if (event.pointerType === 'mouse') return
  if (event.clientX < EDGE || event.clientX > window.innerWidth - EDGE) return
  dragFrom = event.clientX
}
function dragEnd(event: PointerEvent) {
  if (dragFrom === null) return
  const dx = event.clientX - dragFrom
  dragFrom = null
  if (Math.abs(dx) < 40) return
  swiped = true
  step(dx > 0 ? -1 : 1)
}
function dragCancel() {
  dragFrom = null
}
function swallowSwipe(event: MouseEvent) {
  if (!swiped) return
  swiped = false
  event.stopPropagation()
  event.preventDefault()
}
</script>

<template>
  <section class="flex flex-col gap-md" data-testid="profile.chart">
    <h2 class="sr-only">{{ modeTitle }}</h2>
    <!-- The capsule under every pill: under All its Months half reads "All years" and steps to the newest year (‹); Weeks opens on that year. -->
    <ProfileChartNav :mode="mode" :label="label" :overview="byYear" :can-prev="canPrev" :can-next="canNext" :direction="direction" @mode="setMode" @step="step" />

    <!-- The chart; a swipe moves the window. -->
    <div style="touch-action: pan-y" @pointerdown="dragStart" @pointerup="dragEnd" @pointercancel="dragCancel" @click.capture="swallowSwipe">
      <ProfileColumns :columns="loading ? null : drawn" :placeholders="byYear ? 4 : mode === 'months' ? 12 : WEEKS_SHOWN" :lit="lit" testid="profile.columns" @pick="pick" />
    </div>

    <!-- The weeks' full dates, as the chart's caption under its axis (the capsule names them by number). -->
    <Transition name="fold">
      <p v-if="!byYear && mode === 'weeks'" class="figures -mt-xs text-center text-meta text-ink-muted" aria-hidden="true" data-testid="profile.chart.caption">{{ dates }}</p>
    </Transition>

    <!-- The figures under the chart follow the window. -->
    <UiReveal :show="!byYear && mode === 'weeks'">
    <dl class="grid border-t-(length:--stroke-hairline) border-hairline-strong" :style="{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }" :aria-busy="loading || undefined" data-testid="profile.chart.figures">
      <div v-for="(cell, i) in cells" :key="cell.key" class="cell flex min-w-0 flex-col gap-xxs py-md" :class="i < cells.length - 1 ? 'border-r-(length:--stroke-hairline) border-hairline pr-md' : '', i > 0 ? 'pl-md' : ''">
        <dt class="eyebrow">{{ cell.label }}</dt>
        <dd v-if="loading" class="value flex items-center" aria-hidden="true">
          <span class="bar skeleton wave" :style="{ '--wave': i * 0.12 }" />
        </dd>
        <dd v-else class="value figures text-figure tabular-nums" :style="{ '--chars': String(cell.value).length }" :data-testid="`profile.chart.figure.${cell.key}`">{{ cell.value }}</dd>
      </div>
    </dl>
    </UiReveal>

    <!-- The chart's text alternative, following the window. -->
    <p class="sr-only" data-testid="profile.chart.alt">{{ alt }}</p>
  </section>
</template>

<style scoped>
/* The caption arriving with the weeks, and leaving with them. */
.fold-enter-active,
.fold-leave-active {
  transition: opacity var(--duration-quick) var(--ease-standard);
}
.fold-enter-from,
.fold-leave-to {
  opacity: 0;
}
/* The figure's cell sizes it to fit, as ProfileFigures does (components/profile/Figures.vue), and holds its line while a placeholder stands. */
.cell {
  container-type: inline-size;
}
.value {
  height: var(--text-figure--line-height);
}
.cell .value.text-figure {
  display: flex;
  align-items: center;
  font-size: min(var(--text-figure), calc(100cqi / (max(var(--chars, 3), 3) * 0.62)));
}
.bar {
  width: var(--spacing-xxxl);
  height: calc(var(--text-figure--line-height) * 0.62);
}
</style>
