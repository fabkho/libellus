<script setup lang="ts">
// One book standing on a shelf, seen from the spine: colour from the cover,
// thickness from the page count, a stable height per title. Optional
// furniture: a call-number sticker at the foot (dates), a round Rating dot,
// a bookmark sticking out of the top (Currently reading), a "re-read" mark.
import { computed } from 'vue'
import type { CoverColors } from '../../../data'
import { formatRating } from '../../../data'
import { paint, standing, thickness } from './paint'
import { useShelf } from './useShelf'

const props = withDefaults(
  defineProps<{
    book: { title: string; authors: string[]; coverColors?: CoverColors | null; pageCount?: number | null }
    /** Scales the standing height (1 = library shelf). */
    scale?: number
    sticker?: [string, string] | null
    rating?: number | null
    bookmark?: boolean
    /** Number of reads, shown as dots when > 1. */
    reads?: number
    lean?: number
    /** Abandoned: a pale slip sticks out of the top. */
    slip?: boolean
  }>(),
  { scale: 1, sticker: null, rating: null, bookmark: false, reads: 1, lean: 0, slip: false },
)

const { palette } = useShelf()
const colors = computed(() => paint(props.book, palette.value))
const width = computed(() =>
  Math.round(thickness(props.book.pageCount) * (props.scale > 1 ? props.scale : 0.55 + props.scale * 0.45)),
)
const height = computed(() => Math.round(standing(props.book) * props.scale))
const showAuthor = computed(() => width.value >= 40 && height.value > 140)
const surname = computed(() => props.book.authors[0]?.split(' ').at(-1) ?? '')
const compact = computed(() => props.scale < 0.85)

/**
 * Fit the title like a real spine would: one line in the largest size that
 * fits the free length, else two lines on a thick spine, else a smaller size.
 */
const CHAR = 0.63
const fit = computed(() => {
  const title = props.book.title
  const furniture =
    (compact.value ? 13 + 20 : 18 + 30) +
    (props.sticker ? 30 : 0) +
    (props.rating ? 30 : 0) +
    (props.reads > 1 ? 20 : 0) +
    (showAuthor.value && !props.sticker ? surname.value.length * 10 + 6 : 0)
  const avail = height.value - furniture
  const max = Math.min(15, width.value * (compact.value ? 0.42 : 0.46))
  const one = avail / (title.length * CHAR)
  const words = title.split(/(?<=-)|\s+/)
  if (one >= 11 || width.value < 24 || words.length < 2) return { lines: [title], size: Math.max(9.5, Math.min(max, one)) }
  let best: [string, string] = [title, '']
  let bestLen = Infinity
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ').replace(/- /g, '-')
    const b = words.slice(i).join(' ').replace(/- /g, '-')
    const len = Math.max(a.length, b.length)
    if (len < bestLen) {
      bestLen = len
      best = [a, b]
    }
  }
  const size = Math.max(8.5, Math.min(width.value * 0.34, 14, avail / (bestLen * CHAR)))
  return { lines: best[1] ? best : [title], size }
})
/** Leaning left onto the neighbour: pivot on the foot, stand off so the top just touches. */
const standOff = computed(() =>
  props.lean < 0 ? Math.round(height.value * Math.sin((-props.lean * Math.PI) / 180) * 0.92) : 0,
)
</script>

<template>
  <div
    class="spine"
    :class="{ compact }"
    :style="{
      marginLeft: standOff ? `${standOff}px` : undefined,
      width: `${width}px`,
      height: `${height}px`,
      '--bg': colors.bg,
      '--fg': colors.fg,
      '--band': colors.band,
      transform: lean ? `rotate(${lean}deg)` : undefined,
      transformOrigin: lean > 0 ? 'bottom right' : 'bottom left',
      zIndex: lean ? 0 : undefined,
    }"
  >
    <span v-if="bookmark" class="bookmark" />
    <span v-if="slip" class="slip" />
    <span class="body c-cloth">
      <span class="bands top" />
      <span v-if="rating" class="dot">{{ formatRating(rating) }}</span>
      <span v-if="reads > 1" class="reads">{{ reads }}×</span>
      <span class="title" :style="{ fontSize: `${fit.size}px` }"
        ><template v-for="(line, i) in fit.lines" :key="i"><br v-if="i" />{{ line }}</template></span
      >
      <span v-if="showAuthor && !sticker" class="author">{{ surname }}</span>
      <span class="bands bottom" />
      <span v-if="sticker" class="sticker">
        <span>{{ sticker[0] }}</span>
        <span>{{ sticker[1] }}</span>
      </span>
    </span>
  </div>
