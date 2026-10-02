<script setup lang="ts">
// add-sheet: over the new Book's detail. The Status as a numbered choice
// (i. ii. iii.), then the dates that choice needs — here Currently reading,
// begun today — and Add to Library.
import { useProto } from '../../../contract'
import { formatAuthors, formatDate } from '../../../data'
import Button from '../kit/Button.vue'
import Cover from '../kit/Cover.vue'
import Field from '../kit/Field.vue'
import Icon from '../kit/Icon.vue'
import Sheet from '../kit/Sheet.vue'
import BookDetail from './BookDetail.vue'

const proto = useProto()
const numerals = ['i.', 'ii.', 'iii.']
const notes: Record<string, string> = {
  want_to_read: 'No dates. It joins Up next.',
  reading: 'A start date; it becomes a feature on Home.',
  finished: 'End date, then Rating and review.',
}
</script>

<template>
  <div class="over">
    <BookDetail state="new" />
    <Sheet title="Add to Library">
      <div class="stack">
        <div class="book">
          <Cover :book="proto.data.newBook" :width="36" />
          <span class="text">
            <span class="title">{{ proto.data.newBook.title }}</span>
            <span class="b-italic b-muted">{{ formatAuthors(proto.data.newBook.authors) }}</span>
          </span>
        </div>

        <div class="choice">
          <span class="b-label b-muted">Status</span>
          <ol class="options">
            <li
              v-for="(option, i) in proto.data.addDraft.statuses"
              :key="option.value"
              class="option"
              :class="{ selected: option.value === proto.data.addDraft.status }"
            >
              <span class="numeral b-display">{{ numerals[i] }}</span>
              <span class="text">
                <span class="name">{{ option.label }}</span>
                <span class="note">{{ notes[option.value] }}</span>
              </span>
              <span class="mark"><Icon v-if="option.value === proto.data.addDraft.status" name="check" :size="20" :stroke="1.8" /></span>
            </li>
          </ol>
        </div>

        <Field label="Begun" :value="`Today, ${formatDate(proto.data.addDraft.startedOn)}`">
          <template #trailing><Icon name="calendar" :size="20" class="cal" /></template>
        </Field>

        <Button>Add to Library</Button>
      </div>
    </Sheet>
  </div>
</template>

<style scoped>
.over {
  position: relative;
  height: 100%;
}

.stack {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.book {
  display: flex;
  align-items: center;
  gap: 12px;
}

.book .text {
  display: flex;
  flex-direction: column;
}

.book .title {
  font-size: 17px;
  font-weight: 500;
  line-height: 22px;
}

.book .b-italic {
  font-size: 15px;
  line-height: 20px;
}

.choice {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.options {
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--b-rule-strong);
}

.option {
  display: flex;
  min-height: 56px;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid var(--b-rule);
  color: var(--b-ink-2);
}

.numeral {
  --size: 20;
  width: 26px;
  font-style: italic;
  color: var(--b-ink-3);
}

.option .text {
  display: flex;
  flex: 1;
  flex-direction: column;
}

.name {
  font-size: 18px;
  line-height: 24px;
}

.note {
  font-size: 13px;
  font-style: italic;
  line-height: 16px;
  color: var(--b-ink-3);
}

.mark {
  display: flex;
  width: 24px;
  justify-content: flex-end;
}

.selected {
  color: var(--b-ink);
}

.selected .name {
  font-weight: 600;
}

.selected .numeral,
.selected .mark {
  color: var(--b-accent);
}

.cal {
  color: var(--b-ink-2);
}
</style>
