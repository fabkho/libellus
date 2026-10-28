<script setup lang="ts">
// Dev only (the route is dropped from every build: nuxt.config.ts, `$production`): a clickable
// prototype for WP-08 (issue #11b/#11c), the Profile chart's Week/Month switch and range navigator.
// NOTHING here is wired to the reading record: a fake one (today pinned to 17 Jun 2026, a first
// finish on 3 Sep 2024) stands in, so every screenshot is stable. The chart and the books sheet are
// the production components (ProfileColumns, ProfileReadsSheet) on the app's tokens; the prototype
// chrome is the dashed mono bar on top.
//
// Three control layouts to compare:
//   A · the segmented Months/Weeks switch above the chart, the arrows beside the period label;
//   B · the same switch, the arrows below the chart, and a swipe on the chart moves the window;
//   C · one pill ("By month · 2026 ⌄") that opens a period picker sheet holding the switch and the periods;
//   D · a timeline under the chart: her whole record as a strip of micro-bars, the window a brush on it —
//       tap or scrub the strip to move it, the period label rides under the brush;
//   E · the mode as two tabs in the title line, every period a chip in one rail above the chart (one tap,
//       the rail scrolls sideways when the weeks' chips overflow, its edges fade where more chips hide).
// A bar opens that period's books in the existing sheet. The figures under the chart and the
// chart's text alternative follow the window. Query: ?variant=A|B|C|D|E&mode=months|weeks&lang=en|de.
import type { StatsRead } from '~/data/stats'
import { addDays, daysBetween, isoDay, parseDay } from '~/utils/dates'
import { dateFormat } from '~/utils/intl'
import { useLocaleStore } from '~/stores/locale'
import { useThemeStore } from '~/stores/theme'

definePageMeta({ layout: false })

useHead({ title: 'Prototype · chart navigator' })

const { t, locale } = useI18n()
const { count, large, stars, monthLong, monthLetter, dayLong } = useFigures()
const localeStore = useLocaleStore()
const themeStore = useThemeStore()

// ---------------------------------------------------------------------------------------------
// The fake reading record. Today and the first finish are pinned; the counts per month are fixed,
// with two quiet months and scattered empty weeks, so the empty columns and both disabled ends show.
// ---------------------------------------------------------------------------------------------
const TODAY = '2026-06-17' // a Wednesday, inside the year's first half
const FIRST = '2024-09-03'
const TITLES = ['The Left Hand of Darkness', 'Piranesi', 'A Wizard of Earthsea', 'The Dispossessed', 'Hyperion', 'Middlemarch', 'Gilead', 'Beloved', 'Stoner', 'Austerlitz']
const AUTHORS = [['Ursula K. Le Guin'], ['Susanna Clarke'], ['Ursula K. Le Guin'], ['Ursula K. Le Guin', 'Brian Attebery'], ['Dan Simmons'], ['George Eliot'], ['Marilynne Robinson'], ['Toni Morrison'], ['John Williams'], ['W. G. Sebald']]

/** A fixed pseudo-random 0–1 from an integer: the same data in every screenshot. */
const rand = (i: number) => ((i * 2654435761) % 1009) / 1009

/** Books per month, Sep 2024 → Jun 2026 (22 months); two months stand empty on purpose. */
const PER_MONTH = [3, 4, 0, 2, 5, 3, 4, 6, 2, 0, 3, 5, 4, 3, 2, 6, 4, 5, 3, 2, 4, 1]

const reads = computed<StatsRead[]>(() => {
  const out: StatsRead[] = []
  let i = 0
  for (let j = 0; j < PER_MONTH.length; j++) {
    const year = 2024 + Math.floor((8 + j) / 12)
    const month = ((8 + j) % 12) + 1
    for (let k = 0; k < PER_MONTH[j]!; k++, i++) {
      const day = 1 + Math.floor(rand(j * 17 + k) * 27)
      const endedOn = isoDay(new Date(year, month - 1, day))
      if (endedOn < FIRST || endedOn > TODAY) continue
      out.push({
        sessionId: `fake-${i}`,
        entryId: `fake-${i}`,
        book: {
          id: `fake-${i}`,
          createdAt: endedOn,
          title: `${TITLES[i % TITLES.length]}${i >= TITLES.length ? ` ${Math.floor(i / TITLES.length) + 1}` : ''}`,
          authors: AUTHORS[i % AUTHORS.length]!,
          isbn13: null,
          isbn10: null,
          pageCount: 180 + Math.round(rand(i * 31) * 400),
          year: null,
          language: 'en',
          publisher: null,
          description: null,
          coverUrl: null,
          coverThumbhash: null,
          coverColors: null,
          source: 'openlibrary',
          appleId: null,
          openLibraryEditionKey: null,
          openLibraryWorkKey: null,
        },
        startedOn: null,
        endedOn,
        outcome: 'finished',
        rating: i % 5 === 0 ? null : 12 + Math.round(rand(i * 7) * 8),
        pages: 180 + Math.round(rand(i * 31) * 400),
        days: 2 + Math.round(rand(i * 7) * 20),
        nth: 1,
      })
    }
  }
  return out
})

