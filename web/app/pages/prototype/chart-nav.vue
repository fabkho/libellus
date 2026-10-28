<script setup lang="ts">
// Dev only (the route is dropped from every build: nuxt.config.ts, `$production`): the clickable
// prototype for WP-08 (issue #11b/#11c), the Profile chart's Week/Month switch and range navigator.
// NOTHING here is wired to the reading record: a fake one (today pinned to 17 Jun 2026, a first
// finish on 3 Sep 2024) stands in, so every screenshot is stable. The chart and the books sheet are
// the production components (ProfileColumns, ProfileReadsSheet) on the app's tokens; the prototype
// chrome is the dashed mono bar on top.
//
// The chosen direction (seven were compared, docs/prototypes/chart-navigator.md): ONE capsule row.
// The inactive mode is a plain word; the inked one is the stepper — ‹ the window › — and it is the
// mode's name and the navigator at once. The weeks' full dates ride under the chart as its caption.
// Switching modes animates as UiIconSegments unfolds a chosen segment's name (a grid column 0fr → 1f
// with the fade, the inked surface fading in, the halves reflowing on flex-grow: components/ui/
// IconSegments.vue, docs/MOTION.md, `standard`); stepping the window slides the label in the
// direction of travel. Reduce Motion: the app's own (main.css). Query: ?mode=months|weeks&lang=en|de.
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

