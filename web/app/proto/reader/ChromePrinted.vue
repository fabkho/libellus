<script setup lang="ts">
// c — Printed page. Where you are lives in the margins, as in a printed book:
// the chapter as a running head in the serif italic, the page as a folio in
// mono (drawn by Reader.vue into the paginator's own head and foot bands). On
// a wide screen two pages face each other across a soft gutter. So the chrome
// is only actions: a tap in the middle floats a small glass capsule up, as
// the tab bar floats elsewhere in the app — Back, Contents, the page, Aa.
import ProtoIcon from './ProtoIcon.vue'
import ProtoRound from './ProtoRound.vue'
import { durationToken, easingToken, prefersReducedMotion } from '~/utils/motion'
import { stepTick, tick } from '~/utils/haptics'
import type { ChromeInfo } from './types'

const props = defineProps<{
  shown: boolean
  info: ChromeInfo
  search: 'capsule' | 'morph' | 'palette'
  /** Where the chapters start (0–1), for the scrubber's ticks and its label. */
  chapters: { fraction: number; label: string }[]
  /** The page saved as progress (0–1), a faint tick on the scrubber. */
  saved: number | null
  /** The page the member was on when the scrubber opened, while she is elsewhere now. */
  origin: number | null
  reduceMotion: boolean
}>()
const emit = defineEmits<{ back: []; contents: []; type: []; search: []; setHere: []; scrub: [fraction: number, final: boolean]; returnToOrigin: [] }>()

// ------------------------------------------------------------ the scrubber
//
// The capsule's "12 % · 48 left" is where you are; tapped, the capsule grows
// into a slider across the column (the palette's clip-path morph, over
// `standard`), the page moving behind it as the thumb moves, a label over it
// saying the chapter and the page. "p. 12" at its left goes back to where you
// were; the check, a tap on the page, Back or Escape put it away.
// Press and hold anywhere on the capsule and slide: the same scrubber opens
// under the finger and follows it in one gesture (let go to stay there).
const scrubbing = defineModel<boolean>('scrubbing', { required: true })
const visible = ref(false)
const value = ref(0)
const dragging = ref(false)
const capsule = useTemplateRef<HTMLElement>('capsule')
const scrubber = useTemplateRef<HTMLElement>('scrubber')
const track = useTemplateRef<HTMLElement>('track')
let from: DOMRect | null = null

const shownValue = computed(() => (dragging.value ? value.value : props.info.fraction))
const pageOf = (f: number) => Math.max(1, Math.round(f * props.info.pages))
const chapterOf = (f: number) => [...props.chapters].reverse().find((c) => c.fraction <= f + 1e-6)?.label ?? null
const label = computed(() => {
  const f = shownValue.value
  const chapter = chapterOf(f)
  return `${chapter ? `${chapter} · ` : ''}p. ${pageOf(f)} of ${props.info.pages}`
})

const clipOf = (outer: DOMRect, inner: DOMRect) =>
  `inset(${inner.top - outer.top}px ${outer.right - inner.right}px ${outer.bottom - inner.bottom}px ${inner.left - outer.left}px round ${inner.height / 2}px)`

async function openScrubber() {
  tick()
  from = capsule.value?.getBoundingClientRect() ?? null
  scrubbing.value = true
}
watch(scrubbing, async (on) => {
  if (on) {
    if (!from) from = capsule.value?.getBoundingClientRect() ?? null
    visible.value = true
    await nextTick()
    const el = scrubber.value
    if (!el || !from || props.reduceMotion || prefersReducedMotion()) return
    const to = el.getBoundingClientRect()
    el.animate([{ clipPath: clipOf(to, from) }, { clipPath: `inset(0px 0px 0px 0px round ${to.height / 2}px)` }], {
      duration: durationToken('standard'),
      easing: easingToken('standard'),
    })
  } else if (visible.value) {
    const el = scrubber.value
    const target = capsule.value?.getBoundingClientRect()
    if (el && target && !props.reduceMotion && !prefersReducedMotion()) {
      const to = el.getBoundingClientRect()
      await el.animate([{ clipPath: `inset(0px 0px 0px 0px round ${to.height / 2}px)` }, { clipPath: clipOf(to, target) }], {
        duration: durationToken('exit'),
        easing: easingToken('standard'),
        fill: 'forwards',
      }).finished.catch(() => {})
    }
    visible.value = false
    from = null
  }
})
watch(
  () => props.shown,
  (shown) => {
    if (!shown) {
      scrubbing.value = false
      visible.value = false
    }
  },
)

