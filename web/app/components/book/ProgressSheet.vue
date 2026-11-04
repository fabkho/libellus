<script setup lang="ts">
// Update progress (issues #39, #68; design round #65, direction D): opened by
// Update on Home's card and Update progress on the book page. Save sits in the
// title row. The Book; the number wheel between − and + (drag or flick it, tap
// its centre to type; components/progress/Wheel.vue); under it "of 608 ✎", the
// page count that counts, which turns the same wheel into the member's own total
// (issue #60: an ebook's pages follow the font size) until Done hands back, with
// how far the wheel has moved ("+24") and Pages | Percent when the Book has a page
// count. A Book without one counts in percent, with "Count in pages" to give it
// one. Last, how the read ends, two rows of one group: Finish, for the evening the
// book ends, and DNF under it, for the one she puts it down (the book page no
// longer carries either). Each saves the progress first, then its own sheet takes
// over. A refusal stays in the sheet and Save tries again.
//
// Progress on an earlier day (plan docs/plans/backdated-progress.md §3): "Today · Yesterday · Pick a day…" under the
// Book switch the sheet to a day she forgot to update (`reading.progressDay`). The title names the day, "Between
// Fri · p. 170 and Sun · p. 188" takes the place of Last time (the range the wheel may move in), the wheel opens on
// where the day ended (or where the day before did) and runs only inside that range, "+8" counts from the day's
// start, and a quiet line says what else changes. The total and Finish / DNF are Today's: they end the read today.
// A day that has an entry can be removed here, behind a confirm. A polite status says the day and its range, because
// a changed dialog title is not read again.
import { PAGE_CEILING, pageCountOf, progressOf, progressValueOf, type ProgressMode } from '~/data/progress'
import { amountOf, effectOf, unitOf, valueIn, type DayContext } from '~/data/progressDays'
import { dayRangeOf, offersDays } from '~/data/progressDayView'
import { isoDay } from '~/utils/dates'
import { useReadingStore } from '~/stores/reading'
import { stepTick } from '#layers/ui/app/utils/haptics'

// Direct, as this screen asked before own covers: only the Library's row and the reel go through `/cover` (docs/plans/owned-covers.md §5).
const coverHosts = { ...useCoverHosts(), proxy: false }

const { t, n } = useI18n()
const reading = useReadingStore()
// Saving works offline too: it waits to sync (#93).
const text = useProgressText()

const open = computed({
  get: () => reading.progressing !== null,
  set: (value) => {
    if (!value) reading.closeProgress()
  },
})

// Kept while the sheet slides away, so it does not empty mid-exit.
const entry = ref(reading.progressing)
watch(
  () => reading.progressing,
  (value) => {
    if (value) entry.value = value
  },
)

// "Last time · Yesterday · 24 pages" (issue #68): the read's last day of reading before today.
const { days, loaded, lastTime, dayWords, dayWordsInline, amountWords } = useReadingDays(() => entry.value)
const { weekdayDay } = useDays()

const editingTotal = computed(() => reading.progressEditing === 'total')
const inPercent = computed(() => reading.progressMode === 'percent')
const pageCount = computed(() => reading.progressPageCount)
const editionCount = computed(() => reading.progressEditionCount)
const MODES: readonly ProgressMode[] = ['page', 'percent']

const action = computed(() => {
  if (editingTotal.value) return t('book.progress.done')
  if (reading.progressBusy) return t('book.progress.busy')
  return reading.progressError ? t('book.progress.retry') : t('book.progress.save')
})
const actionDisabled = computed(() => reading.progressBusy)

// ---------------------------------------------------------------- An earlier day

const today = computed(() => isoDay())
/** The day the sheet is about: null is Today. */
const earlier = computed(() => reading.progressDay)
const bounds = computed(() => reading.progressBounds)
const startedOn = computed(() => entry.value?.latestSession?.startedOn ?? null)
/** Her own total was changed in this sheet (it goes with a Today save, so the day switch waits until it is saved). */
const totalChanged = computed(() => reading.progressTotal !== (entry.value?.pageCountOverride ?? null))
/** The pill row: needs the read's days (the bounds are unknown without them) and a day before today to record. */
const offersDay = computed(
  () => !editingTotal.value && !totalChanged.value && (earlier.value !== null || (loaded.value && offersDays(startedOn.value, today.value))),
)
const dayContext = computed<DayContext | null>(() => {
  const now = entry.value
  return now ? { current: progressOf(now.latestSession), pageCount: pageCountOf(now), startedOn: startedOn.value } : null
})
/** The wheel's number as the value the database takes. */
const wheelValue = computed(() => progressValueOf(reading.progressValue, reading.progressMode))
/** The day has an entry: its wheel opens on where it ended, and it can be removed. */
const hasEntry = computed(() => bounds.value?.end != null)

