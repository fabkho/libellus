<script setup lang="ts">
// add-sheet: over the new Book's detail. Status first, as three clear choices;
// the date fields follow the choice (Currently reading → start date; Finished
// → start, end, then Rating and review). Shown with Currently reading picked.
import { useProto } from '../../../contract'
import { formatDate, type Status } from '../../../data'
import FormGroup from '../kit/FormGroup.vue'
import FormRow from '../kit/FormRow.vue'
import type { IconName } from '../kit/Icon.vue'
import Icon from '../kit/Icon.vue'
import Pill from '../kit/Pill.vue'
import Sheet from '../kit/Sheet.vue'
import BookDetail from './BookDetail.vue'

const proto = useProto()

const details: Record<Status, { icon: IconName; hint: string; action: string }> = {
  want_to_read: { icon: 'bookmark', hint: 'Save it for later', action: 'Add to Want to read' },
  reading: { icon: 'book', hint: 'Start it today', action: 'Start reading' },
  finished: { icon: 'check', hint: 'Log a read you’ve done', action: 'Add as finished' },
}
</script>

<template>
  <div class="host">
    <BookDetail state="new" />
    <Sheet title="Add to Library" :subtitle="proto.data.newBook.title">
      <div class="stack">
        <div class="choices" role="radiogroup">
          <div
            v-for="option in proto.data.addDraft.statuses"
            :key="option.value"
            class="choice ad-squircle"
            :class="{ on: option.value === proto.data.addDraft.status }"
            role="radio"
            :aria-checked="option.value === proto.data.addDraft.status"
          >
            <span class="choice-icon"><Icon :name="details[option.value].icon" :size="19" :stroke="1.8" /></span>
            <span class="choice-text">
              <span class="choice-label">{{ option.label }}</span>
              <span class="choice-hint">{{ details[option.value].hint }}</span>
            </span>
            <span class="radio"><Icon v-if="option.value === proto.data.addDraft.status" name="check" :size="14" :stroke="2.6" /></span>
          </div>
        </div>

        <FormGroup footer="Change it any time from the book’s reading history.">
          <FormRow label="Started" :value="`Today, ${formatDate(proto.data.addDraft.startedOn)}`" date />
        </FormGroup>

        <Pill icon="book" block>{{ details[proto.data.addDraft.status].action }}</Pill>
      </div>
    </Sheet>
  </div>
</template>

<style scoped>
.host {
  position: relative;
  height: 100%;
}

.stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-bottom: 6px;
}

.choices {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.choice {
  display: flex;
  align-items: center;
  gap: 13px;
  min-height: 62px;
  padding: 0 16px 0 12px;
  border-radius: 20px;
  background: var(--ad-card);
  box-shadow: var(--ad-card-shadow);
}

.choice.on {
  box-shadow:
    0 0 0 2px var(--ad-accent),
    0 8px 22px -10px color-mix(in oklab, var(--ad-accent) 60%, transparent);
}

.choice-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 12px;
  background: var(--ad-fill);
  color: var(--ad-ink-2);
}

.on .choice-icon {
  background: var(--ad-accent-soft);
  color: var(--ad-accent);
}

.choice-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  line-height: 1.25;
}

.choice-label {
  font-size: 16px;
  font-weight: 600;
}

.choice-hint {
  color: var(--ad-ink-2);
  font-size: 13px;
}

.radio {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  box-shadow: inset 0 0 0 1.5px var(--ad-hair);
  color: #fff;
}

.on .radio {
  background: var(--ad-accent);
  box-shadow: none;
}
</style>
