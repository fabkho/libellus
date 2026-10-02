<script setup lang="ts">
// A cover as a physical object: real aspect ratio (measured from the image,
// 2:3 until it loads), a hinge shadow on the bound edge, a soft drop shadow.
// No image → the Placeholder cover, a cloth-bound board with a blind-stamped
// frame, the title in the serif and the author in small caps.
import { computed, ref } from 'vue'
import type { CoverColors } from '../../../data'
import { formatAuthors } from '../../../data'
import { paint } from './paint'
import { useShelf } from './useShelf'

const props = withDefaults(
  defineProps<{
    book: { title: string; authors: string[]; coverUrl: string | null; coverColors?: CoverColors | null; pageCount?: number | null }
    /** Width in px; the height follows the image. */
    width: number
    /** Shadow depth: 0 flat, 1 resting, 2 lifted. */
    lift?: 0 | 1 | 2
    tilt?: number
  }>(),
  { lift: 1, tilt: 0 },
)

const { palette } = useShelf()
const ratio = ref(2 / 3)
const cloth = computed(() => paint(props.book, palette.value))
const placeholderBg = computed(() => props.book.coverColors?.dominant ?? 'var(--c-paper-deep)')

function measure(event: Event) {
  const img = event.target as HTMLImageElement
  if (img.naturalWidth && img.naturalHeight) ratio.value = img.naturalWidth / img.naturalHeight
}
</script>

<template>
  <div
    class="c-cover"
    :class="[`lift-${lift}`]"
    :style="{
      width: `${width}px`,
      aspectRatio: String(ratio),
      transform: tilt ? `rotate(${tilt}deg)` : undefined,
      background: book.coverUrl ? placeholderBg : cloth.bg,
      '--r': `${Math.max(2, Math.round(width / 30))}px`,
    }"
  >
    <img v-if="book.coverUrl" :src="book.coverUrl" :alt="book.title" class="img" @load="measure" />
    <div v-else class="placeholder c-cloth" :style="{ color: cloth.fg, '--band': cloth.band }">
      <span class="frame" />
      <span class="title" :style="{ fontSize: `${Math.max(8, width / 8.2)}px` }">{{ book.title }}</span>
      <span class="rule" />
      <span class="author" :style="{ fontSize: `${Math.max(6, width / 15)}px` }">{{ formatAuthors(book.authors) }}</span>
    </div>
    <span class="hinge" />
  </div>
</template>

<style scoped>
.c-cover {
  position: relative;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: calc(var(--r) * 0.6) var(--r) var(--r) calc(var(--r) * 0.6);
}

.lift-1 {
  box-shadow:
    0 1px 1.5px rgb(var(--c-shadow) / 0.22),
    0 4px 10px -2px rgb(var(--c-shadow) / 0.22);
}

.lift-2 {
  box-shadow:
    0 2px 3px rgb(var(--c-shadow) / 0.18),
    0 14px 26px -6px rgb(var(--c-shadow) / 0.38),
    0 30px 44px -20px rgb(var(--c-shadow) / 0.3);
}

.img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* The bound edge: a crease and a sheen, like a real board under light. */
.hinge {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(
      90deg,
      rgb(0 0 0 / 0.16) 0,
      rgb(255 255 255 / 0.16) 2.2%,
      rgb(0 0 0 / 0.1) 4.5%,
      rgb(255 255 255 / 0.05) 7%,
      transparent 12%
    ),
    linear-gradient(180deg, rgb(255 255 255 / 0.08), transparent 30%);
  border-radius: inherit;
  box-shadow: inset 0 0 0 0.5px rgb(0 0 0 / 0.12);
}

.placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6%;
  padding: 16% 13%;
  text-align: center;
}

.frame {
  position: absolute;
  inset: 7% 8%;
  border: 1px solid var(--band);
  border-radius: 3px;
  opacity: 0.55;
}

.title {
  font-family: var(--c-serif);
  line-height: 1.12;
  overflow-wrap: anywhere;
}

.rule {
  width: 22%;
  height: 1px;
  background: currentColor;
  opacity: 0.5;
}

.author {
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  line-height: 1.2;
  opacity: 0.85;
}
</style>