/** "p. 170", "45 %": a place in the book, short, for the lines about a day. */
function place(value: number, mode: ProgressMode = reading.progressMode): string {
  return mode === 'percent' ? t('book.progress.percent', { percent: value }) : t('book.progress.pageOnly', { page: value })
}
/** "+8", "−6 %": how far a day went, in the read's own unit. */
function signed(amount: number): string {
  const percent = unitOf(dayContext.value?.pageCount ?? null) === 'percent'
  const key = amount < 0 ? (percent ? 'lossPercent' : 'lossPages') : percent ? 'gainPercent' : 'gainPages'
  return t(`book.progress.${key}`, { count: n(Math.abs(amount)) })
}

const range = computed(() => {
  const day = earlier.value
  const b = bounds.value
  if (!day || !b || !days.value) return null
  const { from, to } = dayRangeOf(days.value, day, b, reading.progressLimit)
  const start = t('book.progress.rangePoint', { day: from.day ? dayWords(from.day) : t('book.progress.rangeStart'), value: place(from.value) })
  const open = to.kind === 'open'
  const end =
    to.kind === 'day'
      ? t('book.progress.rangePoint', { day: dayWordsInline(to.day), value: place(to.value) })
      : to.kind === 'now'
        ? t('book.progress.rangePoint', { day: t('book.progress.rangeNow'), value: place(to.value) })
        : ''
  return {
    label: t(open ? 'book.progress.rangeLabelOpen' : 'book.progress.rangeLabel'),
    line: open ? start : t('book.progress.rangeLine', { from: start, to: end }),
    status: open
      ? t('book.progress.statusDayOpen', { day: weekdayDay(day), from: place(from.value) })
      : t('book.progress.statusDay', { day: weekdayDay(day), from: place(from.value), to: place(to.kind === 'open' ? 0 : to.value) }),
  }
})

/** What saving does beyond the day itself: the day after re-chains, or her progress moves (`effectOf`); nothing when only this day changes. */
const effect = computed(() => {
  const day = earlier.value
  const ctx = dayContext.value
  if (!day || !bounds.value || !days.value || !ctx) return ''
  const e = effectOf(days.value, day, wheelValue.value, ctx)
  if (e.kind === 'now') return t('book.progress.effectNow', { value: place(e.value ?? 0) })
  if (!e.next) return ''
  const gone = e.next.now === 0
  const day_ = weekdayDay(day)
  if (e.kind === 'add') {
    return gone
      ? t('book.progress.effectAddGone', { day: day_, next: dayWords(e.next.day) })
      : t('book.progress.effectAdd', { day: day_, next: dayWords(e.next.day), amount: signed(e.next.now), was: signed(e.next.was) })
  }
  const amount = signed(reading.progressValue - bounds.value.start)
  return gone
    ? t('book.progress.effectEditGone', { day: day_, amount, next: dayWordsInline(e.next.day) })
    : t('book.progress.effectEdit', { day: day_, amount, next: dayWordsInline(e.next.day), now: signed(e.next.now) })
})

/** The title: the day, in full, or the sheet's own. */
const title = computed(() => (earlier.value ? t('book.progress.titleDay', { day: weekdayDay(earlier.value) }) : t('book.progress.title')))

// Remove this day: the confirm says where the day's pages go, worded when it is asked (not while it slides away).
const confirming = ref(false)
const removeCopy = ref({ title: '', text: '' })
function askRemove() {
  const day = earlier.value
  const ctx = dayContext.value
  const row = days.value?.find((d) => d.day === day)
  if (!day || !ctx || !days.value || !row) return
  const e = effectOf(days.value, day, null, ctx)
  const amount = amountWords(Math.abs(amountOf(row, ctx.pageCount)))
  const unit = unitOf(ctx.pageCount)
  const stays = place(valueIn(ctx.current, unit, ctx.pageCount) ?? 0, unit)
  let text: string
  if (e.kind === 'now') text = e.value ? t('book.progress.removeDay.textLatest', { value: place(e.value, unit) }) : t('book.progress.removeDay.textStart')
  else if (e.next) text = t('book.progress.removeDay.text', { amount, next: dayWordsInline(e.next.day), value: stays })
  else text = t('book.progress.removeDay.textOnly', { amount, value: stays })
  removeCopy.value = { title: t('book.progress.removeDay.title', { day: weekdayDay(day) }), text }
  confirming.value = true
}
async function remove() {
  if (await reading.removeProgressDay()) confirming.value = false
}