// ------------------------------------------------------------ haptics (utils/haptics.ts, as the progress wheel)
//
// Dragging: a light tick per detent (each page in a short book; one every
// 1 % in a long one, so a fast drag is a purr, not a buzz — and never closer
// than STEP_GAP_MS), a firmer one where a chapter begins, and one at either
// end. Android vibrates; iOS has no Vibration API: it ticks only in taps
// (opening the slider, "p. 20"), never while a finger drags, as the wheel.
let lastDetent: number | null = null
let lastChapter: number | null = null
function chapterIndexOf(f: number) {
  let index = -1
  props.chapters.forEach((c, i) => {
    if (c.fraction <= f + 1e-6) index = i
  })
  return index
}
function feel(f: number, now: number) {
  const pages = props.info.pages
  const per = pages <= 200 ? 1 : Math.ceil(pages / 100)
  const detent = Math.round((f * pages) / per)
  const chapter = chapterIndexOf(f)
  if (lastDetent === null) {
    lastDetent = detent
    lastChapter = chapter
    return
  }
  if (chapter !== lastChapter) {
    lastChapter = chapter
    lastDetent = detent
    try {
      navigator.vibrate?.(18)
    } catch {
      // as utils/haptics: a nicety
    }
    return
  }
  if ((f <= 0 || f >= 1) && detent !== lastDetent) {
    lastDetent = detent
    try {
      navigator.vibrate?.(14)
    } catch {
      // as above
    }
    return
  }
  if (detent !== lastDetent) {
    lastDetent = detent
    stepTick(now)
  }
}
function resetFeel() {
  lastDetent = null
  lastChapter = null
}

let lastSent = 0
let trailing: ReturnType<typeof setTimeout> | undefined
/** The page behind follows the thumb, at most every 140 ms (a new chapter has to load); the last one always. */
function send(final: boolean) {
  clearTimeout(trailing)
  const now = performance.now()
  if (final || now - lastSent > 140) {
    lastSent = now
    emit('scrub', value.value, final)
  } else trailing = setTimeout(() => send(false), 140 - (now - lastSent))
}
function fractionAt(x: number) {
  const r = track.value?.getBoundingClientRect()
  if (!r || !r.width) return value.value
  return Math.min(1, Math.max(0, (x - r.left) / r.width))
}
function onTrackDown(event: PointerEvent) {
  try {
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  } catch {
    // A scripted pointer: the moves still arrive.
  }
  dragging.value = true
  resetFeel()
  value.value = fractionAt(event.clientX)
  feel(value.value, event.timeStamp)
  send(false)
}
function onTrackMove(event: PointerEvent) {
  if (!dragging.value) return
  value.value = fractionAt(event.clientX)
  feel(value.value, event.timeStamp)
  send(false)
}
function onTrackUp() {
  if (!dragging.value) return
  dragging.value = false
  resetFeel()
  send(true)
}
function onTrackKey(event: KeyboardEvent) {
  const step = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0
  const big = event.key === 'PageUp' ? 10 : event.key === 'PageDown' ? -10 : 0
  if (!step && !big) return
  event.preventDefault()
  value.value = Math.min(1, Math.max(0, props.info.fraction + (step || big) / props.info.pages))
  tick()
  send(true)
}

// Press and hold on the capsule, then slide.
let hold: { x: number; y: number; timer: ReturnType<typeof setTimeout>; id: number } | null = null
let holding = false
let swallowClick = false
function onCapsuleDown(event: PointerEvent) {
  if (scrubbing.value) return
  const target = event.currentTarget as HTMLElement
  hold = {
    x: event.clientX,
    y: event.clientY,
    id: event.pointerId,
    timer: setTimeout(async () => {
      hold = null
      holding = true
      swallowClick = true
      tick()
      resetFeel()
      try {
        target.setPointerCapture(event.pointerId)
      } catch {
        // as above
      }
      await openScrubber()
      await nextTick()
      dragging.value = true
      value.value = props.info.fraction
    }, 420),
  }
}
function onCapsuleMove(event: PointerEvent) {
  if (holding) {
    value.value = fractionAt(event.clientX)
    feel(value.value, event.timeStamp)
    send(false)
    return
  }
  if (hold && Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > 8) {
    clearTimeout(hold.timer)
    hold = null
  }
}
function onCapsuleUp() {
  if (hold) clearTimeout(hold.timer)
  hold = null
  if (holding) {
    holding = false
    dragging.value = false
    send(true)
  }
}
function onCapsuleClick(event: MouseEvent) {
  // The click that ends a hold is not a tap on the button under it.
  if (!swallowClick) return
  swallowClick = false
  event.stopPropagation()
  event.preventDefault()
}
</script>