// ---------------------------------------------------------------------------------------------
// Pure bucketing (the shape a real `weeksOf` in data/stats.ts would take). ISO weeks, Monday first,
// by `endedOn`, in the device's zone through the app's own date helpers (utils/dates.ts).
// ---------------------------------------------------------------------------------------------
/** The Monday of the week `day` sits in (ISO, Monday first), at local midnight. */
function mondayOf(day: string): string {
  const date = parseDay(day)
  return isoDay(new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7)))
}

/** The ISO week number (1–53) of a day: its Thursday decides the week's year (week 53 kept). */
function weekNumberOf(day: string): number {
  const date = parseDay(day)
  const thursday = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 3 - ((date.getDay() + 6) % 7))
  const firstThursday = new Date(thursday.getFullYear(), 0, 4)
  return 1 + Math.round((daysBetween(isoDay(firstThursday), isoDay(thursday)) - 3 + ((firstThursday.getDay() + 6) % 7)) / 7)
}

type Bucket = { key: number; count: number; label: string; name: string; reads: StatsRead[]; start: string; end: string }

/** How many weeks one window holds (a quarter). */
const WEEKS_SHOWN = 13

function bucketOf(start: string, end: string, key: number, label: string, name: string, all: readonly StatsRead[]): Bucket {
  const inBucket = all.filter((r) => r.outcome === 'finished' && r.endedOn !== null && r.endedOn >= start && r.endedOn <= end)
  return { key, count: inBucket.length, label, name, reads: inBucket, start, end }
}

/** One column per month of `year`, by the day each read ended. */
function monthsOf(all: readonly StatsRead[], year: number): Bucket[] {
  return Array.from({ length: 12 }, (_, m) => {
    const month = m + 1
    const start = isoDay(new Date(year, m, 1))
    const end = isoDay(new Date(year, m + 1, 0))
    return bucketOf(start, end, month, monthLetter(month), monthLong(month), all)
  })
}

/** `WEEKS_SHOWN` ISO weeks from `startMonday` (which must be a Monday), by the day each read ended. */
function weeksOf(all: readonly StatsRead[], startMonday: string): Bucket[] {
  return Array.from({ length: WEEKS_SHOWN }, (_, w) => {
    const start = addDays(startMonday, w * 7)
    const end = addDays(start, 6)
    const week = weekNumberOf(start)
    return bucketOf(start, end, daysBetween('1970-01-01', start), String(week), t('profile.weekLabel', { week }), all)
  })
}

// ---------------------------------------------------------------------------------------------
// The window and its navigator: months step a year, weeks a quarter (13 weeks). The earliest window
// holds her first finish, the newest ends today — both ends stop there, their arrow disabled.
// ---------------------------------------------------------------------------------------------
const THIS_YEAR = Number(TODAY.slice(0, 4))
const FIRST_YEAR = Number(FIRST.slice(0, 4))
const todayMonday = mondayOf(TODAY)
/** Her actual first finish in the fake record (the generator drops days before `FIRST`): the left end of every window. */
const firstFinish = reads.value.reduce((min, r) => (r.endedOn !== null && r.endedOn < min ? r.endedOn : min), TODAY)
const firstMonday = mondayOf(firstFinish)
/** The newest window holds the last `WEEKS_SHOWN` weeks: it ends with the week today sits in. */
const newestWeekStart = addDays(todayMonday, -7 * (WEEKS_SHOWN - 1))

/** The earliest 13-week window that still holds her first finish (kept as the windows step back). */
function earliestWeekStart(): string {
  let start = newestWeekStart
  while (firstMonday < start) start = addDays(start, -7 * WEEKS_SHOWN)
  return start
}
const EARLIEST_WEEK_START = earliestWeekStart()

const route = useRoute()
const mode = ref<'months' | 'weeks'>(route.query.mode === 'weeks' ? 'weeks' : 'months')
const VARIANTS = ['A', 'B', 'C', 'D', 'E'] as const
type Variant = (typeof VARIANTS)[number]
const variant = ref<Variant>(VARIANTS.includes(String(route.query.variant) as Variant) ? (String(route.query.variant) as Variant) : 'A')
const year = ref(Number(route.query.year) || THIS_YEAR)
const weekStart = ref(typeof route.query.weeks === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(route.query.weeks) ? route.query.weeks : newestWeekStart)
if (route.query.lang === 'de' || route.query.lang === 'en') void localeStore.choose(route.query.lang)
const columns = computed<Bucket[]>(() => (mode.value === 'months' ? monthsOf(reads.value, year.value) : weeksOf(reads.value, weekStart.value)))
const canPrev = computed(() => (mode.value === 'months' ? year.value > FIRST_YEAR : weekStart.value > EARLIEST_WEEK_START))
const canNext = computed(() => (mode.value === 'months' ? year.value < THIS_YEAR : weekStart.value < newestWeekStart))
const lit = computed(() => {
  const today = mode.value === 'months' ? isoDay(new Date(THIS_YEAR, Number(TODAY.slice(5, 7)) - 1, 1)) : todayMonday
  return columns.value.find((c) => c.start <= today && today <= c.end)?.key ?? null
})

