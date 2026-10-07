<script setup lang="ts">
// Search as an overlay, never a page (issue #1, Screens and navigation; D's
// DECISIONS.md). The tab bar's place is taken by D's upside-down command
// palette over whatever page is showing, which stays behind it, blurred and
// veiled. The bottom row keeps Home and Library at the left (the current tab
// stays lit) and the query takes the rest; while the query has the keyboard,
// Cancel replaces the tabs. Above the query is where results go: the default
// slot, best match at the bottom next to the query (#6, #12 fill it). Until
// then the slot shows a line saying search is coming.
//
// Closed by Cancel, a tap on the page behind, swiping the palette down, Escape,
// the system Back (Android's back gesture, useBackDismiss.ts), or going to
// another page.
//
// Motion (docs/MOTION.md, Search morph): the tab bar's capsule turns into the
// palette and back. The palette is laid out at its open size from the first
// frame; what moves is a clip-path that grows from the capsule's outline to the
// palette's (the results unroll upwards inside it), the Search icon flying from
// the capsule into the query row, and opacities. Everything runs on one Web
// Animations timeline per direction, so a close can take over from an opening
// at whatever point it has reached, and the other way round.
//
// The room (composables/usePaletteRoom.ts): the palette's boxes are as tall as
// the palette may grow, from the moment it opens, and the results and the query
// stand at their bottom. How much of it the content fills is drawn, not laid out:
// the surface, its shadow and its clip follow `--palette-gap`, the empty room
// above the content, measured whenever the content changes. A palette that grew
// with its results moved its boxes upwards with every answer, and the browser
// counted each answer as a layout shift of the whole palette (CLS 1.0 on the
// Library, with the shadow as its largest shift).
import { useSearchStore } from '~/stores/search'
import { paletteLift } from '~/utils/keyboard'
import { contentTop, PALETTE_ROOM, ROOM_ATTRIBUTE } from '~/composables/usePaletteRoom'

const { t } = useI18n()
const route = useRoute()
const search = useSearchStore()
const chrome = useSearchChrome()

const veil = useTemplateRef<HTMLElement>('veil')
const palette = useTemplateRef<HTMLElement>('palette')
const shade = useTemplateRef<HTMLElement>('shade')
const body = useTemplateRef<HTMLElement>('body')
const plate = useTemplateRef<HTMLElement>('plate')
const results = useTemplateRef<HTMLElement>('results')
const lead = useTemplateRef<HTMLElement>('lead')
const glyph = useTemplateRef<HTMLElement>('glyph')
const field = useTemplateRef<HTMLElement>('field')
const trail = useTemplateRef<HTMLElement>('trail')
const input = useTemplateRef<HTMLInputElement>('input')

// ------------------------------------------------------------ the room

/** The empty room above the content, in px, as last drawn. */
let gap = 0
/** The next change of the gap glides (Results asks for it between loading and results), after this many ms. */
let glideDelay: number | null = null
let gliding: Animation | null = null

/** Draws the content's height: the gap above it, at once or gliding there. */
function drawGap(next: number) {
  const section = palette.value
  if (!section) return
  const glide = glideDelay !== null || gliding?.playState === 'running'
  const delay = glideDelay ?? 0
  glideDelay = null
  if (next === gap) return
  // From where it is drawn now: a glide that is still on its way is taken over.
  const from = gliding?.playState === 'running' ? getComputedStyle(section).getPropertyValue('--palette-gap').trim() || `${gap}px` : `${gap}px`
  gliding?.cancel()
  gliding = null
  gap = next
  section.style.setProperty('--palette-gap', `${next}px`)
  if (!glide || prefersReducedMotion() || running) return
  gliding = section.animate([{ '--palette-gap': from }, { '--palette-gap': `${next}px` }], {
    duration: durationToken('standard'),
    easing: easingToken('standard'),
    delay,
    fill: 'backwards',
  })
}

/** Measures how much of the room the content fills, and draws it. */
function measureRoom() {
  if (!body.value || !results.value) return
  const box = body.value.getBoundingClientRect()
  drawGap(Math.max(0, Math.round(contentTop(results.value) - box.top)))
}

provide(PALETTE_ROOM, {
  glide(delay = 0) {
    glideDelay = delay
  },
})