// What assistive tech reads for the wheel: the value in words ("p. 212 of 608", "45 %").
const valueText = computed(() =>
  text(inPercent.value ? { percent: reading.progressValue } : { page: reading.progressValue }, pageCount.value).value,
)
// On an earlier day the wheel is measured against where the day began, not against where the read is.
const deltaBy = computed(() => (earlier.value ? (bounds.value ? reading.progressValue - bounds.value.start : 0) : reading.progressDelta))
const delta = computed(() => {
  const by = deltaBy.value
  if (!by) return null
  const key = by > 0 ? (inPercent.value ? 'gainPercent' : 'gainPages') : inPercent.value ? 'lossPercent' : 'lossPages'
  return t(`book.progress.${key}`, { count: n(Math.abs(by)) })
})

/** − / +: a step on the wheel that is showing (held, they repeat). */
function step(by: number) {
  if (reading.progressBusy) return
  if (editingTotal.value) {
    reading.progressTotalDraft = Math.min(Math.max(reading.progressTotalDraft + by, 1), PAGE_CEILING)
  } else {
    reading.progressValue = Math.min(Math.max(reading.progressValue + by, reading.progressFloor), reading.progressLimit)
  }
  stepTick(performance.now())
}
const minus = useHoldRepeat((times) => step(-times))
const plus = useHoldRepeat((times) => step(times))

// A new number is a new try: the last refusal no longer applies.
watch(
  () => [reading.progressValue, reading.progressMode, reading.progressTotal],
  () => (reading.progressError = null),
)
</script>

