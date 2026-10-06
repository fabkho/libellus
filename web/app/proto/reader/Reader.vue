<script setup lang="ts">
// The reader (design round #131 phase 2): one shell for the three prototypes.
// Full screen over everything, the tab bar gone; the book in its own room
// (light, dark or sepia, `data-theme` on this layer and, once it covers the
// screen, on the document, so its sheets wear it too). The variant decides the
// flow (pages or scroll), how a page turns and what chrome there is; the rest
// is shared: the Aa sheet, Contents, the opening flight from the book page's
// cover and back, Start reading? for a Want to read Book, the end of the book
// with Finish, the progress it writes (forward only), Back (chrome first, then
// the reader), the screen kept awake, Reduce Motion.
import { durationToken, easingToken, prefersReducedMotion } from '~/utils/motion'
import type { CoverColors } from '~/utils/cover'
import type { Box } from '~/utils/flight'
import type { Layout, PageColors, ReaderEngine, Relocation } from './engine'
import { REST, coverCopy, fitBox, poseOf, ratioOf, rectOf } from './flight'
import { ProgressWriter, QUICK_POLICY, SPEC_POLICY, pageAt } from './progress'
import { MARGINS, readSettings, writeSettings, type ReaderSettings, type ReaderTheme } from './settings'
import { runningHead, type ChromeInfo } from './types'
import ChromeQuiet from './ChromeQuiet.vue'
import ChromeScroll from './ChromeScroll.vue'
import ChromePrinted from './ChromePrinted.vue'
import TypeSheet from './TypeSheet.vue'
import TocSheet from './TocSheet.vue'
import StartPrompt from './StartPrompt.vue'
import FinishPrompt from './FinishPrompt.vue'
import EndOfBook from './EndOfBook.vue'
import ProgressNote from './ProgressNote.vue'

const props = defineProps<{
  variant: 'a' | 'b' | 'c'
  file: File
  book: { title: string; authors: string[]; cover: string | null; pages: number; colors: CoverColors | null; thumbhash: string | null }
  status: 'want_to_read' | 'reading'
  savedPage: number
  hero: HTMLElement | null
  quickWrites: boolean
  reduceMotion: boolean | null
  initial: { theme: string | null; margins: string | null; leading: string | null; size: string | null; chrome: boolean; sheet: string | null; at: number | null; flight: boolean }
}>()

const emit = defineEmits<{
  closed: []
  progress: [page: number, why: string]
  start: []
  finish: []
  cover: [url: string | null, title: string, author: string]
  wake: [state: string]
  timings: [text: string]
}>()

// ------------------------------------------------------------------ settings

const settings = reactive<ReaderSettings>(readSettings(window.localStorage))
const initialTheme = props.initial.theme
if (initialTheme === 'light' || initialTheme === 'dark' || initialTheme === 'sepia') settings.theme = initialTheme
for (const key of ['margins', 'leading', 'size'] as const) {
  const value = props.initial[key]
  if (value !== null && value !== '' && !Number.isNaN(Number(value))) settings[key] = Number(value)
}
watch(settings, (value) => writeSettings(window.localStorage, value), { deep: true })

const appDark = window.matchMedia('(prefers-color-scheme: dark)').matches
const appTheme: 'light' | 'dark' = (document.documentElement.dataset.theme as 'light' | 'dark' | undefined) ?? (appDark ? 'dark' : 'light')
const theme = computed<ReaderTheme>(() => settings.theme ?? appTheme)

const reduced = computed(() => props.reduceMotion ?? prefersReducedMotion())

// ------------------------------------------------------------------ elements

const root = useTemplateRef<HTMLElement>('root')
const host = useTemplateRef<HTMLElement>('host')
const page = useTemplateRef<HTMLElement>('page')
const flyLayer = useTemplateRef<HTMLElement>('flyLayer')
const probe = useTemplateRef<HTMLElement>('probe')

const engine = shallowRef<ReaderEngine | null>(null)
const loc = ref<Relocation | null>(null)
const ready = ref(false)
const failed = ref<string | null>(null)

const chrome = ref(false)
const typeOpen = ref(false)
const tocOpen = ref(false)
const startOpen = ref(false)
const finishOpen = ref(false)
const endShown = ref(false)
const finishedHere = ref(false)
const sheetOpen = computed(() => typeOpen.value || tocOpen.value || startOpen.value || finishOpen.value)

