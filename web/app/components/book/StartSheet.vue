<script setup lang="ts">
// Start reading (issue #7): opened from a Want to read Book's page. The Book,
// the day the read started (today unless the member picks another day, never
// one in the future), and the one action. While it runs the button says so;
// a failure stays in the sheet with its reason, and the button tries again.
import { useReadingStore } from '~/stores/reading'

const { t } = useI18n()
const reading = useReadingStore()

const open = computed({
  get: () => reading.starting !== null,
  set: (value) => {
    if (!value) reading.closeStart()
  },
})

// Kept while the sheet slides away, so it does not empty mid-exit.
const entry = ref(reading.starting)
watch(
  () => reading.starting,
  (value) => {
    if (value) entry.value = value
  },
)

const today = computed(() => (open.value ? isoDay() : ''))
const label = computed(() =>
  reading.startBusy ? t('start.busy') : reading.startError ? t('start.retry') : t('start.action'),
)
</script>

<template>
  <UiSheet v-model:open="open" :title="t('start.title')" testid="start">
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
          v-model="reading.startedOn"
          :label="t('start.startedOn')"
          :max="today"
          :invalid="reading.startError === 'date_in_future' || reading.startError === 'date_invalid'"
          testid="start.date"
        />
      </UiRowGroup>

      <p v-if="reading.startError" class="mt-ms px-xs text-caption text-error" role="alert" data-testid="start.error">
        {{ t(`library.error.${reading.startError}`) }}
      </p>

      <div class="mt-lg mb-sm">
        <UiButton block :disabled="reading.startBusy" :aria-busy="reading.startBusy" data-testid="start.submit" @click="reading.confirmStart()">
          <UiIcon name="arrow" :size="18" bold />{{ label }}
        </UiButton>
      </div>
    </template>
  </UiSheet>
</template>
