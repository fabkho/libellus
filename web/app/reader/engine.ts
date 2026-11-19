/**
 * The reader's engine (#131 phase 2): foliate-js (`./foliate-js`, MIT; see its
 * VENDORED.md) behind a small, typed surface. Only ever reached through a
 * dynamic `import('~/reader/engine')` from components/reader/Reader.vue, so
 * foliate-js is in the lazy `ebook-reader` chunks (nuxt.config.ts), never in
 * the entry nor in the service worker's precache; they are fetched ahead for a member who has an ebook
 * (data/reader/prefetch.ts) and kept by a runtime cache.
 *
 * What it adds to foliate: the page's stylesheet from the member's settings and
 * the reader's room; every page sanitized before it loads and shown in a frame
 * that runs no script where the browser allows it (`data/reader/markup.ts`); the body's end
 * (back matter such as a licence is not part of "the end"); taps, swipes, pulls
 * past a chapter's ends, highlights, search, and on touch screens the reader's
 * own text selection (long-press and handles), so the browser's selection bar
 * never covers the words.
 */
import newsreader400 from '@fontsource/newsreader/files/newsreader-latin-400-normal.woff2?url'
import newsreader400i from '@fontsource/newsreader/files/newsreader-latin-400-italic.woff2?url'
import newsreader600 from '@fontsource/newsreader/files/newsreader-latin-600-normal.woff2?url'
import geist400 from '@fontsource/geist/files/geist-latin-400-normal.woff2?url'
import geist600 from '@fontsource/geist/files/geist-latin-600-normal.woff2?url'
import { sourceLanguage } from '~/data/reader/lookup'
import type { Highlight } from '~/data/reader/device'
import { resourceType, sanitizeResource } from '~/data/reader/markup'
import { describeSelection, type Box } from '~/data/reader/geometry'
import { pageCss, type Flow, type PageColors, type PageFonts } from '~/data/reader/pageCss'
import { normalizeRelocation, type RelocateDetail, type Relocation, type RelocationRenderer } from '~/data/reader/relocation'
import type { ReaderSettings } from '~/data/reader/settings'
import { findBodyEnd, flattenToc, type TocItem } from '~/data/reader/toc'
import { makeBook, UnsupportedTypeError } from './foliate-js/view.js'
import { EPUB } from './foliate-js/epub.js'
import { frame } from './foliate-js/frame.js'
import { compare as compareCfi } from './foliate-js/epubcfi.js'
import { Overlayer } from './foliate-js/overlayer.js'

// The book's structure, its relocation and the page's typesetting are the reader's data layer (`data/reader/`,
// tested there); this file is the DOM adapter over foliate-js that hands them what only the page can say.
export type { Box, Flow, PageColors, Relocation, TocItem }

export interface Timings {
  /** From the call to the engine being imported (the lazy chunk). */
  importMs: number
  /** Zip index + OPF + nav parsed. */
  parseMs: number
  /** First page laid out and shown. */
  firstPageMs: number
  bytes: number
}

export interface EngineHandlers {
  relocate: (location: Relocation) => void
  /** A tap inside the book's page, in viewport coordinates. */
  tap: (x: number, y: number) => void
  /** The renderer scrolled (scrolled flow), with the new offset. */
  scroll: (offset: number, size: number, viewSize: number) => void
  /** A horizontal swipe on the page (the paginator turns by itself; this is for past the last page). */
  swipe: (direction: 1 | -1) => void
  /** Scroll flow: the member pulled on past the end of a chapter (1) or back past its top (-1). */
  overscroll: (direction: 1 | -1) => void
  /** Text was selected in the page (or the selection went away: null). */
  select: (selection: Selection | null) => void
  /** A highlight was tapped. */
  highlightTapped: (highlight: Highlight, rect: Box) => void
}

/** What the member selected: its words, its place (a CFI) and where it is on screen. */
export interface Selection {
  text: string
  cfi: string
  index: number
  rect: Box
  /** The first and last line's boxes: the menu sits above the first or below the last. */
  first: Box
  last: Box
  /** Every line's box (drawn by the reader when it does the selecting itself). */
  rects: Box[]
  /** Selected by the reader's own long-press and handles (touch screens), not the browser's. */
  custom: boolean
}

