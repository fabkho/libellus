<script setup lang="ts">
// The reading log of a Book being read, on its page under the actions (issue
// #68, direction D): every day that read something, newest first, as a row:
// the day ("Yesterday", "Fri", "3 Oct"), how much in the lamp colour ("+24",
// "+5 %"; a day that went back, "−6", in the quiet ink) and where it ended
// ("p. 212", "44 %"). The last 14 days show, *See all* opens the rest in place;
// history starts with #68, so a read without any day of progress shows no log.
// It opens in with the figures once the first save has booked a day (issue #79).
//
// Progress on an earlier day (docs/plans/backdated-progress.md §3.3): a row is a
// button that opens the Update progress sheet on that day (edit it, or remove it),
// and *Add day* in the head opens it on the newest day without an entry. Both leave
// the sheet to the store (`openProgress(entry, { day })`); focus goes back to the
// row or to Add day when the sheet closes (the row is gone after a Remove).
import type { LibraryEntry } from '~/data/library'
import { addDayOf, logRowsOf, type LogRow } from '~/data/progressDayView'
import { useReadingStore } from '~/stores/reading'
import { isoDay } from '~/utils/dates'

const props = defineProps<{ entry: LibraryEntry }>()

const { t, n } = useI18n()
const reading = useReadingStore()
const { days, log, unit, shown, dayWords } = useReadingDays(() => props.entry)

const all = ref(false)
const view = computed(() => logRowsOf(log.value, all.value))
/** The day Add day opens on; null where the read has no earlier day (it began today). */
const addDay = computed(() => (days.value ? addDayOf(days.value, props.entry.latestSession?.startedOn, isoDay()) : null))

const percent = computed(() => unit.value === 'percent')
/** "+24", "+5 %", "−6": what the row shows (no "+-6"). */
function amountText(row: LogRow) {
  const key = row.back ? (percent.value ? 'lossPercent' : 'lossPages') : percent.value ? 'gainPercent' : 'gainPages'
  return t(`book.progress.${key}`, { count: n(row.size) })
}
/** "p. 212", "44 %". */
const endText = (end: number) => (percent.value ? t('book.progress.percent', { percent: end }) : t('book.progress.logEnd', { page: n(end) }))
/**
 * "Sat +18 p. 188. Edit": what the row shows, word for word (a name must contain the visible text, WCAG 2.5.3), then
 * what it does.
 */
function rowLabel(row: LogRow) {
  const day = dayWords(row.day)
  const amount = amountText(row)
  return row.end === null ? t('book.progress.logRowLabelNoEnd', { day, amount }) : t('book.progress.logRowLabel', { day, amount, end: endText(row.end) })
}

// ------------------------------------------------------------------ the sheet and focus

/** The day of the row the sheet was opened from (null: from Add day). A row that is gone by the time it closes takes its button, and focus, with it. */
let from: string | null = null
const add = useTemplateRef<HTMLElement>('add')
const rowEls = useTemplateRef<{ $el: HTMLElement }[]>('rows')

/** The pointer's tap does not focus a button in every browser; focus it so the sheet gives it back on close. */
function openOn(event: Event, day: string, row = false) {
  ;(event.currentTarget as HTMLElement | null)?.focus({ preventScroll: true })
  from = row ? day : null
  // Today's row opens Today's sheet (the free wheel, Undo on the card); only an earlier day is bounded by its neighbours.
  reading.openProgress(props.entry, day < isoDay() ? { day } : {})
}

/** The sheet gave focus back to a row that a Remove has taken away: Add day has it (or the first row), not the page. */
function keepFocus() {
  if (!from || reading.progressing || view.value.rows.some((row) => row.day === from)) return
  const active = document.activeElement
  if (active && active !== document.body) return
  from = null
  ;(add.value ?? rowEls.value?.[0]?.$el)?.focus({ preventScroll: true })
}
// The sheet has closed, or the row it came from has gone (the days change after the close, too).
watch([() => reading.progressing, () => view.value.rows.map((row) => row.day).join()], () => nextTick(keepFocus))

/** *See all*: the older days open in place; focus goes to the first of them (the pill is gone). */
async function seeAll() {
  const first = view.value.rows.length
  all.value = true
  await nextTick()
  rowEls.value?.[first]?.$el.focus({ preventScroll: true })
}
</script>

<template>
  <UiReveal :show="shown === 'days' && view.rows.length > 0" data-testid="book.readingLog">
    <section class="relative px-ml pt-xl">
      <div class="mb-ms flex flex-wrap items-center justify-between gap-x-sm gap-y-xs">
        <h2 class="eyebrow">{{ t('book.progress.logTitle') }}</h2>
        <button
          v-if="addDay"
          ref="add"
          type="button"
          class="add-day relative inline-flex min-h-(--size-button-sm) shrink-0 items-center gap-xs rounded-pill py-xs pr-md pl-sm text-footnote whitespace-nowrap text-ink-muted edge hover:bg-fill"
          aria-haspopup="dialog"
          :aria-label="t('book.progress.logAddLabel')"
          data-testid="book.logAdd"
          @click="openOn($event, addDay)"
        >
          <UiIcon name="plus" :size="14" bold />{{ t('book.progress.logAdd') }}
        </button>
      </div>
      <UiRowGroup>
        <UiRow
          v-for="row in view.rows"
          :key="row.day"
          ref="rows"
          as="button"
          :label="dayWords(row.day)"
          mono
          chevron
          :aria-label="rowLabel(row)"
          :data-day="row.day"
          data-testid="book.logDay"
          @click="openOn($event, row.day, true)"
        >
          <span :class="row.back ? 'text-ink-faint' : 'text-accent-ink'" data-testid="book.logAmount">{{ amountText(row) }}</span>
          <!-- A space between the two, not drawn in a flex row, but in the row's text: the name says what the row shows ("Sat +18 p. 188"). -->
          {{ ' ' }}
          <span v-if="row.end !== null" class="text-ink-faint" data-testid="book.logEnd">{{ endText(row.end) }}</span>
        </UiRow>
      </UiRowGroup>
      <div v-if="view.more > 0" class="mt-sm flex justify-end">
        <UiSeeAll
          :aria-label="t('book.progress.logSeeAllLabel', { count: view.rows.length + view.more })"
          data-testid="book.logAll"
          @click="seeAll"
        >
          {{ t('book.progress.logSeeAll', { count: view.rows.length + view.more }) }}
        </UiSeeAll>
      </div>
    </section>
  </UiReveal>
</template>

<style scoped>
/* The 44 px target: an invisible box as wide and tall as --size-touch at least, centred on the pill (as UiSeeAll). */
.add-day::after {
  position: absolute;
  top: 50%;
  left: 50%;
  width: max(100%, var(--size-touch));
  height: var(--size-touch);
  content: '';
  transform: translate(-50%, -50%);
}
</style>
