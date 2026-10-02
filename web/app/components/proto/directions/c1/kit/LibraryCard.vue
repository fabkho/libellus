<script setup lang="ts">
// The reading history, calmer than C's due-date card: one hairline card, one
// row per Reading session (newest first) on a thin timeline — which read,
// the dates in small mono figures, the Rating, the review in the serif.
// Every row is editable.
import { computed } from 'vue'
import type { LibraryEntry } from '../../../data'
import { daysBetween } from './paint'
import { formatDate, formatRating } from '../../../data'
import Stars from './Stars.vue'

const props = defineProps<{ entry: LibraryEntry }>()

const ordinals = ['First', 'Second', 'Third', 'Fourth', 'Fifth']

const rows = computed(() =>
  props.entry.sessions
    .map((session, i) => {
      const many = props.entry.sessions.length > 1
      const label = session.outcome
        ? session.outcome === 'abandoned'
          ? 'Not finished'
          : many
            ? `${ordinals[i] ?? `Read ${i + 1}`} read`
            : 'Finished'
        : 'Reading now'
      const days =
        session.startedOn && session.endedOn ? daysBetween(session.startedOn, session.endedOn) + 1 : null
      const dates = session.outcome
        ? `${formatDate(session.startedOn, 'short')} – ${formatDate(session.endedOn)}`
        : `Since ${formatDate(session.startedOn)}`
      return { session, label, dates, days }
    })
    .reverse(),
)
</script>

<template>
  <div class="card">
    <div v-for="({ session, label, dates, days }, i) in rows" :key="session.id" class="row">
      <span class="rail" :class="{ open: !session.outcome, last: i === rows.length - 1 }"><i /></span>
      <div class="body">
        <div class="line">
          <span class="label">{{ label }}</span>
          <span v-if="session.rating" class="rating">
            <Stars :rating="session.rating" :size="12" :value="false" />
            <span class="value">{{ formatRating(session.rating) }}</span>
          </span>
          <span class="edit">Edit</span>
        </div>
        <p class="dates">{{ dates }}<template v-if="days"> · {{ days }} days</template></p>
        <p v-if="session.review" class="review">{{ session.review }}</p>
        <p v-else-if="session.abandonReason" class="review">{{ session.abandonReason }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.card {
  padding: 4px 16px 2px 12px;
  border-radius: 20px;
  background: var(--c1-card);
  box-shadow: var(--c1-card-shadow);
}

.row {
  display: flex;
  gap: 10px;
}

.row + .row .body {
  border-top: 1px solid var(--c1-line);
}

.rail {
  position: relative;
  flex-shrink: 0;
  width: 12px;
}

.rail::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 5.5px;
  width: 1px;
  background: var(--c1-line-strong);
}

.row:first-child .rail::before {
  top: 18px;
}

.rail.last::before {
  bottom: calc(100% - 18px);
}

.rail i {
  position: absolute;
  top: 13px;
  left: 1px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--c1-card);
  box-shadow: inset 0 0 0 1.5px var(--c1-ink-soft);
}

.rail.open i {
  background: var(--c1-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--c1-accent) 22%, transparent);
}

.body {
  flex: 1;
  min-width: 0;
  padding: 10px 0 12px;
}

.line {
  display: flex;
  align-items: center;
  gap: 8px;
}

.label {
  font-size: 15px;
  font-weight: 600;
}

.rating {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.value {
  font-size: 12.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--c1-ink-soft);
}

.edit {
  margin-left: auto;
  font-size: 14px;
  font-weight: 500;
  color: var(--c1-accent-deep);
}

[data-theme='dark'] .edit {
  color: var(--c1-accent);
}

.dates {
  margin: 2px 0 0;
  font-family: var(--c1-mono);
  font-size: 12px;
  letter-spacing: -0.01em;
  color: var(--c1-ink-soft);
}

.review {
  margin: 6px 0 0;
  font-family: var(--c1-serif);
  font-style: italic;
  font-size: 15px;
  line-height: 1.4;
  color: var(--c1-ink);
}
</style>
