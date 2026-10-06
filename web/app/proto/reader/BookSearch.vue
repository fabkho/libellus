<script setup lang="ts">
// Search in the book, as the app searches (grown out of c's capsule, or out of
// a's bottom bar, the magnifier flying in from a's top bar): D's upside-down
// palette at the bottom, the page behind it blurred and veiled, the query row
// at the thumb and the places above it — the next one after where you are
// right by the query, the rest further up, those before you after a "From the
// beginning" rule. A tap on a place goes there (outlined in the lamp colour)
// and the palette turns back into the capsule.
//
// The palette is the app's (components/shell/SearchOverlay.vue): the same
// parts and tokens, and the same morph — the palette is laid out at its open
// size from the first frame, a clip-path grows from the capsule's outline to
// the palette's, the magnifier flies from the capsule into the query row, the
// veil and the surface fade in; one Web Animations timeline per direction, so a
// close takes over from an opening wherever it is (and back). Reduce Motion:
// a cross-fade in place. In production SearchOverlay's palette and morph become
// one component both use (it is wired to the catalogue's store and the tab
// bar's Home and Library today, so the prototype carries a faithful copy).
import { durationToken, easingToken, prefersReducedMotion, timeAt } from '~/utils/motion'
import { paletteLift } from '~/utils/keyboard'
import type { ReaderEngine, SearchHit } from './engine'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ engine: ReaderEngine | null; initial: string; here: string | null; reduceMotion: boolean }>()
const emit = defineEmits<{ go: [cfi: string]; chrome: [state: 'capsule' | 'morph' | 'palette']; settled: [direction: 'open' | 'close'] }>()

const veil = useTemplateRef<HTMLElement>('veil')
const palette = useTemplateRef<HTMLElement>('palette')
const shade = useTemplateRef<HTMLElement>('shade')
const body = useTemplateRef<HTMLElement>('body')
const plate = useTemplateRef<HTMLElement>('plate')
const results = useTemplateRef<HTMLElement>('results')
const glyph = useTemplateRef<HTMLElement>('glyph')
const field = useTemplateRef<HTMLElement>('field')
const trail = useTemplateRef<HTMLElement>('trail')
const input = useTemplateRef<HTMLInputElement>('input')

const rendered = ref(false)
const closing = ref(false)

function close() {
  open.value = false
}
useBackDismiss(open, close)

// ------------------------------------------------------------ the search

const query = ref('')
const hits = ref<SearchHit[]>([])
const progress = ref<number | null>(null)
const searched = ref('')
let run = 0
let timer: ReturnType<typeof setTimeout> | undefined

async function search(q: string) {
  const engine = props.engine
  const id = ++run
  hits.value = []
  searched.value = q
  if (!engine || q.length < 2) {
    progress.value = null
    return
  }
  progress.value = 0
  engine.clearSearch()
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || '#b8782a'
  for await (const step of engine.search(q, accent)) {
    if (id !== run) return
    if ('hits' in step) hits.value = [...hits.value, ...step.hits]
    else progress.value = step.progress
  }
  if (id === run) progress.value = null
}
// The list keeps its foot (the next place, by the query) in view as places come in.
const listEl = useTemplateRef<HTMLElement>('listEl')
watch(
  () => hits.value.length,
  async () => {
    await nextTick()
    if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight
  },
)
watch(query, (q) => {
  clearTimeout(timer)
  timer = setTimeout(() => search(q.trim()), 260)
})

/** The next place after where you are first (it sits by the query), then on; the ones before you after the rule. */
const ordered = computed(() => {
  const here = props.here
  if (!here) return { ahead: hits.value, behind: [] as SearchHit[] }
  const ahead: SearchHit[] = []
  const behind: SearchHit[] = []
  for (const hit of hits.value) ((props.engine?.compareCfi(hit.cfi, here) ?? 1) >= 0 ? ahead : behind).push(hit)
  return { ahead, behind }
})

// ------------------------------------------------------------ the morph (SearchOverlay's)

type Direction = 'open' | 'close'
const STAGE = { plate: 0.35, row: 0.3, results: 0.7 } as const
let animations: Animation[] = []
let running: Direction | null = null

function shown(): number | null {
  const first = animations[0]
  if (!first) return null
  const progress = first.effect?.getComputedTiming().progress ?? 0
  return running === 'open' ? progress : 1 - progress
}
function oriented(frames: Keyframe[], direction: Direction): Keyframe[] {
  if (direction === 'open') return frames
  return frames.map((frame) => ({ ...frame, offset: 1 - (frame.offset ?? 0) })).reverse()
}
function lifted(element: HTMLElement): number {
  const transform = getComputedStyle(element).transform
  return transform && transform !== 'none' ? new DOMMatrixReadOnly(transform).m42 : 0
}

