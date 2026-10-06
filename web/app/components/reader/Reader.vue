<script setup lang="ts">
// The built-in reader (#131 phase 2), opened by Read now on a Book's page for
// the EPUB linked to it on this device (phase 1). Full screen over the app (a
// modal layer: the app behind is inert, Back closes it); the book in its own
// room — sepia by default, light or dark — on this layer and, once it covers
// the screen, on the document and the status bar, so its sheets wear it too.
//
// Two styles, a setting of the device (Aa, or the Profile's Classic reader):
// the printed page (default: a folio at the foot, a small glass capsule on a
// tap in the middle, a page slider grown out of the capsule, a calm fade to
// turn) and the classic one (a bar at the top and one at the bottom, the page
// sliding under the finger). Either reads in pages or scrolls a chapter at a
// time (the scroll's own bars). The rest is shared: the cover flies from the
// book page into the book's cover page and back; the Aa sheet; Contents with a
// slider; search in the app's palette; selected words → Translate, Define,
// Copy, Search, four highlight colours; the end of the book with Finish; Start
// reading for a Want to read Book (the app's own sheets); progress written by
// itself, forward only; the place kept on the device and server-side; the
// screen kept on; Reduce Motion (docs/MOTION.md, Reader).
import type { EbookRecord } from '~/data/ebooks/ebooks'
import type { LibraryEntry } from '~/data/library'
import { pageCountOf, progressFraction } from '~/data/progress'
import { isDefinable } from '~/data/reader/lookup'
import { ProgressWriter, progressAt } from '~/data/reader/progress'
import { MARGINS, type ReaderTheme } from '~/data/reader/settings'
import type { Highlight, HighlightColor } from '~/data/reader/device'
import { REST, fitBox, poseOf, ratioOf, readerCoverCopy, rectOf } from '~/utils/readerFlight'
import type { ChromeInfo } from '~/utils/readerChrome'
import { durationToken, easingToken, prefersReducedMotion } from '~/utils/motion'
import type { Box, Layout, PageColors, ReaderEngine, Relocation, Selection } from '~/reader/engine'
import { useEbooksStore } from '~/stores/ebooks'
import { useReaderStore } from '~/stores/reader'
import { useReadingStore } from '~/stores/reading'
import SelectionMenu, { type MenuTarget } from './SelectionMenu.vue'

const props = defineProps<{ entry: LibraryEntry; record: EbookRecord; hero: HTMLElement | null }>()
const emit = defineEmits<{ closed: [] }>()

const { t } = useI18n()
const reader = useReaderStore()
const reading = useReadingStore()
const ebooks = useEbooksStore()
const online = useOnline()
const settings = reader.settings

/** The entry as the Library holds it now: progress and status move while the book is open. */
const entryNow = computed(() => reader.current(props.entry.id) ?? props.entry)
const status = computed(() => entryNow.value.status)
const pageCount = computed(() => pageCountOf(entryNow.value))
const book = computed(() => {
  const b = props.entry.book
  return {
    title: b.title,
    authors: b.authors,
    cover: coverSrc(b.coverUrl, 'lg') ?? ebooks.coverOf(props.record),
    colors: b.coverColors,
    thumbhash: b.coverThumbhash,
    pages: pageCount.value,
  }
})