export interface SearchHit {
  cfi: string
  pre: string
  match: string
  post: string
  chapter: string
}

export interface Layout {
  flow: Flow
  animated: boolean
  /** Side margins as a share of the width (paginator `gap`). */
  gap: number
  /** Height of the header and footer bands in px (running heads and folios live there). */
  margin: number
  maxColumns: 1 | 2
  maxInlineSize: number
}

type FoliateView = HTMLElement & {
  open: (book: unknown) => Promise<void>
  init: (options: { lastLocation?: string | null; showTextStart?: boolean }) => Promise<void>
  goTo: (target: unknown) => Promise<unknown>
  goToFraction: (fraction: number) => Promise<void>
  next: () => Promise<void>
  prev: () => Promise<void>
  close: () => void
  getSectionFractions: () => number[]
  getCFI: (index: number, range: Range) => string
  addAnnotation: (annotation: { value: string; color?: string }) => Promise<unknown>
  deleteAnnotation: (annotation: { value: string }) => Promise<unknown>
  search: (options: { query: string; matchCase?: boolean; matchDiacritics?: boolean; matchWholeWords?: boolean }) => AsyncGenerator<unknown>
  clearSearch: () => void
  language?: { canonical?: string }
  book: {
    metadata?: { title?: unknown; author?: unknown; language?: unknown }
    toc?: { label: string; href: string; subitems?: unknown[] }[]
    sections: { id: string; linear?: string; size: number }[]
    getCover?: () => Promise<Blob | null>
    resolveHref: (href: string) => { index: number } | null
    landmarks?: { type: string[]; href: string }[]
    transformTarget?: EventTarget
  }
  renderer: HTMLElement & {
    setStyles: (css: string | [string, string]) => void
    heads?: HTMLElement[] | null
    feet?: HTMLElement[] | null
    start: number
    end: number
    size: number
    viewSize: number
    page: number
    pages: number
    atEnd: boolean
    atStart: boolean
    next: (distance?: number) => Promise<void>
    prev: (distance?: number) => Promise<void>
    nextSection: () => Promise<void>
    prevSection: () => Promise<void>
    goTo: (target: unknown) => Promise<void>
    render?: () => void
  }
  lastLocation?: { cfi: string } | null
}

function text(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(', ')
  if (typeof value === 'object') {
    const named = value as { name?: unknown }
    if (named.name) return text(named.name)
    const first = Object.values(value as Record<string, unknown>)[0]
    return text(first)
  }
  return String(value)
}

export class ReaderEngine {
  readonly view: FoliateView
  title = ''
  author = ''
  cover: Blob | null = null
  toc: TocItem[] = []
  timings: Timings = { importMs: 0, parseMs: 0, firstPageMs: 0, bytes: 0 }
  last: Relocation | null = null
  private bodyEnd = 1
  private bodyEndIndex = 0
  private handlers: EngineHandlers
  private sectionFractions: number[] = []
  highlights: Highlight[] = []
  /** A highlight colour's value (the token's), for the overlay in the page (which sees no CSS variables). */
  colorOf: (color: Highlight['color']) => string = () => 'transparent'
  /** When a highlight was last tapped: that tap is not also a page turn. */
  annotationTappedAt = 0
  /** Until when a tap is ignored (the end of a long-press that selected a word). */
  suppressTapUntil = 0
  /**
   * On touch screens the reader selects text itself (long-press a word, drag the
   * handles): the browser's selection is off in the page, so neither Chrome on
   * Android (Copy · Select all · Web search · Share) nor Safari on iOS (Copy ·
   * Look Up · Translate · Share) shows its own bar over the words.
   */
  touchSelection = false
  customRange: Range | null = null
  customDoc: Document | null = null
  private pressWord: Range | null = null
  onSelect: ((s: Selection | null) => void) | null = null
  /** The book's language as MyMemory wants it ("en", "pt-BR"), for translating and looking up words; "" when the book names none ("und", "mul", nothing). */
  get language(): string {
    return sourceLanguage(this.view.language?.canonical) ?? sourceLanguage(text(this.view.book.metadata?.language)) ?? ''
  }