function morphFrames(): [HTMLElement | null, Keyframe[]][] {
  const fade = (from: number, to: number, at: number): Keyframe[] => [
    { opacity: from, offset: 0 },
    { opacity: from, offset: at },
    { opacity: to, offset: 1 },
  ]
  const veilFrames: Keyframe[] = [
    { opacity: 0, offset: 0 },
    { opacity: 1, offset: 1 },
  ]
  const capsule = document.querySelector<HTMLElement>('[data-reader-morph="capsule"]')
  const icon = document.querySelector<HTMLElement>('[data-reader-morph="search"] svg')
  const glyphIcon = glyph.value?.querySelector('svg')
  // Opened without the capsule (from selected words): fade in place.
  if (!capsule || !icon || !capsule.offsetParent || !body.value || !palette.value || !glyphIcon) {
    return [
      [veil.value, veilFrames],
      [palette.value, fade(0, 1, 0)],
    ]
  }
  const dy = lifted(palette.value)
  const box = body.value.getBoundingClientRect()
  const top = box.top - dy
  const bottom = box.bottom - dy
  const from = capsule.getBoundingClientRect()
  const radius = getComputedStyle(body.value).borderTopLeftRadius
  // A capsule is round at its ends; a bar (a's bottom bar) has its own corners.
  const fromRadius = Math.min(from.height / 2, Number.parseFloat(getComputedStyle(capsule).borderTopLeftRadius) || 0)
  const clip = (inset: string, round: string) => `inset(${inset} round ${round})`
  const outline = {
    x: from.left + from.width / 2 - (box.left + box.width / 2),
    y: from.top + from.height / 2 - (top + box.height / 2),
    scaleX: from.width / box.width,
    scaleY: from.height / box.height,
  }
  const start = icon.getBoundingClientRect()
  const end = glyphIcon.getBoundingClientRect()
  const travel = {
    x: start.left + start.width / 2 - (end.left + end.width / 2),
    y: start.top + start.height / 2 - (end.top - dy + end.height / 2),
    scale: start.width / end.width,
  }
  // The capsule's other buttons step back as the palette grows over them (they come back on the way down).
  const others = [...capsule.querySelectorAll<HTMLElement>('[data-reader-morph="item"]')]
  return [
    [veil.value, veilFrames],
    [
      body.value,
      [
        { clipPath: clip(`${from.top - top}px ${box.right - from.right}px ${bottom - from.bottom}px ${from.left - box.left}px`, `${fromRadius}px`), offset: 0 },
        { clipPath: clip('0px 0px 0px 0px', radius), offset: 1 },
      ],
    ],
    [
      plate.value,
      [
        { opacity: 0, offset: 0 },
        { opacity: 1, offset: STAGE.plate },
        { opacity: 1, offset: 1 },
      ],
    ],
    [
      shade.value,
      [
        { transform: `translate(${outline.x}px, ${outline.y}px) scale(${outline.scaleX}, ${outline.scaleY})`, opacity: 0, offset: 0 },
        { transform: 'none', opacity: 1, offset: 1 },
      ],
    ],
    [
      results.value,
      [
        { opacity: 0, offset: 0 },
        { opacity: 1, offset: STAGE.results },
        { opacity: 1, offset: 1 },
      ],
    ],
    [
      field.value,
      [
        { transform: `translate(${travel.x}px, ${travel.y}px)`, opacity: 0, offset: 0 },
        { opacity: 0, offset: STAGE.row },
        { transform: 'none', opacity: 1, offset: 1 },
      ],
    ],
    [trail.value, fade(0, 1, STAGE.row)],
    [
      glyph.value,
      [
        { transform: `translate(${travel.x}px, ${travel.y}px) scale(${travel.scale})`, color: getComputedStyle(icon).color, offset: 0 },
        { transform: 'none', color: getComputedStyle(glyph.value!).color, offset: 1 },
      ],
    ],
    ...others.map((el) => [el, fade(1, 0, 0).map((f, i) => (i === 1 ? { ...f, opacity: 0, offset: 0.25 } : f))] as [HTMLElement, Keyframe[]]),
  ]
}

function fadeFrames(): [HTMLElement | null, Keyframe[]][] {
  const fade: Keyframe[] = [
    { opacity: 0, offset: 0 },
    { opacity: 1, offset: 1 },
  ]
  return [
    [veil.value, fade],
    [palette.value, fade],
  ]
}

