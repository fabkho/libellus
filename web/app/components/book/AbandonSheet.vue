<script setup lang="ts">
// Abandon reading (issue #10): opened from a Currently reading Book's page. The
// Book; the day the read stopped (today unless picked, never in the future,
// never before the read started); a reason, optional; the one action. The
// Book moves to Finished, under *Not finished*. While it runs the button says
// so; a failure stays in the sheet with its reason and the button tries again.
// Cancelling keeps what was typed for the next time the same Book's sheet opens.
import { ABANDON_REASON_MAX_LENGTH } from '~/data/library'
import { useReadingStore } from '~/stores/reading'

const { t } = useI18n()
const reading = useReadingStore()
// Starting, finishing and DNF work offline too: they wait to sync (#93).

const open = computed({
  get: () => reading.abandoning !== null,
  set: (value) => {
    if (!value) reading.closeAbandon()
  },
})

// Kept while the sheet slides away, so it does not empty mid-exit.
const entry = ref(reading.abandoning)
watch(
  () => reading.abandoning,
  (value) => {
    if (value) entry.value = value
  },
)

const today = computed(() => (open.value ? isoDay() : ''))
const dateError = computed(() =>
  ['date_invalid', 'date_in_future', 'ended_before_started'].includes(reading.abandonError ?? ''),
)
const label = computed(() =>
  reading.abandonBusy ? t('abandon.busy') : reading.abandonError ? t('abandon.retry') : t('abandon.action'),
)
const reasonId = useId()
</script>

<template>
  <UiSheet v-model:open="open" :title="t('abandon.title')" testid="abandon">
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
          v-model="reading.abandonedOn"
          :label="t('abandon.endedOn')"
          :min="entry.latestSession?.startedOn ?? undefined"
          :max="today"
          :invalid="dateError"
          testid="abandon.date"
        />
      </UiRowGroup>

      <div class="mt-lg">
        <UiTextArea
          :id="reasonId"
          v-model="reading.reason"
          :label="t('abandon.reason')"
          :hint="t('abandon.optional')"
          :placeholder="t('abandon.reasonPlaceholder')"
          :maxlength="ABANDON_REASON_MAX_LENGTH"
          :disabled="reading.abandonBusy"
          data-testid="abandon.reason"
        />
      </div>

      <p v-if="reading.abandonError" class="mt-ms px-xs text-caption text-error" role="alert" data-testid="abandon.error">
        {{ t(`library.error.${reading.abandonError}`) }}
      </p>

      <div class="mt-lg mb-sm">
        <UiButton block :disabled="reading.abandonBusy" :aria-busy="reading.abandonBusy" data-testid="abandon.submit" @click="reading.confirmAbandon()">
          <UiIcon name="slash" :size="18" bold />{{ label }}
        </UiButton>
      </div>
    </template>
  </UiSheet>
</template>