function prev() {
  if (!canPrev.value) return
  if (mode.value === 'months') year.value -= 1
  else weekStart.value = addDays(weekStart.value, -7 * WEEKS_SHOWN)
}
function next() {
  if (!canNext.value) return
  if (mode.value === 'months') year.value += 1
  else weekStart.value = addDays(weekStart.value, 7 * WEEKS_SHOWN)
}

/** "2026", or the window's date range ("16 Mar – 14 Jun 2026", across a year end "15 Dec 2025 – 15 Mar 2026"). */
function periodLabelOf(start: string): string {
  const end = addDays(start, 7 * WEEKS_SHOWN - 1)
  const dayMonth = dateFormat(locale.value, { day: 'numeric', month: 'short' })
  const sameYear = start.slice(0, 4) === end.slice(0, 4)
  const left = sameYear ? dayMonth.format(parseDay(start)) : `${dayMonth.format(parseDay(start))} ${start.slice(0, 4)}`
  return `${left} – ${dayMonth.format(parseDay(end))} ${end.slice(0, 4)}`
}
const periodLabel = computed(() => (mode.value === 'months' ? String(year.value) : periodLabelOf(weekStart.value)))
const modeTitle = computed(() => (mode.value === 'months' ? t('profile.byMonth') : t('profile.byWeek')))

function setMode(next: 'months' | 'weeks') {
  if (mode.value === next) return
  mode.value = next
  if (next === 'months') year.value = Math.min(Math.max(year.value, FIRST_YEAR), THIS_YEAR)
  else weekStart.value = newestWeekStart
}

// ---------------------------------------------------------------------------------------------
// The figures under the chart and the chart's text alternative follow the window.
// ---------------------------------------------------------------------------------------------
const windowReads = computed(() => columns.value.flatMap((c) => c.reads))
const pages = computed(() => windowReads.value.reduce((sum, r) => sum + (r.pages ?? 0), 0))
const average = computed(() => {
  const rated = windowReads.value.filter((r) => r.rating !== null)
  return rated.length ? rated.reduce((sum, r) => sum + r.rating!, 0) / rated.length : null
})
const cells = computed(() => [
  { key: 'books', label: t('profile.figures.books'), value: count(windowReads.value.length) },
  { key: 'pages', label: t('profile.figures.pages'), value: pages.value ? large(pages.value) : '–' },
  { key: 'average', label: t('profile.figures.average'), value: stars(average.value) },
])
const chartAlt = computed(
  () =>
    `${modeTitle.value} · ${periodLabel.value}. ` +
    columns.value.map((c) => t('profile.columnLabel', { label: c.name, count: count(c.count) })).join('. '),
)

// ---------------------------------------------------------------------------------------------
// A bar's books in the existing sheet; variant C's period picker.
// ---------------------------------------------------------------------------------------------
const picked = ref<Bucket | null>(null)
const sheetOpen = computed({ get: () => picked.value !== null, set: (open: boolean) => !open && (picked.value = null) })
const sheetTitle = computed(() => {
  const b = picked.value
  if (!b) return ''
  return mode.value === 'months'
    ? t('profile.sheet.month', { month: monthLong(b.key), year: year.value })
    : t('profile.sheet.week', { date: dayLong(b.start) })
})
const sheetReads = computed(() => picked.value?.reads ?? [])

function pick(key: number) {
  picked.value = columns.value.find((c) => c.key === key) ?? null
}

const pickerOpen = ref(false)
const periods = computed(() =>
  mode.value === 'months'
    ? Array.from({ length: THIS_YEAR - FIRST_YEAR + 1 }, (_, i) => {
        const y = THIS_YEAR - i
        return { key: y, label: String(y), count: reads.value.filter((r) => r.outcome === 'finished' && r.endedOn?.startsWith(String(y))).length }
      })
    : Array.from({ length: Math.round(daysBetween(EARLIEST_WEEK_START, newestWeekStart) / (7 * WEEKS_SHOWN)) + 1 }, (_, i) => {
        const start = addDays(newestWeekStart, -i * 7 * WEEKS_SHOWN)
        return {
          key: i,
          label: periodLabelOf(start),
          count: reads.value.filter((r) => r.outcome === 'finished' && r.endedOn !== null && r.endedOn >= start && r.endedOn <= addDays(start, 7 * WEEKS_SHOWN - 1)).length,
          start,
        }
      }),
)
const currentPeriodKey = computed(() => (mode.value === 'months' ? year.value : periods.value.find((p) => 'start' in p && p.start === weekStart.value)?.key ?? 0))

