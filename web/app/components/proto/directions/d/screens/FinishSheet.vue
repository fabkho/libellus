<script setup lang="ts">
// finish-sheet: over the reading Book's detail. End date (today), the
// quarter-star Rating mid-drag — the value large, the finger on a rail of
// quarter notches under the stars — and the review being typed.
import { computed } from 'vue'
import { useProto } from '../../../contract'
import { formatDate } from '../../../data'
import BookLine from '../kit/BookLine.vue'
import Button from '../kit/Button.vue'
import Row from '../kit/Row.vue'
import Sheet from '../kit/Sheet.vue'
import Stars from '../kit/Stars.vue'
import { ratingText } from '../kit/night'
import BookDetail from './BookDetail.vue'

const proto = useProto()
const draft = computed(() => proto.value.data.finishDraft)

const SIZE = 46
const GAP = 10
const WIDTH = SIZE * 5 + GAP * 4
/** x of a rating (in quarters) along the stars, matching how Stars fills them. */
function x(quarters: number): number {
  if (quarters <= 0) return (3.4 / 24) * SIZE
  const i = Math.ceil(quarters / 4) - 1
  const f = (quarters - i * 4) / 4
  return i * (SIZE + GAP) + ((3.4 + 17.2 * f) / 24) * SIZE
}
const notches = Array.from({ length: 21 }, (_, q) => ({ q, x: x(q), whole: q % 4 === 0 }))
const thumb = computed(() => x(draft.value.rating))
</script>

<template>
  <Sheet title="Finish reading">
    <template #under><BookDetail state="reading" /></template>

    <BookLine :book="proto.data.readingEntry.book" />

    <div class="d-group">
      <Row label="Finished on" icon="calendar" :value="`Today · ${formatDate(draft.endedOn)}`" chevron />
    </div>

    <div class="rating">
      <div class="rating-head">
        <span class="d-eyebrow">Rating</span>
        <span class="d-eyebrow faint">Optional</span>
      </div>
      <p class="readout d-num">
        {{ ratingText(draft.rating) }}<span class="of">/ 5</span>
      </p>
      <div class="track" :style="{ width: `${WIDTH}px` }">
        <Stars :rating="draft.rating" :size="SIZE" :gap="GAP" :value="false" />
        <span class="guide" :style="{ left: `${thumb}px` }" />
        <div class="rail">
          <span
            v-for="n in notches"
            :key="n.q"
            class="notch"
            :class="{ whole: n.whole, lit: n.q <= draft.rating }"
            :style="{ left: `${n.x}px` }"
          />
          <span class="thumb" :style="{ left: `${thumb}px` }" />
        </div>
      </div>
      <p class="steps">Drag across the stars · quarter steps</p>
    </div>

    <label class="review">
      <span class="review-label">Review <span class="faint-text">· optional</span></span>
      <span class="review-text">{{ draft.review }}<span class="d-caret" /></span>
    </label>

    <div class="go"><Button block>Finish</Button></div>
  </Sheet>
</template>

<style scoped>
.rating {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 22px;
}

.rating-head {
  display: flex;
  width: 100%;
  justify-content: space-between;
  padding: 0 4px;
}

.faint {
  color: var(--d-ink-4);
}

.readout {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-top: 6px;
  font-size: 50px;
  font-weight: 300;
  line-height: 1;
  letter-spacing: -0.04em;
  color: var(--d-lamp);
}

.of {
  font-size: 15px;
  font-weight: 400;
  letter-spacing: 0;
  color: var(--d-ink-3);
}

.track {
  position: relative;
  margin-top: 14px;
}

.guide {
  position: absolute;
  top: -6px;
  bottom: 6px;
  width: 1px;
  background: linear-gradient(to bottom, transparent, var(--d-lamp));
  transform: translateX(-0.5px);
}

.rail {
  position: relative;
  height: 26px;
  margin-top: 8px;
}

.rail::before {
  position: absolute;
  top: 12px;
  right: 0;
  left: 0;
  height: 1px;
  content: '';
  background: var(--d-line-2);
}

.notch {
  position: absolute;
  top: 9px;
  width: 1px;
  height: 7px;
  background: var(--d-ink-4);
  transform: translateX(-0.5px);
}

.notch.whole {
  top: 6px;
  height: 13px;
  background: var(--d-ink-3);
}

.notch.lit {
  background: var(--d-lamp);
}

.thumb {
  position: absolute;
  top: 0;
  width: 26px;
  height: 26px;
  border-radius: 999px;
  background: var(--d-ink);
  box-shadow:
    0 0 0 6px rgb(239 183 104 / 0.18),
    0 4px 12px rgb(0 0 0 / 0.5);
  transform: translateX(-50%);
}

.steps {
  margin-top: 8px;
  font-size: 12px;
  color: var(--d-ink-3);
}

.review {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 20px;
  padding: 12px 14px 14px;
  border-radius: 14px;
  background: var(--d-fill);
  box-shadow: inset 0 0 0 1px rgb(239 183 104 / 0.45);
}

.review-label {
  font-size: 12.5px;
  color: var(--d-ink-2);
}

.faint-text {
  color: var(--d-ink-4);
}

.review-text {
  font-family: var(--d-serif);
  font-size: 16px;
  font-style: italic;
  line-height: 1.38;
}

.go {
  margin-top: 18px;
}
</style>
