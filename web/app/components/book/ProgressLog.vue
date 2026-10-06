<script setup lang="ts">
// The reading log of a Book being read, on its page under the actions (issue
// #68, direction D): every day that read something, newest first, as a row:
// the day ("Yesterday", "Fri", "3 Oct"), how much in the lamp colour ("+24",
// "+5 %") and where it ended ("p. 212", "44 %"). The last 14 days show; history
// starts with #68, so a read without any day of progress shows no log. It opens
// in with the figures once the first save has booked a day (issue #79).
import type { LibraryEntry } from '~/data/library'

const props = defineProps<{ entry: LibraryEntry }>()

const { t, n } = useI18n()
const { log, unit, shown, dayWords } = useReadingDays(() => props.entry)
const rows = computed(() => log.value.slice(0, 14))
</script>

<template>
  <UiReveal :show="shown === 'days' && rows.length > 0" data-testid="book.readingLog">
    <section class="relative px-ml pt-xl">
      <h2 class="eyebrow mb-ms">{{ t('book.progress.logTitle') }}</h2>
      <UiRowGroup>
        <UiRow v-for="row in rows" :key="row.day" :label="dayWords(row.day)" mono data-testid="book.logDay">
          <span class="text-accent-ink" data-testid="book.logAmount">
            {{ t(unit === 'page' ? 'book.progress.gainPages' : 'book.progress.gainPercent', { count: n(row.amount) }) }}
          </span>
          <span v-if="row.end !== null" class="text-ink-faint" data-testid="book.logEnd">
            {{ unit === 'page' ? t('book.progress.logEnd', { page: n(row.end) }) : t('book.progress.percent', { percent: row.end }) }}
          </span>
        </UiRow>
      </UiRowGroup>
    </section>
  </UiReveal>
</template>