  constructor(view: FoliateView, handlers: EngineHandlers) {
    this.view = view
    this.handlers = handlers
  }

  /** Builds the book's facts once it is open: body end, contents with their places. */
  prepare() {
    const { book } = this.view
    this.title = text(book.metadata?.title)
    this.author = text(book.metadata?.author)
    this.sectionFractions = this.view.getSectionFractions()
    // The body ends before the first back-matter section after the last real one (`data/reader/toc.ts`).
    const body = findBodyEnd(book.sections, this.sectionFractions)
    this.bodyEndIndex = body.index
    this.bodyEnd = body.fraction
    this.toc = flattenToc(book, this.sectionFractions, this.bodyEnd)
  }

  /** foliate's `relocate`: the paginator's numbers are read off the renderer element, `data/reader/relocation.ts` does the rest. */
  onRelocate(detail: RelocateDetail) {
    const renderer = this.view.renderer
    const r: RelocationRenderer = {
      flow: renderer.getAttribute('flow'),
      page: renderer.page,
      pages: renderer.pages,
      size: renderer.size,
      viewSize: renderer.viewSize,
      end: renderer.end,
      fraction: sectionFractionOf(renderer),
    }
    this.last = normalizeRelocation(detail, r, this.bodyEnd, this.bodyEndIndex)
    this.handlers.relocate(this.last)
  }

  next() {
    if (this.last?.atEnd) return Promise.resolve(false)
    return this.view.next().then(() => true)
  }
  prev() {
    return this.view.prev()
  }
  goTo(target: string | number) {
    return this.view.goTo(target)
  }
  goToFraction(fraction: number) {
    return this.view.goToFraction(Math.min(0.9999, fraction * this.bodyEnd))
  }
  /** A body fraction as the view's own (for jumps by page). */
  bodyFractionOf(href: string) {
    return this.toc.find((item) => item.href === href)?.fraction ?? null
  }

  setLayout(layout: Layout) {
    const r = this.view.renderer
    r.setAttribute('flow', layout.flow)
    r.setAttribute('gap', `${(layout.gap * 100).toFixed(1)}%`)
    r.setAttribute('margin', `${layout.margin}px`)
    r.setAttribute('max-column-count', String(layout.maxColumns))
    r.setAttribute('max-inline-size', `${layout.maxInlineSize}px`)
    r.toggleAttribute('animated', layout.animated)
  }

  setStyles(settings: ReaderSettings, colors: PageColors) {
    const flow = this.view.renderer.getAttribute('flow') === 'scrolled' ? 'scrolled' : 'paginated'
    this.view.renderer.setStyles(pageCss(settings, colors, pageFonts(), flow, this.touchSelection))
  }

  highlight(highlight: Highlight) {
    this.highlights = [...this.highlights.filter((h) => h.cfi !== highlight.cfi), highlight]
    // A range this copy cannot resolve (a damaged record) is skipped, not an error.
    void this.view.addAnnotation({ value: highlight.cfi, color: this.colorOf(highlight.color) }).catch(() => undefined)
  }
  unhighlight(cfi: string) {
    this.highlights = this.highlights.filter((h) => h.cfi !== cfi)
    void this.view.deleteAnnotation({ value: cfi })
  }
  // ---------------------------------------------------------------- the reader's own selection (touch)