</template>

<style scoped>
.spine {
  position: relative;
  flex-shrink: 0;
}

.body {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  overflow: hidden;
  padding: 10px 0 8px;
  border-radius: 4px 4px 3px 3px;
  background-color: var(--bg);
  color: var(--fg);
  box-shadow:
    inset 0 0 0 0.5px rgb(0 0 0 / 0.14),
    1px 0 0 rgb(0 0 0 / 0.08);
}

/* The round of the spine: light from the left, shade to the right. */
.body::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(
    90deg,
    rgb(0 0 0 / 0.16) 0,
    rgb(255 255 255 / 0.14) 18%,
    rgb(255 255 255 / 0.05) 42%,
    rgb(0 0 0 / 0.04) 70%,
    rgb(0 0 0 / 0.2) 100%
  );
}

.bands {
  flex-shrink: 0;
  width: 100%;
  height: 7px;
  border-top: 1.5px solid var(--band);
  border-bottom: 1.5px solid var(--band);
  opacity: 0.85;
}

.bands.top {
  margin-bottom: 8px;
}

.bands.bottom {
  margin-top: 8px;
}

.title {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  writing-mode: vertical-rl;
  font-family: var(--c-serif);
  line-height: 1.08;
  text-align: center;
  white-space: nowrap;
  text-overflow: ellipsis;
  letter-spacing: 0.01em;
}

.author {
  flex-shrink: 0;
  margin-top: 6px;
  writing-mode: vertical-rl;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  opacity: 0.8;
}

.compact .body {
  padding: 7px 0 6px;
}

.compact .bands {
  height: 4px;
  border-top-width: 1px;
  border-bottom-width: 1px;
}

.compact .bands.top {
  margin-bottom: 6px;
}

.compact .bands.bottom {
  margin-top: 6px;
}

/* The call-number label: day over month, typewritten. */
.sticker {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  flex-shrink: 0;
  width: calc(100% - 6px);
  max-width: 34px;
  margin-top: 6px;
  padding: 3px 0 2px;
  border-radius: 2.5px;
  background: #fbf6ea;
  color: #2b1d14;
  font-family: var(--c-mono);
  font-size: 9px;
  font-weight: 700;
  line-height: 1.05;
  box-shadow: 0 0.5px 1px rgb(0 0 0 / 0.25);
}

.dot {
  position: relative;
  z-index: 1;
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 24px;
  height: 24px;
  margin: -2px 0 8px;
  border-radius: 50%;
  background: var(--c-mustard);
  color: #2b1d14;
  font-size: 8.5px;
  font-weight: 800;
  letter-spacing: -0.02em;
  box-shadow:
    0 0.5px 1px rgb(0 0 0 / 0.3),
    inset 0 0 0 1.5px rgb(255 255 255 / 0.35);
}

.reads {
  position: relative;
  z-index: 1;
  flex-shrink: 0;
  margin: -4px 0 6px;
  padding: 1px 3px;
  border-radius: 3px;
  background: var(--fg);
  color: var(--bg);
  font-size: 8.5px;
  font-weight: 800;
}

/* A paper bookmark sticking out of the top: currently reading. */
.bookmark {
  position: absolute;
  top: -15px;
  left: 50%;
  z-index: 0;
  width: 11px;
  height: 30px;
  margin-left: -3px;
  background: var(--c-accent);
  clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%);
  border-radius: 2px 2px 0 0;
  transform: rotate(6deg);
  box-shadow: inset -2px 0 0 rgb(0 0 0 / 0.12);
}

.bookmark::after {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  height: 7px;
  background: linear-gradient(135deg, transparent 50%, rgb(0 0 0 / 0.15) 50%);
}

/* A pale slip: abandoned, maybe for later. */
.slip {
  position: absolute;
  top: -11px;
  left: 4px;
  z-index: 0;
  width: 15px;
  height: 26px;
  background: var(--c-card);
  border-radius: 2px;
  transform: rotate(-8deg);
  box-shadow: 0 0 0 0.5px rgb(0 0 0 / 0.18);
}
</style>
