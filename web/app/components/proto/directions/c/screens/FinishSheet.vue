<script setup lang="ts">
// finish-sheet: over book-reading. Finishing a book is filling in its
// library card: the end date previewed as the red stamp it will get, the
// quarter-star Rating mid-drag (thumb on a ruler of quarter ticks, the value
// in a tag above the finger), the review written on ruled lines.
import { computed } from 'vue'
import { formatAuthors, formatDate } from '../../../data'
import Button from '../kit/Button.vue'
import Icon from '../kit/Icon.vue'
import Sheet from '../kit/Sheet.vue'
import Stamp from '../kit/Stamp.vue'
import Stars from '../kit/Stars.vue'
import { stampDate } from '../kit/paint'
import { useShelf } from '../kit/useShelf'
import BookDetail from './BookDetail.vue'

const { data } = useShelf()
const draft = computed(() => data.value.finishDraft)
const book = computed(() => data.value.readingEntry.book)
</script>

<template>
  <div class="wrap">
    <BookDetail state="reading" />
    <Sheet title="Finish">
      <div class="card c-paper-grain">
        <span class="punch" />
        <div class="card-head">
          <span class="kicker">Reading card</span>
          <span class="card-title">{{ book.title }}</span>
          <span class="card-author">{{ formatAuthors(book.authors) }}</span>
        </div>

        <div class="line date">
          <span class="label">End date</span>
          <span class="date-value">
            <Stamp label="Finished" :date="stampDate(draft.endedOn)" :rotate="-4" />
          </span>
          <span class="date-change"><Icon name="calendar" :size="18" />Today</span>
        </div>

        <div class="line rating">
          <span class="label">Rating <i>optional</i></span>
          <div class="stars-wrap">
            <Stars :rating="draft.rating" :size="44" :gap="7" dragging />
          </div>
          <span class="drag-hint">Drag across the stars · quarter steps</span>
        </div>

        <div class="line review">
          <span class="label">Review <i>optional</i></span>
          <p class="ruled">{{ draft.review }}<span class="caret" /></p>
        </div>
      </div>

      <Button class="go"><Icon name="stamp" :size="20" />Finish {{ formatDate(draft.endedOn, 'short') }}</Button>
    </Sheet>
  </div>
</template>

<style scoped>
.wrap {
  position: relative;
  height: 100%;
}

.card {
  position: relative;
  margin: 2px 0 18px;
  padding: 18px 18px 6px 40px;
  border-radius: 8px 8px 18px 18px;
  background:
    linear-gradient(90deg, transparent 27px, color-mix(in srgb, var(--c-stamp) 45%, transparent) 27px 28.5px, transparent 28.5px),
    var(--c-card);
  box-shadow:
    0 0 0 1px var(--c-line),
    0 8px 18px -12px rgb(var(--c-shadow) / 0.4);
}

.punch {
  position: absolute;
  top: 14px;
  left: 9px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--c-paper);
  box-shadow: inset 0 1px 2px rgb(var(--c-shadow) / 0.3);
}

.card-head {
  display: flex;
  flex-direction: column;
  padding-bottom: 12px;
  border-bottom: 1.5px solid var(--c-line-strong);
}

.kicker,
.label {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--c-ink-soft);
}

.label i {
  margin-left: 4px;
  font-style: normal;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: none;
  color: var(--c-muted);
}

.card-title {
  margin-top: 2px;
  font-family: var(--c-serif);
  font-size: 20px;
  line-height: 1.15;
}

.card-author {
  font-size: 14px;
  font-weight: 600;
  color: var(--c-ink-soft);
}

.line {
  border-bottom: 1px solid var(--c-line);
}

.line:last-child {
  border-bottom: 0;
}

.date {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  align-items: center;
  padding: 12px 0 14px;
}

.date .label {
  grid-column: 1 / -1;
  margin-bottom: 8px;
}

.date-value {
  padding-left: 4px;
}

.date-change {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 12px;
  border-radius: 12px;
  background: var(--c-paper-deep);
  font-size: 14px;
  font-weight: 700;
}

.rating {
  display: flex;
  flex-direction: column;
  padding: 12px 0 10px;
}

.stars-wrap {
  display: flex;
  justify-content: center;
  padding: 50px 0 4px;
}

.drag-hint {
  font-size: 12.5px;
  font-weight: 600;
  text-align: center;
  color: var(--c-muted);
}

.review {
  padding: 12px 0 8px;
}

.ruled {
  margin: 4px 0 0;
  font-size: 16px;
  line-height: 28px;
  background: repeating-linear-gradient(180deg, transparent 0 27px, var(--c-line) 27px 28px);
}

.caret {
  display: inline-block;
  width: 2px;
  height: 1.15em;
  margin-left: 1px;
  vertical-align: -0.2em;
  border-radius: 1px;
  background: var(--c-accent);
}

.go {
  margin-top: 0;
}
</style>