function pickPeriod(key: number) {
  if (mode.value === 'months') year.value = key
  else {
    const period = periods.value.find((p) => p.key === key)
    if (period && 'start' in period) weekStart.value = period.start
  }
  pickerOpen.value = false
}

// ---------------------------------------------------------------------------------------------
// D and E: every window of the record at once (months: one per year; weeks: one per 13 weeks, oldest
// first). D draws them as a timeline strip with a brush, E as a rail of chips. Neither needs a
// disabled arrow: the strip and the rail simply end where the record does.
// ---------------------------------------------------------------------------------------------
const WEEK_WINDOWS = Math.round(daysBetween(EARLIEST_WEEK_START, newestWeekStart) / (7 * WEEKS_SHOWN)) + 1
type Window = { index: number; start: string; year: number; label: string; short: string; count: number; buckets: Bucket[] }
const windows = computed<Window[]>(() =>
  mode.value === 'months'
    ? Array.from({ length: THIS_YEAR - FIRST_YEAR + 1 }, (_, i) => {
        const y = FIRST_YEAR + i
        const buckets = monthsOf(reads.value, y)
        return { index: i, start: `${y}-01-01`, year: y, label: String(y), short: String(y), count: buckets.reduce((s, b) => s + b.count, 0), buckets }
      })
    : Array.from({ length: WEEK_WINDOWS }, (_, i) => {
        const start = addDays(EARLIEST_WEEK_START, i * 7 * WEEKS_SHOWN)
        const buckets = weeksOf(reads.value, start)
        const short = t('profile.weekLabel', { week: `${buckets[0]!.label}–${buckets[buckets.length - 1]!.label}` })
        return { index: i, start, year: Number(start.slice(0, 4)), label: periodLabelOf(start), short, count: buckets.reduce((s, b) => s + b.count, 0), buckets }
      }),
)
const windowIndex = computed(() =>
  mode.value === 'months' ? year.value - FIRST_YEAR : Math.round(daysBetween(EARLIEST_WEEK_START, weekStart.value) / (7 * WEEKS_SHOWN)),
)
function selectWindow(index: number) {
  const w = windows.value[index]
  if (!w) return
  if (mode.value === 'months') year.value = w.year
  else weekStart.value = w.start
}

// D's strip: one micro-bar per month / week of every window; time outside her record (before the first
// finish, after today) is drawn as a dotted line, today's bucket in the lamp colour as on the chart.
const stripTop = computed(() => Math.max(1, ...windows.value.flatMap((w) => w.buckets.map((b) => b.count))))
const outside = (b: Bucket) => b.end < FIRST || b.start > TODAY
const isToday = (b: Bucket) => b.start <= TODAY && TODAY <= b.end
/** Where each year begins along the strip, in percent: the strip's tick labels. */
const yearTicks = computed(() => {
  const all = windows.value.flatMap((w) => w.buckets)
  return all.flatMap((b, i) => {
    const y = b.start.slice(0, 4)
    return i === 0 || all[i - 1]!.start.slice(0, 4) !== y ? [{ year: y, at: (i / all.length) * 100 }] : []
  })
})
/** The brush's centre along the strip, in percent: the label under it rides there (kept inside the strip). */
const brushAt = computed(() => ((windowIndex.value + 0.5) / windows.value.length) * 100)

const strip = useTemplateRef<HTMLElement>('strip')
let scrubbing = false
function scrubAt(x: number) {
  const rect = strip.value?.getBoundingClientRect()
  if (!rect) return
  const n = windows.value.length
  selectWindow(Math.min(n - 1, Math.max(0, Math.floor(((x - rect.left) / rect.width) * n))))
}
function scrubStart(event: PointerEvent) {
  scrubbing = true
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
  scrubAt(event.clientX)
}
function scrubMove(event: PointerEvent) {
  if (scrubbing) scrubAt(event.clientX)
}
function scrubEnd() {
  scrubbing = false
}

