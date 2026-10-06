<script setup lang="ts">
// The number wheel of the Update progress sheet (issue #68, direction D): a drum
// of whole numbers the finger turns. The centre row is the value, large in thin
// figures on a filled band between two hairlines; the rows above and below turn
// away and fade. Only the rows near the centre exist, so a 99,999-page total
// costs what a 100 % one does.
//
// Its own touch handling, not the page's scrolling: a drag follows the finger 1:1
// (pointer capture, `touch-action: none`, so neither the page nor the sheet's
// swipe-down takes it), a flick coasts on and lands exactly on a number, past
// either end it gives way and springs back (utils/wheel.ts). A tick for each
// number that passes the centre where the device vibrates (utils/haptics.ts,
// `stepTick`, throttled). A tap on the centre types the number instead (the
// numeric keyboard, Enter or leaving keeps it, Escape does not); a tap above or
// below steps there. For the keyboard and assistive tech it is a vertical
// `slider` (Android maps it to a SeekBar, which TalkBack adjusts with a swipe up
// or down and reads with its value text; a `spinbutton` became an edit box that
// TalkBack could not turn): arrows ±1 (up is more), Page Up/Down ±10, Home/End
// the ends, a digit or Enter starts typing.
import { stepTick } from '~/utils/haptics'
import { prefersReducedMotion } from '~/utils/motion'
import { FOLLOW_MS, TAP_MS, TAP_SLOP_PX, decayAt, flingTarget, releaseSpeed, rubberBand, tappedRow, valueAt } from '~/utils/wheel'

const props = withDefaults(
  defineProps<{
    min?: number
    max: number
    /** Drawn after each number, smaller ("%"). */
    suffix?: string
    /** The accessible name. */
    label: string
    /** What assistive tech reads for the value ("p. 212 of 608"); the number by default. */
    valueText?: string
    disabled?: boolean
    testid: string
  }>(),
  { min: 0, suffix: '', valueText: undefined, disabled: false },
)
const model = defineModel<number>({ required: true })

const { t, n } = useI18n()

const drum = useTemplateRef<HTMLElement>('drum')
const input = useTemplateRef<HTMLInputElement>('input')

/** One row's height in px: the touch size, read once the wheel is on screen. */
const row = ref(44)
const last = computed(() => Math.max(0, props.max - props.min))
const indexOf = (value: number) => Math.min(Math.max(value - props.min, 0), last.value)

/** Where the drum is, in rows (0: the first number at the centre). */
const pos = ref(indexOf(model.value))
/** The value last given out, so a change from outside can be told from our own. */
let emitted = model.value

onMounted(() => {
  row.value = Number.parseFloat(getComputedStyle(drum.value!).getPropertyValue('--size-touch')) || row.value
})

/**
 * Moves the drum. When the member moves it, a new number at the centre is given
 * out and ticks (`now`: the event's time); when it only follows a value set from
 * outside (`follow`), it gives nothing out, so a value set meanwhile stands.
 */
function show(at: number, now: number | null, follow = false) {
  pos.value = at
  if (follow) return
  const value = valueAt(at, props.min, props.max)
  if (value === emitted) return
  emitted = value
  model.value = value
  if (now !== null) stepTick(now)
}

// ------------------------------------------------------------------ coasting

let frame = 0
function stop() {
  if (frame) cancelAnimationFrame(frame)
  frame = 0
}

/**
 * Coasts from where the drum is to a row, slowing down: the member's fling or
 * snap (`member`: numbers given out and ticked as they pass), or the drum
 * following a value set from outside.
 */
function coastTo(target: number, member: boolean) {
  stop()
  const from = pos.value
  if (from === target || prefersReducedMotion()) return show(target, null, !member)
  const start = performance.now()
  const step = (now: number) => {
    const at = decayAt(from, target, now - start, member ? undefined : FOLLOW_MS)
    show(at, member ? now : null, !member)
    frame = at === target ? 0 : requestAnimationFrame(step)
  }
  frame = requestAnimationFrame(step)
}

/** A value set from outside (− / +, typing, switching Pages | Percent) turns the drum there. */
watch(model, (value) => {
  if (value === emitted) return
  emitted = value
  const target = indexOf(value)
  // A long way (a page turned into a percent): there at once, not a blur of numbers.
  if (Math.abs(target - pos.value) > 60) {
    stop()
    pos.value = target
  } else coastTo(target, false)
})
watch(
  () => [props.min, props.max],
  () => {
    stop()
    pos.value = indexOf(model.value)
  },
)
onBeforeUnmount(stop)

// --------------------------------------------------------------------- touch

let drag: { id: number; y: number; from: number; at: number; time: number; moved: boolean; samples: { t: number; at: number }[] } | null = null