const appTheme: 'light' | 'dark' =
  (document.documentElement.dataset.theme as 'light' | 'dark' | undefined) ??
  (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
const theme = computed<ReaderTheme>(() => settings.theme ?? appTheme)
const reduced = computed(() => prefersReducedMotion())

/** a: classic, b: scroll (either style), c: the printed page. */
const mode = computed<'a' | 'b' | 'c'>(() => (settings.flow === 'scroll' ? 'b' : settings.style === 'classic' ? 'a' : 'c'))

// ------------------------------------------------------------------ elements and state

const root = useTemplateRef<HTMLElement>('root')
const host = useTemplateRef<HTMLElement>('host')
const page = useTemplateRef<HTMLElement>('page')
const flyLayer = useTemplateRef<HTMLElement>('flyLayer')
const probe = useTemplateRef<HTMLElement>('probe')

const engine = shallowRef<ReaderEngine | null>(null)
const loc = ref<Relocation | null>(null)
const ready = ref(false)
const failed = ref<'missing' | 'failed' | null>(null)

const chrome = ref(false)
const typeOpen = ref(false)
const contentsOpen = ref(false)
const endShown = ref(false)
const translateOpen = ref(false)
const defineOpen = ref(false)
const paletteOpen = ref(false)
const paletteChrome = ref<'capsule' | 'morph' | 'palette'>('capsule')
const scrubbing = ref(false)
const sheetOpen = computed(
  () => typeOpen.value || contentsOpen.value || translateOpen.value || defineOpen.value || paletteOpen.value || reading.starting !== null || reading.finishing !== null,
)

watch(mode, async (now, before) => {
  // Changing style or flow keeps the place; the chrome and the folio follow.
  chrome.value = false
  await nextTick()
  if (before === 'c' || now === 'c') paintMargins()
})

// The reader is a modal layer: the app behind it is inert, Back closes it
// (after its own chrome, end page, slider and menu, which open later and are
// on top), and focus comes back to Read now.
const open = ref(true)
useModalLayer(open, { elements: () => [root.value, flyLayer.value], initialFocus: () => root.value, close: () => void close() })
useBackDismiss(endShown, () => (endShown.value = false))
useBackDismiss(chrome, () => (chrome.value = false))
useBackDismiss(scrubbing, () => (scrubbing.value = false))

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
  const margins = MARGINS[settings.margins] ?? MARGINS[2]
  const gap = margins.side
  // The device's insets are the page host's (it starts under the status bar and ends above the gesture
  // bar), so the bands above and below the text are only the text's own (foliate's margin is one value
  // for both). The printed page's foot band holds the folio.
  if (mode.value === 'b') return { flow: 'scrolled', animated: false, gap, margin: margins.band + 12, maxColumns: 1, maxInlineSize: margins.measure }
  if (mode.value === 'c') return { flow: 'paginated', animated: false, gap, margin: Math.max(22, margins.band - 6), maxColumns: 2, maxInlineSize: Math.min(margins.measure, 700) }
  return { flow: 'paginated', animated: !reduced.value, gap, margin: margins.band, maxColumns: 1, maxInlineSize: margins.measure }
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
/** A highlight colour's value, from its token. */
function highlightColor(color: HighlightColor): string {
  const name = `--color-highlight-${color}`
  return (root.value ? getComputedStyle(root.value) : getComputedStyle(document.documentElement)).getPropertyValue(name).trim()
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
    // No pull-to-refresh or bounce while reading: a pull at a chapter's top is the reader's (the previous chapter).
    html.style.overscrollBehavior = 'none'
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
  html.style.overscrollBehavior = ''
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta, i) => (meta.content = metaBefore[i] ?? meta.content))
}

// ------------------------------------------------------------------ progress and the place

const writer = new ProgressWriter({
  current: () => reader.progressFor(props.entry.id),
  pageCount: () => pageCount.value,
  enabled: () => status.value === 'reading',
  write: (value) => void reader.saveProgress(entryNow.value, value),
})

const chapterFraction = ref(0)
const info = computed<ChromeInfo>(() => {
  const at = loc.value
  const fraction = at?.fraction ?? 0
  const value = progressAt(fraction, pageCount.value)
  const saved = reader.progressFor(props.entry.id)
  const savedFraction = progressFraction(saved, pageCount.value)
  const behind = status.value === 'reading' && saved && savedFraction - fraction > 0.02 ? placeWords(savedFraction) : null
  return {
    title: book.value.title,
    chapter: at?.chapter ?? null,
    fraction,
    chapterFraction: chapterFraction.value,
    page: 'page' in value ? value.page : null,
    pages: pageCount.value,
    minutesChapter: at?.minutesLeftInChapter ?? 0,
    minutesBook: at?.minutesLeftInBook ?? 0,
    behind,
    atEnd: at?.atEnd ?? false,
  }
})
/** "p. 34" with a page count, "34 %" without. */
function placeWords(fraction: number): string {
  const value = progressAt(fraction, pageCount.value)
  return 'page' in value ? t('reader.pageOnly', { page: value.page }) : t('reader.percent', { percent: value.percent })
}

function onRelocate(at: Relocation) {
  loc.value = at
  if (mode.value !== 'b') chapterFraction.value = at.sectionFraction
  // A chapter no taller than the screen (the cover, a title page) is read once it shows (Next chapter offers itself).
  else chapterFraction.value = at.fits ? 1 : at.sectionFraction
  writer.saw(at.fraction)
  if (ready.value) reader.leavePlace(props.entry.id, { cfi: at.cfi, fraction: at.fraction, fileHash: props.record.hash })
  if (mode.value === 'c') paintMargins()
}

/** The member reads on: from here places count as progress. */
function readsOn() {
  writer.reading()
}
/** "Set to p. 12": the member moves her progress back herself. */
function setHere() {
  void reader.saveProgress(entryNow.value, progressAt(info.value.fraction, pageCount.value))
}

// ------------------------------------------------------------------ turning pages

