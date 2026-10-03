<script setup lang="ts">
// How far the member is in a Book they are reading (issue #39), on the book
// page: a hairline bar in the lamp colour, the value in tabular figures
// ("p. 212 of 480 · 44 %", or "45 %" when the Book has no page count) and
// *Update progress*, which opens the sheet. No progress yet: an empty bar and
// "Not started yet". Updating writes: offline the button says so (#15).
import type { LibraryEntry } from '~/data/library'
import { progressFraction, progressOf } from '~/data/progress'
import { useReadingStore } from '~/stores/reading'

const props = defineProps<{ entry: LibraryEntry }>()

const { t } = useI18n()
const reading = useReadingStore()
const online = useOnline()
const text = useProgressText()

const progress = computed(() => progressOf(props.entry.latestSession))
const pageCount = computed(() => props.entry.book.pageCount)
const words = computed(() => text(progress.value, pageCount.value))
</script>

<template>
  <!-- The rule and its figures are one group (8 apart); the status line sits 16
       above it and the action 20 below. -->
  <div class="mb-ml flex flex-col gap-sm" data-testid="book.progress">
    <UiProgress
      :fraction="progressFraction(progress, pageCount)"
      :label="t('book.progress.label')"
      :value-text="words.value"
      data-testid="book.progressBar"
    />
    <div class="flex items-center justify-between gap-ms">
      <p class="figures flex items-center gap-sm text-caption" :class="progress ? 'text-ink' : 'text-ink-faint'">
        <span data-testid="book.progressValue">{{ words.value }}</span>
        <template v-if="progress && 'page' in progress && words.percent !== null">
          <span class="dot text-ink-ghost" aria-hidden="true" />
          <span class="text-ink-faint" data-testid="book.progressPercent">{{ t('book.progress.percent', { percent: words.percent }) }}</span>
        </template>
      </p>
      <UiButton tone="quiet" size="sm" :offline="!online" data-testid="book.updateProgress" @click="reading.openProgress(entry)">
        {{ t('book.progress.update') }}
      </UiButton>
    </div>
  </div>
</template>

<style scoped>
.dot {
  width: var(--spacing-xxs);
  height: var(--spacing-xxs);
  border-radius: var(--radius-pill);
  background: currentColor;
}
</style>
