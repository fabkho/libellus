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
import { SEARCH_DEBOUNCE_MS } from '~/data/search'
import BookLoading from './BookLoading.vue'
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
//
// As the app's search (components/search/Results.vue): the query goes out after
// the typing pause; nothing shows for that pause and a `quick` more, so a book
// that answers at once shows no loading at all; until the first places come the
// riffling book and the lamp hairline say it is looking; a newer query dims the
// places on screen to 60 % instead of emptying them, and its own replace them
// when they come; the palette glides to its new height over `standard`, growing
// up from the query; the first places rise in one after another.

const query = ref('')
const hits = ref<SearchHit[]>([])
/** The book is still being searched (places may still come). */
const searching = ref(false)
/** A newer query is on its way: the places on screen belong to the last one. */
const outdated = ref(false)
const searched = ref('')
let run = 0
let timer: ReturnType<typeof setTimeout> | undefined

async function search(q: string) {
  const engine = props.engine
  const id = ++run
  clearTimeout(timer)
  if (!engine || q.length < 2) {
    hits.value = []
    searched.value = ''
    searching.value = false
    outdated.value = false
    return
  }
  searching.value = true
  engine.clearSearch()
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || '#b8782a'
  let first = true
  for await (const step of engine.search(q, accent)) {
    if (id !== run) return
    if (!('hits' in step)) continue
    if (first) {
      // The first places of the new query take the old ones' place.
      hits.value = step.hits
      searched.value = q
      outdated.value = false
      first = false
    } else hits.value = [...hits.value, ...step.hits]
  }
  if (id !== run) return
  if (first) {
    hits.value = []
    searched.value = q
    outdated.value = false
  }
  searching.value = false
}
watch(query, (q) => {
  clearTimeout(timer)
  const text = q.trim()
  if (text.length < 2) return void search('')
  if (hits.value.length) outdated.value = true
  timer = setTimeout(() => search(text), SEARCH_DEBOUNCE_MS)
})

type State = 'idle' | 'loading' | 'results' | 'none'
const state = computed<State>(() => {
  if (query.value.trim().length < 2) return 'idle'
  if (hits.value.length) return 'results'
  if (searching.value || outdated.value || searched.value !== query.value.trim()) return 'loading'
  return 'none'
})

/** The next place after where you are first (by the query), on to the end; then, after the rule, from the beginning. */
const ordered = computed(() => {
  const here = props.here
  if (!here) return { ahead: hits.value, behind: [] as SearchHit[] }
  const ahead: SearchHit[] = []
  const behind: SearchHit[] = []
  for (const hit of hits.value) ((props.engine?.compareCfi(hit.cfi, here) ?? 1) >= 0 ? ahead : behind).push(hit)
  return { ahead, behind }
})

