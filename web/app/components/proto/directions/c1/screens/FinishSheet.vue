<script setup lang="ts">
// finish-sheet: over book-reading. The A/D sheet — the book, the end date,
// a big quarter-star Rating mid-drag, the review — with one bit of C left:
// the end date shows as the small red stamp the book will get.
import { computed } from 'vue'
import { formatAuthors, formatDate, formatRating } from '../../../data'
import Button from '../kit/Button.vue'
import Cover from '../kit/Cover.vue'
import Field from '../kit/Field.vue'
import Icon from '../kit/Icon.vue'
import Sheet from '../kit/Sheet.vue'
import Stamp from '../kit/Stamp.vue'
import Stars from '../kit/Stars.vue'
import { stampDate } from '../kit/paint'
import { useShelf } from '../kit/useShelf'
import BookDetail from './BookDetail.vue'

const { data } = useShelf()
const draft = computed(() => data.value.finishDraft)
const book = computed(() => data.value.readingEntry.book)
const words = ['', 'Poor', 'Poor', 'Not for me', 'Not for me', 'Fine', 'Fine', 'Good', 'Good', 'Great', 'Great', 'Loved it']
const word = computed(() => words[Math.ceil((draft.value.rating ?? 0) / 2)] ?? '')
</script>

<template>
  <div class="wrap">
    <BookDetail state="reading" />
    <Sheet title="Finish">
      <div class="book">
        <Cover :book="book" :width="40" />
        <span class="book-text">
          <span class="book-title">{{ book.title }}</span>
          <span class="book-author">{{ formatAuthors(book.authors) }}</span>
        </span>
      </div>

      <div class="group">
        <div class="date-row">
          <span class="label">Finished on</span>
          <Stamp label="Finished" :date="stampDate(draft.endedOn)" :rotate="-3" :size="0.78" />
          <span class="change"><Icon name="calendar" :size="16" />Today</span>
        </div>
      </div>

      <div class="group rating">
        <div class="score">
          <span class="big">{{ formatRating(draft.rating) }}</span>
          <span class="of">/ 5 · {{ word }}</span>
        </div>
        <Stars :rating="draft.rating" :size="40" :gap="8" :value="false" dragging />
        <span class="hint">Slide across the stars · quarter steps · optional</span>
      </div>

      <Field label="Review · optional" :value="draft.review" multiline focus />

      <Button class="go"><Icon name="check" :size="20" />Finish {{ formatDate(draft.endedOn, 'short') }}</Button>
    </Sheet>
  </div>
</template>

<style scoped>
.wrap {
  position: relative;
  height: 100%;
}

.book {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 2px 0 14px;
}

.book-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.book-title {
  font-family: var(--c1-serif);
  font-weight: var(--c1-serif-weight);
  font-size: 18px;
  line-height: 1.2;
}

.book-author {
  font-size: 14px;
  color: var(--c1-ink-soft);
}

.group {
  margin-bottom: 12px;
  padding: 0 16px;
  border-radius: 18px;
  background: var(--c1-card);
  box-shadow: var(--c1-card-shadow);
}

.date-row {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 58px;
}

.label {
  flex: 1;
  white-space: nowrap;
  font-size: 16px;
}

.change {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--c1-accent-soft);
  color: var(--c1-accent-deep);
  font-size: 14px;
  font-weight: 500;
}

[data-theme='dark'] .change {
  color: var(--c1-accent);
}

.rating {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 14px 16px 12px;
}

.score {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 26px;
}

.big {
  font-family: var(--c1-serif);
  font-weight: var(--c1-serif-weight);
  font-size: 40px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.of {
  font-size: 14px;
  color: var(--c1-ink-soft);
}

.rating :deep(.tag) {
  display: none;
}

.hint {
  margin-top: 4px;
  font-size: 12px;
  color: var(--c1-muted);
}

.go {
  margin-top: 14px;
}
</style>