// E's rail: the chip in view is scrolled into the middle; the edges fade only where more chips hide.
const rail = useTemplateRef<HTMLElement>('rail')
/** Weeks: the chips grouped by the year their window starts in, the year a sticky label the next one pushes out. */
const railGroups = computed(() => {
  const groups: { year: number | null; items: Window[] }[] = []
  for (const w of windows.value) {
    const year = mode.value === 'weeks' ? w.year : null
    const last = groups[groups.length - 1]
    if (last && last.year === year) last.items.push(w)
    else groups.push({ year, items: [w] })
  }
  return groups
})
const railAtStart = ref(true)
const railAtEnd = ref(true)
function railEdges() {
  const el = rail.value
  if (!el) return
  railAtStart.value = el.scrollLeft <= 1
  railAtEnd.value = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1
}
function railCentre(smooth: boolean) {
  const el = rail.value
  const chip = el?.querySelector<HTMLElement>('[aria-pressed="true"]')
  if (!el || !chip) return
  el.scrollTo({ left: chip.offsetLeft - (el.clientWidth - chip.offsetWidth) / 2, behavior: smooth ? 'smooth' : 'instant' })
  railEdges()
}
watch([variant, mode, windowIndex], (_now, [prevVariant, prevMode]) => nextTick(() => railCentre(prevVariant === 'E' && prevMode === mode.value)), { flush: 'post' })
onMounted(() => nextTick(() => railCentre(false)))

// Variant B: a swipe on the chart moves the window (the page still scrolls: `pan-y`).
let dragFrom: number | null = null
function dragStart(event: PointerEvent) {
  dragFrom = event.clientX
}
function dragEnd(event: PointerEvent) {
  if (dragFrom === null) return
  const dx = event.clientX - dragFrom
  dragFrom = null
  if (Math.abs(dx) < 40) return
  if (dx > 0) prev()
  else next()
}
</script>