  private caretAt(doc: Document, x: number, y: number): { node: Node; offset: number } | null {
    const d = doc as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null }
    const p = d.caretPositionFromPoint?.(x, y)
    if (p) return { node: p.offsetNode, offset: p.offset }
    const r = doc.caretRangeFromPoint?.(x, y)
    return r ? { node: r.startContainer, offset: r.startOffset } : null
  }
  /** The word under a point (in the page's own coordinates), or null on space and pictures. */
  private wordAt(doc: Document, x: number, y: number): Range | null {
    // Only the page on screen: in pages the page's document runs on sideways into the next pages.
    const frame = doc.defaultView?.frameElement?.getBoundingClientRect()
    if (frame) {
      const vx = Math.min(Math.max(frame.left + x, 1), window.innerWidth - 1)
      const vy = Math.min(Math.max(frame.top + y, 1), window.innerHeight - 1)
      x = vx - frame.left
      y = vy - frame.top
    }
    const caret = this.caretAt(doc, x, y)
    if (!caret || caret.node.nodeType !== Node.TEXT_NODE) return null
    const node = caret.node as Text
    const segmenter = new Intl.Segmenter(this.language || undefined, { granularity: 'word' })
    for (const seg of segmenter.segment(node.data)) {
      const end = seg.index + seg.segment.length
      if (caret.offset >= seg.index && caret.offset <= end && (caret.offset < end || seg.isWordLike)) {
        if (!seg.isWordLike) return null
        const range = doc.createRange()
        range.setStart(node, seg.index)
        range.setEnd(node, end)
        return range
      }
    }
    return null
  }
  /** Long-press: the word under the finger. */
  selectWordAt(doc: Document, x: number, y: number): boolean {
    const word = this.wordAt(doc, x, y)
    if (!word) return false
    this.customDoc = doc
    this.customRange = word
    this.pressWord = word.cloneRange()
    this.reportCustom()
    return true
  }
  /** Where a point stands against another: -1 before it, 0 on it, 1 after it. */
  private order(doc: Document, anchor: [Node, number], node: Node, offset: number): number {
    const at = doc.createRange()
    at.setStart(anchor[0], anchor[1])
    return at.comparePoint(node, offset)
  }
  /** The finger moves on after the long-press: from the pressed word to the word under it, either way. */
  extendFromPress(x: number, y: number) {
    const doc = this.customDoc
    const press = this.pressWord
    if (!doc || !press) return
    const word = this.wordAt(doc, x, y)
    if (!word) return
    const range = doc.createRange()
    if (this.order(doc, [press.startContainer, press.startOffset], word.startContainer, word.startOffset) >= 0) {
      range.setStart(press.startContainer, press.startOffset)
      range.setEnd(word.endContainer, word.endOffset)
    } else {
      range.setStart(word.startContainer, word.startOffset)
      range.setEnd(press.endContainer, press.endOffset)
    }
    this.customRange = range
    this.reportCustom()
  }
  /** A handle dragged to a point on screen (viewport coordinates); returns which end it now is (they can cross). */
  extendSelection(which: 'start' | 'end', vx: number, vy: number): 'start' | 'end' {
    const doc = this.customDoc
    const current = this.customRange
    const frame = doc?.defaultView?.frameElement?.getBoundingClientRect()
    if (!doc || !current || !frame) return which
    const word = this.wordAt(doc, vx - frame.left, vy - frame.top)
    if (!word) return which
    // The other end stays where it is; the dragged one goes to the word, before or after it.
    const anchor: [Node, number] = which === 'end' ? [current.startContainer, current.startOffset] : [current.endContainer, current.endOffset]
    const range = doc.createRange()
    let now: 'start' | 'end'
    if (which === 'end' ? this.order(doc, anchor, word.endContainer, word.endOffset) > 0 : this.order(doc, anchor, word.startContainer, word.startOffset) >= 0) {
      range.setStart(anchor[0], anchor[1])
      range.setEnd(word.endContainer, word.endOffset)
      now = 'end'
    } else {
      range.setStart(word.startContainer, word.startOffset)
      range.setEnd(anchor[0], anchor[1])
      now = 'start'
    }
    if (range.collapsed) return which
    this.customRange = range
    this.reportCustom()
    return now
  }
  reportCustom() {
    const range = this.customRange
    const doc = this.customDoc
    if (!range || !doc) return this.onSelect?.(null)
    this.onSelect?.(describeRange(this, doc, range, true))
  }

  clearSelection() {
    this.customRange = null
    this.pressWord = null
    const contents = (this.view.renderer as unknown as { getContents: () => { doc: Document }[] }).getContents()
    for (const { doc } of contents) doc.getSelection()?.removeAllRanges()
  }

  /** Every place in the book where `query` stands, chapter by chapter as they are searched. */
  async *search(query: string, color: string): AsyncGenerator<{ progress: number } | { hits: SearchHit[] }> {
    const found = this.view.search({ query, matchCase: false, matchDiacritics: false, matchWholeWords: false, draw: Overlayer.outline, drawOptions: { color, width: 1.5, radius: 3 } } as never)
    for await (const result of found) {
      if (result === 'done') return
      const r = result as { progress?: number; label?: string; subitems?: { cfi: string; excerpt: { pre: string; match: string; post: string } }[] }
      if (r.subitems) {
        yield { hits: r.subitems.map((item) => ({ cfi: item.cfi, ...item.excerpt, chapter: (r.label ?? '').trim() })) }
      } else if (typeof r.progress === 'number') yield { progress: r.progress }
    }
  }
  clearSearch() {
    this.view.clearSearch()
  }
  /** -1, 0 or 1: where one place stands against another. */
  compareCfi(a: string, b: string): number {
    try {
      return compareCfi(a, b)
    } catch {
      return 0
    }
  }

  destroy() {
    this.view.close()
    this.view.remove()
  }
}