function onPointerdown(event: PointerEvent) {
  if (props.disabled || typing.value || drag) return
  if (event.pointerType === 'mouse' && event.button !== 0) return
  stop()
  drum.value?.setPointerCapture?.(event.pointerId)
  drag = { id: event.pointerId, y: event.clientY, from: pos.value, at: pos.value, time: event.timeStamp, moved: false, samples: [{ t: event.timeStamp, at: pos.value }] }
}

function onPointermove(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.id) return
  const dy = event.clientY - drag.y
  if (Math.abs(dy) > TAP_SLOP_PX) drag.moved = true
  if (!drag.moved) return
  // The finger going up brings the larger numbers (below the centre) up to it.
  drag.at = drag.from - dy / row.value
  drag.samples.push({ t: event.timeStamp, at: drag.at })
  if (drag.samples.length > 12) drag.samples.shift()
  show(rubberBand(drag.at, last.value), event.timeStamp)
}

function onPointerup(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.id) return
  const ended = drag
  drag = null
  if (!ended.moved && event.timeStamp - ended.time < TAP_MS) return tap(event)
  const speed = releaseSpeed(ended.samples, event.timeStamp)
  // Out past an end, it springs back to the end whatever the speed.
  const inside = ended.at >= 0 && ended.at <= last.value
  coastTo(flingTarget(pos.value, inside ? speed : 0, last.value), true)
}

function onPointercancel(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.id) return
  drag = null
  coastTo(flingTarget(pos.value, 0, last.value), true)
}

/** A tap: on the centre row it types; above or below, it steps there. */
function tap(event: PointerEvent) {
  const rect = drum.value!.getBoundingClientRect()
  const rows = tappedRow(event.clientY - (rect.top + rect.height / 2), row.value)
  if (rows === 0) return startTyping()
  model.value = Math.min(Math.max(model.value + rows, props.min), props.max)
  stepTick(event.timeStamp)
}

// A mouse wheel or a trackpad turns it too, and settles on a number once it rests.
let resting: ReturnType<typeof setTimeout> | undefined
function onWheel(event: WheelEvent) {
  if (props.disabled || typing.value) return
  event.preventDefault()
  stop()
  const rows = event.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? event.deltaY / row.value : event.deltaY
  show(Math.min(Math.max(pos.value + rows, 0), last.value), event.timeStamp)
  clearTimeout(resting)
  resting = setTimeout(() => coastTo(flingTarget(pos.value, 0, last.value), true), 120)
}
onBeforeUnmount(() => clearTimeout(resting))

// ------------------------------------------------------------------ keyboard

function onKeydown(event: KeyboardEvent) {
  if (props.disabled) return
  const moves: Record<string, number> = {
    ArrowUp: model.value + 1,
    ArrowRight: model.value + 1,
    ArrowDown: model.value - 1,
    ArrowLeft: model.value - 1,
    PageUp: model.value + 10,
    PageDown: model.value - 10,
    Home: props.min,
    End: props.max,
  }
  const to = moves[event.key]
  if (to !== undefined) {
    event.preventDefault()
    model.value = Math.min(Math.max(to, props.min), props.max)
    return
  }
  if (event.key === 'Enter' || /^\d$/.test(event.key)) {
    event.preventDefault()
    startTyping(event.key === 'Enter' ? undefined : event.key)
  }
}

// -------------------------------------------------------------------- typing

const typing = ref(false)
const field = ref('')

/**
 * Types the number instead. The field is always there (unseen until now), so it
 * is focused within the tap itself and the phone raises its keyboard. It starts
 * empty, the current number as its placeholder, so what is typed replaces it
 * (a selection is not reliable under a phone's keyboard); left empty, the number
 * stays.
 */
function startTyping(first?: string) {
  if (props.disabled) return
  stop()
  field.value = first ?? ''
  typing.value = true
  input.value?.focus()
}

/** Leaves typing: what was typed becomes the value (within the ends) unless it is dropped. */
function stopTyping(keep: boolean) {
  if (!typing.value) return
  typing.value = false
  const text = field.value.trim()
  if (keep && /^\d{1,9}$/.test(text)) model.value = Math.min(Math.max(Number(text), props.min), props.max)
}

function onInputKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault()
    stopTyping(true)
    drum.value?.focus()
  } else if (event.key === 'Escape') {
    // The sheet would close on it: only typing does.
    event.preventDefault()
    event.stopPropagation()
    stopTyping(false)
    drum.value?.focus()
  }
}

// ------------------------------------------------------------------- drawing

