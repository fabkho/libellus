<script setup lang="ts">
// add-sheet: over the new Book's detail. Status first; the dates follow the
// choice (Want to read: none · Currently reading: start · Finished: start,
// end, then Rating and review). Shown with Currently reading, started today.
import { useProto } from '../../../contract'
import { formatDate } from '../../../data'
import BookLine from '../kit/BookLine.vue'
import Button from '../kit/Button.vue'
import Row from '../kit/Row.vue'
import Sheet from '../kit/Sheet.vue'
import BookDetail from './BookDetail.vue'

const proto = useProto()

const needs: Record<string, string> = {
  want_to_read: 'No dates',
  reading: 'Start date',
  finished: 'Dates, rating',
}
</script>

<template>
  <Sheet title="Add to Library">
    <template #under><BookDetail state="new" /></template>

    <BookLine :book="proto.data.newBook" />

    <p class="dl-eyebrow label">Status</p>
    <div class="dl-group">
      <div
        v-for="option in proto.data.addDraft.statuses"
        :key="option.value"
        class="option"
        :class="{ on: option.value === proto.data.addDraft.status }"
      >
        <span class="radio" />
        <span class="name">{{ option.label }}</span>
        <span class="need">{{ needs[option.value] }}</span>
      </div>
    </div>

    <p class="dl-eyebrow label">Dates</p>
    <div class="dl-group">
      <Row
        label="Started"
        icon="calendar"
        :value="`Today · ${formatDate(proto.data.addDraft.startedOn)}`"
        chevron
      />
    </div>

    <div class="go"><Button block>Add to Library</Button></div>
  </Sheet>
</template>

<style scoped>
.label {
  margin: 8px 4px 10px;
}

.label + .dl-group + .label {
  margin-top: 22px;
}

.option {
  position: relative;
  display: flex;
  height: 52px;
  align-items: center;
  gap: 12px;
  padding: 0 14px;
  font-size: 15.5px;
  color: var(--dl-ink-2);
}

.option + .option::before {
  position: absolute;
  top: 0;
  right: 0;
  left: 44px;
  height: 0.5px;
  content: '';
  background: var(--dl-line-2);
}

.option.on {
  color: var(--dl-ink);
}

.radio {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  border-radius: 999px;
  box-shadow: inset 0 0 0 1px var(--dl-ink-3);
}

.on .radio {
  background: radial-gradient(circle, var(--dl-lamp) 0 4.5px, transparent 5px);
  box-shadow:
    inset 0 0 0 1.5px var(--dl-lamp),
    0 0 12px rgb(239 183 104 / 0.35);
}

.name {
  flex: 1;
}

.need {
  font-size: 12.5px;
  color: var(--dl-ink-3);
}

.go {
  margin-top: 26px;
}
</style>
