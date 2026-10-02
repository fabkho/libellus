<script setup lang="ts">
// add-sheet: over book-new. Three chunky tiles for the Status, the chosen
// one lifted off the table; the date fields that choice needs (Currently
// reading: started, today by default).
import { computed } from 'vue'
import { formatAuthors, formatDate } from '../../../data'
import Button from '../kit/Button.vue'
import Cover from '../kit/Cover.vue'
import Field from '../kit/Field.vue'
import Icon from '../kit/Icon.vue'
import Sheet from '../kit/Sheet.vue'
import { useShelf } from '../kit/useShelf'
import BookDetail from './BookDetail.vue'

const { data } = useShelf()
const draft = computed(() => data.value.addDraft)
const book = computed(() => data.value.newBook)
const icons = { want_to_read: 'bookmark', reading: 'open-book', finished: 'stamp' } as const
const hints = { want_to_read: 'No dates', reading: 'From today', finished: 'Dates & Rating' } as const
</script>

<template>
  <div class="wrap">
    <BookDetail state="new" />
    <Sheet title="Add to Library">
      <div class="book">
        <Cover :book="book" :width="40" />
        <span class="book-text">
          <span class="book-title">{{ book.title }}</span>
          <span class="book-author">{{ formatAuthors(book.authors) }}</span>
        </span>
      </div>

      <div class="tiles" role="radiogroup">
        <span
          v-for="option in draft.statuses"
          :key="option.value"
          class="tile"
          :class="[option.value, { on: option.value === draft.status }]"
          role="radio"
          :aria-checked="option.value === draft.status"
        >
          <span class="tile-icon"><Icon :name="icons[option.value]" :size="24" :filled="option.value === draft.status" /></span>
          <span class="tile-label">{{ option.label }}</span>
          <span class="tile-hint">{{ hints[option.value] }}</span>
          <span v-if="option.value === draft.status" class="tick"><Icon name="check" :size="13" /></span>
        </span>
      </div>

      <Field label="Started reading" :value="`Today, ${formatDate(draft.startedOn)}`">
        <template #leading><Icon name="calendar" :size="20" class="cal" /></template>
        <template #trailing><span class="change">Change</span></template>
      </Field>
      <p class="note">Change dates any time in the book's reading history.</p>

      <Button><Icon name="plus" :size="20" />Add to Library</Button>
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
  padding: 4px 0 16px;
}

.book-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.book-title {
  font-family: var(--c1-serif);
  font-weight: var(--c1-serif-weight);
  font-size: 17px;
}

.book-author {
  font-size: 14px;
  color: var(--c1-ink-soft);
}

.tiles {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 18px;
}

.tile {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 118px;
  padding: 12px 12px 12px;
  border-radius: 20px;
  background: var(--c1-paper-deep);
  color: var(--c1-ink-soft);
}

.tile-icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  margin-bottom: 8px;
  border-radius: 13px;
  background: var(--c1-card);
}

.tile-label {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.15;
  color: var(--c1-ink);
}

.tile-hint {
  font-size: 12px;
  font-weight: 600;
}

.tile.on {
  background: var(--c1-card);
  box-shadow:
    inset 0 0 0 1.5px var(--c1-accent),
    0 8px 18px -10px rgb(var(--c1-shadow) / 0.3);
}

.tile.on .tile-icon {
  background: var(--c1-teal-soft);
  color: var(--c1-teal);
}

.tick {
  position: absolute;
  top: 10px;
  right: 10px;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--c1-ink);
  color: var(--c1-paper);
}

.cal {
  color: var(--c1-ink-soft);
}

.change {
  font-size: 15px;
  font-weight: 500;
  color: var(--c1-accent-deep);
}

[data-theme='dark'] .change {
  color: var(--c1-accent);
}

.note {
  margin: 8px 0 18px;
  font-size: 13px;
  color: var(--c1-ink-soft);
}
</style>