// The content changes (results arrive, a state replaces another) or a row changes size: measured
// again before the frame is drawn (mutations as a microtask, sizes in the frame's resize step).
let mutations: MutationObserver | null = null
let sizes: ResizeObserver | null = null
/** Watches the body and every child of a room, the boxes whose tops make the content's. */
function watchSizes() {
  if (!sizes || !body.value || !results.value) return
  sizes.disconnect()
  sizes.observe(body.value)
  const rooms = [results.value, ...results.value.querySelectorAll(`[${ROOM_ATTRIBUTE}]`)]
  for (const room of rooms) for (const child of room.children) sizes.observe(child)
}
watch(results, (element) => {
  mutations?.disconnect()
  sizes?.disconnect()
  mutations = sizes = null
  if (!element || typeof MutationObserver === 'undefined') return
  gap = 0
  sizes = new ResizeObserver(() => measureRoom())
  mutations = new MutationObserver(() => {
    watchSizes()
    measureRoom()
  })
  mutations.observe(element, { childList: true, subtree: true, characterData: true })
  watchSizes()
  measureRoom()
})

/** In the DOM: open, or still morphing back into the tab bar. */
const rendered = ref(false)
/** Morphing back: taps fall through to the tab bar, so Search can reopen it midway. */
const closing = ref(false)
const typing = ref(false)

const PAGES = [
  { key: 'home', to: '/', icon: 'home' },
  { key: 'library', to: '/library', icon: 'library' },
] as const

function close() {
  scanning.value = false
  search.close()
  input.value?.blur()
}

// The camera button (#92): only where the browser can read an EAN-13.
const scanSupported = useBarcodeSupport()
const scanning = ref(false)
function openScanner() {
  input.value?.blur()
  scanning.value = true
}
// Back closes it instead of leaving the page. A change of page closes it by
// its own rule (below), so it is not closed by every one.
useBackDismiss(() => search.isOpen, close, { keepOnRouteChange: true })

// ------------------------------------------------------------ the morph

type Direction = 'open' | 'close'

/**
 * Where, along the opening (0 = the capsule, 1 = the palette), each part does
 * its share. Fractions of the morph rather than durations: the morph's length
 * and curve are tokens, these only say what happens early and what late.
 */
const STAGE = {
  /** The palette's surface has covered the capsule's glass. */
  plate: 0.35,
  /** The tabs and Cancel start to fade in, once the surface is there. */
  row: 0.3,
  /** The results are fully there. */
  results: 0.7,
} as const

let animations: Animation[] = []
let running: Direction | null = null

/** Where the current animations have got to, as a share of the opening. */
function shown(): number | null {
  const first = animations[0]
  if (!first) return null
  const progress = first.effect?.getComputedTiming().progress ?? 0
  return running === 'open' ? progress : 1 - progress
}

/** Keyframes are written for the opening; the close plays them back to front. */
function oriented(frames: Keyframe[], direction: Direction): Keyframe[] {
  if (direction === 'open') return frames
  return frames.map((frame) => ({ ...frame, offset: 1 - (frame.offset ?? 0) })).reverse()
}

/** The section's own translation (keyboard, drag), so measurements can leave it out. */
function lifted(element: HTMLElement): number {
  const transform = getComputedStyle(element).transform
  return transform && transform !== 'none' ? new DOMMatrixReadOnly(transform).m42 : 0
}