<template>
  <div class="min-h-dvh pb-3xl" data-testid="proto.chartNav">
    <!-- Prototype chrome (the dashed mono bar): not design. -->
    <div class="proto-chrome flex flex-col gap-xs border-b-(length:--stroke-hairline) border-dashed border-accent px-md py-sm">
      <p class="text-meta text-ink-muted">Prototype · WP-08 chart navigator · fake data, today pinned to 17 Jun 2026 · dev only, dropped from every build</p>
      <div class="flex flex-wrap items-center gap-sm">
        <div class="flex items-center gap-xxs">
          <span class="text-meta text-ink-faint">variant</span>
          <button v-for="v in VARIANTS" :key="v" type="button" class="proto-toggle text-meta" :class="{ on: variant === v }" :aria-pressed="variant === v" :data-testid="`proto.variant.${v}`" @click="variant = v">{{ v }}</button>
        </div>
        <div class="flex items-center gap-xxs">
          <span class="text-meta text-ink-faint">theme</span>
          <button type="button" class="proto-toggle text-meta" :class="{ on: themeStore.theme === 'light' }" :aria-pressed="themeStore.theme === 'light'" @click="themeStore.theme === 'dark' && themeStore.toggle()">light</button>
          <button type="button" class="proto-toggle text-meta" :class="{ on: themeStore.theme === 'dark' }" :aria-pressed="themeStore.theme === 'dark'" @click="themeStore.theme === 'light' && themeStore.toggle()">dark</button>
        </div>
        <div class="flex items-center gap-xxs">
          <span class="text-meta text-ink-faint">lang</span>
          <button type="button" class="proto-toggle text-meta" :class="{ on: localeStore.current === 'en' }" :aria-pressed="localeStore.current === 'en'" @click="localeStore.choose('en')">en</button>
          <button type="button" class="proto-toggle text-meta" :class="{ on: localeStore.current === 'de' }" :aria-pressed="localeStore.current === 'de'" @click="localeStore.choose('de')">de</button>
        </div>
      </div>
    </div>

    <!-- The chart block, edge to edge as the Profile's. -->
    <section class="flex flex-col gap-md px-screen pt-xl" :data-testid="`proto.chart.${variant}`">
      <!-- A and B: the segmented switch by the chart's title. -->
      <div v-if="variant === 'A' || variant === 'B' || variant === 'D'" class="flex min-h-(--size-button-sm) items-center justify-between gap-md">
        <h2 class="eyebrow">{{ modeTitle }}</h2>
        <div role="group" :aria-label="t('profile.chartMode.label')" class="segmented inline-flex rounded-pill border border-hairline-strong p-xxs">
          <button type="button" class="target figures rounded-pill px-md text-caption" :class="mode === 'months' ? 'bg-ink text-on-ink' : 'text-ink-muted'" :aria-pressed="mode === 'months'" data-testid="proto.mode.months" @click="setMode('months')">{{ t('profile.chartMode.months') }}</button>
          <button type="button" class="target figures rounded-pill px-md text-caption" :class="mode === 'weeks' ? 'bg-ink text-on-ink' : 'text-ink-muted'" :aria-pressed="mode === 'weeks'" data-testid="proto.mode.weeks" @click="setMode('weeks')">{{ t('profile.chartMode.weeks') }}</button>
        </div>
      </div>

      <!-- A: the arrows beside the period label, above the chart. -->
      <div v-if="variant === 'A'" class="flex items-center justify-center gap-sm">
        <UiButton tone="quiet" size="sm" :disabled="!canPrev" :aria-label="t('profile.prevRange')" data-testid="proto.prev" @click="prev"><UiIcon name="back" :size="15" /></UiButton>
        <span class="figures min-w-xxl text-center text-subhead" aria-live="polite" data-testid="proto.period">{{ periodLabel }}</span>
        <UiButton tone="quiet" size="sm" :disabled="!canNext" :aria-label="t('profile.nextRange')" data-testid="proto.next" @click="next"><UiIcon name="chevron" :size="15" /></UiButton>
      </div>

      <!-- C: one pill, the switch and the periods inside the picker it opens. -->
      <button v-else-if="variant === 'C'" type="button" class="target flex h-(--size-button-sm) items-center gap-xxs self-start rounded-pill border border-hairline-strong px-md text-caption" :aria-label="`${modeTitle} · ${periodLabel}`" data-testid="proto.pill" @click="pickerOpen = true">
        <span class="figures">{{ modeTitle }} · {{ periodLabel }}</span>
        <UiIcon name="down" :size="14" />
      </button>

      <!-- E: the mode as two tabs in the title line; every period a chip in one rail. -->
      <template v-else-if="variant === 'E'">
        <div role="tablist" :aria-label="t('profile.chartMode.label')" class="flex items-center gap-lg">
          <button
            v-for="m in ['months', 'weeks'] as const"
            :key="m"
            type="button"
            role="tab"
            class="tab target eyebrow flex h-(--size-button-sm)"
            :class="{ on: mode === m }"
            :aria-selected="mode === m"
            :data-testid="`proto.tab.${m}`"
            @click="setMode(m)"
          >
            {{ m === 'months' ? t('profile.byMonth') : t('profile.byWeek') }}
          </button>
        </div>
        <div ref="rail" class="rail" :class="{ 'fade-start': !railAtStart && mode === 'months', 'fade-end': !railAtEnd }" data-testid="proto.rail" @scroll.passive="railEdges">
          <div v-for="group in railGroups" :key="`${mode}-${group.year}`" class="flex shrink-0 gap-sm">
            <span v-if="group.year" class="year eyebrow" aria-hidden="true">{{ group.year }}</span>
            <button
              v-for="w in group.items"
              :key="`${mode}-${w.index}`"
              type="button"
              class="chip target figures flex h-(--size-button-sm) shrink-0 items-baseline gap-xs rounded-pill border px-ms"
              :class="w.index === windowIndex ? 'border-ink bg-ink text-on-ink' : 'border-hairline-strong text-ink'"
              :aria-pressed="w.index === windowIndex"
              :aria-label="t('profile.columnLabel', { label: w.label, count: count(w.count) })"
              :data-testid="`proto.chip.${w.index}`"
              @click="selectWindow(w.index)"
            >
              <span class="text-caption">{{ w.short }}</span>
              <span class="text-meta" :class="w.index === windowIndex ? 'opacity-70' : 'text-ink-faint'">{{ count(w.count) }}</span>
            </button>
          </div>
        </div>
        <span class="sr-only" aria-live="polite" data-testid="proto.period">{{ periodLabel }}</span>
      </template>

      <!-- The chart (production Columns); in B a swipe moves the window. -->
      <div :style="variant === 'B' ? { touchAction: 'pan-y' } : undefined" @pointerdown="variant === 'B' && dragStart($event)" @pointerup="variant === 'B' && dragEnd($event)">
        <ProfileColumns :columns="columns" :lit="lit" :placeholders="WEEKS_SHOWN" testid="proto.columns" @pick="pick" />
      </div>

      <!-- B: the arrows below the chart. -->
      <div v-if="variant === 'B'" class="flex items-center justify-center gap-sm">
        <UiButton tone="quiet" size="sm" :disabled="!canPrev" :aria-label="t('profile.prevRange')" data-testid="proto.prev" @click="prev"><UiIcon name="back" :size="15" /></UiButton>
        <span class="figures min-w-xxl text-center text-subhead" aria-live="polite" data-testid="proto.period">{{ periodLabel }}</span>
        <UiButton tone="quiet" size="sm" :disabled="!canNext" :aria-label="t('profile.nextRange')" data-testid="proto.next" @click="next"><UiIcon name="chevron" :size="15" /></UiButton>
      </div>

      <!-- D: the timeline. Year ticks over the strip, the brush on the window, its label riding under it. -->
      <div v-if="variant === 'D'" class="flex flex-col gap-xs" data-testid="proto.timeline">
        <div class="relative h-(--text-meta--line-height)" aria-hidden="true">
          <span v-for="tick in yearTicks" :key="tick.year" class="tick figures text-meta text-ink-faint" :style="{ left: `${tick.at}%` }">{{ tick.year }}</span>
        </div>
        <div
          ref="strip"
          role="group"
          :aria-label="modeTitle"
          class="strip relative flex h-(--size-touch)"
          data-testid="proto.strip"
          @pointerdown="scrubStart"
          @pointermove="scrubMove"
          @pointerup="scrubEnd"
          @pointercancel="scrubEnd"
          @keydown.left.prevent="prev"
          @keydown.right.prevent="next"
        >
          <span class="brush" :style="{ left: `${(windowIndex / windows.length) * 100}%`, width: `${100 / windows.length}%` }" aria-hidden="true" />
          <button
            v-for="w in windows"
            :key="`${mode}-${w.index}`"
            type="button"
            class="segment relative flex min-w-0 flex-1 items-end"
            :class="{ on: w.index === windowIndex }"
            :aria-pressed="w.index === windowIndex"
            :aria-label="t('profile.columnLabel', { label: w.label, count: count(w.count) })"
            :data-testid="`proto.segment.${w.index}`"
            @click="selectWindow(w.index)"
          >
            <span v-for="b in w.buckets" :key="b.key" class="micro" :class="{ out: outside(b), now: isToday(b), none: !outside(b) && !b.count }" :style="{ '--h': b.count / stripTop }" />
          </button>
        </div>
        <div class="relative h-(--text-subhead--line-height)">
          <span class="riding figures text-subhead" :style="{ '--at': `${brushAt}%` }" aria-live="polite" data-testid="proto.period">{{ periodLabel }}</span>
        </div>
      </div>

      <!-- The figures under the chart follow the window. -->
      <dl class="grid grid-cols-3 border-t-(length:--stroke-hairline) border-hairline-strong" data-testid="proto.figures">
        <div v-for="(cell, i) in cells" :key="cell.key" class="cell flex min-w-0 flex-col gap-xxs py-md" :class="i < 2 ? 'border-r-(length:--stroke-hairline) border-hairline pr-md' : 'pl-md'">
          <dt class="eyebrow">{{ cell.label }}</dt>
          <dd class="value figures text-figure tabular-nums" :style="{ '--chars': String(cell.value).length }" :data-testid="`proto.figure.${cell.key}`">{{ cell.value }}</dd>
        </div>
      </dl>

      <!-- The chart's text alternative, following the window. -->
      <p class="sr-only" data-testid="proto.chartAlt">{{ chartAlt }}</p>
    </section>

    <ProfileReadsSheet v-model:open="sheetOpen" :title="sheetTitle" :reads="sheetReads" :with-year="mode === 'weeks'" testid="proto.reads" />

    <!-- C's period picker: the switch on top, the periods below, the one in view lit. -->
    <UiSheet v-model:open="pickerOpen" :title="t('profile.sheet.period')" testid="proto.picker">
      <div role="group" :aria-label="t('profile.chartMode.label')" class="segmented inline-flex rounded-pill border border-hairline-strong p-xxs">
        <button type="button" class="target figures rounded-pill px-md text-caption" :class="mode === 'months' ? 'bg-ink text-on-ink' : 'text-ink-muted'" :aria-pressed="mode === 'months'" @click="setMode('months')">{{ t('profile.chartMode.months') }}</button>
        <button type="button" class="target figures rounded-pill px-md text-caption" :class="mode === 'weeks' ? 'bg-ink text-on-ink' : 'text-ink-muted'" :aria-pressed="mode === 'weeks'" @click="setMode('weeks')">{{ t('profile.chartMode.weeks') }}</button>
      </div>
      <div class="flex flex-col pt-sm">
        <button
          v-for="period in periods"
          :key="period.key"
          type="button"
          class="target flex h-(--size-button) items-center justify-between gap-md border-t-(length:--stroke-hairline) border-hairline text-left"
          :aria-pressed="period.key === currentPeriodKey"
          :data-testid="`proto.picker.${period.key}`"
          @click="pickPeriod(period.key)"
        >
          <span class="figures text-subhead" :class="period.key === currentPeriodKey ? 'text-accent-ink' : 'text-ink'">{{ period.label }}</span>
          <span class="figures text-meta text-ink-muted">{{ count(period.count) }}</span>
        </button>
      </div>
    </UiSheet>
  </div>
