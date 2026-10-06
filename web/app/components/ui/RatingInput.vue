<script setup lang="ts">
// The rating control (D's finish-sheet): the value large in the lamp colour,
// five stars, and under them a rail of quarter notches with a thumb. Drag
// across the stars and the Rating snaps to the nearest quarter; a tap sets
// the whole star under the finger; dragging off the left of the first star
// or Clear leaves it empty (a Rating is optional). A slider for assistive
// tech and the keyboard: arrows step a quarter, Page Up/Down a star, Home
// clears, End is five stars. `v-model` is the stored quarters, 1–20, or null.
import { isRatingStep, tick } from '~/utils/haptics'
import { MAX_QUARTERS, quartersAt, ratingText, ratingX, stepQuarters, wholeStarsAt } from '~/utils/rating'

const model = defineModel<number | null>({ required: true })
const props = defineProps<{ testid: string; disabled?: boolean }>()

const { t } = useI18n()

const track = useTemplateRef<HTMLElement>('track')
const hintId = useId()

/** The control's geometry in px, from the tokens it is drawn with. */
function geometry() {
  const style = getComputedStyle(track.value!)
  return {
    size: Number.parseFloat(style.getPropertyValue('--size-star-input')) || 44,
    gap: Number.parseFloat(style.getPropertyValue('--spacing-ms')) || 12,
  }
}

/** Where a quarter sits, as a star index and a fraction of a star's width, for CSS to place. */
function position(quarters: number) {
  const star = quarters <= 0 ? 0 : Math.ceil(quarters / 4) - 1
  return { '--star': star, '--fill': ratingX(quarters, 1, 0) - star }
}

const NOTCHES = Array.from({ length: MAX_QUARTERS + 1 }, (_, quarters) => ({
  quarters,
  whole: quarters % 4 === 0,
  style: position(quarters),
}))

const value = computed(() => model.value ?? 0)
const valueText = computed(() =>
  model.value ? t('rating.label', { value: ratingText(model.value) }) : t('rating.none'),
)

function set(quarters: number) {
  const next = quarters > 0 ? quarters : null
  if (isRatingStep(model.value, next)) tick()
  model.value = next
}

// A press becomes a drag once the finger has moved; one that never moved is a tap.
const TAP_SLOP = 4
let press: { id: number; x: number; dragging: boolean } | null = null
const dragging = ref(false)

function xIn(event: PointerEvent): number {
  return event.clientX - track.value!.getBoundingClientRect().left
}

function onPointerdown(event: PointerEvent) {
  if (props.disabled || press) return
  press = { id: event.pointerId, x: event.clientX, dragging: false }
  track.value?.setPointerCapture?.(event.pointerId)
  track.value?.focus({ preventScroll: true })
}

function onPointermove(event: PointerEvent) {
  if (!press || event.pointerId !== press.id) return
  if (!press.dragging && Math.abs(event.clientX - press.x) < TAP_SLOP) return
  press.dragging = dragging.value = true
  const { size, gap } = geometry()
  set(quartersAt(xIn(event), size, gap))
}

function onPointerup(event: PointerEvent) {
  if (!press || event.pointerId !== press.id) return
  if (!press.dragging) {
    const { size, gap } = geometry()
    set(wholeStarsAt(xIn(event), size, gap))
  }
  press = null
  dragging.value = false
}

function onPointercancel() {
  press = null
  dragging.value = false
}

const KEYS: Record<string, (quarters: number | null) => number> = {
  ArrowRight: (q) => stepQuarters(q, 1),
  ArrowUp: (q) => stepQuarters(q, 1),
  ArrowLeft: (q) => stepQuarters(q, -1),
  ArrowDown: (q) => stepQuarters(q, -1),
  PageUp: (q) => stepQuarters(q, 4),
  PageDown: (q) => stepQuarters(q, -4),
  Home: () => 0,
  End: () => MAX_QUARTERS,
}

function onKeydown(event: KeyboardEvent) {
  const step = KEYS[event.key]
  if (!step || props.disabled) return
  event.preventDefault()
  set(step(model.value))
}
</script>

