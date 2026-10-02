<script setup lang="ts">
// A book lying on its side, spine towards you: one layer of a stack. The
// spine carries the title (serif) and author; the `label` slot is a paper
// sticker at the right end for dates and the Rating. Length and offset vary
// a little per title so a pile looks hand-stacked.
import { computed } from 'vue'
import type { CoverColors } from '../../../data'
import { formatAuthors } from '../../../data'
import { hash, paint, thickness } from './paint'
import { useShelf } from './useShelf'

const props = withDefaults(
  defineProps<{
    book: { title: string; authors: string[]; coverColors?: CoverColors | null; pageCount?: number | null }
    /** Fixed thickness; default from the page count. */
    height?: number
    /** Max length in px; the book is a bit shorter, by title. */
    length?: number
    /** Horizontal jitter, px. */
    jitter?: number
    compact?: boolean
    bookmark?: boolean
  }>(),
  { length: 353, jitter: 8, compact: false, bookmark: false },
)

const { palette } = useShelf()
const colors = computed(() => paint(props.book, palette.value))
const h = computed(() => props.height ?? Math.max(44, thickness(props.book.pageCount, 44, 66)))
const shift = computed(() => ((hash(props.book.title) % 5) - 2) * (props.jitter / 2))
const len = computed(() => props.length - Math.abs(shift.value) - (hash(props.book.title + 'l') % 3) * 6)
</script>

<template>
  <div class="lying" :style="{ height: `${h}px`, width: `${len}px`, transform: `translateX(${shift}px)` }">
    <span class="spine c-cloth" :style="{ '--bg': colors.bg, '--fg': colors.fg, '--band': colors.band }">
      <span class="band" />
      <span class="text">
        <span class="title">{{ book.title }}</span>
        <span v-if="!compact" class="author">{{ formatAuthors(book.authors) }}</span>
      </span>
      <slot name="label" />
      <span class="band" />
    </span>
    <span v-if="bookmark" class="ribbon" />
    <span class="pages" />
  </div>
</template>

<style scoped>
.lying {
  position: relative;
  display: flex;
  margin: 0 auto;
}

.spine {
  position: relative;
  z-index: 1;
  display: flex;
  flex: 1;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 0 6px;
  border-radius: 5px 3px 3px 5px;
  background-color: var(--bg);
  color: var(--fg);
  box-shadow:
    inset 0 0 0 0.5px rgb(0 0 0 / 0.14),
    0 1px 0 rgb(0 0 0 / 0.1);
}

/* Rounded spine under a top light. */
.spine::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  background: linear-gradient(
    180deg,
    rgb(255 255 255 / 0.16) 0,
    rgb(255 255 255 / 0.04) 35%,
    rgb(0 0 0 / 0.03) 70%,
    rgb(0 0 0 / 0.2) 100%
  );
}

.band {
  flex-shrink: 0;
  align-self: stretch;
  width: 6px;
  margin: 4px 0;
  border-left: 1.5px solid var(--band);
  border-right: 1.5px solid var(--band);
  opacity: 0.85;
}

.text {
  display: flex;
  flex: 1;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
}

.title {
  flex-shrink: 1;
  min-width: 0;
  overflow: hidden;
  font-family: var(--c-serif);
  font-size: 16px;
  line-height: 1.2;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.author {
  flex-shrink: 100;
  min-width: 0;
  overflow: hidden;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  white-space: nowrap;
  text-overflow: ellipsis;
  opacity: 0.75;
}

/* The page block peeking at the far end. */
.pages {
  width: 5px;
  margin: 3px 0 3px -2px;
  border-radius: 0 2px 2px 0;
  background: repeating-linear-gradient(180deg, #fbf5e8 0 1px, #e7dcc6 1px 2px);
}

.ribbon {
  position: absolute;
  right: 40px;
  bottom: -14px;
  z-index: 0;
  width: 9px;
  height: 22px;
  background: var(--c-accent);
  clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 78%, 0 100%);
}
</style>