let turning = false
/** A turn asked for while the page is still settling from the last one: kept, and made right after (one at most). */
let queuedTurn: 1 | -1 | null = null
async function turn(direction: 1 | -1) {
  const e = engine.value
  if (!e || !ready.value || closing) return
  if (turning) {
    queuedTurn = direction
    return
  }
  if (endShown.value) {
    if (direction === -1) endShown.value = false
    return
  }
  if (direction === 1 && loc.value?.atEnd) {
    endShown.value = true
    return
  }
  turning = true
  readsOn()
  try {
    const el = host.value
    if (mode.value === 'c' && !reduced.value && el) {
      // The printed page lays the next one down: a short dip and a soft return, no slide.
      await el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: durationToken('instant'), easing: easingToken('exit'), fill: 'forwards' }).finished
      await (direction === 1 ? e.view.next() : e.view.prev())
      const back = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: durationToken('standard'), easing: easingToken('standard'), fill: 'forwards' })
      await back.finished
      el.getAnimations().forEach((a) => a.cancel())
    } else {
      await (direction === 1 ? e.view.next() : e.view.prev())
    }
  } finally {
    turning = false
  }
  const next = queuedTurn
  queuedTurn = null
  if (next) void turn(next)
}

function onTap(x: number) {
  if (!ready.value || sheetOpen.value) return
  // A tap beside a selection or an open highlight puts the menu away, and nothing else.
  if (menuOpen.value) return closeMenu()
  if (performance.now() - menuClosedAt < 400) return
  if (chrome.value) {
    chrome.value = false
    return
  }
  if (mode.value === 'b') {
    chrome.value = true
    return
  }
  const w = window.innerWidth
  if (x < w * 0.3) void turn(-1)
  else if (x > w * 0.7) void turn(1)
  else chrome.value = true
}

/** Scroll: pulled on past a chapter's end (or back past its top): the next (previous) chapter, as reading on. */
function onOverscroll(direction: 1 | -1) {
  if (mode.value !== 'b' || !ready.value || sheetOpen.value || menuOpen.value) return
  void turn(direction)
}

function onSwipe(direction: 1 | -1) {
  // The paginator turns pages under the finger itself; only past the last page is ours.
  if (mode.value === 'b' || !ready.value) return
  readsOn()
  if (direction === 1 && loc.value?.atEnd && !endShown.value) endShown.value = true
}

// Scroll: the chrome comes back when the member scrolls up, and leaves as she reads on.
let lastOffset = 0
let turnAt = 0
let lastIndex = -1
/** A jump (Contents, Search, the slider) scrolls too; that is not the member scrolling back, nor reading. */
let jumping = false
function jump(go: () => Promise<unknown> | undefined) {
  jumping = true
  writer.lookingUp()
  void Promise.resolve(go()).finally(() => setTimeout(() => (jumping = false), 400))
}
function onScroll(offset: number, size: number, viewSize: number) {
  if (mode.value !== 'b') return
  if (selection.value?.custom && !dragging.value) closeMenu()
  chapterFraction.value = viewSize > size ? Math.min(1, offset / (viewSize - size)) : 1
  const index = loc.value?.sectionIndex ?? -1
  if (index !== lastIndex || !ready.value || jumping) {
    lastIndex = index
    lastOffset = turnAt = offset
    return
  }
  const delta = offset - lastOffset
  if (Math.abs(delta) > 2) readsOn()
  if ((delta > 0 && offset < turnAt) || (delta < 0 && offset > turnAt)) turnAt = lastOffset
  lastOffset = offset
  if (offset - turnAt > 10 && chrome.value && !sheetOpen.value) chrome.value = false
  else if (turnAt - offset > 10 && !chrome.value) chrome.value = true
}

function onKey(event: KeyboardEvent) {
  if (sheetOpen.value || !ready.value) return
  if (['ArrowRight', 'PageDown', ' '].includes(event.key) && mode.value !== 'b') {
    event.preventDefault()
    void turn(1)
  } else if (['ArrowLeft', 'PageUp'].includes(event.key) && mode.value !== 'b') {
    event.preventDefault()
    void turn(-1)
  }
  // Escape: the layers' own Back entries (menu, slider, chrome, end page, the reader) close top first.
  else if (event.key === 'Escape') {
    if (menuOpen.value) closeMenu()
    else if (scrubbing.value) scrubbing.value = false
    else if (chrome.value) chrome.value = false
    else if (endShown.value) endShown.value = false
    else void close()
  }
}

// ------------------------------------------------------------------ the printed page's folio

function paintMargins() {
  const r = engine.value?.view.renderer
  if (!r?.heads || !r.feet) return
  const two = r.feet.length > 1
  // No running head: the top band is only air. The folio sits at the foot, small mono, faint. The paginator
  // keeps its bands in a closed shadow tree: classes do not reach in, the tokens (custom properties) do.
  for (const el of r.heads) el.textContent = ''
  const value = progressAt(info.value.fraction, pageCount.value)
  const folio = 'page' in value ? String(Math.max(1, value.page)) : t('reader.percent', { percent: value.percent })
  r.feet.forEach((el, i) => {
    Object.assign(el.style, {
      display: 'flex',
      height: '100%',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      color: 'var(--color-ink-faint)',
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-meta)',
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'nowrap',
    })
    el.textContent = !two || i === 0 ? folio : ''
  })
}

