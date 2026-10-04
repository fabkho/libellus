<script setup lang="ts">
// Direction A, "Scrub": the progress bar is the control. At rest it is D's
// hairline with a small lit thumb; a finger that slides along it takes the
// thumb with it (relative: the thumb never jumps to the finger), the rail
// thickens, notches show the tenths, and a readout floats over the thumb with
// the page and how far it moved. Haptic ticks as it crosses each step (a page
// at fine speed, a few pages otherwise), a firmer one at every tenth and at
// the ends. Sliding the finger up away from the rail slows it down (half,
// then a fifth: "Fine"), as iOS's media scrubbers do, so one page is easy to
// hit on a 600-page book. Letting go saves; the caller offers Undo.
// A slider for the keyboard and assistive tech (arrows a page, Page Up/Down a
// step, Home/End).
import { haptic, maxOf, positionOf, usesPages, n, type ProtoRead } from '../model'

const props = withDefaults(defineProps<{ read: ProtoRead; size?: 'card' | 'page'; demo?: number | null }>(), {
  size: 'card',
  demo: null,
})
const emit = defineEmits<{ commit: [from: number, to: number]; live: [value: number | null]; tap: [] }>()

const track = useTemplateRef<HTMLElement>('track')
const max = computed(() => maxOf(props.read))
const pages = computed(() => usesPages(props.read))
/** Steps a coarse slide ticks at: about sixty across the rail, on a round number. */
const step = computed(() => {
  if (!pages.value) return 1
  const raw = max.value / 60
  return [1, 2, 5, 10, 20, 25, 50, 100].find((s) => s >= raw) ?? 100
})

const live = ref<number | null>(null)
const from = ref(0)
const speed = ref(1)
const value = computed(() => live.value ?? props.demo ?? positionOf(props.read))
const active = computed(() => live.value !== null || props.demo !== null)
const fraction = computed(() => Math.min(Math.max(value.value / max.value, 0), 1))
const fromFraction = computed(() => Math.min(Math.max((props.demo !== null ? positionOf(props.read) : from.value) / max.value, 0), 1))
const delta = computed(() => value.value - (props.demo !== null ? positionOf(props.read) : from.value))
watch(live, (v) => emit('live', v))

const TAP_SLOP = 6
let press: { id: number; x: number; y: number; acc: number; dragging: boolean } | null = null

function onPointerdown(event: PointerEvent) {
  if (press || event.button !== 0) return
  press = { id: event.pointerId, x: event.clientX, y: event.clientY, acc: positionOf(props.read), dragging: false }
  track.value?.setPointerCapture?.(event.pointerId)
}

function onPointermove(event: PointerEvent) {
  if (!press || event.pointerId !== press.id) return
  const dx = event.clientX - press.x
  if (!press.dragging) {
    if (Math.abs(dx) < TAP_SLOP) return
    press.dragging = true
    from.value = positionOf(props.read)
    live.value = from.value
    haptic('tick')
  }
  const rect = track.value!.getBoundingClientRect()
  const away = Math.max(0, rect.top + rect.height / 2 - event.clientY)
  speed.value = away > 120 ? 0.2 : away > 56 ? 0.5 : 1
  const before = live.value!
  press.acc = Math.min(Math.max(press.acc + dx * (max.value / rect.width) * speed.value, 0), max.value)
  press.x = event.clientX
  const next = Math.round(press.acc)
  if (next === before) return
  live.value = next
  buzzBetween(before, next)
}

/** The firmest thing crossed between two values decides the tick. */
function buzzBetween(a: number, b: number) {
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  if (b === 0 || b === max.value) return haptic('edge')
  const tenth = max.value / 10
  if (Math.floor(hi / tenth) !== Math.floor(lo / tenth)) return haptic('step')
  const every = speed.value < 1 ? 1 : step.value
  if (Math.floor(hi / every) !== Math.floor(lo / every)) haptic('tick')
}

function release(commit: boolean) {
  if (!press) return
  const wasDragging = press.dragging
  press = null
  speed.value = 1
  if (!wasDragging) {
    if (commit) emit('tap')
    return
  }
  const to = live.value!
  live.value = null
  if (commit && to !== from.value) emit('commit', from.value, to)
}

function onKeydown(event: KeyboardEvent) {
  const at = positionOf(props.read)
  const moves: Record<string, number> = {
    ArrowRight: at + 1,
    ArrowUp: at + 1,
    ArrowLeft: at - 1,
    ArrowDown: at - 1,
    PageUp: at + step.value,
    PageDown: at - step.value,
    Home: 0,
    End: max.value,
  }
  const to = moves[event.key]
  if (to === undefined) return
  event.preventDefault()
  emit('commit', at, Math.min(Math.max(to, 0), max.value))
}

const readout = computed(() => (pages.value ? `p. ${n(value.value)}` : `${value.value} %`))
const deltaText = computed(() => (delta.value === 0 ? '' : `${delta.value > 0 ? '+' : '−'}${n(Math.abs(delta.value))}`))
const TENTHS = Array.from({ length: 11 }, (_, i) => i / 10)
</script>

