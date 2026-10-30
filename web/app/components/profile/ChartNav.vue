<script setup lang="ts">
// The chart's control (WP-08, the capsule): the mode and the navigator in one pill row. The inactive mode is a
// plain word (the whole half is its tap target); the inked one IS the stepper, ‹ the window's name ›, so the
// switch and the year/week control are one object. `label` is the window named short ("2026", "KW 13–25 · 2026").
//
// Motion is UiIconSegments' unfold (docs/MOTION.md, `standard`): switching modes folds the picked word away as
// the stepper unfolds where it was (a grid column 0fr → 1fr with the fade over it), the inked surface fading in,
// the halves reflowing on flex-grow. Stepping slides the label in from the side the window came from (`quick`),
// the arrows never moving. An arrow's press is a round dot under it, in at once (pointerdown, not `:active`, which
// comes too late on touch) and fading out on release. Reduce Motion is the app's own rule (main.css).
// A disabled end (nothing before her first finish, nothing after today) is faded.
import type { ChartMode } from '~/data/statsChart'

const props = defineProps<{
  mode: ChartMode
  /** The window, named short. */
  label: string
  /** The overview of all years is shown (the Months half): its name for a screen reader is "By year". */
  overview?: boolean
  canPrev: boolean
  canNext: boolean
  /** Which way the window last moved (a swipe on the chart too): the label slides in from that side. */
  direction: -1 | 1
}>()
const emit = defineEmits<{ mode: [mode: ChartMode]; step: [direction: -1 | 1] }>()
const { t } = useI18n()

const MODES = ['months', 'weeks'] as const

/** When the inked half changes sides, an arrow lands where the tapped mode name was; a second tap that
 * quick (a double tap, an impatient finger) must not step the window it just opened. */
let switchedAt = 0
function stepAfterSwitch(direction: -1 | 1) {
  if (Date.now() - switchedAt <= 400) return
  emit('step', direction)
}

/** The arrow under the finger (or the mouse button), from the moment it goes down: `:active` alone comes too
 * late on touch (Chromium sets it once the tap is recognised, after the finger has lifted), so a held arrow
 * showed nothing. `:active` still covers the keyboard (Space). A press the guard above swallows shows nothing. */
const pressing = ref<string | null>(null)
function press(which: string) {
  if (Date.now() - switchedAt > 400) pressing.value = which
}
function release() {
  pressing.value = null
}

function setMode(next: ChartMode) {
  if (props.mode === next) return
  switchedAt = Date.now()
  emit('mode', next)
}
</script>

<template>
  <!-- The inactive mode a plain word, the inked one the stepper. -->
  <div role="group" :aria-label="t('profile.chartMode.label')" class="capsule flex h-(--size-touch) rounded-pill border border-hairline-strong p-xxs" data-testid="profile.chart.capsule">
    <div v-for="m in MODES" :key="m" class="segment" :class="{ on: mode === m }">
      <!-- The word: the tap that picks this mode. It folds away (and out of reach) once picked. -->
      <button
        type="button"
        class="pick unfold target"
        :class="{ closed: mode === m }"
        :aria-pressed="mode === m"
        :tabindex="mode === m ? -1 : 0"
        :inert="mode === m || undefined"
        :data-testid="`profile.chart.mode.${m}`"
        @click="setMode(m)"
      >
        <span class="clip"><span class="word figures text-caption">{{ t(`profile.chartMode.${m}`) }}</span></span>
      </button>
      <!-- The stepper: the arrows and the window's name. It unfolds where the word was; folded (`inert`)
           while the mode is off, so its arrows are out of reach and out of the tab order. -->
      <span class="ctl unfold" :class="{ closed: mode !== m }" :inert="mode !== m || undefined">
        <span class="clip">
          <span class="stepper">
            <button
              type="button"
              class="step target"
              :class="{ pressing: pressing === `${m}.prev` }"
              :disabled="!canPrev"
              :aria-label="t('profile.prevRange')"
              :data-testid="mode === m ? 'profile.chart.prev' : undefined"
              @pointerdown="press(`${m}.prev`)"
              @pointerup="release"
              @pointercancel="release"
              @pointerleave="release"
              @click="stepAfterSwitch(-1)"
            >
              <UiIcon name="back" :size="15" />
            </button>
            <span class="fit figures" aria-live="polite" :data-testid="mode === m ? 'profile.chart.period' : undefined">
              <span class="sr-only">{{ m === 'weeks' ? t('profile.byWeek') : overview ? t('profile.byYear') : t('profile.byMonth') }} · </span>
              <Transition :name="direction > 0 ? 'step-fwd' : 'step-back'" mode="out-in">
                <span :key="label" class="whitespace-nowrap" :style="{ '--chars': label.length }">{{ label }}</span>
              </Transition>
            </span>
            <button
              type="button"
              class="step target"
              :class="{ pressing: pressing === `${m}.next` }"
              :disabled="!canNext"
              :aria-label="t('profile.nextRange')"
              :data-testid="mode === m ? 'profile.chart.next' : undefined"
              @pointerdown="press(`${m}.next`)"
              @pointerup="release"
              @pointercancel="release"
              @pointerleave="release"
              @click="stepAfterSwitch(1)"
            >
              <UiIcon name="chevron" :size="15" />
            </button>
          </span>
        </span>
      </span>
    </div>
  </div>