// Back (Android's gesture, the browser's Back): the chrome (or the end page) first, then the reader.
const open = ref(true)
useBackDismiss(open, () => void close())
useBackDismiss(endShown, () => (endShown.value = false))
useBackDismiss(chrome, () => (chrome.value = false))

// ------------------------------------------------------------------ layout

function insets() {
  const style = probe.value ? getComputedStyle(probe.value) : null
  return {
    top: Number.parseFloat(style?.paddingTop ?? '0') || 0,
    bottom: Number.parseFloat(style?.paddingBottom ?? '0') || 0,
  }
}

const viewport = reactive({ width: window.innerWidth, height: window.innerHeight })
function onResize() {
  viewport.width = window.innerWidth
  viewport.height = window.innerHeight
}

const layout = computed<Layout>(() => {
  void viewport.width
  const { top, bottom } = insets()
  const edge = Math.max(top, bottom)
  const margins = MARGINS[settings.margins] ?? MARGINS[2]
  const gap = margins.side
  // The bands above and below the text shrink with the margins (edge to edge: the safe area and a hair);
  // the printed page keeps room for its running head and folio, the scroll for its floating chapter.
  if (props.variant === 'b') return { flow: 'scrolled', animated: false, gap, margin: edge + margins.band + 12, maxColumns: 1, maxInlineSize: margins.measure }
  if (props.variant === 'c') return { flow: 'paginated', animated: false, gap, margin: edge + Math.max(30, margins.band + 12), maxColumns: 2, maxInlineSize: Math.min(margins.measure, 700) }
  return { flow: 'paginated', animated: !reduced.value, gap, margin: edge + margins.band, maxColumns: 1, maxInlineSize: margins.measure }
})

function colors(): PageColors {
  const style = getComputedStyle(root.value!)
  const read = (name: string) => style.getPropertyValue(`--color-${name}`).trim()
  return {
    surface: read('surface'),
    ink: read('ink'),
    inkMuted: read('ink-muted'),
    accent: read('accent'),
    hairline: read('hairline-strong'),
    scheme: theme.value === 'dark' ? 'dark' : 'light',
  }
}

watch(
  () => ({ ...settings, theme: theme.value }),
  async () => {
    await nextTick()
    engine.value?.setStyles(settings, colors())
    if (document.documentElement.dataset.readerOpen) takeOverTheme()
  },
  { deep: true },
)
watch(layout, (value) => {
  engine.value?.setLayout(value)
  engine.value?.setStyles(settings, colors())
})

// ------------------------------------------------------------------ the room

let themeBefore: string | undefined
let metaBefore: string[] = []
function takeOverTheme() {
  const html = document.documentElement
  if (!html.dataset.readerOpen) {
    themeBefore = html.dataset.theme
    metaBefore = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((m) => m.content)
    html.style.overflow = 'hidden'
  }
  html.dataset.readerOpen = '1'
  html.dataset.theme = theme.value
  const surface = getComputedStyle(root.value!).getPropertyValue('--color-surface').trim()
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) meta.content = surface
}
function giveBackTheme() {
  const html = document.documentElement
  if (!html.dataset.readerOpen) return
  delete html.dataset.readerOpen
  if (themeBefore) html.dataset.theme = themeBefore
  else delete html.dataset.theme
  html.style.overflow = ''
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta, i) => (meta.content = metaBefore[i] ?? meta.content))
}

// ------------------------------------------------------------------ progress

const writer = new ProgressWriter({
  saved: () => props.savedPage,
  pageCount: () => props.book.pages,
  policy: () => (props.quickWrites ? QUICK_POLICY : SPEC_POLICY),
  enabled: () => props.status === 'reading' && !finishedHere.value,
  write: (written, why) => {
    emit('progress', written, why)
    if (why !== 'close') note.value = { page: written, at: Date.now() }
  },
})
const note = ref<{ page: number; at: number } | null>(null)

const chapterFraction = ref(0)
const info = computed<ChromeInfo>(() => {
  const at = loc.value
  const pageNow = pageAt(at?.fraction ?? 0, props.book.pages)
  return {
    title: props.book.title,
    chapter: at?.chapter ?? null,
    fraction: at?.fraction ?? 0,
    chapterFraction: chapterFraction.value,
    page: pageNow,
    pages: props.book.pages,
    minutesChapter: at?.minutesLeftInChapter ?? 0,
    minutesBook: at?.minutesLeftInBook ?? 0,
    behind: props.status === 'reading' && pageNow < props.savedPage - 1 ? props.savedPage : null,
    atEnd: at?.atEnd ?? false,
  }
})