<template>
  <div class="flex flex-col items-center" data-no-swipe>
    <div class="flex w-full items-center justify-between px-xs">
      <span class="eyebrow">{{ t('rating.title') }}</span>
      <button
        v-if="model"
        type="button"
        class="-mr-sm min-h-(--size-touch) px-sm text-caption text-ink-muted"
        :data-testid="`${testid}.clear`"
        :disabled="disabled"
        @click="model = null"
      >
        {{ t('rating.clear') }}
      </button>
      <span v-else class="eyebrow flex min-h-(--size-touch) items-center text-ink-faint">{{ t('rating.optional') }}</span>
    </div>

    <!-- The value, large; "Not rated" in its place until there is one. -->
    <p class="flex h-(--text-figure--line-height) items-baseline gap-xs" aria-hidden="true" :data-testid="`${testid}.value`">
      <template v-if="model">
        <span class="figures text-figure text-accent">{{ ratingText(model) }}</span>
        <span class="figures text-subhead text-ink-faint">{{ t('rating.outOf') }}</span>
      </template>
      <span v-else class="self-center text-subhead text-ink-faint">{{ t('rating.none') }}</span>
    </p>

    <div
      ref="track"
      role="slider"
      :tabindex="disabled ? -1 : 0"
      :aria-label="t('rating.title')"
      :aria-describedby="hintId"
      aria-valuemin="0"
      :aria-valuemax="MAX_QUARTERS / 4"
      :aria-valuenow="value / 4"
      :aria-valuetext="valueText"
      :aria-disabled="disabled || undefined"
      class="track relative mt-ms outline-none"
      :class="dragging && 'dragging'"
      :data-testid="testid"
      @pointerdown="onPointerdown"
      @pointermove="onPointermove"
      @pointerup="onPointerup"
      @pointercancel="onPointercancel"
      @lostpointercapture="onPointercancel"
      @keydown="onKeydown"
    >
      <span class="block" aria-hidden="true"><UiStars :quarters="model" size="input" :show-value="false" /></span>
      <span v-if="model" class="guide" :style="position(value)" aria-hidden="true" />
      <span class="rail" aria-hidden="true">
        <span
          v-for="notch in NOTCHES"
          :key="notch.quarters"
          class="notch"
          :class="{ whole: notch.whole, lit: model && notch.quarters <= model }"
          :style="notch.style"
        />
        <span class="thumb" :class="!model && 'empty'" :style="position(value)" />
      </span>
    </div>
    <p :id="hintId" class="mt-xs text-footnote text-ink-faint">{{ t('rating.hint') }}</p>
  </div>
</template>

<style scoped>
/* Horizontal drags are the control's; vertical ones still scroll the sheet. */
.track {
  touch-action: pan-y;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}

.track:focus-visible {
  border-radius: var(--radius-sm);
  outline: var(--stroke-focus) solid var(--color-accent-ink);
  outline-offset: var(--spacing-xs);
}

/* Where a quarter sits along the stars: --star whole steps of a star and its
   gap, plus --fill of a star (utils/rating.ts, ratingX). */
.guide,
.notch,
.thumb {
  position: absolute;
  left: calc(var(--star) * (var(--size-star-input) + var(--spacing-ms)) + var(--fill) * var(--size-star-input));
}

.guide {
  top: calc(-1 * var(--spacing-xs));
  height: calc(var(--size-star-input) + var(--spacing-sm));
  width: var(--stroke-rule);
  background: linear-gradient(to bottom, transparent, var(--color-accent));
  transform: translateX(-50%);
}

.rail {
  position: relative;
  display: block;
  height: calc(var(--size-rating-thumb) + var(--spacing-xs));
  margin-top: var(--spacing-sm);
}

.rail::before {
  position: absolute;
  top: 50%;
  right: 0;
  left: 0;
  height: var(--stroke-rule);
  content: '';
  background: var(--color-hairline-strong);
}

.notch {
  top: 50%;
  width: var(--stroke-rule);
  height: var(--spacing-sm);
  background: var(--color-ink-ghost);
  transform: translate(-50%, -50%);
}

.notch.whole {
  height: var(--spacing-ms);
  background: var(--color-ink-faint);
}

.notch.lit {
  background: var(--color-accent);
}

.thumb {
  top: 50%;
  width: var(--size-rating-thumb);
  height: var(--size-rating-thumb);
  border-radius: var(--radius-pill);
  background: var(--color-ink);
  box-shadow:
    0 0 0 var(--spacing-xs) var(--color-accent-soft),
    var(--shadow-button);
  transform: translate(-50%, -50%);
  transition:
    left var(--duration-quick) var(--ease-standard),
    background-color var(--duration-quick) var(--ease-standard);
}

/* Following the finger: no easing behind it. */
.dragging .thumb {
  transition: none;
}

.thumb.empty {
  background: var(--color-ink-ghost);
  box-shadow: none;
}

@media (prefers-reduced-motion: reduce) {
  .thumb {
    transition: none;
  }
}
</style>