/** The keyframes of the whole morph, measured from the tab bar and the palette as laid out now. */
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
  const capsule = document.querySelector<HTMLElement>('[data-morph="capsule"]')
  const icon = document.querySelector<HTMLElement>('[data-morph="search"]')
  const glyphIcon = glyph.value?.querySelector('svg')
  // No tab bar to grow out of (a layout without one): fade in place.
  if (!capsule || !icon || !body.value || !palette.value || !glyphIcon) {
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
  const clip = (inset: string, round: string) => `inset(${inset} round ${round})`
  // The palette as drawn: the room below the gap (the boxes themselves are the whole room).
  const drawn = { top: top + gap, height: box.height - gap }

  // The shadow cannot be clipped to the growing outline (it lies outside it),
  // so its box is scaled from the capsule's instead and fades in on the way.
  const outline = {
    x: from.left + from.width / 2 - (box.left + box.width / 2),
    y: from.top + from.height / 2 - (drawn.top + drawn.height / 2),
    scaleX: from.width / box.width,
    scaleY: from.height / drawn.height,
  }

  const start = icon.getBoundingClientRect()
  const end = glyphIcon.getBoundingClientRect()
  const travel = {
    x: start.left + start.width / 2 - (end.left + end.width / 2),
    y: start.top + start.height / 2 - (end.top - dy + end.height / 2),
    scale: start.width / end.width,
  }

  // Home and Library stay put in the capsule, but the Search icon flies across
  // them. They fade out before it reaches them on the way up, and on the way
  // down come back only once it has passed (the bar takes over at the very
  // end, MOTION.md): `pass` is how far along the opening the icon's leading
  // edge reaches the right-hand tab (its centre moves linearly with the offset).
  const tabs = [...capsule.querySelectorAll<HTMLElement>('[data-morph="tab"]')]
  const tabsRight = Math.max(...tabs.map((tab) => (tab.querySelector('svg') ?? tab).getBoundingClientRect().right))
  const startX = start.left + start.width / 2
  const pass = Math.min(1, Math.max(0, (startX - start.width / 2 - tabsRight) / travel.x))
  const tabFrames: [HTMLElement, Keyframe[]][] =
    tabs.length && travel.x > 0
      ? tabs.map((tab) => [
          tab,
          [
            { opacity: 1, offset: 0 },
            { opacity: 0, offset: pass },
            { opacity: 0, offset: 1 },
          ],
        ])
      : []

  return [
    [veil.value, veilFrames],
    [
      body.value,
      [
        {
          clipPath: clip(
            `${from.top - top}px ${box.right - from.right}px ${bottom - from.bottom}px ${from.left - box.left}px`,
            `${from.height / 2}px`,
          ),
          offset: 0,
        },
        { clipPath: clip(`${gap}px 0px 0px 0px`, radius), offset: 1 },
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
    [lead.value, fade(0, 1, STAGE.row)],
    // The query comes in behind the Search icon, as if the icon pulled it into the row.
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
        {
          transform: `translate(${travel.x}px, ${travel.y}px) scale(${travel.scale})`,
          color: getComputedStyle(icon).color,
          offset: 0,
        },
        { transform: 'none', color: getComputedStyle(glyph.value!).color, offset: 1 },
      ],
    ],
    ...tabFrames,
  ]
}

/** With Reduce Motion: the palette and the veil cross-fade in place; the tab bar stays as it is under them. */
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

/**
 * Plays the morph towards `direction`, from wherever the screen is now: from
 * the capsule when opening, from the open palette when closing, or from the
 * point an interrupted morph had reached. Each start measures afresh (the row
 * may have changed from tabs to Cancel, the results may have grown).
 */
