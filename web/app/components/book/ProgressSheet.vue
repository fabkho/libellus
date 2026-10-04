<script setup lang="ts">
// Update progress (issues #39, #68; design round #65, direction D): opened by
// Update on Home's card and Update progress on the book page. Save sits in the
// title row. The Book; the number wheel between − and + (drag or flick it, tap
// its centre to type; components/progress/Wheel.vue); under it "of 608 ✎", the
// page count that counts, which turns the same wheel into the member's own total
// (issue #60: an ebook's pages follow the font size) until Done hands back, with
// how far the wheel has moved ("+24") and Pages | Percent when the Book has a page
// count. A Book without one counts in percent, with "Count in pages" to give it
// one. Last, Finish: the progress is saved and the Finish sheet takes over, for
// the evening the book ends. A refusal stays in the sheet and Save tries again.
import { PAGE_CEILING, type ProgressMode } from '~/data/progress'
import { useReadingStore } from '~/stores/reading'
import { stepTick } from '~/utils/haptics'

const { t, n } = useI18n()
const reading = useReadingStore()
// Saving writes: offline the actions say so instead (#15).
const online = useOnline()
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
const { lastTime, dayWords, amountWords } = useReadingDays(() => entry.value)

const editingTotal = computed(() => reading.progressEditing === 'total')
const inPercent = computed(() => reading.progressMode === 'percent')
const pageCount = computed(() => reading.progressPageCount)
const editionCount = computed(() => reading.progressEditionCount)
const MODES: readonly ProgressMode[] = ['page', 'percent']

const action = computed(() => {
  if (editingTotal.value) return t('book.progress.done')
  if (!online.value) return t('common.offline')
  if (reading.progressBusy) return t('book.progress.busy')
  return reading.progressError ? t('book.progress.retry') : t('book.progress.save')
})
const actionDisabled = computed(() => reading.progressBusy || (!online.value && !editingTotal.value))

// What assistive tech reads for the wheel: the value in words ("p. 212 of 608", "45 %").
const valueText = computed(() =>
  text(inPercent.value ? { percent: reading.progressValue } : { page: reading.progressValue }, pageCount.value).value,
)
const delta = computed(() => {
  const by = reading.progressDelta
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
    reading.progressValue = Math.min(Math.max(reading.progressValue + by, 0), reading.progressLimit)
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
    :title="t('book.progress.title')"
    testid="progress"
    :action="action"
    :action-disabled="actionDisabled"
    @action="reading.confirmProgress()"
  >
    <template v-if="entry">
      <UiBookLine
        :title="entry.book.title"
        :authors="entry.book.authors"
        :src="coverSrc(entry.book.coverUrl, 'xs')"
        :thumbhash="entry.book.coverThumbhash"
        :colors="entry.book.coverColors"
      />

      <!-- What she read last time, over the wheel. -->
      <p v-if="!editingTotal && lastTime" class="figures flex min-h-(--size-touch) items-center truncate text-meta text-ink-faint" data-testid="progress.lastTime">
        <span class="eyebrow mr-sm">{{ t('book.progress.lastTime') }}</span>{{ t('book.progress.lastTimeLine', { day: dayWords(lastTime.day), amount: amountWords(lastTime.amount) }) }}
      </p>

      <!-- The total wheel says what it is for, and the way back to the edition's. -->
      <div v-if="editingTotal" class="flex min-h-(--size-touch) items-center justify-between gap-ms">
        <p class="eyebrow text-accent" data-testid="progress.totalTitle">{{ t('book.progress.totalTitle') }}</p>
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
            v-if="!inPercent"
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
            v-else-if="!pageCount"
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
            :class="reading.progressDelta > 0 ? 'text-accent' : 'text-ink-faint'"
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

      <!-- The evening the book ends: save where she is, then the Finish sheet. -->
      <div
        v-if="!editingTotal"
        class="mt-sm flex items-center justify-between gap-ms rounded-md bg-fill px-inset py-ms edge-faint"
        data-testid="progress.finishRow"
      >
        <span class="flex min-w-0 flex-col gap-xxs">
          <span class="text-body">{{ t('book.progress.finishedIt') }}</span>
          <span class="text-caption text-ink-faint" data-testid="progress.finishHint">
            {{ reading.progressAtEnd ? t('book.progress.reached') : t('book.progress.finishHint') }}
          </span>
        </span>
        <UiButton
          :tone="reading.progressAtEnd ? 'primary' : 'quiet'"
          size="sm"
          :offline="!online"
          :disabled="reading.progressBusy"
          data-testid="progress.finish"
          @click="reading.finishFromProgress()"
        >
          <UiIcon name="check" :size="14" bold />{{ t('book.finish') }}
        </UiButton>
      </div>

      <p v-if="reading.progressError" class="mt-ms px-xs text-caption text-error" role="alert" data-testid="progress.failure">
        {{ t(`library.error.${reading.progressError}`) }}
      </p>
      <div class="h-sm" />
    </template>
  </UiSheet>
</template>

<style scoped>
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