</template>

<style scoped>
/* Prototype chrome: dashed lamp border, mono type (docs/prototypes/README.md). */
.proto-chrome {
  font-family: var(--font-mono);
}
.proto-toggle {
  border: var(--stroke-hairline) dashed var(--color-accent);
  border-radius: var(--radius-pill);
  padding: 2px var(--spacing-sm);
  color: var(--color-ink-muted);
}
.proto-toggle.on {
  background: var(--color-accent-soft);
  color: var(--color-accent-ink);
}
/* A drawn 32 px control with the 44 px target centred on it (UiButton's rule). */
.target {
  position: relative;
  align-items: center;
}
.target::after {
  position: absolute;
  inset: 50% 0 auto;
  height: var(--size-touch);
  min-width: var(--size-touch);
  content: '';
  transform: translateY(-50%);
}
.segmented .target {
  height: var(--size-button-sm);
}
/* D: the timeline strip. Each window a segment of micro-bars, the brush a frame sliding over it. */
.tick {
  position: absolute;
  top: 0;
  padding-left: var(--spacing-xxs);
  border-left: var(--stroke-hairline) solid var(--color-hairline-strong);
  line-height: var(--text-meta--line-height);
}
.strip {
  touch-action: pan-y;
  border-bottom: var(--stroke-hairline) solid var(--color-hairline-strong);
}
.segment {
  gap: 1px;
  padding: var(--spacing-xs) var(--spacing-xxs) 0;
  border-left: var(--stroke-hairline) dashed var(--color-hairline);
}
.segment:first-of-type {
  border-left-color: transparent;
}
.segment:focus-visible {
  outline: var(--stroke-focus) solid var(--color-accent);
  outline-offset: -2px;
}
.micro {
  flex: 1 1 0;
  min-width: 0;
  height: max(calc(var(--h) * (var(--size-touch) - var(--spacing-sm))), var(--stroke-focus));
  border-radius: 1px 1px 0 0;
  background: var(--color-ink-ghost);
}
.segment.on .micro {
  background: var(--color-ink-muted);
}
.micro.none {
  height: var(--stroke-focus);
}
.micro.out {
  height: 0;
  background: none;
  border-bottom: var(--stroke-focus) dotted var(--color-ink-ghost);
}
.micro.now,
.segment.on .micro.now {
  background: var(--color-accent);
}
.brush {
  position: absolute;
  inset-block: 0 calc(-1 * var(--stroke-hairline));
  border: var(--stroke-hairline) solid var(--color-ink);
  border-bottom-width: var(--stroke-focus);
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  background: var(--color-fill);
  transition:
    left var(--duration-quick) var(--ease-standard),
    width var(--duration-quick) var(--ease-standard);
  pointer-events: none;
}
.riding {
  position: absolute;
  top: 0;
  left: var(--at);
  transform: translateX(calc(-1 * var(--at)));
  white-space: nowrap;
  transition:
    left var(--duration-quick) var(--ease-standard),
    transform var(--duration-quick) var(--ease-standard);
}
@media (prefers-reduced-motion: reduce) {
  .brush,
  .riding {
    transition: none;
  }
}
/* E: the tabs and the chip rail. */
.tab {
  color: var(--color-ink-faint);
  border-bottom: var(--stroke-focus) solid transparent;
}
.tab.on {
  color: var(--color-ink);
  border-bottom-color: var(--color-accent);
}
.rail {
  position: relative;
  display: flex;
  gap: var(--spacing-sm);
  /* The chips' 44 px targets stay inside the scroller: 6 px over and under the 32 px pill. */
  margin-block: calc(-1 * (var(--size-touch) - var(--size-button-sm)) / 2);
  padding-block: calc((var(--size-touch) - var(--size-button-sm)) / 2);
  overflow-x: auto;
  scroll-snap-type: x proximity;
  scrollbar-width: none;
}
.rail::-webkit-scrollbar {
  display: none;
}
/* Oldest left, newest right: when the rail does not fill, it sits against the right edge. */
.rail > :first-child {
  margin-left: auto;
}
.rail .chip {
  scroll-snap-align: center;
}
/* The weeks' year label: it sticks at the rail's left edge while its chips pass under it, the next year pushes it out. */
.rail .year {
  position: sticky;
  left: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  padding-right: var(--spacing-lg);
  margin-right: calc(-1 * var(--spacing-sm));
  background: linear-gradient(to right, var(--color-surface) calc(100% - var(--spacing-inset)), transparent);
}
.rail.fade-start {
  mask-image: linear-gradient(to right, transparent, #000 var(--spacing-xl));
}
.rail.fade-end {
  mask-image: linear-gradient(to left, transparent, #000 var(--spacing-xl));
}
.rail.fade-start.fade-end {
  mask-image: linear-gradient(to right, transparent, #000 var(--spacing-xl), #000 calc(100% - var(--spacing-xl)), transparent);
}
/* The figure's cell sizes it to fit, as ProfileFigures does (components/profile/Figures.vue). */
.cell {
  container-type: inline-size;
}
.cell .value.text-figure {
  display: flex;
  align-items: center;
  font-size: min(var(--text-figure), calc(100cqi / (max(var(--chars, 3), 3) * 0.62)));
}
</style>