function play(direction: Direction) {
  const reduced = prefersReducedMotion()
  const at = shown() ?? (direction === 'open' ? 0 : 1)
  for (const animation of animations) animation.cancel()
  // The morph ends on the content's height as it is now; a glide of it gives way.
  measureRoom()
  gliding?.finish()
  gliding = null

  chrome.value = reduced ? 'tabs' : 'morph'
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

/** The morph is over: hand the chrome to whoever has it now and let go of the animations. */
function settle(direction: Direction) {
  for (const animation of animations) animation.cancel()
  animations = []
  running = null
  if (direction === 'open') {
    chrome.value = 'palette'
  } else {
    chrome.value = 'tabs'
    rendered.value = false
    closing.value = false
    typing.value = false
  }
}

// ------------------------------------------------------------ keyboard and drag

// While the query has the keyboard the palette sits right above it. The
// keyboard's height is the shared inset (composables/useKeyboardInset.ts): in
// the installed app it is reported as the keyboard starts to move, so the
// palette rides up on the keyboard's own curve; it reads 0 again once the
// search closes.
const keyboard = useKeyboardInset(() => search.isOpen)
/** How far up the palette has to go to sit `--spacing-sm` above the keyboard, from where `float-bottom` puts it. */
const lift = computed(() => {
  if (!keyboard.value || !palette.value) return 0
  const resting = Number.parseFloat(getComputedStyle(palette.value).bottom) || 0
  const gap = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--spacing-sm')) || 0
  return paletteLift(keyboard.value, gap, resting)
})

const { handlers, offset, dragging } = useSwipeDown(close)
const paletteStyle = computed(() => ({
  // The room's top: as high as the results may reach, which with the keyboard up is as much lower as
  // the palette is lifted (its bottom stands on the keyboard, its top stays below the status bar).
  top: `calc(env(safe-area-inset-top) + var(--spacing-xxxl) - var(--float-bottom) + ${lift.value}px)`,
  transform: offset.value || lift.value ? `translateY(${offset.value - lift.value}px)` : undefined,
  transition: dragging.value ? 'none' : undefined,
}))

function onKeydown(event: KeyboardEvent) {
  // With the scanner open, Escape closes only the scanner (its own handler).
  if (event.key === 'Escape' && !scanning.value) close()
}

function listen(on: boolean) {
  const method = on ? 'addEventListener' : 'removeEventListener'
  window[method]('keydown', onKeydown)
}

watch(
  () => search.isOpen,
  async (open) => {
    if (!import.meta.client) return
    listen(open)
    if (open) {
      closing.value = false
      rendered.value = true
      await nextTick()
      if (!search.isOpen) return
      // Opened from a tap, so the keyboard comes up with it: focus first, in
      // the same task as the tap, and start the morph from the row as it will
      // be (Cancel instead of the tabs) — all before the next frame is drawn.
      input.value?.focus({ preventScroll: true })
      await nextTick()
      if (search.isOpen) play('open')
    } else if (rendered.value) {
      closing.value = true
      input.value?.blur()
      await nextTick()
      if (!search.isOpen) play('close')
    }
  },
)
// Going to another page closes the search, but only a navigation that started
// while it was open (a result, a tab in the palette). One that started before
// (a tab tapped just before Search, its page still loading) lands behind the
// open search instead of closing it the moment it arrives.
const router = useRouter()
let openedAt = -Infinity
let navigationStartedAt = -Infinity
watch(
  () => search.isOpen,
  (open) => {
    if (open) openedAt = performance.now()
  },
  { flush: 'sync' },
)
const stopNavigationGuard = router.beforeEach(() => {
  navigationStartedAt = performance.now()
})
onUnmounted(stopNavigationGuard)
watch(
  () => route.path,
  () => {
    if (search.isOpen && navigationStartedAt >= openedAt) search.close()
  },
)
onUnmounted(() => {
  if (!import.meta.client) return
  listen(false)
  for (const animation of animations) animation.cancel()
  mutations?.disconnect()
  sizes?.disconnect()
  chrome.value = 'tabs'
})
</script>

<template>
  <Teleport to="body">
    <template v-if="rendered">
      <button
        ref="veil"
        type="button"
        :aria-label="t('search.close')"
        class="veil fixed inset-0 z-30 bg-veil"
        :class="closing && 'pointer-events-none'"
        data-testid="search.backdrop"
        @click="close"
      />

      <section
        ref="palette"
        role="dialog"
        aria-modal="true"
        :aria-label="t('search.title')"
        class="palette float-bottom pointer-events-none fixed inset-x-ms z-40 mx-auto max-w-(--size-max-content)"
        :style="paletteStyle"
        data-testid="search.overlay"
        v-on="handlers"
      >
        <!-- The room is the whole box; what is drawn of it is the part under the gap (usePaletteRoom.ts). -->
        <div ref="shade" class="drawn pointer-events-none absolute inset-x-0 top-0 rounded-xl shadow-palette" aria-hidden="true" />
        <!-- The taps: only where the palette is drawn (above it the veil is tapped), also while the
             body's clip is still growing out of the capsule. -->
        <div
          class="drawn absolute inset-x-0 top-0 rounded-xl"
          :class="closing ? 'pointer-events-none' : 'pointer-events-auto'"
          aria-hidden="true"
        />

        <div
          ref="body"
          class="body relative flex h-full flex-col overflow-hidden rounded-xl"
          :class="closing ? 'pointer-events-none' : 'pointer-events-auto'"
        >
          <div ref="plate" class="drawn absolute inset-x-0 top-0 rounded-xl bg-surface-raised edge" aria-hidden="true" />

          <div ref="results" class="relative flex min-h-0 flex-1 flex-col justify-end" data-room>
            <slot>
              <p class="px-lg py-lg text-center text-caption text-ink-faint" data-testid="search.empty">
                {{ t('search.empty') }}
              </p>
            </slot>
            <div class="h-(--stroke-hairline) shrink-0 bg-hairline" aria-hidden="true" />
          </div>

          <div class="relative flex h-(--size-query) shrink-0 items-center gap-sm" :class="typing ? 'pr-inset pl-md' : 'pr-inset pl-sm'">
            <div v-if="!typing" ref="lead" class="flex shrink-0 items-center gap-sm">
              <NuxtLink
                v-for="tab in PAGES"
                :key="tab.key"
                :to="tab.to"
                class="tab"
                :class="route.path === tab.to ? 'text-ink' : 'text-ink-faint'"
                :aria-current="route.path === tab.to ? 'page' : undefined"
                :data-testid="`search.tab.${tab.key}`"
              >
                <UiIcon :name="tab.icon" :bold="route.path === tab.to" />
                <span class="sr-only">{{ t(`tabs.${tab.key}`) }}</span>
                <span v-if="route.path === tab.to" class="dot" aria-hidden="true" />
              </NuxtLink>
              <span class="mr-xs h-lg w-(--stroke-hairline) shrink-0 bg-hairline-strong" aria-hidden="true" />
            </div>

            <span ref="glyph" class="glyph flex shrink-0 text-accent">
              <UiIcon name="search" :size="19" />
            </span>

            <div ref="field" class="flex min-w-0 flex-1 items-center gap-sm self-stretch">
              <input
                ref="input"
                v-model="search.query"
                type="search"
                inputmode="search"
                enterkeyhint="search"
                autocomplete="off"
                autocapitalize="off"
                autocorrect="off"
                spellcheck="false"
                :aria-label="t('search.title')"
                :placeholder="t('search.placeholder')"
                class="min-w-0 flex-1 self-stretch bg-transparent text-callout text-ink caret-accent outline-none placeholder:text-ink-faint [&::-webkit-search-cancel-button]:hidden"
                data-testid="search.query"
                @focus="typing = true"
                @blur="search.isOpen && (typing = false)"
              />
              <button
                v-if="scanSupported && !search.query"
                type="button"
                :aria-label="t('search.scan.open')"
                class="relative -mr-sm flex size-(--size-touch) shrink-0 items-center justify-center text-ink-muted"
                data-testid="search.scan"
                @pointerdown.prevent
                @click="openScanner"
              >
                <UiIcon name="camera" :size="20" />
              </button>
              <button
                v-if="search.query"
                type="button"
                :aria-label="t('search.clear')"
                class="relative flex size-ml shrink-0 items-center justify-center rounded-pill bg-fill-strong text-ink-muted after:absolute after:-inset-ms after:content-['']"
                data-testid="search.clear"
                @pointerdown.prevent
                @click="search.query = ''"
              >
                <UiIcon name="close" :size="13" bold />
              </button>
            </div>

            <div v-if="typing" ref="trail" class="flex shrink-0 items-center gap-sm">
              <span class="ml-xs h-ml w-(--stroke-hairline) shrink-0 bg-hairline-strong" aria-hidden="true" />
              <button
                type="button"
                class="min-h-(--size-touch) shrink-0 pl-xs text-body text-ink-muted"
                data-testid="search.cancel"
                @pointerdown.prevent
                @click="close"
              >
                {{ t('common.cancel') }}
              </button>
            </div>
          </div>
        </div>
      </section>

      <ShellBarcodeScanner v-if="scanSupported" v-model:open="scanning" />
    </template>
  </Teleport>
</template>

<style scoped>
/* The page stays put behind the palette, blurred and veiled. */
.veil {
  -webkit-backdrop-filter: blur(calc(var(--blur-veil) * var(--glass-scale, 1)));
  backdrop-filter: blur(calc(var(--blur-veil) * var(--glass-scale, 1)));
}

.tab {
  position: relative;
  display: flex;
  width: var(--size-touch);
  height: var(--size-touch);
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
}

.dot {
  position: absolute;
  bottom: var(--spacing-xxs);
  width: var(--spacing-xs);
  height: var(--spacing-xs);
  border-radius: var(--radius-pill);
  background: var(--color-accent);
}

/* Follows a drag 1:1 and rides up and down with the keyboard on its curve (its top with it, so the
   room's top stays where it is). */
.palette {
  touch-action: none;
  transition:
    transform var(--duration-keyboard) var(--ease-keyboard),
    top var(--duration-keyboard) var(--ease-keyboard);
}

/* The empty room above the content (usePaletteRoom.ts): an animatable length, so a glide can move it. */
@property --palette-gap {
  syntax: '<length>';
  inherits: true;
  initial-value: 0px;
}

/* The surface and its shadow are drawn as tall as the content, under the gap. They are laid out at
   the room's top and moved down by the gap (a translation, which the browser does not count as a
   layout shift); placed at the gap itself, they would shift whenever the content changed. */
.drawn {
  height: calc(100% - var(--palette-gap));
  translate: 0 var(--palette-gap);
}

/* Nothing of the body shows, or takes a tap, above the content. */
.body {
  clip-path: inset(var(--palette-gap) 0 0 0 round var(--radius-xl));
}

/* The Search icon flies from the capsule around its own centre. */
.glyph {
  transform-origin: center;
}
</style>
