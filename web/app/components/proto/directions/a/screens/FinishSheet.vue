<script setup lang="ts">
// finish-sheet: over the reading Book's detail. End date (today by default),
// the quarter-star Rating mid-drag at 3.75, the review being typed, Finish.
import { useProto } from '../../../contract'
import { formatDate } from '../../../data'
import FormGroup from '../kit/FormGroup.vue'
import FormRow from '../kit/FormRow.vue'
import Pill from '../kit/Pill.vue'
import RatingSlider from '../kit/RatingSlider.vue'
import Sheet from '../kit/Sheet.vue'
import BookDetail from './BookDetail.vue'

const proto = useProto()
</script>

<template>
  <div class="host">
    <BookDetail state="reading" />
    <Sheet title="Finish" :subtitle="proto.data.readingEntry.book.title">
      <div class="stack">
        <FormGroup>
          <FormRow label="Finished on" :value="`Today, ${formatDate(proto.data.finishDraft.endedOn)}`" date />
        </FormGroup>

        <div class="rating-card a-squircle">
          <RatingSlider :rating="proto.data.finishDraft.rating" :dragging="proto.data.finishDraft.dragging" />
        </div>

        <div class="review a-squircle">
          <span class="review-label">Review <span class="optional">optional</span></span>
          <p class="review-text a-serif">{{ proto.data.finishDraft.review }}<span class="caret" /></p>
        </div>

        <Pill icon="check" block>Finish</Pill>
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
  gap: 12px;
  padding-bottom: 6px;
}

.rating-card {
  padding: 16px 0 14px;
  border-radius: 22px;
  background: var(--a-card);
  box-shadow: var(--a-card-shadow);
}

.review {
  padding: 12px 16px 14px;
  border-radius: 22px;
  background: var(--a-card);
  box-shadow:
    0 0 0 1.5px color-mix(in oklab, var(--a-accent) 55%, transparent),
    0 8px 24px -10px rgb(40 30 15 / 0.12);
}

.review-label {
  color: var(--a-ink-2);
  font-size: 12.5px;
  font-weight: 600;
}

.optional {
  margin-left: 4px;
  color: var(--a-ink-3);
  font-weight: 500;
}

.review-text {
  margin: 4px 0 0;
  font-size: 16.5px;
  line-height: 1.4;
}

.caret {
  display: inline-block;
  width: 2px;
  height: 20px;
  margin-left: 1px;
  border-radius: 1px;
  background: var(--a-accent);
  vertical-align: -4px;
}
</style>