function play(direction: Direction) {
  const reduced = props.reduceMotion || prefersReducedMotion()
  const at = shown() ?? (direction === 'open' ? 0 : 1)
  for (const animation of animations) animation.cancel()
  emit('chrome', reduced ? 'capsule' : 'morph')
  running = direction
  const duration = reduced ? durationToken('standard') : durationToken(direction === 'open' ? 'overlay' : 'overlay-exit')
  const easing = easingToken('standard')
  const timing: KeyframeAnimationOptions = { duration, easing, fill: 'both' }
  const elapsed = duration * timeAt(easing, direction === 'open' ? at : 1 - at)
  const started: Animation[] = []
  for (const [element, frames] of reduced ? fadeFrames() : morphFrames()) {
    if (!element) continue
    const animation = element.animate(oriented(frames, direction), timing)
    animation.currentTime = elapsed
    started.push(animation)
  }
  animations = started
  const first = started[0]
  if (!first) return settle(direction)
  first.onfinish = () => {
    if (animations === started) settle(direction)
  }
}

function settle(direction: Direction) {
  for (const animation of animations) animation.cancel()
  animations = []
  running = null
  if (direction === 'open') emit('chrome', 'palette')
  else {
    emit('chrome', 'capsule')
    rendered.value = false
    closing.value = false
  }
  emit('settled', direction)
}

// ------------------------------------------------------------ keyboard, drag, Escape

const keyboard = useKeyboardInset(() => open.value)
const lift = computed(() => {
  if (!keyboard.value || !palette.value) return 0
  const resting = Number.parseFloat(getComputedStyle(palette.value).bottom) || 0
  const gap = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--spacing-sm')) || 0
  return paletteLift(keyboard.value, gap, resting)
})
const { handlers, offset, dragging } = useSwipeDown(close)
const paletteStyle = computed(() => ({
  transform: offset.value || lift.value ? `translateY(${offset.value - lift.value}px)` : undefined,
  transition: dragging.value ? 'none' : undefined,
  '--lift': `${lift.value}px`,
}))
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopImmediatePropagation()
    close()
  }
}

watch(open, async (isOpen) => {
  if (isOpen) {
    window.addEventListener('keydown', onKeydown, true)
    closing.value = false
    rendered.value = true
    if (props.initial && props.initial !== query.value) query.value = props.initial
    await nextTick()
    if (!open.value) return
    // Focus in the tap that opened it, so the keyboard rises with the palette.
    input.value?.focus({ preventScroll: true })
    await nextTick()
    if (open.value) play('open')
  } else if (rendered.value) {
    window.removeEventListener('keydown', onKeydown, true)
    closing.value = true
    input.value?.blur()
    await nextTick()
    if (!open.value) play('close')
  }
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown, true)
  for (const animation of animations) animation.cancel()
  clearTimeout(timer)
  run++
})

function pick(hit: SearchHit) {
  emit('go', hit.cfi)
  close()
}
</script>

