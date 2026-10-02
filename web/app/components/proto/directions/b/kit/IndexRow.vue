<script setup lang="ts">
// One line of a table of contents: a running number, a small plate, the title
// running into a dotted leader and its folio (a date), then a second line for
// the author and whatever the list adds (a Rating, a mark).
import { formatAuthors } from '../../../data'
import Cover from './Cover.vue'

withDefaults(
  defineProps<{
    book: { title: string; authors: string[]; coverUrl: string | null }
    number?: string
    folio?: string
    coverWidth?: number
    /** Big display numerals instead of small index figures (the Member's order). */
    ordinal?: boolean
  }>(),
  { coverWidth: 34 },
)
</script>

<template>
  <div class="row">
    <span v-if="number" class="number" :class="ordinal ? 'order-figure b-display' : 'b-figures'">{{ number }}</span>
    <Cover :book="book" :width="coverWidth" />
    <div class="text">
      <div class="line one">
        <span class="title">{{ book.title }}</span>
        <template v-if="folio || $slots.folio">
          <span class="b-leader" />
          <span class="folio b-figures"><slot name="folio">{{ folio }}</slot></span>
        </template>
      </div>
      <div class="line two">
        <span class="author b-italic b-clip"><slot name="author">{{ formatAuthors(book.authors) }}</slot></span>
        <span v-if="$slots.aside" class="aside"><slot name="aside" /></span>
      </div>
    </div>
    <slot name="trailing" />
  </div>
</template>

<style scoped>
.row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--b-rule);
}

.number {
  width: 18px;
  flex-shrink: 0;
  padding-top: 3px;
  font-size: 12px;
  line-height: 20px;
  color: var(--b-ink-3);
  text-align: left;
}

.number.order-figure {
  width: 24px;
  font-size: calc(28px * var(--b-ds));
  padding-top: 2px;
  color: var(--b-accent);
  text-align: center;
  line-height: 1;
}

.row :deep(.cover) {
  margin-top: 2px;
}

.text {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  padding-top: 1px;
}

.line {
  display: flex;
  min-width: 0;
  align-items: baseline;
}

/* A long title wraps; the leader and folio sit on its last line. */
.line.one {
  align-items: flex-end;
}

.title {
  min-width: 0;
  flex-shrink: 1;
  font-size: 17px;
  font-weight: 500;
  line-height: 22px;
  text-wrap: pretty;
}

.folio {
  flex-shrink: 0;
  font-size: 13px;
  line-height: 22px;
  color: var(--b-ink-2);
}

.two {
  justify-content: space-between;
  gap: 8px;
}

.author {
  min-width: 0;
  font-size: 15px;
  line-height: 20px;
  color: var(--b-ink-2);
}

.aside {
  display: flex;
  flex-shrink: 0;
  align-items: baseline;
}
</style>