/** The member has moved in the book (a page, a scroll, a jump): where the reader merely opened is no progress. */
let moved = false
function onRelocate(at: Relocation) {
  loc.value = at
  if (props.variant !== 'b') chapterFraction.value = at.sectionFraction
  if (moved) writer.saw(at.fraction)
  if (props.variant === 'c') paintMargins()
}

// ------------------------------------------------------------------ turning pages

let turning = false
async function turn(direction: 1 | -1) {
  const e = engine.value
  if (!e || turning || !ready.value) return
  if (endShown.value) {
    if (direction === -1) endShown.value = false
    return
  }
  if (direction === 1 && loc.value?.atEnd) {
    endShown.value = true
    return
  }
  turning = true
  moved = true
  try {
    if (props.variant === 'c' && !reduced.value && host.value) {
      // The printed page lays the next one down: a short dip and a soft return, no slide.
      await host.value.animate([{ opacity: 1 }, { opacity: 0 }], { duration: durationToken('instant'), easing: easingToken('exit'), fill: 'forwards' }).finished
      await (direction === 1 ? e.view.next() : e.view.prev())
      const back = host.value.animate([{ opacity: 0 }, { opacity: 1 }], { duration: durationToken('standard'), easing: easingToken('standard'), fill: 'forwards' })
      await back.finished
      back.cancel()
      host.value.getAnimations().forEach((a) => a.cancel())
    } else {
      await (direction === 1 ? e.view.next() : e.view.prev())
    }
  } finally {
    turning = false
  }
}

function onTap(x: number) {
  if (!ready.value || sheetOpen.value) return
  if (chrome.value) {
    chrome.value = false
    return
  }
  if (props.variant === 'b') {
    chrome.value = true
    return
  }
  const w = window.innerWidth
  if (x < w * 0.3) void turn(-1)
  else if (x > w * 0.7) void turn(1)
  else chrome.value = true
}

function onSwipe(direction: 1 | -1) {
  // The paginator turns pages under the finger itself; only past the last page is ours.
  if (props.variant === 'b' || !ready.value) return
  moved = true
  if (direction === 1 && loc.value?.atEnd && !endShown.value) endShown.value = true
}

// The scroll variant: the chrome comes back when the member scrolls up, and leaves as she reads on.
let lastOffset = 0
let turnAt = 0
let lastIndex = -1
/** A jump (Contents, the scrubber) scrolls too; that is not the member scrolling back. */
let jumping = false
function jump(go: () => Promise<unknown> | undefined) {
  jumping = true
  moved = true
  void Promise.resolve(go()).finally(() => setTimeout(() => (jumping = false), 400))
}
function onScroll(offset: number, size: number, viewSize: number) {
  if (props.variant !== 'b') return
  chapterFraction.value = viewSize > size ? Math.min(1, offset / (viewSize - size)) : 1
  const index = loc.value?.sectionIndex ?? -1
  if (index !== lastIndex || !ready.value || jumping) {
    lastIndex = index
    lastOffset = turnAt = offset
    return
  }
  const delta = offset - lastOffset
  if (Math.abs(delta) > 2) moved = true
  if ((delta > 0 && offset < turnAt) || (delta < 0 && offset > turnAt)) turnAt = lastOffset
  lastOffset = offset
  if (offset - turnAt > 10 && chrome.value && !sheetOpen.value) chrome.value = false
  else if (turnAt - offset > 10 && !chrome.value) chrome.value = true
}

function onKey(event: KeyboardEvent) {
  if (sheetOpen.value || !ready.value) return
  if (['ArrowRight', 'PageDown', ' '].includes(event.key) && props.variant !== 'b') {
    event.preventDefault()
    void turn(1)
  } else if (['ArrowLeft', 'PageUp'].includes(event.key) && props.variant !== 'b') {
    event.preventDefault()
    void turn(-1)
  } else if (event.key === 'Escape') {
    if (chrome.value) chrome.value = false
    else if (endShown.value) endShown.value = false
    else void close()
  }
}

// ------------------------------------------------------------------ the printed page's margins (c)