// ------------------------------------------------------------------ the slider (printed page)

const scrubOrigin = ref<{ cfi: string; fraction: number } | null>(null)
watch(scrubbing, (on) => {
  scrubOrigin.value = on && loc.value ? { cfi: loc.value.cfi, fraction: loc.value.fraction } : null
})
const chapterStarts = computed(() =>
  (engine.value?.toc ?? []).filter((item) => item.depth === 0 && item.fraction !== null).map((item) => ({ fraction: item.fraction!, label: item.label })),
)
function onScrub(fraction: number) {
  endShown.value = false
  jump(() => engine.value?.goToFraction(Math.min(fraction, 0.9995)))
}
function returnToOrigin() {
  const origin = scrubOrigin.value
  if (origin) jump(() => engine.value?.goTo(origin.cfi))
}

// ------------------------------------------------------------------ search (the app's palette)

const searchInitial = ref('')
let pickedInPalette = false
function openSearch(initial: string) {
  searchInitial.value = initial
  pickedInPalette = false
  paletteOpen.value = true
}
function onPaletteGo(cfi: string) {
  pickedInPalette = true
  jump(() => engine.value?.goTo(cfi))
}
function onPaletteSettled(direction: 'open' | 'close') {
  // A place picked: once the palette is the capsule (or bar) again, the chrome steps away.
  if (direction === 'close' && pickedInPalette) chrome.value = false
}

// ------------------------------------------------------------------ selected words

const selection = shallowRef<Selection | null>(null)
/** On a touch screen the reader selects itself (engine.ts): no browser bar over the words. */
const touchScreen = window.matchMedia('(pointer: coarse)').matches
/** A handle being dragged: the bubble waits until it is let go. */
const dragging = ref<null | 'start' | 'end'>(null)
let dragOffset = 0
function onHandleDown(which: 'start' | 'end', event: PointerEvent) {
  const s = selection.value
  if (!s) return
  try {
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  } catch {
    // A pointer the browser does not know: the moves still arrive on the handle.
  }
  // Probe the line the handle hangs from, not the point under the finger (which is below it).
  const line = which === 'start' ? s.first : s.last
  dragOffset = event.clientY - (line.top + line.height / 2)
  dragging.value = which
}
function onHandleMove(event: PointerEvent) {
  if (dragging.value) dragging.value = engine.value?.extendSelection(dragging.value, event.clientX, event.clientY - dragOffset) ?? dragging.value
}
function onHandleUp() {
  dragging.value = null
}

const tapped = shallowRef<{ highlight: Highlight; rect: Box } | null>(null)
const menuOpen = computed(() => Boolean(selection.value || tapped.value))
useBackDismiss(menuOpen, () => closeMenu())
let menuClosedAt = 0
const sheetText = ref('')
const toast = ref<string | null>(null)

const menuTarget = computed<MenuTarget | null>(() => {
  if (dragging.value) return null
  if (tapped.value) {
    const { highlight, rect } = tapped.value
    return { text: highlight.text, rect, first: rect, last: rect, color: highlight.color }
  }
  const s = selection.value
  if (!s) return null
  return { text: s.text, rect: s.rect, first: s.first, last: s.last, color: engine.value?.highlights.find((h) => h.cfi === s.cfi)?.color ?? null }
})
const canDefine = computed(() => isDefinable(menuTarget.value?.text ?? ''))

function onSelect(next: Selection | null) {
  if (!next) {
    if (selection.value) menuClosedAt = performance.now()
    selection.value = null
    return
  }
  tapped.value = null
  chrome.value = false
  selection.value = next
}
function onHighlightTapped(highlight: Highlight, rect: Box) {
  if (!ready.value || sheetOpen.value) return
  chrome.value = false
  selection.value = null
  tapped.value = { highlight, rect }
}
function closeMenu(clear = true) {
  if (menuOpen.value) menuClosedAt = performance.now()
  selection.value = null
  tapped.value = null
  if (clear) engine.value?.clearSelection()
}
function onColor(color: HighlightColor) {
  const e = engine.value
  if (!e) return
  const made: Highlight | null = tapped.value
    ? { ...tapped.value.highlight, color }
    : selection.value
      ? { cfi: selection.value.cfi, index: selection.value.index, text: selection.value.text, color }
      : null
  if (made) {
    e.highlight(made)
    // Kept on the device at once and sent through the outbox (offline too); another copy of the book gets it from there.
    reader.saveHighlight(props.entry.id, props.record.hash, made)
  }
  closeMenu()
}
function onRemove() {
  const e = engine.value
  // A tapped highlight, or words selected over one (the bubble offers Remove for both).
  const cfi = tapped.value?.highlight.cfi ?? (selection.value && e?.highlights.some((h) => h.cfi === selection.value?.cfi) ? selection.value.cfi : null)
  if (e && cfi) {
    e.unhighlight(cfi)
    reader.removeHighlight(props.entry.id, props.record.hash, cfi)
  }
  closeMenu()
}