</template>

<style scoped>
/* A drawn control with the 44 px target centred on it (UiButton's rule). */
.target {
  position: relative;
  align-items: center;
}
.target::after {
  position: absolute;
  inset: 50% 0 auto;
  height: var(--size-touch);
  min-width: var(--size-touch);
  content: '';
  transform: translateY(-50%);
}

/* The capsule, animated as UiIconSegments (components/ui/IconSegments.vue): the halves reflow on
   flex-grow over `standard`, the inked one unfolds its stepper where the other's word folds away —
   a grid column 0fr → 1fr so the width animates without measuring, with the fade over it. The inked
   surface and the text colour fade in with the growth. Reduce Motion: main.css. */
.capsule .segment {
  display: flex;
  min-width: 0;
  overflow: hidden;
  /* The segment's width is the flex row's, never its content's: the label sizes against it (below). */
  container-type: inline-size;
  align-items: center;
  justify-content: center;
  flex: 1 1 0;
  border-radius: var(--radius-pill);
  transition:
    flex-grow var(--duration-standard) var(--ease-standard),
    background-color var(--duration-standard) var(--ease-standard),
    color var(--duration-quick) var(--ease-standard);
}
.capsule .segment.on {
  flex-grow: 2.3;
  background: var(--color-ink);
  color: var(--color-on-ink);
}
.unfold {
  display: grid;
  min-width: 0;
  /* Open, a half fills its segment: the whole inactive half is one tap target. */
  flex: 1 1 0;
  grid-template-columns: 1fr;
  opacity: 1;
  transition:
    flex-grow var(--duration-standard) var(--ease-standard),
    grid-template-columns var(--duration-standard) var(--ease-standard),
    opacity var(--duration-standard) var(--ease-standard);
}
.unfold.closed {
  flex-grow: 0;
  grid-template-columns: 0fr;
  opacity: 0;
}
.clip {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}
/* The stepper fills the half's height (not the label's line): the clip around it would otherwise cut
   the arrows' 32 px press dot to a 21 px band. */
.ctl {
  align-self: stretch;
}
.pick {
  height: 100%;
  color: var(--color-ink-muted);
}
.word {
  display: block;
  padding-inline: var(--spacing-ms);
  text-align: center;
}
.stepper {
  display: flex;
  height: 100%;
  align-items: center;
}
/* The arrows: 32 px drawn on the ink (44 px targets), a disabled end faded out. */
.step {
  display: flex;
  width: var(--size-button-sm);
  height: 100%;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  transition: opacity var(--duration-quick) var(--ease-standard);
}
/* The press: a round dot under the arrow, fully round as the selected half's tile
   (the same `radius-pill`), not a shape of its own. */
.step::before {
  position: absolute;
  top: 50%;
  left: 50%;
  width: var(--size-button-sm);
  height: var(--size-button-sm);
  border-radius: var(--radius-pill);
  content: '';
  transform: translate(-50%, -50%);
  transition: background-color var(--duration-quick) var(--ease-standard);
}
/* The arrow's icon stays above the press dot (both are positioned; the dot is the earlier one). */
.step :deep(svg) {
  position: relative;
}
.step::after {
  inset: 0 auto;
  height: 100%;
  transform: none;
}
.step:disabled {
  opacity: 0.3;
}
/* Pressed, the dot is there at once (as a row's fill, Columns); let go, it fades over `quick`. */
.step:not(:disabled):is(:active, .pressing)::before {
  background: color-mix(in srgb, var(--color-on-ink) 14%, transparent);
  transition: none;
}
/* The label keeps the subhead size and shrinks only where it would not fit (a year end at 360 px in
   English): Geist Mono's advance is 0.6 em, so the room over its characters gives the size, as the
   figures cells do. */
.fit {
  display: flex;
  min-width: 0;
  flex: 1;
  justify-content: center;
  line-height: var(--text-subhead--line-height);
}
.capsule .segment .fit > :last-child {
  font-size: min(var(--text-subhead), calc((100cqi - 2 * var(--size-button-sm) - var(--spacing-md)) / (var(--chars) * 0.6)));
}

/* Stepping the window: the label slides in from the side the window came from and the old one out
   the far side (`quick`), the arrows never moving. */
.step-fwd-enter-active,
.step-fwd-leave-active,
.step-back-enter-active,
.step-back-leave-active {
  transition:
    transform var(--duration-quick) var(--ease-standard),
    opacity var(--duration-quick) var(--ease-standard);
}
.step-fwd-enter-from {
  transform: translateX(8px);
  opacity: 0;
}
.step-fwd-leave-to {
  transform: translateX(-8px);
  opacity: 0;
}
.step-back-enter-from {
  transform: translateX(-8px);
  opacity: 0;
}
.step-back-leave-to {
  transform: translateX(8px);
  opacity: 0;
}
</style>