function paintMargins() {
  const r = engine.value?.view.renderer
  if (!r?.heads || !r.feet) return
  const two = r.heads.length > 1
  const style = (el: HTMLElement, kind: 'head' | 'foot') => {
    Object.assign(el.style, {
      display: 'flex',
      alignItems: kind === 'head' ? 'flex-end' : 'flex-start',
      justifyContent: 'center',
      height: '100%',
      paddingTop: kind === 'head' ? `${insets().top}px` : '0',
      paddingBottom: kind === 'head' ? '14px' : '0',
      color: 'var(--color-ink-faint)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    })
    if (kind === 'head') Object.assign(el.style, { fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: '13px', letterSpacing: '0.01em' })
    else Object.assign(el.style, { fontFamily: 'var(--font-mono)', fontSize: '11px', fontVariantNumeric: 'tabular-nums', paddingTop: '16px' })
  }
  r.heads.forEach((el, i) => {
    style(el, 'head')
    const head = runningHead(props.book.title, info.value.chapter)
    el.textContent = two && i === 0 ? props.book.title : head
  })
  r.feet.forEach((el, i) => {
    style(el, 'foot')
    el.textContent = two && i === 0 ? String(Math.max(1, info.value.page)) : two ? '' : String(Math.max(1, info.value.page))
  })
}

// ------------------------------------------------------------------ opening and closing

/** The page box the cover lands in: the whole page, inside the text's margins. */
function pageArea(): Box {
  const { width, height } = viewport
  const l = layout.value
  if (l.flow === 'scrolled') return { left: width * l.gap, top: l.margin, width: width * (1 - 2 * l.gap), height: height - 2 * l.margin }
  const columns = l.maxColumns === 2 && width > height ? 2 : 1
  const inline = Math.min(width * (1 - 2 * l.gap), l.maxInlineSize * columns)
  const area = { left: (width - inline) / 2, top: l.margin, width: inline, height: height - 2 * l.margin }
  return columns === 2 ? { ...area, width: area.width / 2 - (width * l.gap) / 2 } : area
}

/** Where the book's own cover is drawn on its first page, if the page showing is a cover page. */
function coverOnPage(): Box | null {
  const contents = (engine.value?.view.renderer as unknown as { getContents?: () => { doc: Document }[] })?.getContents?.()
  const doc = contents?.[0]?.doc
  if (!doc) return null
  const images = doc.querySelectorAll('img, svg image')
  if (images.length !== 1 || (doc.body?.textContent ?? '').trim().length > 40) return null
  const frame = doc.defaultView?.frameElement?.getBoundingClientRect()
  const rect = images[0]!.getBoundingClientRect()
  if (!frame || !rect.width) return null
  return { left: frame.left + rect.left, top: frame.top + rect.top, width: rect.width, height: rect.height }
}

function heroImage(): { el: HTMLElement; src: string; box: Box } | null {
  const sheet = props.hero?.querySelector<HTMLElement>('[data-cover]')
  const img = sheet?.querySelector('img')
  if (!sheet || !img?.complete || !img.naturalWidth) return null
  return { el: sheet, src: img.currentSrc || img.src, box: rectOf(sheet) }
}

const HERO_RADIUS = 5

async function openFlight(engineReady: Promise<ReaderEngine | null>) {
  const layer = root.value!
  const pageEl = page.value!
  const instant = !props.initial.flight
  const hero = !reduced.value && !instant ? heroImage() : null
  if (instant) {
    await engineReady
    return
  }
  if (!hero) {
    // Reduce Motion (or no cover image): the reader cross-fades in over the book page.
    pageEl.style.opacity = '0'
    await layer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: durationToken('standard'), easing: easingToken('standard') }).finished
    await engineReady
    await pageEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: durationToken('standard'), easing: easingToken('standard') }).finished
    pageEl.style.opacity = ''
    return
  }
  const ratio = await ratioOf(hero.src)
  let target = fitBox(pageArea(), ratio)
  const copy = coverCopy(flyLayer.value!, hero.src, target)
  hero.el.style.visibility = 'hidden'
  pageEl.style.opacity = '0'
  const duration = durationToken('sheet')
  const easing = easingToken('standard')
  const flight = copy.animate([poseOf(target, hero.box, HERO_RADIUS), REST], { duration, easing, fill: 'both' })
  layer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: duration * 0.8, easing })
  const [, opened] = await Promise.all([flight.finished, engineReady])
  // The hand-off: on a cover page the copy settles onto the page's own cover and goes; elsewhere it dissolves into the page.
  const onPage = opened ? coverOnPage() : null
  if (onPage && (Math.abs(onPage.left - target.left) > 1 || Math.abs(onPage.top - target.top) > 1 || Math.abs(onPage.width - target.width) > 1)) {
    const settle = copy.animate([REST, poseOf(target, onPage, 0)], { duration: durationToken('quick'), easing, fill: 'forwards' })
    await settle.finished
    target = onPage
  }
  pageEl.style.opacity = ''
  if (onPage) {
    await copy.animate([{ opacity: 1 }, { opacity: 0 }], { duration: durationToken('quick'), easing, fill: 'forwards' }).finished
  } else {
    pageEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: durationToken('standard'), easing })
    await copy.animate([{ opacity: 1 }, { opacity: 0 }], { duration: durationToken('standard'), easing, fill: 'forwards' }).finished
  }
  copy.remove()
  hero.el.style.visibility = ''
}

