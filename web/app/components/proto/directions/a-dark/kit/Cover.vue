<script setup lang="ts">
// A Book's cover, the hero of every screen. Real aspect ratio: give either a
// width or a height and the other side follows the image (`aspect-ratio: auto
// 2/3` keeps a 2:3 box only until it has loaded). While loading, the box shows
// the cover's own dominant colour, so nothing flashes grey.
//
// Without an image (Manual books) it draws the Placeholder cover: title and
// author set in the serif on a cloth colour picked from the title.
import { computed } from 'vue'
import type { CoverColors } from '../../../data'
import { formatAuthors } from '../../../data'

const props = withDefaults(
  defineProps<{
    book: { title: string; authors: string[]; coverUrl: string | null; coverColors?: CoverColors | null }
    width?: number
    height?: number
    /** soft: resting on paper · lift: the hero, floating · flat: inside a mosaic */
    shadow?: 'soft' | 'lift' | 'flat'
  }>(),
  { shadow: 'soft' },
)

/** Cloth colours for Placeholder covers: deep, bookish, never neon. */
const cloths = [
  { bg: '#2f4a3c', ink: '#efe6d2', rule: '#c9a85c' },
  { bg: '#6a2b2a', ink: '#f3e7d6', rule: '#d8b273' },
  { bg: '#24324d', ink: '#ece5d4', rule: '#c4a465' },
  { bg: '#8a6a3a', ink: '#fbf3e2', rule: '#f1dcaa' },
  { bg: '#4a3048', ink: '#f1e5e2', rule: '#cfa98a' },
]

const cloth = computed(() => {
  let hash = 0
  for (const char of props.book.title) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return cloths[hash % cloths.length]!
})

/** Rendered box for the placeholder (no natural ratio there: 2:3). */
const box = computed(() => {
  if (props.width) return { w: props.width, h: Math.round(props.width * 1.5) }
  const h = props.height ?? 150
  return { w: Math.round(h / 1.5), h }
})

const radius = computed(() => {
  const w = box.value.w
  return w < 50 ? 2.5 : w < 100 ? 3.5 : w < 150 ? 5 : 6
})

const sizing = computed(() =>
  props.width
    ? { width: `${props.width}px`, height: 'auto' }
    : { height: `${props.height ?? 150}px`, width: 'auto' },
)
</script>

<template>
  <span class="cover" :class="`shadow-${shadow}`" :style="{ '--r': `${radius}px` }">
    <img
      v-if="book.coverUrl"
      :src="book.coverUrl"
      :alt="book.title"
      class="image"
      :style="{ ...sizing, background: book.coverColors?.dominant ?? 'var(--ad-sunk)' }"
      draggable="false"
    />
    <span
      v-else
      class="placeholder"
      :style="{
        width: `${box.w}px`,
        height: `${box.h}px`,
        background: cloth.bg,
        color: cloth.ink,
        '--rule': cloth.rule,
        '--u': `${box.w / 100}px`,
      }"
    >
      <span class="ph-rule" />
      <span class="ph-title">{{ book.title }}</span>
      <span class="ph-author">{{ formatAuthors(book.authors) }}</span>
      <span class="ph-rule bottom" />
    </span>
    <span class="spine" aria-hidden="true" />
  </span>
</template>

<style scoped>
.cover {
  position: relative;
  display: inline-block;
  flex-shrink: 0;
  line-height: 0;
  border-radius: var(--r);
  vertical-align: bottom;
}

.image,
.placeholder {
  display: block;
  aspect-ratio: auto 2 / 3;
  border-radius: var(--r);
  object-fit: cover;
}

.shadow-soft {
  box-shadow:
    0 0.5px 1px rgb(var(--ad-shade) / 0.12),
    0 4px 10px -3px rgb(var(--ad-shade) / 0.18);
}

.shadow-lift {
  box-shadow:
    0 1px 2px rgb(var(--ad-shade) / 0.12),
    0 12px 24px -8px rgb(var(--ad-shade) / 0.3),
    0 30px 60px -20px rgb(var(--ad-shade) / 0.3);
}

.shadow-flat {
  box-shadow: 0 0.5px 1.5px rgb(var(--ad-shade) / 0.16);
}

/* Spine light and a hairline edge: covers read as objects, not thumbnails. */
.spine {
  position: absolute;
  inset: 0;
  border-radius: var(--r);
  background: linear-gradient(
    90deg,
    rgb(0 0 0 / 0.16) 0,
    rgb(255 255 255 / 0.2) 1.6%,
    rgb(0 0 0 / 0.05) 3.4%,
    rgb(255 255 255 / 0) 7%
  );
  box-shadow: inset 0 0 0 0.5px rgb(0 0 0 / 0.1);
  pointer-events: none;
}

.placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: calc(var(--u) * 6);
  padding: calc(var(--u) * 12) calc(var(--u) * 10);
  text-align: center;
  line-height: 1.1;
}

.ph-title {
  font-family: var(--ad-serif);
  font-size: calc(var(--u) * 13.5);
  font-weight: 500;
  letter-spacing: -0.01em;
  text-wrap: balance;
}

.ph-author {
  font-family: var(--ad-sans);
  font-size: calc(var(--u) * 6.4);
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  opacity: 0.85;
}

.ph-rule {
  width: 34%;
  height: calc(var(--u) * 2.4);
  border-top: max(0.5px, calc(var(--u) * 0.7)) solid var(--rule);
  border-bottom: max(0.5px, calc(var(--u) * 0.7)) solid var(--rule);
  opacity: 0.9;
}
</style>