/** The app's fonts as the page's frame needs them: absolute, because the book's document resolves URLs against its own blob. */
function pageFonts(): PageFonts {
  return {
    serif: new URL(newsreader400, location.href).href,
    serifItalic: new URL(newsreader400i, location.href).href,
    serifBold: new URL(newsreader600, location.href).href,
    sans: new URL(geist400, location.href).href,
    sansBold: new URL(geist600, location.href).href,
  }
}

/** How far through the section the paginator stands: its scroll offset in scroll flow, its text page in pages. */
function sectionFractionOf(renderer: FoliateView['renderer']): number {
  const scrolled = renderer.getAttribute('flow') === 'scrolled'
  const fraction = scrolled ? renderer.start / Math.max(1, renderer.viewSize - renderer.size) : (renderer.page - 1) / Math.max(1, renderer.pages - 3)
  return Math.min(1, Math.max(0, fraction))
}

/**
 * Long-press a word (450 ms, the finger still) to select it, keep the finger
 * down and move to stretch the selection word by word; the handles do the rest
 * (Reader.vue). Listens on the page's window in the capture phase, so while the
 * finger is selecting, foliate's own swipe (on the document) never sees the
 * moves and the page does not turn. Touch events, caret-from-point and
 * Intl.Segmenter: the same in Chrome on Android and Safari on iOS.
 */