let closing = false
async function close() {
  if (closing) return
  closing = true
  open.value = false
  chrome.value = false
  endShown.value = false
  writer.flush()
  releaseWake()
  const layer = root.value
  const pageEl = page.value
  giveBackTheme()
  const hero = layer && pageEl && !reduced.value ? heroImage() : null
  if (layer && pageEl && hero) {
    const ratio = await ratioOf(hero.src)
    const target = coverOnPage() ?? fitBox(pageArea(), ratio)
    const copy = coverCopy(flyLayer.value!, hero.src, target)
    hero.el.style.visibility = 'hidden'
    const easing = easingToken('standard')
    // The page gives way to its cover, which then flies home; the room fades as it goes.
    copy.animate([{ opacity: 0 }, { opacity: 1 }], { duration: durationToken('quick'), easing, fill: 'both' })
    await pageEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: durationToken('quick'), easing, fill: 'forwards' }).finished
    const duration = durationToken('exit') * 1.4
    layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing, fill: 'forwards' })
    await copy.animate([REST, poseOf(target, hero.box, HERO_RADIUS)], { duration, easing, fill: 'forwards' }).finished
    hero.el.style.visibility = ''
    copy.remove()
  } else if (layer) {
    await layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: durationToken('exit'), easing: easingToken('exit'), fill: 'forwards' }).finished
  }
  engine.value?.destroy()
  emit('closed')
}

// ------------------------------------------------------------------ the screen kept on

let wakeSentinel: { release: () => Promise<void> } | null = null
async function applyWake() {
  if (!settings.keepAwake || closing) return releaseWake()
  const api = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock
  if (api && window.isSecureContext) {
    try {
      wakeSentinel = await api.request('screen')
      emit('wake', 'on')
      return
    } catch {
      // Refused (battery saver, not visible): simulated below.
    }
  }
  emit('wake', 'on (simulated: needs HTTPS)')
}
function releaseWake() {
  void wakeSentinel?.release().catch(() => {})
  wakeSentinel = null
  emit('wake', 'off')
}
watch(() => settings.keepAwake, applyWake)
function onVisibility() {
  if (document.visibilityState === 'visible' && settings.keepAwake && !closing) void applyWake()
}

// ------------------------------------------------------------------ start

const timings = ref<string | null>(null)

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', onResize)
  document.addEventListener('visibilitychange', onVisibility)
  const startedAt = performance.now()
  let importedAt = startedAt
  const engineReady = import('./engine')
    .then((module) => {
      importedAt = performance.now()
      return module.openReader(host.value!, props.file, {
        handlers: { relocate: onRelocate, tap: (x) => onTap(x), scroll: onScroll, swipe: onSwipe },
        layout: layout.value,
        settings,
        colors: colors(),
        at: props.initial.at ?? (props.savedPage > 0 ? props.savedPage / props.book.pages : null),
        startedAt,
        importedAt,
      })
    })
    .then((opened) => {
      engine.value = opened
      if (opened.cover && !props.book.cover) emit('cover', URL.createObjectURL(opened.cover), opened.title, opened.author)
      const t = opened.timings
      timings.value = `${(t.bytes / 1e6).toFixed(1)} MB · engine ${Math.round(t.importMs)} ms · book ${Math.round(t.parseMs)} ms · first page ${Math.round(t.firstPageMs)} ms`
      emit('timings', timings.value)
      ;(window as unknown as { __readerTimings?: unknown }).__readerTimings = { ...t }
      return opened
    })
    .catch((error: unknown) => {
      failed.value = error instanceof Error ? error.message : String(error)
      return null
    })
  await openFlight(engineReady)
  ready.value = true
  takeOverTheme()
  void applyWake()
  ;(window as unknown as { __readerReady?: boolean }).__readerReady = true
  if (props.variant === 'c') paintMargins()
  if (props.initial.chrome) chrome.value = true
  const sheet = props.initial.sheet
  if (sheet === 'type') typeOpen.value = true
  else if (sheet === 'toc') tocOpen.value = true
  else if (sheet === 'end') endShown.value = true
  else if (sheet === 'finish') (endShown.value = true), (finishOpen.value = true)
  else if (props.status === 'want_to_read' || sheet === 'start') setTimeout(() => (startOpen.value = !closing), durationToken('standard'))
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', onResize)
  document.removeEventListener('visibilitychange', onVisibility)
  writer.dispose()
  releaseWake()
  giveBackTheme()
})