<template>
  <template v-if="rendered">
    <button
      ref="veil"
      type="button"
      aria-label="Close search"
      class="veil fixed inset-0 z-30 bg-veil"
      :class="closing && 'pointer-events-none'"
      data-testid="bookSearch.backdrop"
      @click="close"
    />
    <section
      ref="palette"
      role="dialog"
      aria-modal="true"
      aria-label="Search in this book"
      class="palette float-bottom fixed inset-x-ms z-40 mx-auto max-w-(--size-max-content)"
      :class="closing && 'pointer-events-none'"
      :style="paletteStyle"
      data-testid="bookSearch"
      v-on="handlers"
    >
      <div ref="shade" class="pointer-events-none absolute inset-0 rounded-xl shadow-palette" aria-hidden="true" />
      <div ref="body" class="relative flex flex-col overflow-hidden rounded-xl">
        <div ref="plate" class="absolute inset-0 rounded-xl bg-surface-raised edge" aria-hidden="true" />

        <div ref="results" class="relative flex flex-col justify-end" aria-live="polite">
          <div ref="listEl" class="list overflow-y-auto overscroll-contain" data-testid="bookSearch.results">
            <p v-if="searched.length < 2" class="px-lg py-lg text-center text-caption text-ink-faint" data-testid="bookSearch.idle">
              Find a word or a name in this book.
            </p>
            <template v-else>
              <!-- Furthest at the top, the next place right above the query. -->
              <template v-if="ordered.behind.length">
                <button
                  v-for="(hit, i) in [...ordered.behind].reverse()"
                  :key="`b${i}${hit.cfi}`"
                  type="button"
                  class="hit block w-full px-md py-ms text-left hover:bg-fill active:bg-fill-strong"
                  @click="pick(hit)"
                >
                  <span class="eyebrow block">{{ hit.chapter }}</span>
                  <span class="excerpt book-title mt-xxs block text-subhead text-ink-muted">{{ hit.pre }}<mark>{{ hit.match }}</mark>{{ hit.post }}</span>
                </button>
                <p class="eyebrow flex items-center gap-sm px-md pt-sm pb-xs"><span class="h-(--stroke-hairline) flex-1 bg-hairline" />Before where you are<span class="h-(--stroke-hairline) flex-1 bg-hairline" /></p>
              </template>
              <button
                v-for="(hit, i) in [...ordered.ahead].reverse()"
                :key="`a${i}${hit.cfi}`"
                type="button"
                class="hit block w-full px-md py-ms text-left hover:bg-fill active:bg-fill-strong"
                :data-testid="i === ordered.ahead.length - 1 ? 'bookSearch.next' : undefined"
                @click="pick(hit)"
              >
                <span class="eyebrow block">{{ hit.chapter }}<template v-if="i === ordered.ahead.length - 1"> · next</template></span>
                <span class="excerpt book-title mt-xxs block text-subhead text-ink-muted">{{ hit.pre }}<mark>{{ hit.match }}</mark>{{ hit.post }}</span>
              </button>
              <p class="figures px-md pt-xs pb-sm text-meta text-ink-faint">
                <template v-if="progress !== null">Looking through the pages… {{ Math.round(progress * 100) }} %<template v-if="hits.length"> · {{ hits.length }} found</template></template>
                <template v-else-if="!hits.length">Nowhere in this book.</template>
                <template v-else>{{ hits.length }} {{ hits.length === 1 ? 'place' : 'places' }}</template>
              </p>
            </template>
          </div>
          <span v-if="progress !== null" class="sweep" aria-hidden="true" />
          <div class="h-(--stroke-hairline) shrink-0 bg-hairline" aria-hidden="true" />
        </div>

        <div class="relative flex h-(--size-query) shrink-0 items-center gap-sm pr-inset pl-md">
          <span ref="glyph" class="glyph flex shrink-0 text-accent"><UiIcon name="search" :size="19" /></span>
          <div ref="field" class="flex min-w-0 flex-1 items-center gap-sm">
            <input
              ref="input"
              v-model="query"
              type="search"
              inputmode="search"
              enterkeyhint="search"
              autocomplete="off"
              autocapitalize="off"
              autocorrect="off"
              spellcheck="false"
              aria-label="Search in this book"
              placeholder="Search in this book"
              class="min-w-0 flex-1 bg-transparent text-callout text-ink caret-accent outline-none placeholder:text-ink-faint [&::-webkit-search-cancel-button]:hidden"
              data-testid="bookSearch.query"
              @keydown.enter.prevent="search(query.trim())"
            />
            <button
              v-if="query"
              type="button"
              aria-label="Clear"
              class="relative flex size-ml shrink-0 items-center justify-center rounded-pill bg-fill-strong text-ink-muted after:absolute after:-inset-ms after:content-['']"
              data-testid="bookSearch.clear"
              @pointerdown.prevent
              @click="query = ''"
            >
              <UiIcon name="close" :size="13" bold />
            </button>
          </div>
          <div ref="trail" class="flex shrink-0 items-center gap-sm">
            <span class="ml-xs h-ml w-(--stroke-hairline) shrink-0 bg-hairline-strong" aria-hidden="true" />
            <button type="button" class="min-h-(--size-touch) shrink-0 pl-xs text-body text-ink-muted" data-testid="bookSearch.cancel" @pointerdown.prevent @click="close">
              {{ $t('common.cancel') }}
            </button>
          </div>
        </div>
      </div>
    </section>
  </template>
</template>

<style scoped>
.veil {
  -webkit-backdrop-filter: blur(var(--blur-veil));
  backdrop-filter: blur(var(--blur-veil));
}
.palette {
  touch-action: none;
  transition: transform var(--duration-keyboard) var(--ease-keyboard);
}
.glyph {
  transform-origin: center;
}
/* As tall as the room above the query allows (the palette's top stops under the status bar). */
.list {
  max-height: calc(100dvh - var(--bar-top) - var(--float-bottom) - var(--size-query) - var(--spacing-xl) - var(--lift, 0px));
  touch-action: pan-y;
}
.hit + .hit {
  border-top: var(--stroke-hairline) solid var(--color-hairline);
}
.excerpt {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
mark {
  color: var(--color-ink);
  background: var(--color-accent-soft);
  border-radius: var(--radius-cover-sm);
}
/* The palette's loading hairline (MOTION.md, Search loading): a lamp line sweeping along the edge above the query. */
.sweep {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 30%;
  height: var(--stroke-rule);
  background: linear-gradient(90deg, transparent, var(--color-accent), transparent);
  animation: sweep calc(var(--duration-caret) * 1.2) var(--ease-standard) infinite;
}
@keyframes sweep {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(340%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .sweep {
    display: none;
  }
}
</style>
