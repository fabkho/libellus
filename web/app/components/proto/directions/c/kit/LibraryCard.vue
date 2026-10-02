<script setup lang="ts">
// The reading history as an old library due-date card: ruled rows, a red
// margin rule, one row per Reading session (newest first), the start date
// stamped in blue, the end date in red, the Rating in the last column and
// the review written on the lines below. Every row is editable (pencil).
import { computed } from 'vue'
import type { LibraryEntry } from '../../../data'
import Icon from './Icon.vue'
import Stars from './Stars.vue'
import { stampDate } from './paint'

const props = defineProps<{ entry: LibraryEntry }>()

const rows = computed(() =>
  props.entry.sessions
    .map((session, i) => ({ session, number: i + 1 }))
    .reverse(),
)
const tilt = (n: number, k: number) => (((n * 7 + k * 5) % 5) - 2) * 0.9
</script>

<template>
  <div class="card c-paper-grain">
    <div class="head">
      <span class="col n">No.</span>
      <span class="col">Started</span>
      <span class="col">Finished</span>
      <span class="col r">Rating</span>
    </div>
    <div v-for="{ session, number } in rows" :key="session.id" class="row">
      <div class="line">
        <span class="col n num">{{ number }}</span>
        <span class="col">
          <span v-if="session.startedOn" class="stamp blue c-ink-grain" :style="{ transform: `rotate(${tilt(number, 1)}deg)` }">{{
            stampDate(session.startedOn)
          }}</span>
          <span v-else class="blank">—</span>
        </span>
        <span class="col">
          <span
            v-if="session.outcome === 'finished'"
            class="stamp red c-ink-grain"
            :style="{ transform: `rotate(${tilt(number, 2)}deg)` }"
            >{{ stampDate(session.endedOn) }}</span
          >
          <span
            v-else-if="session.outcome === 'abandoned'"
            class="stamp grey c-ink-grain"
            :style="{ transform: `rotate(${tilt(number, 2)}deg)` }"
            >{{ stampDate(session.endedOn) }}</span
          >
          <span v-else class="open">reading now…</span>
        </span>
        <span class="col r">
          <Stars v-if="session.rating" :rating="session.rating" :size="11" :gap="0" :value="false" />
          <span v-if="session.rating" class="value">{{ session.rating / 4 }}</span>
          <span v-else class="blank">—</span>
        </span>
        <span class="edit" aria-label="Edit"><Icon name="pencil" :size="16" /></span>
      </div>
      <p v-if="session.review" class="review">{{ session.review }}</p>
      <p v-if="session.abandonReason" class="review muted">Not finished: {{ session.abandonReason }}</p>
    </div>
  </div>
</template>

<style scoped>
.card {
  position: relative;
  overflow: hidden;
  padding: 0 0 6px;
  border-radius: 6px 6px 16px 16px;
  background:
    linear-gradient(90deg, transparent 37px, color-mix(in srgb, var(--c-stamp) 45%, transparent) 37px 38.5px, transparent 38.5px),
    var(--c-card);
  box-shadow:
    0 0 0 1px var(--c-line),
    0 6px 16px -10px rgb(var(--c-shadow) / 0.35);
}

.head,
.line {
  display: grid;
  grid-template-columns: 38px 1fr 1fr 74px 30px;
  align-items: center;
  padding: 0 0 0 0;
}

.head {
  height: 30px;
  border-bottom: 1.5px solid var(--c-line-strong);
  background: var(--c-paper-deep);
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--c-ink-soft);
}

.col {
  padding-left: 8px;
}

.col.n {
  padding-left: 0;
  text-align: center;
}

.col.r {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
}

.row {
  border-bottom: 1px solid var(--c-line);
}

.row:last-child {
  border-bottom: 0;
}

.line {
  min-height: 46px;
}

.num {
  font-family: var(--c-mono);
  font-size: 15px;
  font-weight: 700;
  color: var(--c-ink-soft);
}

.stamp {
  display: inline-block;
  padding: 2px 4px;
  border: 1.5px solid currentColor;
  border-radius: 4px;
  font-family: var(--c-mono);
  font-size: 12.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.blue {
  color: var(--c-stamp-blue);
}

.red {
  color: var(--c-stamp);
}

.grey {
  color: var(--c-muted);
}

.open {
  font-size: 13px;
  font-weight: 600;
  font-style: italic;
  color: var(--c-teal);
}

.blank {
  color: var(--c-muted);
}

.value {
  font-size: 12px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.edit {
  display: grid;
  place-items: center;
  width: 30px;
  height: 44px;
  color: var(--c-muted);
}

.review {
  margin: -2px 14px 12px 48px;
  font-size: 14px;
  line-height: 1.4;
  color: var(--c-ink);
}

.review::before {
  content: '“';
}

.review::after {
  content: '”';
}

.review.muted {
  color: var(--c-ink-soft);
}

.review.muted::before,
.review.muted::after {
  content: '';
}
</style>