// ------------------------------------------------------------------ actions from the chrome and sheets

function goTo(href: string) {
  tocOpen.value = false
  chrome.value = false
  endShown.value = false
  jump(() => engine.value?.goTo(href))
}
function goToFraction(fraction: number) {
  endShown.value = false
  jump(() => engine.value?.goToFraction(fraction))
}
function setHere() {
  writer.setTo(info.value.page)
}
function onStarted() {
  startOpen.value = false
  emit('start')
}
function onFinished() {
  finishOpen.value = false
  finishedHere.value = true
  emit('finish')
}
function nextChapter() {
  if (loc.value?.atEnd) endShown.value = true
  else jump(() => engine.value?.view.next())
}
</script>

<template>
  <div
    ref="root"
    class="reader fixed inset-0 z-[35] overflow-hidden bg-surface text-ink"
    :class="`reader-${variant}`"
    :data-theme="theme"
    data-testid="reader"
    :data-ready="ready || undefined"
  >
    <span ref="probe" class="pointer-events-none fixed top-0 left-0 bar-top safe-bottom opacity-0" aria-hidden="true" />
    <div ref="page" class="absolute inset-0">
      <div ref="host" class="absolute inset-0" data-testid="reader.page" />
    </div>

    <ChromeQuiet
      v-if="variant === 'a'"
      :shown="chrome && ready"
      :info="info"
      @back="close"
      @contents="tocOpen = true"
      @type="typeOpen = true"
      @scrub="goToFraction"
      @set-here="setHere"
    />
    <ChromeScroll
      v-else-if="variant === 'b'"
      :shown="chrome && ready"
      :ready="ready"
      :info="info"
      :next-label="loc?.atEnd ? 'The end' : 'Next chapter'"
      @back="close"
      @contents="tocOpen = true"
      @type="typeOpen = true"
      @next="nextChapter"
      @set-here="setHere"
    />
    <ChromePrinted
      v-else
      :shown="chrome && ready"
      :info="info"
      @back="close"
      @contents="tocOpen = true"
      @type="typeOpen = true"
      @set-here="setHere"
    />

    <ProgressNote :note="note" :variant="variant" :chrome="chrome" />

    <EndOfBook
      :shown="endShown"
      :book="book"
      :finished="finishedHere"
      :reading="status === 'reading'"
      @finish="finishOpen = true"
      @back="endShown = false"
      @close="close"
    />

    <p v-if="failed" class="absolute inset-x-0 top-1/2 px-xl text-center text-subhead text-ink-muted">This book could not be opened. {{ failed }}</p>

    <TypeSheet v-model:open="typeOpen" :settings="settings" :wake-note="settings.keepAwake && !isSecureContextNow() ? 'Simulated here: the phone needs HTTPS for it.' : null" />
    <TocSheet v-model:open="tocOpen" :toc="engine?.toc ?? []" :current="loc?.chapterHref ?? null" :info="info" :book="book" @go="goTo" />
    <StartPrompt v-model:open="startOpen" :book="book" @start="onStarted" />
    <FinishPrompt v-model:open="finishOpen" :book="book" @finish="onFinished" />
  </div>
  <!-- Outside the reader's layer, so the cover keeps its opacity while the room fades in and out under it. -->
  <div ref="flyLayer" class="pointer-events-none fixed inset-0 z-[36]" aria-hidden="true" />
</template>

<script lang="ts">
function isSecureContextNow() {
  return typeof window !== 'undefined' && window.isSecureContext
}
</script>