function installTouchSelection(engine: ReaderEngine, doc: Document) {
  const win = doc.defaultView
  if (!win) return
  // The browser's own long-press menus (a picture's "Download image", Safari's callout) stay away too.
  doc.addEventListener('contextmenu', (e) => e.preventDefault())
  doc.addEventListener('selectstart', (e) => e.preventDefault())
  let press: { x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null
  let selecting = false
  const cancel = () => {
    if (press) clearTimeout(press.timer)
    press = null
  }
  win.addEventListener(
    'touchstart',
    (e) => {
      cancel()
      const t = e.touches[0]
      if (e.touches.length !== 1 || !t) return
      const x = t.clientX
      const y = t.clientY
      press = {
        x,
        y,
        timer: setTimeout(() => {
          press = null
          if (engine.selectWordAt(doc, x, y)) {
            selecting = true
            navigator.vibrate?.(8)
          }
        }, 450),
      }
    },
    { capture: true, passive: true },
  )
  win.addEventListener(
    'touchmove',
    (e) => {
      const t = e.touches[0]
      if (!t) return
      if (selecting) {
        e.preventDefault()
        e.stopImmediatePropagation()
        engine.extendFromPress(t.clientX, t.clientY)
        return
      }
      if (press && Math.hypot(t.clientX - press.x, t.clientY - press.y) > 10) cancel()
    },
    { capture: true, passive: false },
  )
  const end = () => {
    cancel()
    if (selecting) {
      selecting = false
      engine.suppressTapUntil = performance.now() + 500
      engine.reportCustom()
    }
  }
  win.addEventListener('touchend', end, { capture: true })
  win.addEventListener('touchcancel', end, { capture: true })
}

/** A range as the reader's menu needs it: words, place, boxes on screen (the arithmetic is `data/reader/geometry.ts`). */
function describeRange(engine: ReaderEngine, doc: Document, range: Range, custom: boolean): Selection | null {
  const index = engine.last?.sectionIndex ?? 0
  const frame = doc.defaultView?.frameElement?.getBoundingClientRect()
  return describeSelection(
    range.toString(),
    engine.view.getCFI(index, range),
    index,
    range.getBoundingClientRect(),
    [...range.getClientRects()],
    frame ? { left: frame.left, top: frame.top } : null,
    custom,
  )
}

/**
 * A book's scripts never run as BetterReads. foliate's frames are of the app's
 * origin (it lays out, selects and listens inside them), so three layers keep
 * an EPUB from anywhere out of the member's session:
 * - its script files are never loaded, and every page, SVG and stylesheet is
 *   sanitized before foliate makes its blob, each (X)HTML page carrying its
 *   own `script-src 'none'` policy (`sanitizeResource`, data/reader/markup.ts);
 * - the frames run no script at all where the browser still delivers events to
 *   a scriptless frame (`frameSandbox`).
 */
function guard(target: EventTarget | undefined) {
  if (!target) throw new UnsupportedTypeError('No way to sanitize this book')
  target.addEventListener('load', (event) => {
    const detail = (event as CustomEvent<{ isScript: boolean; allow: unknown }>).detail
    if (detail.isScript) detail.allow = false
  })
  target.addEventListener('data', (event) => {
    // The type stays a plain string: foliate's paginator reads it right after, to adjust stylesheets.
    const detail = (event as CustomEvent<{ data: unknown; type: string }>).detail
    const type = String(detail.type ?? '')
    detail.type = resourceType(type)
    detail.data = Promise.resolve(detail.data).then(async (data) => (await sanitizeResource(data, type)).data)
  })
}

let sandbox: Promise<string> | null = null

/**
 * The page frames' sandbox, found out once: `allow-same-origin` alone where a
 * listener on a scriptless frame's document still fires (Chromium, Firefox), so
 * no script of a book could run there even past the sanitizer. WebKit fires no
 * event into such a frame (https://bugs.webkit.org/show_bug.cgi?id=218086), so
 * there, and if the probe cannot tell, the frames keep `allow-scripts` and rest
 * on the sanitizer and each page's own `script-src 'none'`.
 */
export function frameSandbox(): Promise<string> {
  sandbox ??= new Promise<string>((resolve) => {
    const scriptless = 'allow-same-origin'
    const scripted = 'allow-same-origin allow-scripts'
    const probe = document.createElement('iframe')
    probe.setAttribute('sandbox', scriptless)
    probe.setAttribute('aria-hidden', 'true')
    probe.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden'
    const done = (value: string) => {
      clearTimeout(timer)
      probe.remove()
      resolve(value)
    }
    const timer = setTimeout(() => done(scripted), 1000)
    probe.addEventListener('load', () => {
      const doc = probe.contentDocument
      if (!doc) return done(scripted)
      let fired = false
      doc.addEventListener('libellus-probe', () => (fired = true))
      doc.dispatchEvent(new Event('libellus-probe'))
      done(fired ? scriptless : scripted)
    })
    probe.srcdoc = '<!DOCTYPE html><title>probe</title>'
    document.body.append(probe)
  })
  return sandbox
}

/**
 * Opens a book in a new `<foliate-view>` inside `host`. Resolves once the
 * first page is laid out and showing; every number on the way is timed.
 */
export async function openReader(
  host: HTMLElement,
  file: File,
  options: {
    handlers: EngineHandlers
    layout: Layout
    settings: ReaderSettings
    colors: PageColors
    at?: string | number | null
    highlights?: Highlight[]
    colorOf?: (color: Highlight['color']) => string
    touchSelection?: boolean
    startedAt: number
    importedAt: number
  },
): Promise<ReaderEngine> {
  const view = document.createElement('foliate-view') as FoliateView
  view.style.display = 'block'
  view.style.width = '100%'
  view.style.height = '100%'
  host.append(view)
  const engine = new ReaderEngine(view, options.handlers)
  engine.timings.bytes = file.size
  engine.timings.importMs = options.importedAt - options.startedAt

  frame.sandbox = await frameSandbox()
  const book = await makeBook(new File([file], 'book.epub', { type: 'application/epub+zip' }))
  // Only an EPUB opens here (phase 1 links nothing else): MOBI, FB2 and comic books make their pages without the hook below.
  if (!(book instanceof EPUB)) throw new UnsupportedTypeError('Not an EPUB')
  guard(book.transformTarget)
  await view.open(book)
  engine.timings.parseMs = performance.now() - options.importedAt
  engine.prepare()
  engine.highlights = options.highlights ?? []
  if (options.colorOf) engine.colorOf = options.colorOf
  engine.touchSelection = options.touchSelection ?? false
  engine.onSelect = options.handlers.select
  engine.cover = (await view.book.getCover?.().catch(() => null)) ?? null

  // A link out of the book: foliate opens any `scheme:` href itself, `javascript:` too, in a window of
  // the app's origin. Only web links leave, in a new tab that cannot reach back (noopener).
  view.addEventListener('external-link', (event) => {
    event.preventDefault()
    const href = (event as CustomEvent<{ href_: string }>).detail.href_
    let url: URL | null = null
    try {
      url = new URL(href)
    } catch {
      return
    }
    if (url.protocol === 'https:' || url.protocol === 'http:') window.open(url.href, '_blank', 'noopener,noreferrer')
  })

  view.addEventListener('relocate', (event) => engine.onRelocate((event as CustomEvent<RelocateDetail>).detail))
  // Highlights: drawn in the room's way (a soft wash under the words), redrawn when a section loads again.
  view.addEventListener('draw-annotation', (event) => {
    const { draw, annotation } = (event as CustomEvent<{ draw: (f: unknown, o: unknown) => void; annotation: { color?: string } }>).detail
    draw(Overlayer.highlight, { color: annotation.color })
  })
  view.addEventListener('create-overlay', (event) => {
    const { index } = (event as CustomEvent<{ index: number }>).detail
    for (const h of engine.highlights) if (h.index === index) void view.addAnnotation({ value: h.cfi, color: engine.colorOf(h.color) }).catch(() => undefined)
  })
  view.addEventListener('show-annotation', (event) => {
    const { value, range } = (event as CustomEvent<{ value: string; range: Range }>).detail
    const highlight = engine.highlights.find((h) => h.cfi === value)
    if (!highlight) return
    engine.annotationTappedAt = performance.now()
    const frame = range.startContainer.ownerDocument?.defaultView?.frameElement?.getBoundingClientRect()
    const r = range.getBoundingClientRect()
    options.handlers.highlightTapped(highlight, { left: (frame?.left ?? 0) + r.left, top: (frame?.top ?? 0) + r.top, width: r.width, height: r.height })
  })
  view.renderer.addEventListener('scroll', () => {
    const r = view.renderer
    options.handlers.scroll(r.start, r.size, r.viewSize)
  })
  // Scroll flow: a chapter is one long page, and foliate stops at its ends. Pulling on past the end
  // (or back past the top) goes to the next (previous) chapter, so the book flows; a chapter shorter
  // than the screen (the cover, a title page) is at both ends at once. Listened for on each chapter's
  // page and on the reader around it: under a short chapter the finger lands outside its page.
  const atEnd = () => view.renderer.viewSize - view.renderer.end < 4
  const atTop = () => view.renderer.start < 4
  const scrolledFlow = () => view.renderer.getAttribute('flow') === 'scrolled'
  function listenForPulls(target: Document | HTMLElement) {
    let pullY: number | null = null
    target.addEventListener('touchstart', (e) => {
      const touch = e as TouchEvent
      pullY = touch.touches.length === 1 ? (touch.touches[0]?.clientY ?? null) : null
    }, { passive: true })
    target.addEventListener('touchend', (e) => {
      const y = (e as TouchEvent).changedTouches[0]?.clientY
      if (pullY !== null && y !== undefined && scrolledFlow() && !engine.customRange) {
        const dy = y - pullY
        if (dy < -70 && atEnd()) options.handlers.overscroll(1)
        else if (dy > 70 && atTop()) options.handlers.overscroll(-1)
      }
      pullY = null
    })
    let wheel = 0
    let wheelTimer: ReturnType<typeof setTimeout> | undefined
    target.addEventListener('wheel', (e) => {
      const event = e as WheelEvent
      if (!scrolledFlow()) return
      const down = event.deltaY > 0
      if ((down && !atEnd()) || (!down && !atTop())) return void (wheel = 0)
      wheel += event.deltaY
      clearTimeout(wheelTimer)
      wheelTimer = setTimeout(() => (wheel = 0), 400)
      if (Math.abs(wheel) > 240) {
        wheel = 0
        options.handlers.overscroll(down ? 1 : -1)
      }
    }, { passive: true })
  }
  listenForPulls(view)
  // A tap beside a short chapter's page (under the cover in scroll flow) is a tap on the page too.
  view.addEventListener('click', (click) => {
    if (click.defaultPrevented || !scrolledFlow()) return
    options.handlers.tap(click.clientX, click.clientY)
  })
  view.addEventListener('load', (event) => {
    const { doc } = (event as CustomEvent<{ doc: Document }>).detail
    // Keys pressed while the page has focus (after a tap into it) reach the reader too: arrows turn, Escape closes.
    doc.addEventListener('keydown', (key) => {
      const forwarded = new KeyboardEvent('keydown', { key: key.key, cancelable: true })
      window.dispatchEvent(forwarded)
      if (forwarded.defaultPrevented) key.preventDefault()
    })
    listenForPulls(doc)
    let touchX: number | null = null
    doc.addEventListener('touchstart', (touch) => (touchX = touch.changedTouches[0]?.screenX ?? null), { passive: true })
    doc.addEventListener('touchend', (touch) => {
      const x = touch.changedTouches[0]?.screenX
      if (touchX !== null && x !== undefined && Math.abs(x - touchX) > 60) options.handlers.swipe(x < touchX ? 1 : -1)
      touchX = null
    })
    doc.addEventListener('click', (click) => {
      if (click.defaultPrevented) return
      const target = click.target as Element | null
      if (target?.closest?.('a[href]')) return
      if (!doc.getSelection()?.isCollapsed) return
      const frame = doc.defaultView?.frameElement?.getBoundingClientRect()
      const x = (frame?.left ?? 0) + click.clientX
      const y = (frame?.top ?? 0) + click.clientY
      // A tap on a highlight opens it instead (the view tells us in its own click listener, which may run after ours).
      setTimeout(() => {
        if (performance.now() - engine.annotationTappedAt < 300 || performance.now() < engine.suppressTapUntil) return
        options.handlers.tap(x, y)
      })
    })
    if (engine.touchSelection) installTouchSelection(engine, doc)
    else {
      // With a mouse the browser selects; its selection is reported once it holds still.
      let selectTimer: ReturnType<typeof setTimeout> | undefined
      doc.addEventListener('selectionchange', () => {
        clearTimeout(selectTimer)
        selectTimer = setTimeout(() => {
          const selection = doc.getSelection()
          if (!selection || selection.isCollapsed || !selection.rangeCount) return options.handlers.select(null)
          options.handlers.select(describeRange(engine, doc, selection.getRangeAt(0), false))
        }, 220)
      })
    }
  })

  engine.setLayout(options.layout)
  engine.setStyles(options.settings, options.colors)
  const first = new Promise<void>((resolve) => view.addEventListener('relocate', () => resolve(), { once: true }))
  if (typeof options.at === 'number') await engine.goToFraction(options.at)
  else await view.init({ lastLocation: options.at ?? null, showTextStart: false })
  await first
  // Laid out and painted: two frames after the first relocate.
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  engine.timings.firstPageMs = performance.now() - options.startedAt
  return engine
}