<template>
  <div
    ref="track"
    role="slider"
    tabindex="0"
    aria-label="Reading progress"
    :aria-valuemin="0"
    :aria-valuemax="max"
    :aria-valuenow="value"
    :aria-valuetext="readout"
    class="scrub relative outline-none"
    :class="[size, active && 'active']"
    :style="{ '--at': fraction, '--from': fromFraction }"
    data-no-swipe
    data-testid="a.scrub"
    @pointerdown="onPointerdown"
    @pointermove="onPointermove"
    @pointerup="release(true)"
    @pointercancel="release(false)"
    @lostpointercapture="release(true)"
    @keydown="onKeydown"
  >
    <span class="rail" aria-hidden="true">
      <span class="read" />
      <span class="gain" />
    </span>
    <span class="notches" aria-hidden="true">
      <span v-for="t in TENTHS" :key="t" class="notch" :class="{ lit: t <= fraction, half: t === 0.5 }" :style="{ '--t': t }" />
    </span>
    <span class="thumb" aria-hidden="true" />
    <span class="readout glass edge shadow-float" aria-hidden="true">
      <span class="figures text-body text-ink">{{ readout }}</span>
      <span v-if="deltaText" class="figures text-meta text-accent">{{ deltaText }}</span>
      <span v-if="speed < 1" class="eyebrow">{{ speed < 0.5 ? 'Fine' : 'Half' }}</span>
    </span>
  </div>
</template>

<style scoped>
/* Horizontal drags are the scrubber's; vertical ones still scroll the page. */
.scrub {
  height: var(--size-touch);
  touch-action: pan-y;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}
.scrub.active {
  cursor: grabbing;
}
.scrub:focus-visible {
  border-radius: var(--radius-sm);
  outline: var(--stroke-focus) solid var(--color-accent);
  outline-offset: var(--spacing-xxs);
}

.rail {
  position: absolute;
  top: 50%;
  right: 0;
  left: 0;
  height: var(--stroke-focus);
  overflow: hidden;
  border-radius: var(--radius-pill);
  background: var(--color-hairline-strong);
  transform: translateY(-50%);
  transition: height var(--duration-quick) var(--ease-standard);
}
.active .rail {
  height: var(--spacing-xs);
}
.read,
.gain {
  position: absolute;
  inset-block: 0;
  left: 0;
  background: var(--color-accent);
}
.read {
  width: calc(min(var(--at), var(--from)) * 100%);
}
/* What this slide adds: the lamp at full, the rest a step back while scrubbing. */
.gain {
  left: calc(var(--from) * 100%);
  width: calc(max(var(--at) - var(--from), 0) * 100%);
}
.active .read {
  opacity: 0.55;
}

.notches {
  position: absolute;
  inset: 0;
  opacity: 0;
  transition: opacity var(--duration-quick) var(--ease-standard);
}
.active .notches,
.page .notches {
  opacity: 1;
}
.notch {
  position: absolute;
  top: calc(50% + var(--spacing-sm));
  left: calc(var(--t) * 100%);
  width: var(--stroke-rule);
  height: var(--spacing-xs);
  background: var(--color-ink-ghost);
  transform: translateX(-50%);
}
.notch.half {
  height: var(--spacing-sm);
  background: var(--color-ink-faint);
}
.notch.lit {
  background: var(--color-accent);
}

.thumb {
  position: absolute;
  top: 50%;
  left: calc(var(--at) * 100%);
  width: var(--spacing-ms);
  height: var(--spacing-ms);
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  box-shadow: 0 0 var(--spacing-sm) var(--spacing-xxs) color-mix(in srgb, var(--color-accent) 45%, transparent);
  transform: translate(-50%, -50%);
  transition:
    width var(--duration-quick) var(--ease-standard),
    height var(--duration-quick) var(--ease-standard),
    background-color var(--duration-quick) var(--ease-standard),
    box-shadow var(--duration-quick) var(--ease-standard);
}
.active .thumb {
  width: var(--size-rating-thumb);
  height: var(--size-rating-thumb);
  background: var(--color-ink);
  box-shadow:
    0 0 0 var(--spacing-xs) var(--color-accent-soft),
    var(--shadow-button);
}

/* Over the thumb, kept inside the rail's ends. */
.readout {
  position: absolute;
  bottom: calc(50% + var(--spacing-ml));
  left: clamp(var(--spacing-xxxl), calc(var(--at) * 100%), calc(100% - var(--spacing-xxxl)));
  display: flex;
  align-items: baseline;
  gap: var(--spacing-sm);
  padding: var(--spacing-xs) var(--spacing-ms);
  border-radius: var(--radius-pill);
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transform: translate(-50%, var(--spacing-xs));
  transition:
    opacity var(--duration-quick) var(--ease-standard),
    transform var(--duration-quick) var(--ease-standard);
}
.active .readout {
  opacity: 1;
  transform: translate(-50%, 0);
}
/* On the book page the number over the rail is the readout. */
.page .readout {
  display: none;
}

@media (prefers-reduced-motion: reduce) {
  .thumb,
  .rail,
  .readout {
    transition: none;
  }
}
</style>