<template>
  <div class="gutter pointer-events-none fixed inset-y-0 left-1/2 z-10" aria-hidden="true" />


  <Transition name="capsule">
    <div v-if="shown" class="capsule-wrap fixed inset-x-0 z-30 flex flex-col items-center gap-sm" data-testid="reader.capsule">
      <button
        v-if="info.behind"
        type="button"
        class="glass edge min-h-(--size-button-sm) rounded-pill px-md text-caption text-ink-muted shadow-float"
        data-testid="reader.setHere"
        @click="$emit('setHere')"
      >
        Your progress is at <span class="figures">p. {{ info.behind }}</span> · <span class="font-medium text-accent">Set to p. {{ info.page }}</span>
      </button>
      <!-- The search palette grows out of this capsule (BookSearch.vue), as the app's palette grows out of the tab bar. -->
      <!-- While the scrubber is open, its label stands where the progress note would. -->
      <p v-if="visible" class="glass edge figures flex min-h-(--size-button-sm) items-center rounded-pill px-md text-caption text-ink shadow-float" aria-live="polite" data-testid="reader.scrubLabel">
        {{ label }}
      </p>
      <nav
        ref="capsule"
        class="capsule glass edge flex h-(--size-tab-bar) items-center gap-xxs rounded-pill px-xs shadow-float"
        :class="(search === 'palette' || visible) && 'invisible'"
        data-reader-morph="capsule"
        @pointerdown="onCapsuleDown"
        @pointermove="onCapsuleMove"
        @pointerup="onCapsuleUp"
        @pointercancel="onCapsuleUp"
        @click.capture="onCapsuleClick"
      >
        <UiRoundButton data-reader-morph="item" icon="back" label="Back to the book" data-testid="reader.back" @click="$emit('back')" />
        <button
          type="button"
          class="figures min-h-(--size-touch) px-sm text-caption text-ink-muted"
          aria-label="Go to a page"
          data-reader-morph="item"
          data-testid="reader.where"
          @click="openScrubber"
        >
          {{ Math.round(info.fraction * 100) }} %<span class="text-ink-ghost"> · </span>{{ info.pages - info.page }} left
        </button>
        <ProtoRound label="Search in the book" data-reader-morph="search" :class="search === 'morph' && 'flying'" data-testid="reader.search" @click="$emit('search')"><ProtoIcon name="search" :size="19" /></ProtoRound>
        <ProtoRound data-reader-morph="item" label="Contents" data-testid="reader.contents" @click="$emit('contents')"><ProtoIcon name="contents" :size="20" /></ProtoRound>
        <ProtoRound data-reader-morph="item" label="Text and theme" data-testid="reader.type" @click="$emit('type')">
          <span class="book-title text-body-large">A<span class="text-caption">a</span></span>
        </ProtoRound>
      </nav>

      <!-- The scrubber: the capsule grown across the column. -->
      <section
        v-if="visible"
        ref="scrubber"
        class="scrubber glass edge absolute bottom-0 flex h-(--size-tab-bar) items-center gap-xs rounded-pill px-xs shadow-float"
        role="group"
        aria-label="Go to a page"
        data-testid="reader.scrubber"
      >
        <button
          v-if="origin !== null"
          type="button"
          class="figures flex min-h-(--size-touch) shrink-0 items-center gap-xxs rounded-pill pr-sm pl-xs text-caption text-accent"
          :aria-label="`Back to page ${origin}`"
          data-testid="reader.scrubBack"
          @click="tick(), $emit('returnToOrigin')"
        >
          <UiIcon name="repeat" :size="15" />p. {{ origin }}
        </button>
        <div
          ref="track"
          class="track relative h-(--size-touch) min-w-0 flex-1 cursor-pointer"
          :class="origin === null && 'ml-ms'"
          role="slider"
          tabindex="0"
          :aria-valuemin="1"
          :aria-valuemax="info.pages"
          :aria-valuenow="pageOf(shownValue)"
          :aria-valuetext="label"
          aria-label="Page"
          data-testid="reader.scrubTrack"
          :style="{ '--f': shownValue, '--s': saved ?? -1 }"
          @pointerdown="onTrackDown"
          @pointermove="onTrackMove"
          @pointerup="onTrackUp"
          @pointercancel="onTrackUp"
          @keydown="onTrackKey"
        >
          <span class="rule absolute inset-x-0 top-1/2 rounded-pill bg-hairline-strong" aria-hidden="true">
            <span class="fill absolute inset-y-0 left-0 rounded-pill bg-accent" />
          </span>
          <span v-for="(c, i) in chapters" :key="i" class="tick absolute top-1/2 bg-ink-ghost" :style="{ left: `${c.fraction * 100}%` }" aria-hidden="true" />
          <span v-if="saved !== null" class="tick saved absolute top-1/2 bg-ink-faint" aria-hidden="true" />
          <span class="thumb absolute top-1/2 rounded-pill bg-accent" :class="dragging && 'on'" aria-hidden="true" />
        </div>
        <UiRoundButton icon="check" label="Done" data-testid="reader.scrubDone" @click="scrubbing = false" />
      </section>
    </div>
  </Transition>