/** What the page should draw: this copy's live highlights, from the device's list (which the server's joins). */
const placedHighlights = computed(() => reader.highlightsFor(props.entry.id, props.record.hash))
/** Highlights made in another file of this book (the Contents sheet lists them). */
const otherCopyHighlights = computed(() => reader.highlightsFromAnotherCopy(props.entry.id, props.record.hash))
/** A highlight that came from another device (or went) while the book is open is drawn (or lifted) in place. */
function reconcileHighlights() {
  const e = engine.value
  if (!e) return
  const wanted = new Map(placedHighlights.value.map((h) => [h.cfi, h]))
  for (const h of [...e.highlights]) {
    if (wanted.has(h.cfi)) continue
    if (tapped.value?.highlight.cfi === h.cfi) closeMenu()
    e.unhighlight(h.cfi)
  }
  for (const h of wanted.values()) {
    const have = e.highlights.find((x) => x.cfi === h.cfi)
    if (!have || have.color !== h.color) e.highlight(h)
  }
}
watch(placedHighlights, reconcileHighlights)
let stopFollowing: (() => void) | null = null
let toastTimer: ReturnType<typeof setTimeout> | undefined
function showToast(text: string) {
  toast.value = text
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = null), 1800)
}
async function onCopy() {
  const text = menuTarget.value?.text ?? ''
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // No Clipboard API (an insecure context): copy through a hidden field (iOS wants a range set on it).
    const area = Object.assign(document.createElement('textarea'), { value: text })
    area.style.cssText = 'position:fixed;opacity:0;top:0;left:0'
    document.body.append(area)
    area.select()
    area.setSelectionRange(0, text.length)
    document.execCommand('copy')
    area.remove()
  }
  closeMenu()
  showToast(t('reader.menu.copied'))
}
function openLookup(kind: 'translate' | 'define' | 'search') {
  const text = menuTarget.value?.text ?? ''
  closeMenu()
  if (kind === 'search') return openSearch(text)
  sheetText.value = text
  if (kind === 'translate') translateOpen.value = true
  else defineOpen.value = true
}
function swapLookup(kind: 'translate' | 'define') {
  translateOpen.value = kind === 'translate'
  defineOpen.value = kind === 'define'
}

// ------------------------------------------------------------------ opening and closing (docs/MOTION.md, Reader)

/** The page box the cover lands in: the whole page, inside the text's margins. */
function pageArea(): Box {
  const { width } = viewport
  const { top: insetTop, bottom: insetBottom } = insets()
  const height = viewport.height - insetTop - insetBottom
  const l = layout.value
  if (l.flow === 'scrolled') return { left: width * l.gap, top: insetTop + l.margin, width: width * (1 - 2 * l.gap), height: height - 2 * l.margin }
  const columns = l.maxColumns === 2 && width > height ? 2 : 1
  const inline = Math.min(width * (1 - 2 * l.gap), l.maxInlineSize * columns)
  const area = { left: (width - inline) / 2, top: insetTop + l.margin, width: inline, height: height - 2 * l.margin }
  return columns === 2 ? { ...area, width: area.width / 2 - (width * l.gap) / 2 } : area
}

/** Where the book's own cover is drawn on the page showing, if it is a cover page. */
function coverOnPage(): Box | null {
  const doc = (engine.value?.view.renderer as unknown as { getContents?: () => { doc: Document }[] })?.getContents?.()?.[0]?.doc
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

/** The hero cover's corners (`radius.coverLg`), read from the token. */
function heroRadius(): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--radius-cover-lg')) || 0
}