const loadingWait = SEARCH_DEBOUNCE_MS + durationToken('quick')
const room = useTemplateRef<HTMLElement>('room')
let heightBefore = 0
let cameFrom: State | null = null
let gliding: Animation | undefined
const arriving = ref(false)
let arrivingTimer: ReturnType<typeof setTimeout> | undefined
watch(
  state,
  (_next, previous) => {
    heightBefore = room.value?.offsetHeight ?? 0
    cameFrom = previous ?? null
  },
  { flush: 'pre' },
)
watch(
  state,
  (next) => {
    const el = room.value
    if (!el || props.reduceMotion || prefersReducedMotion()) return
    if (next === 'results' && cameFrom !== 'results') {
      arriving.value = true
      clearTimeout(arrivingTimer)
      arrivingTimer = setTimeout(() => (arriving.value = false), durationToken('standard') * 3)
    }
    const heightAfter = el.offsetHeight
    gliding?.cancel()
    if (!heightBefore || heightBefore === heightAfter) return
    gliding = el.animate(
      [
        { height: `${heightBefore}px`, overflow: 'hidden' },
        { height: `${heightAfter}px`, overflow: 'hidden' },
      ],
      { duration: durationToken('standard'), easing: easingToken('standard'), delay: next === 'loading' ? loadingWait : 0, fill: 'backwards' },
    )
  },
  { flush: 'post' },
)

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
  clearTimeout(arrivingTimer)
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

        <div ref="results" class="relative flex flex-col justify-end">
          <div ref="room" class="relative flex min-h-0 flex-col" aria-live="polite" data-testid="bookSearch.results">
            <p v-if="state === 'idle'" class="px-lg py-lg text-center text-caption text-ink-faint" data-testid="bookSearch.idle">
              Find a word or a name in this book.
            </p>

            <!-- Leaves over the places arriving where it stood. -->
            <Transition name="loading">
              <BookLoading v-if="state === 'loading'" text="Looking through the pages…" :style="{ '--loading-wait': `${loadingWait}ms` }" />
            </Transition>

            <!-- Reversed, as the app's list: the next place at the bottom by the query, the far end fading out at the top. -->
            <ol
              v-if="state === 'results'"
              class="list flex flex-col-reverse overflow-y-auto overscroll-contain py-xs transition-opacity duration-(--duration-standard) ease-standard"
              :class="[outdated && 'opacity-60', arriving && 'arriving']"
              :aria-busy="outdated"
              data-no-swipe
            >
              <li v-for="(hit, i) in ordered.ahead" :key="`a${i}${hit.cfi}`" :style="i < 5 ? { '--n': i } : undefined">
                <button
                  type="button"
                  class="hit block w-full px-md py-ms text-left hover:bg-fill active:bg-fill-strong"
                  :data-testid="i === 0 ? 'bookSearch.next' : undefined"
                  @click="pick(hit)"
                >
                  <span class="eyebrow block">{{ hit.chapter }}<template v-if="i === 0"> · next</template></span>
                  <span class="excerpt book-title mt-xxs block text-subhead text-ink-muted">{{ hit.pre }}<mark>{{ hit.match }}</mark>{{ hit.post }}</span>
                </button>
              </li>
              <li v-if="ordered.behind.length" class="eyebrow flex items-center gap-sm px-md pt-sm pb-xs" aria-hidden="true">
                <span class="h-(--stroke-hairline) flex-1 bg-hairline" />From the beginning<span class="h-(--stroke-hairline) flex-1 bg-hairline" />
              </li>
              <li v-for="(hit, i) in ordered.behind" :key="`b${i}${hit.cfi}`" :style="!ordered.ahead.length && i < 5 ? { '--n': i } : undefined">
                <button type="button" class="hit block w-full px-md py-ms text-left hover:bg-fill active:bg-fill-strong" @click="pick(hit)">
                  <span class="eyebrow block">{{ hit.chapter }}</span>
                  <span class="excerpt book-title mt-xxs block text-subhead text-ink-muted">{{ hit.pre }}<mark>{{ hit.match }}</mark>{{ hit.post }}</span>
                </button>
              </li>
              <!-- Last in a reversed list: the far end, padded below the fade. -->
              <li class="figures px-md pt-xxl pb-xs text-center text-meta text-ink-faint" data-testid="bookSearch.count">
                {{ hits.length }} {{ hits.length === 1 ? 'place' : 'places' }} in this book<template v-if="searching"> so far</template>
              </li>
            </ol>

            <div v-else-if="state === 'none'" class="px-ml pt-ml pb-md" data-testid="bookSearch.none">
              <p class="text-callout font-medium">Nowhere in this book</p>
              <p class="mt-xs text-subhead text-ink-muted">“{{ searched }}” does not come up in it.</p>
              <p class="mt-md text-subhead text-ink-faint">Try fewer letters, or another spelling.</p>
            </div>
          </div>
          <!-- Still looking, with places already there: the lamp hairline keeps sweeping above the query. -->
          <span v-if="state === 'results' && searching" class="sweep" aria-hidden="true" />
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
              @keydown.enter.prevent="(outdated = hits.length > 0), search(query.trim())"
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
/* As tall as the room above the query allows (the palette's top stops under the status bar); the far end fades out. */
.list {
  max-height: calc(100dvh - var(--bar-top) - var(--float-bottom) - var(--size-query) - var(--spacing-xl) - var(--lift, 0px));
  touch-action: pan-y;
  -webkit-mask-image: linear-gradient(to bottom, transparent, black var(--spacing-xxl));
  mask-image: linear-gradient(to bottom, transparent, black var(--spacing-xxl));
}
.list > li + li .hit {
  border-bottom: var(--stroke-hairline) solid var(--color-hairline);
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
/* The loading state leaves over the room the places arrive in, fading, so the first rows rise in where it stood. */
.loading-leave-active {
  position: absolute;
  inset: auto 0 0;
  transition: opacity var(--duration-exit) var(--ease-exit);
}
.loading-leave-to {
  opacity: 0;
}
/* The nearest places (the bottom rows) land one after the other; the others are simply there. */
.arriving > li[style] {
  animation: row-arrive var(--duration-standard) var(--ease-standard) calc(var(--n) * var(--duration-instant) * 0.5) both;
}
@keyframes row-arrive {
  from {
    opacity: 0;
    translate: 0 var(--spacing-sm);
  }
}
/* The lamp hairline on the divider, while more places may come (Loading.vue's sweep). */
.sweep {
  position: absolute;
  inset: auto 0 0;
  height: var(--stroke-rule);
  overflow: hidden;
}
.sweep::after {
  content: '';
  position: absolute;
  inset: 0;
  width: 40%;
  background: linear-gradient(90deg, transparent, var(--color-accent), transparent);
  animation: sweep calc(var(--duration-caret) * 1.6) var(--ease-standard) infinite;
}
@keyframes sweep {
  from {
    translate: -100% 0;
  }
  to {
    translate: 250% 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .sweep {
    display: none;
  }
}
</style>