</template>

<style scoped>
/* Two facing pages: a soft crease down the gutter, like the spine crease on a cover. Only when the spread shows. */
.gutter {
  display: none;
  width: var(--spacing-xxl);
  transform: translateX(-50%);
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, var(--color-ink) 4%, transparent) 46%,
    color-mix(in srgb, var(--color-ink) 7%, transparent) 50%,
    color-mix(in srgb, var(--color-ink) 4%, transparent) 54%,
    transparent
  );
}
@media (orientation: landscape) and (min-width: 800px) {
  .gutter {
    display: block;
  }
}
/* While the palette's own magnifier flies, the capsule's stays hidden (one icon on screen). */
.flying :deep(svg) {
  visibility: hidden;
}
.capsule-wrap {
  bottom: var(--float-bottom);
}
.capsule {
  touch-action: none;
}
/* The scrubber spans the column, `ms` in from its sides, where the capsule stood. */
.scrubber {
  left: var(--spacing-ms);
  right: var(--spacing-ms);
  max-width: calc(var(--size-max-content) - 2 * var(--spacing-ms));
  margin-inline: auto;
}
.track {
  touch-action: none;
}
.track .rule {
  height: var(--stroke-focus);
  transform: translateY(-50%);
}
.track .fill {
  width: calc(var(--f) * 100%);
}
.track .tick {
  width: var(--stroke-hairline);
  height: var(--spacing-sm);
  transform: translate(-50%, -50%);
}
.track .tick.saved {
  left: calc(var(--s) * 100%);
  width: var(--stroke-focus);
  height: var(--spacing-ms);
  border-radius: var(--radius-pill);
}
.track .thumb {
  left: calc(var(--f) * 100%);
  width: var(--spacing-md);
  height: var(--spacing-md);
  transform: translate(-50%, -50%);
  box-shadow: 0 0 var(--spacing-sm) color-mix(in srgb, var(--color-accent) 45%, transparent);
  transition: transform var(--duration-quick) var(--ease-standard);
}
.track .thumb.on {
  transform: translate(-50%, -50%) scale(1.3);
}
.track:focus-visible {
  outline: none;
}
.track:focus-visible .thumb {
  outline: var(--stroke-focus) solid var(--color-accent);
  outline-offset: var(--spacing-xxs);
}
.capsule-enter-active {
  transition:
    opacity var(--duration-standard) var(--ease-standard),
    transform var(--duration-standard) var(--ease-standard);
}
.capsule-leave-active {
  transition:
    opacity var(--duration-exit) var(--ease-exit),
    transform var(--duration-exit) var(--ease-exit);
}
.capsule-enter-from,
.capsule-leave-to {
  opacity: 0;
  transform: translateY(var(--spacing-md));
}
</style>