async function openFlight(engineReady: Promise<ReaderEngine | null>) {
  const layer = root.value!
  const pageEl = page.value!
  const hero = reduced.value ? null : heroImage()
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
  const copy = readerCoverCopy(flyLayer.value!, hero.src, target)
  hero.el.style.visibility = 'hidden'
  pageEl.style.opacity = '0'
  const duration = durationToken('sheet')
  const easing = easingToken('standard')
  const flight = copy.animate([poseOf(target, hero.box, heroRadius()), REST], { duration, easing, fill: 'both' })
  layer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: duration * 0.8, easing })
  const [, opened] = await Promise.all([flight.finished, engineReady])
  // The hand-off: on a cover page the copy settles onto the page's own cover and goes; elsewhere it dissolves into the page.
  const onPage = opened ? coverOnPage() : null
  if (onPage && (Math.abs(onPage.left - target.left) > 1 || Math.abs(onPage.top - target.top) > 1 || Math.abs(onPage.width - target.width) > 1)) {
    await copy.animate([REST, poseOf(target, onPage, 0)], { duration: durationToken('quick'), easing, fill: 'forwards' }).finished
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
/** Unmounted without Back (signed out, another route): no flight home, but nothing is lost either. */
let gone = false
/** What leaving the book always does, once: the progress and the place written at once. */
let left = false
function leave() {
  if (left) return
  left = true
  writer.flush()
  if (loc.value) reader.leavePlace(props.entry.id, { cfi: loc.value.cfi, fraction: loc.value.fraction, fileHash: props.record.hash }, { now: true })
  releaseWake()
  stopFollowing?.()
  stopFollowing = null
}
function destroyEngine() {
  const e = engine.value
  engine.value = null
  e?.destroy()
}
async function close() {
  if (closing) return
  closing = true
  open.value = false
  chrome.value = false
  endShown.value = false
  leave()
  const layer = root.value
  const pageEl = page.value
  giveBackTheme()
  const hero = layer && pageEl && !reduced.value && ready.value ? heroImage() : null
  if (layer && pageEl && hero) {
    const ratio = await ratioOf(hero.src)
    const target = coverOnPage() ?? fitBox(pageArea(), ratio)
    const copy = readerCoverCopy(flyLayer.value!, hero.src, target)
    hero.el.style.visibility = 'hidden'
    const easing = easingToken('standard')
    // The page gives way to its cover, which then flies home; the room fades as it goes.
    copy.animate([{ opacity: 0 }, { opacity: 1 }], { duration: durationToken('quick'), easing, fill: 'both' })
    await pageEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: durationToken('quick'), easing, fill: 'forwards' }).finished
    const duration = durationToken('exit') * 1.4
    layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing, fill: 'forwards' })
    await copy.animate([REST, poseOf(target, hero.box, heroRadius())], { duration, easing, fill: 'forwards' }).finished
    hero.el.style.visibility = ''
    copy.remove()
  } else if (layer) {
    await layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: durationToken('exit'), easing: easingToken('exit'), fill: 'forwards' }).finished
  }
  destroyEngine()
  emit('closed')
}

// ------------------------------------------------------------------ the screen kept on

type WakeLock = { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> }
let wakeSentinel: { release: () => Promise<void> } | null = null
async function applyWake() {
  if (!settings.keepAwake || closing) return releaseWake()
  const api = (navigator as Navigator & { wakeLock?: WakeLock }).wakeLock
  if (!api || wakeSentinel) return
  try {
    wakeSentinel = await api.request('screen')
  } catch {
    // Refused (battery saver, page hidden): the screen turns off as usual.
  }
}
function releaseWake() {
  void wakeSentinel?.release().catch(() => {})
  wakeSentinel = null
}
watch(() => settings.keepAwake, applyWake)
function onVisibility() {
  // The lock goes when the page is hidden; it is asked for again when the book comes back.
  if (document.visibilityState === 'visible') {
    wakeSentinel = null
    if (settings.keepAwake && !closing) void applyWake()
  }
}

// ------------------------------------------------------------------ start, finish, the end

/** Start reading for a Want to read Book: the app's Start sheet, once, after the book has opened. */
let askedToStart = false
const finishedHere = computed(() => status.value === 'finished')
function finish() {
  reading.openFinish(entryNow.value)
}

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', onResize)
  document.addEventListener('visibilitychange', onVisibility)
  const engineReady = (async () => {
    const [file, at, highlights] = await Promise.all([
      ebooks.fileOf(props.record),
      reader.openingPlaceFor(props.entry.id, props.record.hash),
      // The device's highlights, joined by the server's when they come in time (and, once any are uploaded, those from before the sync).
      reader.openHighlights(props.entry.id, props.record.hash),
    ])
    if (!file) {
      failed.value = 'missing'
      return null
    }
    const { openReader } = await import('~/reader/engine')
    const opened = await openReader(host.value!, new File([file], props.record.name || 'book.epub', { type: 'application/epub+zip' }), {
      handlers: {
        relocate: onRelocate,
        tap: (x) => onTap(x),
        scroll: onScroll,
        swipe: onSwipe,
        overscroll: onOverscroll,
        select: onSelect,
        highlightTapped: onHighlightTapped,
      },
      highlights,
      colorOf: highlightColor,
      touchSelection: touchScreen,
      layout: layout.value,
      settings,
      colors: colors(),
      at: at ? ('cfi' in at ? at.cfi : at.fraction) : progressFraction(reader.progressFor(props.entry.id), pageCount.value) || null,
      startedAt: performance.now(),
      importedAt: performance.now(),
    })
    // Closed (or gone) while the book was still opening: it never shows.
    if (closing || gone) {
      opened.destroy()
      return null
    }
    engine.value = opened
    // Highlights that arrived while the book was opening, and then every minute and on coming back.
    reconcileHighlights()
    if (!left) stopFollowing = reader.followHighlights(props.entry.id, props.record.hash)
    if (import.meta.dev) (window as unknown as { __readerEngine?: unknown }).__readerEngine = opened
    return opened
  })().catch(() => {
    failed.value = failed.value ?? 'failed'
    return null
  })
  await openFlight(engineReady)
  // Back during the opening flight: the room was never taken over, and must not be after close() gave it back.
  if (closing || gone) return
  ready.value = true
  takeOverTheme()
  void applyWake()
  if (mode.value === 'c') paintMargins()
  if (status.value === 'want_to_read' && !askedToStart && !failed.value) {
    askedToStart = true
    setTimeout(() => !closing && reading.openStart(entryNow.value), durationToken('standard'))
  }
})

