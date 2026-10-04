<script setup lang="ts">
// Start reading (issue #7): opened from a Want to read Book's page. The Book,
// the day the read started (today unless the member picks another day, never
// one in the future), and the one action. While it runs the button says so;
// a failure stays in the sheet with its reason, and the button tries again.
// The same sheet reads a closed Book again (#10): "Read again" after a finished
// read, "Start again" after an abandoned one, with the words of that action.
import { useReadingStore } from '~/stores/reading'

const TITLE_KEYS = { start: 'start.title', again: 'start.titleAgain', restart: 'start.titleRestart' } as const
const ACTION_KEYS = { start: 'start.action', again: 'start.actionAgain', restart: 'start.actionRestart' } as const

const { t } = useI18n()
const reading = useReadingStore()
// Starting, finishing and DNF work offline too: they wait to sync (#93).

const open = computed({
  get: () => reading.starting !== null,
  set: (value) => {
    if (!value) reading.closeStart()
  },
})

// Kept while the sheet slides away, so it does not empty mid-exit.
const entry = ref(reading.starting)
const kind = ref(reading.startKind)
watch(
  () => reading.starting,
  (value) => {
    if (!value) return
    entry.value = value
    kind.value = reading.startKind
  },
)

const today = computed(() => (open.value ? isoDay() : ''))
const label = computed(() =>
  reading.startBusy ? t('start.busy') : reading.startError ? t('start.retry') : t(ACTION_KEYS[kind.value]),
)
</script>

<template>
  <UiSheet v-model:open="open" :title="t(TITLE_KEYS[kind])" testid="start">
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
          <UiIcon :name="kind === 'start' ? 'arrow' : 'repeat'" :size="18" bold />{{ label }}
        </UiButton>
      </div>
    </template>
  </UiSheet>
</template>
