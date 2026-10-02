<script setup lang="ts">
// finish-sheet: over the reading Book's detail. End date (today), the
// quarter-star Rating mid-drag at 3¾, the review being typed, Finish.
import { useProto } from '../../../contract'
import { formatAuthors, formatDate } from '../../../data'
import Button from '../kit/Button.vue'
import Field from '../kit/Field.vue'
import Icon from '../kit/Icon.vue'
import RatingControl from '../kit/RatingControl.vue'
import Sheet from '../kit/Sheet.vue'
import BookDetail from './BookDetail.vue'

const proto = useProto()
</script>

<template>
  <div class="over">
    <BookDetail state="reading" />
    <Sheet
      title="Finish"
      :subtitle="`${proto.data.readingEntry.book.title}, ${formatAuthors(proto.data.readingEntry.book.authors)}`"
    >
      <div class="stack">
        <Field label="Finished on" :value="`Today, ${formatDate(proto.data.finishDraft.endedOn)}`">
          <template #trailing><Icon name="calendar" :size="20" class="cal" /></template>
        </Field>

        <div class="rating">
          <div class="label-row">
            <span class="b-label b-muted">Rating</span>
            <span class="hint">in quarter stars · optional</span>
          </div>
          <RatingControl :rating="proto.data.finishDraft.rating" :dragging="proto.data.finishDraft.dragging" />
        </div>

        <Field label="Review" hint="optional" :value="proto.data.finishDraft.review" multiline focus italic />

        <Button>Finish</Button>
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

.cal {
  color: var(--b-ink-2);
}

.rating {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.label-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.hint {
  font-size: 12px;
  font-style: italic;
  line-height: 16px;
  color: var(--b-ink-3);
}
</style>
