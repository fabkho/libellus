<script setup lang="ts">
// Update progress (issue #39): opened from the book page and from the value on
// a Home card. The Book; pages or percent (a toggle when the Book has a page
// count, percent only without one); the number; +10 and +25 to count on from
// what is there; the one action. At the last page (or 100 %) the sheet asks
// "Finished it?" and opens the Finish sheet, saving the progress first. A
// refusal stays in the sheet and the button tries again.
import { useReadingStore } from '~/stores/reading'
import type { ProgressMode } from '~/data/progress'

const { t } = useI18n()
const reading = useReadingStore()
// Saving writes: offline the action says so instead (#15).
const online = useOnline()

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

const pageCount = computed(() => entry.value?.book.pageCount ?? null)
const MODES: readonly ProgressMode[] = ['page', 'percent']
const fieldId = useId()
const label = computed(() =>
  reading.progressMode === 'page' ? t('book.progress.pageLabel', { count: pageCount.value ?? 0 }) : t('book.progress.percentLabel'),
)
// "Try again" is for a save that failed; a number that does not fit is fixed, not retried.
const action = computed(() =>
  reading.progressBusy
    ? t('book.progress.busy')
    : reading.progressError && reading.progressError !== 'progress_invalid'
      ? t('book.progress.retry')
      : t('book.progress.action'),
)
const fieldError = computed(() => {
  if (!reading.progressError) return null
  return reading.progressError === 'progress_invalid'
    ? t('book.progress.invalid', { max: reading.progressLimit })
    : t(`library.error.${reading.progressError}`)
})
// Only the field's own refusal sits under it; any other has its line below.
const invalid = computed(() => reading.progressError === 'progress_invalid')

// Typing is a new try: the last refusal no longer applies.
watch(
  () => reading.progressField,
  () => (reading.progressError = null),
)
</script>

<template>
  <UiSheet v-model:open="open" :title="t('book.progress.title')" testid="progress">
    <template v-if="entry">
      <UiBookLine
        :title="entry.book.title"
        :authors="entry.book.authors"
        :src="coverSrc(entry.book.coverUrl, 'xs')"
        :thumbhash="entry.book.coverThumbhash"
        :colors="entry.book.coverColors"
      />

      <div v-if="pageCount" role="group" :aria-label="t('book.progress.modeLabel')" class="mb-md flex gap-sm">
        <button
          v-for="mode in MODES"
          :key="mode"
          type="button"
          :aria-pressed="reading.progressMode === mode"
          class="inline-flex h-(--size-button-sm) items-center rounded-pill px-md text-subhead"
          :class="reading.progressMode === mode ? 'bg-ink text-on-ink' : 'edge text-ink-muted'"
          :data-testid="`progress.mode.${mode}`"
          @click="reading.chooseProgressMode(mode)"
        >
          {{ t(`book.progress.mode.${mode}`) }}
        </button>
      </div>

      <UiField
        :id="fieldId"
        v-model="reading.progressField"
        :label="label"
        :error="invalid ? fieldError : null"
        error-testid="progress.error"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        enterkeyhint="done"
        placeholder="0"
        :maxlength="9"
        :disabled="reading.progressBusy"
        class="figures"
        data-testid="progress.value"
        @keydown.enter="reading.confirmProgress()"
      />

      <div class="mt-md flex gap-sm">
        <UiButton
          v-for="by in [10, 25]"
          :key="by"
          tone="quiet"
          size="sm"
          :disabled="reading.progressBusy"
          :data-testid="`progress.plus${by}`"
          @click="reading.bumpProgress(by)"
        >
          {{ t(reading.progressMode === 'page' ? 'book.progress.plusPages' : 'book.progress.plusPercent', { count: by }) }}
        </UiButton>
      </div>

      <!-- The last page: the read may be done. Saves the progress, then the Finish sheet. -->
      <div
        v-if="reading.progressAtEnd"
        class="mt-md flex items-center justify-between gap-ms rounded-md bg-fill px-inset py-ms edge-faint"
        data-testid="progress.reached"
      >
        <span class="flex min-w-0 flex-col gap-xxs">
          <span class="text-body">{{ t('book.progress.finishedIt') }}</span>
          <span class="text-caption text-ink-faint">{{ t('book.progress.reached') }}</span>
        </span>
        <UiButton tone="quiet" size="sm" :offline="!online" :disabled="reading.progressBusy" data-testid="progress.finish" @click="reading.finishFromProgress()">
          <UiIcon name="check" :size="14" bold />{{ t('book.finish') }}
        </UiButton>
      </div>

      <p v-if="reading.progressError && !invalid" class="mt-ms px-xs text-caption text-error" role="alert" data-testid="progress.failure">
        {{ fieldError }}
      </p>

      <div class="mt-lg mb-sm">
        <UiButton block :disabled="reading.progressBusy" :offline="!online" :aria-busy="reading.progressBusy" data-testid="progress.submit" @click="reading.confirmProgress()">
          <UiIcon name="check" :size="18" bold />{{ action }}
        </UiButton>
      </div>
    </template>
  </UiSheet>
</template>