/** Which way the window last moved: the label slides in from that side. */
const stepDir = ref(1)
function prev() {
  if (!canPrev.value) return
  stepDir.value = -1
  if (mode.value === 'months') year.value -= 1
  else weekStart.value = addDays(weekStart.value, -7 * WEEKS_SHOWN)
}
function next() {
  if (!canNext.value) return
  stepDir.value = 1
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
/** The capsule names the window short — weeks by their numbers ("KW 13–25 · 2026") — the caption tells the dates. */
const shortLabel = computed(() => {
  if (mode.value === 'months') return String(year.value)
  const first = columns.value[0]!
  const last = columns.value[columns.value.length - 1]!
  const from = first.start.slice(0, 4)
  const to = last.end.slice(0, 4)
  return `${t('profile.weekLabel', { week: `${first.label}–${last.label}` })} · ${from === to ? to : `${from}/${to.slice(2)}`}`
})
const modeTitle = computed(() => (mode.value === 'months' ? t('profile.byMonth') : t('profile.byWeek')))

/** When the inked half changes sides, an arrow lands where the tapped mode name was; a second tap that
 * quick (a double tap, an impatient finger) must not step the window it just opened. */
let switchedAt = 0
function stepAfterSwitch(step: () => void) {
  if (Date.now() - switchedAt > 400) step()
}

function setMode(next: 'months' | 'weeks') {
  if (mode.value === next) return
  switchedAt = Date.now()
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
// A bar's books in the existing sheet.
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

// A swipe on the chart moves the window (the page still scrolls: `pan-y`), except one that starts
// within 24 px of either screen edge — that is iOS's back-swipe and stays the system's.
const EDGE = 24
let dragFrom: number | null = null
function dragStart(event: PointerEvent) {
  if (event.clientX < EDGE || event.clientX > window.innerWidth - EDGE) return
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
      <p class="text-meta text-ink-muted">Prototype · WP-08 chart navigator, the chosen capsule · fake data, today pinned to 17 Jun 2026 · dev only, dropped from every build</p>
      <div class="flex flex-wrap items-center gap-sm">
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
    <section class="flex flex-col gap-md px-screen pt-xl" data-testid="proto.chart">
      <!-- The capsule: the inactive mode a plain word, the inked one the stepper. Switching modes is
           UiIconSegments' motion — the word folds away as the stepper unfolds in its place (a grid
           column 0fr → 1fr with the fade), the inked surface fading in, the halves reflowing. -->
      <div role="group" :aria-label="t('profile.chartMode.label')" class="capsule flex h-(--size-touch) rounded-pill border border-hairline-strong p-xxs" data-testid="proto.capsule">
        <div v-for="m in ['months', 'weeks'] as const" :key="m" class="segment" :class="{ on: mode === m }" :data-testid="`proto.mode.${m}`">
          <!-- The word: the tap that picks this mode. It folds away (and out of reach) once picked. -->
          <button
            type="button"
            class="pick unfold target"
            :class="{ closed: mode === m }"
            :aria-pressed="mode === m"
            :tabindex="mode === m ? -1 : 0"
            :inert="mode === m || undefined"
            @click="setMode(m)"
          >
            <span class="clip"><span class="word figures text-caption">{{ t(`profile.chartMode.${m}`) }}</span></span>
          </button>
          <!-- The stepper: the arrows and the window's name. It unfolds where the word was; folded
               (`inert`) while the mode is off, so its arrows are out of reach and out of the tab order. -->
          <span class="ctl unfold" :class="{ closed: mode !== m }" :inert="mode !== m || undefined">
            <span class="clip">
              <span class="stepper">
                <button type="button" class="step target" :disabled="!canPrev" :aria-label="t('profile.prevRange')" :data-testid="mode === m ? 'proto.prev' : undefined" @click="stepAfterSwitch(prev)"><UiIcon name="back" :size="15" /></button>
                <span class="fit figures" aria-live="polite" :data-testid="mode === m ? 'proto.period' : undefined">
                  <span class="sr-only">{{ m === 'months' ? t('profile.byMonth') : t('profile.byWeek') }} · </span>
                  <Transition :name="stepDir > 0 ? 'step-fwd' : 'step-back'" mode="out-in">
                    <span :key="shortLabel" class="whitespace-nowrap" :style="{ '--chars': shortLabel.length }">{{ shortLabel }}</span>
                  </Transition>
                </span>
                <button type="button" class="step target" :disabled="!canNext" :aria-label="t('profile.nextRange')" :data-testid="mode === m ? 'proto.next' : undefined" @click="stepAfterSwitch(next)"><UiIcon name="chevron" :size="15" /></button>
              </span>
            </span>
          </span>
        </div>
      </div>

      <!-- The chart (production Columns); a swipe moves the window. -->
      <div style="touch-action: pan-y" @pointerdown="dragStart($event)" @pointerup="dragEnd($event)">
        <ProfileColumns :columns="columns" :lit="lit" :placeholders="WEEKS_SHOWN" testid="proto.columns" @pick="pick" />
      </div>

      <!-- The weeks' full dates, as the chart's caption under its axis (the capsule names them by number). -->
      <Transition name="fold">
        <p v-if="mode === 'weeks'" class="figures -mt-xs text-center text-meta text-ink-muted" aria-hidden="true" data-testid="proto.caption">{{ periodLabel }}</p>
      </Transition>

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
/* A drawn control with the 44 px target centred on it (UiButton's rule). */
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

/* The capsule, animated as UiIconSegments (components/ui/IconSegments.vue): the halves reflow on
   flex-grow over `standard`, the inked one unfolds its stepper where the other's word folds away —
   a grid column 0fr → 1fr so the width animates without measuring, with the fade over it. The inked
   surface and the text colour fade in with the growth. Reduce Motion: main.css. */
.capsule .segment {
  display: flex;
  min-width: 0;
  overflow: hidden;
  /* The segment's width is the flex row's, never its content's: the label sizes against it (below). */
  container-type: inline-size;
  align-items: center;
  justify-content: center;
  flex: 1 1 0;
  border-radius: var(--radius-pill);
  transition:
    flex-grow var(--duration-standard) var(--ease-standard),
    background-color var(--duration-standard) var(--ease-standard),
    color var(--duration-quick) var(--ease-standard);
}
.capsule .segment.on {
  flex-grow: 2.3;
  background: var(--color-ink);
  color: var(--color-on-ink);
}
.unfold {
  display: grid;
  min-width: 0;
  /* Open, a half fills its segment: the whole inactive half is one tap target. */
  flex: 1 1 0;
  grid-template-columns: 1fr;
  opacity: 1;
  transition:
    flex-grow var(--duration-standard) var(--ease-standard),
    grid-template-columns var(--duration-standard) var(--ease-standard),
    opacity var(--duration-standard) var(--ease-standard);
}
.unfold.closed {
  flex-grow: 0;
  grid-template-columns: 0fr;
  opacity: 0;
}
.clip {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}
.pick {
  height: 100%;
  color: var(--color-ink-muted);
}
.word {
  display: block;
  padding-inline: var(--spacing-ms);
  text-align: center;
}
.stepper {
  display: flex;
  height: 100%;
  align-items: center;
}
/* The arrows: 32 px drawn on the ink (44 px targets), a disabled end faded out. */
.step {
  display: flex;
  width: var(--size-button-sm);
  height: 100%;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  transition: opacity var(--duration-quick) var(--ease-standard);
}
/* The press: a round dot under the arrow, fully round as the selected half's tile
   (the same `radius-pill`), not a shape of its own. */
.step::before {
  position: absolute;
  top: 50%;
  left: 50%;
  width: var(--size-button-sm);
  height: var(--size-button-sm);
  border-radius: var(--radius-pill);
  content: '';
  transform: translate(-50%, -50%);
  transition: background-color var(--duration-quick) var(--ease-standard);
}
/* The arrow's icon stays above the press dot (both are positioned; the dot is the earlier one). */
.step :deep(svg) {
  position: relative;
}
.step::after {
  inset: 0 auto;
  height: 100%;
  transform: none;
}
.step:disabled {
  opacity: 0.3;
}
.step:not(:disabled):active::before {
  background: color-mix(in srgb, var(--color-on-ink) 14%, transparent);
}
/* The label keeps the subhead size and shrinks only where it would not fit (a year end at 360 px in
   English): Geist Mono's advance is 0.6 em, so the room over its characters gives the size, as the
   figures cells do. */
.fit {
  display: flex;
  min-width: 0;
  flex: 1;
  justify-content: center;
  line-height: var(--text-subhead--line-height);
}
.capsule .segment .fit > :last-child {
  font-size: min(var(--text-subhead), calc((100cqi - 2 * var(--size-button-sm) - var(--spacing-md)) / (var(--chars) * 0.6)));
}

/* Stepping the window: the label slides in from the side the window came from and the old one out
   the far side (`quick`), the arrows never moving. */
.step-fwd-enter-active,
.step-fwd-leave-active,
.step-back-enter-active,
.step-back-leave-active {
  transition:
    transform var(--duration-quick) var(--ease-standard),
    opacity var(--duration-quick) var(--ease-standard);
}
.step-fwd-enter-from {
  transform: translateX(8px);
  opacity: 0;
}
.step-fwd-leave-to {
  transform: translateX(-8px);
  opacity: 0;
}
.step-back-enter-from {
  transform: translateX(-8px);
  opacity: 0;
}
.step-back-leave-to {
  transform: translateX(8px);
  opacity: 0;
}
/* The caption arriving with the weeks, and leaving with them. */
.fold-enter-active,
.fold-leave-active {
  transition: opacity var(--duration-quick) var(--ease-standard);
}
.fold-enter-from,
.fold-leave-to {
  opacity: 0;
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