/** The rows near the centre: three either side is past the fade. */
const rows = computed(() => {
  const from = Math.max(0, Math.floor(pos.value) - 3)
  const to = Math.min(last.value, Math.ceil(pos.value) + 3)
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i)
})
const centre = computed(() => Math.min(Math.max(Math.round(pos.value), 0), last.value))

function rowStyle(i: number) {
  const d = i - pos.value
  const away = Math.min(Math.abs(d), 2.6)
  return {
    transform: `translateY(${d * row.value}px) perspective(400px) rotateX(${-d * 20}deg) scale(${1 - away * 0.12})`,
    opacity: String(Math.max(0, 1 - away * 0.36)),
  }
}
</script>

<template>
  <div class="relative" :class="disabled && 'opacity-50'">
    <div
      ref="drum"
      class="drum relative"
      role="slider"
      aria-orientation="vertical"
      :tabindex="disabled ? -1 : 0"
      :aria-label="label"
      :aria-valuemin="min"
      :aria-valuemax="max"
      :aria-valuenow="model"
      :aria-valuetext="valueText ?? `${n(model)}${suffix ? ` ${suffix}` : ''}`"
      :aria-disabled="disabled || undefined"
      :aria-describedby="`${testid}-hint`"
      data-no-swipe
      :data-testid="testid"
      @pointerdown="onPointerdown"
      @pointermove="onPointermove"
      @pointerup="onPointerup"
      @pointercancel="onPointercancel"
      @lostpointercapture="onPointercancel"
      @wheel="onWheel"
      @keydown="onKeydown"
    >
      <span class="band" aria-hidden="true" />
      <span
        v-for="i in rows"
        :key="i"
        class="row figures"
        :class="[i === centre ? 'text-ink' : 'text-ink-muted', typing && i === centre && 'invisible']"
        :style="rowStyle(i)"
        aria-hidden="true"
      >
        {{ n(i + min) }}<span v-if="suffix" class="suffix">{{ suffix }}</span>
      </span>
      <span class="fade" aria-hidden="true" />
      <span :id="`${testid}-hint`" class="sr-only">{{ t('book.progress.wheelHint') }}</span>
    </div>
    <input
      ref="input"
      v-model="field"
      class="typing figures"
      :class="typing && 'on'"
      type="text"
      inputmode="numeric"
      enterkeyhint="done"
      autocomplete="off"
      maxlength="9"
      tabindex="-1"
      :aria-label="label"
      :placeholder="n(model)"
      :aria-hidden="!typing || undefined"
      :data-testid="`${testid}Input`"
      @blur="stopTyping(true)"
      @keydown="onInputKeydown"
    />
  </div>
</template>

<style scoped>
.drum {
  height: calc(var(--size-touch) * 5);
  overflow: hidden;
  cursor: ns-resize;
  outline: none;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
}
.drum:focus-visible {
  border-radius: var(--radius-md);
  outline: var(--stroke-focus) solid var(--color-accent-ink);
}
/* The centre: a filled band between two hairlines, a little taller than a row. */
.band {
  position: absolute;
  top: 50%;
  right: 0;
  left: 0;
  height: calc(var(--size-touch) + var(--spacing-sm));
  border-block: var(--stroke-hairline) solid var(--color-hairline-strong);
  border-radius: var(--radius-sm);
  background: var(--color-fill);
  transform: translateY(-50%);
  pointer-events: none;
}
.row {
  position: absolute;
  top: 50%;
  right: 0;
  left: 0;
  display: flex;
  height: var(--size-touch);
  margin-top: calc(var(--size-touch) / -2);
  align-items: center;
  justify-content: center;
  font-size: var(--text-figure);
  font-weight: 300;
  letter-spacing: var(--text-figure--letter-spacing);
  line-height: var(--size-touch);
  pointer-events: none;
  backface-visibility: hidden;
  will-change: transform;
}
.suffix {
  margin-left: var(--spacing-xs);
  font-size: var(--text-title);
}
/* The rows turn away into the sheet. */
.fade {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to bottom,
    var(--color-surface-sheet),
    transparent 32%,
    transparent 68%,
    var(--color-surface-sheet)
  );
  pointer-events: none;
}
/* Always there, unseen until the centre is tapped, so it can take focus within the tap. */
.typing {
  position: absolute;
  top: 50%;
  right: var(--spacing-sm);
  left: var(--spacing-sm);
  height: var(--size-touch);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-accent);
  font-size: var(--text-figure);
  font-weight: 300;
  letter-spacing: var(--text-figure--letter-spacing);
  text-align: center;
  caret-color: var(--color-accent);
  opacity: 0;
  outline: none;
  pointer-events: none;
  transform: translateY(-50%);
}
.typing.on {
  opacity: 1;
  pointer-events: auto;
}
.typing::placeholder {
  color: var(--color-ink-faint);
}
</style>
