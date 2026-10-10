<script setup lang="ts">
// Finish reading (D's finish-sheet; issue #7): opened from a Currently reading
// Book's page or its card in the Library. The Book; the day it was finished
// (today unless picked, never in the future, never before the read started);
// the quarter-star Rating, optional; a review, optional; the one action. While
// it runs the button says so; a failure stays in the sheet with its reason and
// the button tries again. Cancelling keeps what was chosen for the next time
// the same Book's sheet opens. Under the Book, how the read went (issue #68):
// "Read in 12 days · 51 pages a day", from its start to the day it is finished on.
import { REVIEW_MAX_LENGTH } from '~/data/library'
import { pageCountOf } from '~/data/progress'
import { readSummaryOf } from '~/data/progressDays'
import { useReadingStore } from '~/stores/reading'

const { t, n } = useI18n()
const reading = useReadingStore()
const online = useOnline()
// Starting, finishing and DNF work offline too: they wait to sync (#93).

const open = computed({
  get: () => reading.finishing !== null,
  set: (value) => {
    if (!value) reading.closeFinish()
  },
})

// Kept while the sheet slides away, so it does not empty mid-exit.
const entry = ref(reading.finishing)
watch(
  () => reading.finishing,
  (value) => {
    if (value) entry.value = value
  },
)

const today = computed(() => (open.value ? isoDay() : ''))
const dateError = computed(() =>
  ['date_invalid', 'date_in_future', 'ended_before_started'].includes(reading.finishError ?? ''),
)
const label = computed(() =>
  reading.finishBusy ? t('finish.busy') : reading.finishError ? t('finish.retry') : t('finish.action'),
)
const reviewId = useId()
watch(open, (isOpen) => {
  if (isOpen) spoilers.value = false
})

const summary = computed(() => {
  const startedOn = entry.value?.latestSession?.startedOn
  if (!entry.value || !startedOn || !/^\d{4}-\d{2}-\d{2}$/.test(reading.endedOn)) return null
  const read = readSummaryOf(startedOn, reading.endedOn, pageCountOf(entry.value))
  return t('book.progress.readIn', {
    days: t('book.progress.days', { count: read.days }, read.days),
    perDay:
      read.unit === 'page'
        ? t('book.progress.readPerDayPages', { count: n(read.perDay) }, read.perDay)
        : t('book.progress.perDayPercent', { count: read.perDay }),
  })
})
</script>

<template>
  <UiSheet v-model:open="open" :title="t('finish.title')" testid="finish">
    <template v-if="entry">
      <UiBookLine
        :title="entry.book.title"
        :authors="entry.book.authors"
        :src="coverSrc(entry.book.coverUrl, 'xs')"
        :thumbhash="entry.book.coverThumbhash"
        :colors="entry.book.coverColors"
      />
      <p v-if="summary" class="figures mb-md text-meta text-ink-faint" data-testid="finish.summary">{{ summary }}</p>

      <UiRowGroup>
        <UiDateRow
          v-model="reading.endedOn"
          :label="t('finish.endedOn')"
          :min="entry.latestSession?.startedOn ?? undefined"
          :max="today"
          :invalid="dateError"
          testid="finish.date"
        />
      </UiRowGroup>

      <UiRatingInput v-model="reading.rating" class="mt-md" :disabled="reading.finishBusy" testid="finish.rating" />

      <!-- How she read it (#169); it needs the connection, so offline the finish goes without it. -->
      <BookReadAs v-if="online" v-model="reading.finishReadAs" :entry="entry" class="mt-lg" testid="finish.readAs" />

      <div class="mt-lg">
        <UiTextArea
          :id="reviewId"
          v-model="reading.review"
          :label="t('finish.review')"
          :hint="t('finish.optional')"
          :placeholder="t('finish.reviewPlaceholder')"
          :maxlength="REVIEW_MAX_LENGTH"
          :disabled="reading.finishBusy"
          data-testid="finish.review"
        >
          <template #footer>
            <BookSpoilerSwitch v-model="reading.reviewSpoilers" :disabled="reading.finishBusy" testid="finish.spoilers" />
          </template>
        </UiTextArea>
      </div>

      <p v-if="reading.finishError" class="mt-ms px-xs text-caption text-error" role="alert" data-testid="finish.error">
        {{ t(`library.error.${reading.finishError}`) }}
      </p>

      <div class="mt-lg mb-sm">
        <UiButton block :disabled="reading.finishBusy" :aria-busy="reading.finishBusy" data-testid="finish.submit" @click="reading.confirmFinish()">
          <UiIcon name="check" :size="18" bold />{{ label }}
        </UiButton>
      </div>
    </template>
  </UiSheet>
</template>