onBeforeUnmount(() => {
  gone = true
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', onResize)
  document.removeEventListener('visibilitychange', onVisibility)
  clearTimeout(toastTimer)
  leave()
  writer.dispose()
  giveBackTheme()
  destroyEngine()
})

// ------------------------------------------------------------------ actions from the chrome and sheets

function goTo(href: string) {
  contentsOpen.value = false
  chrome.value = false
  endShown.value = false
  jump(() => engine.value?.goTo(href))
}
function nextChapter() {
  if (loc.value?.atEnd) endShown.value = true
  else {
    readsOn()
    void engine.value?.view.next()
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      ref="root"
      class="reader fixed inset-0 z-35 overflow-hidden bg-surface text-ink outline-none"
      :class="`reader-${mode}`"
      :data-theme="theme"
      role="dialog"
      aria-modal="true"
      :aria-label="book.title"
      tabindex="-1"
      data-testid="reader"
      :data-ready="ready || undefined"
      :data-mode="mode"
      :data-fraction="loc ? loc.fraction.toFixed(3) : undefined"
      :data-chapter="loc?.sectionIndex"
    >
      <span ref="probe" class="bar-top safe-bottom pointer-events-none fixed top-0 left-0 opacity-0" aria-hidden="true" />
      <div ref="page" class="absolute inset-0">
        <div ref="host" class="page-host absolute inset-x-0" data-testid="reader.page" />
      </div>

      <ReaderChromeClassic
        v-if="mode === 'a'"
        :shown="chrome && ready"
        :search="paletteChrome"
        :info="info"
        @back="close"
        @contents="contentsOpen = true"
        @type="typeOpen = true"
        @search="openSearch('')"
        @scrub="onScrub"
        @set-here="setHere"
      />
      <ReaderChromeScroll
        v-else-if="mode === 'b'"
        :shown="chrome && ready"
        :search="paletteChrome"
        :ready="ready"
        :info="info"
        :next-label="loc?.atEnd ? t('reader.theEnd') : t('reader.nextChapter')"
        @back="close"
        @contents="contentsOpen = true"
        @type="typeOpen = true"
        @search="openSearch('')"
        @next="nextChapter"
        @set-here="setHere"
      />
      <ReaderChromePrinted
        v-else
        v-model:scrubbing="scrubbing"
        :shown="chrome && ready"
        :search="paletteChrome"
        :info="info"
        :chapters="chapterStarts"
        :saved="status === 'reading' ? progressFraction(reader.progressFor(entry.id), pageCount) || null : null"
        :origin="scrubOrigin && Math.abs(scrubOrigin.fraction - info.fraction) > 0.002 ? placeWords(scrubOrigin.fraction) : null"
        :reduce-motion="reduced"
        @scrub="onScrub"
        @return-to-origin="returnToOrigin"
        @back="close"
        @contents="contentsOpen = true"
        @type="typeOpen = true"
        @search="openSearch('')"
        @set-here="setHere"
      />

      <!-- The reader's own selection (touch screens): a lamp wash over the words and two handles to stretch it. -->
      <div v-if="selection?.custom" class="pointer-events-none absolute inset-0 z-20" data-testid="reader.selection">
        <span
          v-for="(r, i) in selection.rects"
          :key="i"
          class="sel absolute"
          :style="{ left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` }"
        />
        <button
          v-for="which in ['start', 'end'] as const"
          :key="which"
          type="button"
          class="handle pointer-events-auto absolute flex size-(--size-touch) justify-center"
          :style="
            which === 'start'
              ? { left: `calc(${selection.first.left}px - var(--size-touch) / 2)`, top: `${selection.first.top}px`, '--stem': `${selection.first.height}px` }
              : { left: `calc(${selection.last.left + selection.last.width}px - var(--size-touch) / 2)`, top: `${selection.last.top}px`, '--stem': `${selection.last.height}px` }
          "
          :aria-label="which === 'start' ? t('reader.menu.startHandle') : t('reader.menu.endHandle')"
          :data-testid="`reader.handle.${which}`"
          @pointerdown="onHandleDown(which, $event)"
          @pointermove="onHandleMove"
          @pointerup="onHandleUp"
          @pointercancel="onHandleUp"
        >
          <span class="stem" aria-hidden="true" /><span class="knob" aria-hidden="true" />
        </button>
      </div>

      <SelectionMenu
        :target="menuTarget"
        :can-define="canDefine"
        @translate="openLookup('translate')"
        @define="openLookup('define')"
        @copy="onCopy"
        @search="openLookup('search')"
        @color="onColor"
        @remove="onRemove"
      />
      <Transition name="toast">
        <p v-if="toast" class="toast figures pointer-events-none fixed inset-x-0 z-40 flex justify-center" role="status">
          <span class="rounded-pill bg-ink px-md py-xs text-meta text-on-ink shadow-float">{{ toast }}</span>
        </p>
      </Transition>

      <ReaderEndOfBook :shown="endShown" :book="book" :finished="finishedHere" @finish="finish" @back="endShown = false" @close="close" />

      <div v-if="failed" class="absolute inset-0 flex flex-col items-center justify-center gap-lg px-xl text-center" data-testid="reader.failed">
        <p class="text-subhead text-ink-muted">{{ t(failed === 'missing' ? 'reader.missing' : 'reader.failed') }}</p>
        <UiButton tone="secondary" size="md" data-testid="reader.failedBack" @click="close">{{ t('reader.back') }}</UiButton>
      </div>

      <ReaderTypeSheet v-model:open="typeOpen" :settings="settings" />
      <ReaderContentsSheet
        v-model:open="contentsOpen"
        :toc="engine?.toc ?? []"
        :current="loc?.chapterHref ?? null"
        :info="info"
        :other-copy="otherCopyHighlights"
        :book="book"
        @go="goTo"
        @remove-highlight="(id: string) => reader.removeHighlightById(props.entry.id, id)"
        @scrub="(f: number) => ((contentsOpen = false), onScrub(f))"
      />
      <ReaderTranslateSheet v-model:open="translateOpen" :text="sheetText" :from="engine?.language ?? 'en'" :online="online" @define="swapLookup('define')" />
      <ReaderDefineSheet v-model:open="defineOpen" :text="sheetText" :language="engine?.language ?? 'en'" :online="online" @translate="swapLookup('translate')" />
      <ReaderSearch
        v-model:open="paletteOpen"
        :engine="engine"
        :initial="searchInitial"
        :here="loc?.cfi ?? null"
        :reduce-motion="reduced"
        @go="onPaletteGo"
        @chrome="paletteChrome = $event"
        @settled="onPaletteSettled"
      />
    </div>
    <!-- Outside the reader's layer, so the cover keeps its opacity while the room fades in and out under it. -->
    <div ref="flyLayer" class="pointer-events-none fixed inset-0 z-36" aria-hidden="true" />
  </Teleport>
</template>

<style scoped>
/* The book's page lies between the status bar and the gesture bar; its own bands are only the text's. */
.page-host {
  top: var(--safe-area-top);
  bottom: var(--safe-area-bottom);
}
.toast {
  bottom: calc(var(--float-bottom) + var(--spacing-xxl));
}
.toast-enter-active {
  transition: opacity var(--duration-quick) var(--ease-standard);
}
.toast-leave-active {
  transition: opacity var(--duration-exit) var(--ease-exit);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
}
/* The reader's own selection: the lamp's soft wash, and handles like Android's and iOS's, in the lamp colour. */
.sel {
  background: color-mix(in srgb, var(--color-accent) 30%, transparent);
  border-radius: var(--radius-cover-sm);
}
.handle {
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
}
.handle .stem {
  position: absolute;
  top: 0;
  left: calc(50% - var(--stroke-focus) / 2);
  width: var(--stroke-focus);
  height: calc(var(--stem) + var(--spacing-xs));
  background: var(--color-accent);
}
.handle .knob {
  position: absolute;
  top: calc(var(--stem) + var(--spacing-xxs));
  left: calc(50% - var(--spacing-sm));
  width: var(--spacing-md);
  height: var(--spacing-md);
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  box-shadow: var(--elevation-button);
}
/* Highlights wash the words: multiplied into paper, softer and plain in the dark. */
.reader :deep(foliate-view) {
  --overlayer-highlight-opacity: 0.42;
  --overlayer-highlight-blend-mode: multiply;
}
.reader[data-theme='dark'] :deep(foliate-view) {
  --overlayer-highlight-opacity: 0.3;
  --overlayer-highlight-blend-mode: normal;
}
</style>