<template>
  <UiSheet
    v-model:open="open"
    :title="title"
    testid="progress"
    :action="action"
    :action-disabled="actionDisabled"
    @action="reading.confirmProgress()"
  >
    <template v-if="entry">
      <UiBookLine
        :title="entry.book.title"
        :authors="entry.book.authors"
        v-bind="coverImage(entry.book, 'xs', coverHosts)"
        :thumbhash="entry.book.coverThumbhash"
        :colors="entry.book.coverColors"
      />

      <!-- The day: Today, Yesterday, or one picked (the sheet then speaks of that day). -->
      <ProgressDayPills
        v-if="offersDay"
        :day="earlier"
        :today="today"
        :min="startedOn ?? undefined"
        :disabled="reading.progressBusy"
        class="mb-xs"
        @choose="reading.chooseProgressDay($event)"
      />

      <!-- What she read last time, over the wheel; on an earlier day, the range the wheel may move in. -->
      <p v-if="range" class="figures grid min-h-(--size-touch) content-center py-xs text-meta text-ink-faint" data-testid="progress.range">
        <span><span class="eyebrow mr-sm">{{ range.label }}</span>{{ range.line }}</span>
      </p>
      <p v-else-if="!editingTotal && !earlier && lastTime" class="figures flex min-h-(--size-touch) items-center truncate text-meta text-ink-faint" data-testid="progress.lastTime">
        <span class="eyebrow mr-sm">{{ t('book.progress.lastTime') }}</span>{{ t('book.progress.lastTimeLine', { day: dayWords(lastTime.day), amount: amountWords(lastTime.amount) }) }}
      </p>

      <!-- The total wheel says what it is for, and the way back to the edition's. -->
      <div v-if="editingTotal" class="flex min-h-(--size-touch) items-center justify-between gap-ms">
        <p class="eyebrow text-accent-ink" data-testid="progress.totalTitle">{{ t('book.progress.totalTitle') }}</p>
        <UiButton
          v-if="reading.progressTotal !== null"
          tone="plain"
          size="sm"
          class="-mr-sm"
          data-testid="progress.totalDrop"
          @click="reading.dropProgressTotal()"
        >
          {{ editionCount ? t('book.progress.totalEdition', { count: n(editionCount) }) : t('book.progress.totalPercent') }}
        </UiButton>
      </div>

      <div class="flex items-center gap-sm">
        <button
          type="button"
          class="step edge"
          :aria-label="t('book.progress.less')"
          :disabled="reading.progressBusy"
          data-testid="progress.minus"
          @pointerdown="minus.start"
          @pointerup="minus.stop"
          @pointerleave="minus.stop"
          @pointercancel="minus.stop"
          @click="minus.once"
        >
          <span class="minus" aria-hidden="true" />
        </button>
        <div class="min-w-0 flex-1">
          <ProgressWheel
            v-if="!editingTotal"
            v-model="reading.progressValue"
            :min="reading.progressFloor"
            :max="reading.progressLimit"
            :suffix="inPercent ? '%' : ''"
            :label="inPercent ? t('book.progress.percentLabel') : t('book.progress.pageLabel')"
            :value-text="valueText"
            :disabled="reading.progressBusy"
            testid="progress.wheel"
          />
          <ProgressWheel
            v-else
            v-model="reading.progressTotalDraft"
            :min="1"
            :max="PAGE_CEILING"
            :label="t('book.progress.totalTitle')"
            testid="progress.totalWheel"
          />
        </div>
        <button
          type="button"
          class="step edge"
          :aria-label="t('book.progress.more')"
          :disabled="reading.progressBusy"
          data-testid="progress.plus"
          @pointerdown="plus.start"
          @pointerup="plus.stop"
          @pointerleave="plus.stop"
          @pointercancel="plus.stop"
          @click="plus.once"
        >
          <UiIcon name="plus" :size="18" />
        </button>
      </div>

      <!-- Under the wheel: of how many (the way to her own total), what this adds, and the unit. -->
      <div v-if="!editingTotal" class="mt-xs flex min-h-(--size-touch) items-center justify-between gap-sm">
        <span class="flex min-w-0 items-center gap-sm">
          <button
            v-if="!earlier && !inPercent"
            type="button"
            class="total figures text-caption text-ink-muted enabled:hover:text-ink"
            :aria-label="t('book.progress.totalEdit', { count: n(pageCount ?? 0) })"
            :disabled="reading.progressBusy"
            data-testid="progress.total"
            @click="reading.editProgressTotal()"
          >
            {{ t('book.progress.totalOf', { count: n(pageCount ?? 0) }) }}<UiIcon name="pencil" :size="12" class="ml-xs inline text-ink-faint" />
          </button>
          <button
            v-else-if="!earlier && !pageCount"
            type="button"
            class="total text-caption text-ink-muted enabled:hover:text-ink"
            :disabled="reading.progressBusy"
            data-testid="progress.total"
            @click="reading.editProgressTotal()"
          >
            {{ t('book.progress.totalCount') }}
          </button>
          <span
            v-if="delta"
            class="figures truncate text-caption"
            :class="deltaBy > 0 ? 'text-accent-ink' : 'text-ink-faint'"
            data-testid="progress.delta"
          >
            {{ delta }}
          </span>
        </span>
        <div v-if="pageCount" role="group" :aria-label="t('book.progress.modeLabel')" class="flex shrink-0 gap-xs">
          <button
            v-for="mode in MODES"
            :key="mode"
            type="button"
            :aria-pressed="reading.progressMode === mode"
            class="pill relative inline-flex h-(--size-button-sm) items-center rounded-pill px-ms text-caption"
            :class="reading.progressMode === mode ? 'bg-ink text-on-ink' : 'edge text-ink-muted hover:bg-fill'"
            :disabled="reading.progressBusy"
            :data-testid="`progress.mode.${mode}`"
            @click="reading.chooseProgressMode(mode)"
          >
            {{ t(`book.progress.mode.${mode}`) }}
          </button>
        </div>
      </div>
      <p v-else class="mt-xs min-h-(--size-touch) px-md text-center text-caption text-ink-faint" data-testid="progress.totalHint">
        {{ t('book.progress.totalHint') }}
      </p>

      <!-- How the read ends, both behind a save of where she is: Finish (the Finish sheet), and
           under it DNF (the DNF sheet). One group of two rows, their buttons one width. -->
      <div v-if="!editingTotal && !earlier" class="mt-sm grid grid-cols-[1fr_auto] overflow-hidden rounded-md bg-fill edge-faint">
        <div class="end col-span-2 grid grid-cols-subgrid items-center gap-ms px-inset py-ms" data-testid="progress.finishRow">
          <span class="flex min-w-0 flex-col gap-xxs">
            <span class="text-body">{{ t('book.progress.finishedIt') }}</span>
            <span class="text-caption text-ink-faint" data-testid="progress.finishHint">
              {{ reading.progressAtEnd ? t('book.progress.reached') : t('book.progress.finishHint') }}
            </span>
          </span>
          <UiButton
            :tone="reading.progressAtEnd ? 'primary' : 'quiet'"
            size="sm"
            :disabled="reading.progressBusy"
            data-testid="progress.finish"
            @click="reading.finishFromProgress()"
          >
            <UiIcon name="check" :size="14" bold />{{ t('book.finish') }}
          </UiButton>
        </div>
        <div class="end col-span-2 grid grid-cols-subgrid items-center gap-ms px-inset py-ms" data-testid="progress.abandonRow">
          <span class="flex min-w-0 flex-col gap-xxs">
            <span class="text-body">{{ t('book.progress.notFinishing') }}</span>
            <span class="text-caption text-ink-faint" data-testid="progress.abandonHint">{{ t('book.progress.abandonHint') }}</span>
          </span>
          <UiButton tone="quiet" size="sm" :disabled="reading.progressBusy" data-testid="progress.abandon" @click="reading.abandonFromProgress()">
            <UiIcon name="slash" :size="14" />{{ t('book.abandon') }}
          </UiButton>
        </div>
      </div>

      <!-- What saving does beyond the day: the polite live region stays, its line comes and goes. -->
      <div role="status" aria-live="polite" data-testid="progress.effect">
        <UiReveal :show="Boolean(effect)">
          <p class="px-xs pt-xs text-caption text-ink-faint">{{ effect }}</p>
        </UiReveal>
      </div>
      <!-- The day's own words and range, said once when it changes: a changed dialog title is not read again. -->
      <p class="sr-only" role="status" aria-live="polite" data-testid="progress.announce">{{ range?.status }}</p>

      <div v-if="earlier && hasEntry" class="mt-md">
        <UiButton block tone="danger" :disabled="reading.progressBusy" data-testid="progress.remove" @click="askRemove">
          {{ t('book.progress.dayRemove') }}
        </UiButton>
      </div>

      <p v-if="reading.progressError && !confirming" class="mt-ms px-xs text-caption text-error" role="alert" data-testid="progress.failure">
        {{ t(`library.error.${reading.progressError}`) }}
      </p>
      <div class="h-sm" />
    </template>
  </UiSheet>

  <UiConfirm
    v-model:open="confirming"
    :title="removeCopy.title"
    :text="removeCopy.text"
    :action="reading.progressBusy ? t('book.progress.removeDay.busy') : t('book.progress.removeDay.action')"
    :cancel-label="t('book.progress.removeDay.keep')"
    :busy="reading.progressBusy"
    :error="reading.progressError ? t(`library.error.${reading.progressError}`) : null"
    testid="removeDay"
    @confirm="remove"
  />
