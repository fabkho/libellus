<script setup lang="ts">
// Finish reading (D's finish-sheet; issue #7): opened from a Currently reading
// Book's page or its card in the Library. The Book; the day it was finished
// (today unless picked, never in the future, never before the read started);
// the quarter-star Rating, optional; a review, optional; the one action. While
// it runs the button says so; a failure stays in the sheet with its reason and
// the button tries again. Cancelling keeps what was chosen for the next time
// the same Book's sheet opens.
import { REVIEW_MAX_LENGTH } from '~/data/library'
import { useReadingStore } from '~/stores/reading'

const { t } = useI18n()
const reading = useReadingStore()
// Adding, starting, finishing writes: offline the action says so instead (#15).
const online = useOnline()

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
        />
      </div>

      <p v-if="reading.finishError" class="mt-ms px-xs text-caption text-error" role="alert" data-testid="finish.error">
        {{ t(`library.error.${reading.finishError}`) }}
      </p>

      <div class="mt-lg mb-sm">
        <UiButton block :disabled="reading.finishBusy" :offline="!online" :aria-busy="reading.finishBusy" data-testid="finish.submit" @click="reading.confirmFinish()">
          <UiIcon name="check" :size="18" bold />{{ label }}
        </UiButton>
      </div>
    </template>
  </UiSheet>
</template>