</template>

<style scoped>
/* The ending rows' divider: a hairline inset under the text, as between grouped rows (UiRow). */
.end {
  position: relative;
}
.end + .end::before {
  position: absolute;
  top: 0;
  right: 0;
  left: var(--spacing-inset);
  height: var(--stroke-hairline);
  content: '';
  background: var(--color-hairline-strong);
}

/* − and +: round 44 pt targets on a hairline ring, darker while pressed. */
.step {
  display: flex;
  width: var(--size-touch);
  height: var(--size-touch);
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-pill);
  color: var(--color-ink);
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.step:active {
  background: var(--color-fill-strong);
}
.step:disabled {
  color: var(--color-ink-ghost);
}
.minus {
  width: var(--spacing-ms);
  height: var(--stroke-icon);
  border-radius: var(--radius-pill);
  background: currentColor;
}
/* "of 608 ✎": a dotted underline says it can be changed; 44 pt tall to tap. */
.total {
  min-height: var(--size-touch);
  text-align: left;
  text-decoration: underline dotted var(--color-ink-ghost);
  text-underline-offset: var(--spacing-xs);
}
/* The drawn pill is 32 px; the touch target stays 44. */
.pill::after {
  position: absolute;
  inset: 50% 0 auto;
  height: var(--size-touch);
  content: '';
  transform: translateY(-50%);
}
</style>
