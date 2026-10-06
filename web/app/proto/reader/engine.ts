/**
 * The reader's engine: foliate-js (vendor/foliate-js, MIT) behind a small,
 * typed surface. This module is only ever reached through a dynamic
 * `import('./engine')` from Reader.vue, so foliate-js lives in a lazy chunk of
 * its own and never in the entry (in production: a named `foliate` chunk left
 * out of the precache, as Regal and the barcode decoder are).
 *
 * Design round #131 phase 2. Not production code: the prototypes share it.
 */
import newsreader400 from '@fontsource/newsreader/files/newsreader-latin-400-normal.woff2?url'
import newsreader400i from '@fontsource/newsreader/files/newsreader-latin-400-italic.woff2?url'
import newsreader600 from '@fontsource/newsreader/files/newsreader-latin-600-normal.woff2?url'
import geist400 from '@fontsource/geist/files/geist-latin-400-normal.woff2?url'
import geist600 from '@fontsource/geist/files/geist-latin-600-normal.woff2?url'
import './vendor/foliate-js/view.js'
import type { ReaderSettings } from './settings'
import { FONT_SIZES, LEADINGS } from './settings'

export interface TocItem {
  label: string
  href: string
  depth: number
  /** Where it starts, 0–1 of the body (for the page number in the Contents sheet). */
  fraction: number | null
}

export interface Relocation {
  /** How far through the body (the PG licence and other back matter after it do not count), 0–1. */
  fraction: number
  /** How far through the current section, 0–1. */
  sectionFraction: number
  sectionIndex: number
  chapter: string | null
  chapterHref: string | null
  minutesLeftInChapter: number
  minutesLeftInBook: number
  cfi: string
  /** On the last page of the body (or past it). */
  atEnd: boolean
  atStart: boolean
  reason: string | null
}

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
}

export type Flow = 'paginated' | 'scrolled'

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

/** Colours the page takes, read from the reader's tokens (the iframe cannot see CSS variables). */
export interface PageColors {
  surface: string
  ink: string
  inkMuted: string
  accent: string
  hairline: string
  scheme: 'light' | 'dark'
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
  book: {
    metadata?: { title?: unknown; author?: unknown }
    toc?: { label: string; href: string; subitems?: unknown[] }[]
    sections: { id: string; linear?: string; size: number }[]
    getCover?: () => Promise<Blob | null>
    resolveHref: (href: string) => { index: number } | null
    landmarks?: { type: string[]; href: string }[]
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

/** Back matter that is not the book: Project Gutenberg's licence, and similar footers. */
const BACK_MATTER = /footer|licen[cs]e|colophon|imprint|uncopyright/i

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
    // The body ends before the first back-matter section after the last real one.
    let end = book.sections.length - 1
    while (end > 0 && (BACK_MATTER.test(book.sections[end]!.id) || book.sections[end]!.linear === 'no')) end--
    this.bodyEndIndex = end
    this.bodyEnd = this.sectionFractions[end + 1] ?? 1
    const flat: TocItem[] = []
    const walk = (items: { label: string; href: string; subitems?: unknown[] }[] | undefined, depth: number) => {
      for (const item of items ?? []) {
        const label = (item.label ?? '').trim()
        if (BACK_MATTER.test(label) || /project gutenberg/i.test(label)) continue
        let fraction: number | null = null
        try {
          const resolved = book.resolveHref(item.href)
          if (resolved) fraction = Math.min(1, (this.sectionFractions[resolved.index] ?? 0) / this.bodyEnd)
        } catch {
          fraction = null
        }
        flat.push({ label, href: item.href, depth, fraction })
        walk(item.subitems as typeof items, depth + 1)
      }
    }
    walk(book.toc, 0)
    this.toc = flat
  }

  onRelocate(detail: {
    fraction: number
    cfi: string
    tocItem?: { label?: string; href?: string } | null
    section?: { current: number }
    time?: { section: number; total: number }
    reason?: string
  }, renderer: { fraction?: number; reason?: string; index?: number }) {
    const index = detail.section?.current ?? 0
    const fraction = Math.min(1, Math.max(0, detail.fraction / this.bodyEnd))
    const r = this.view.renderer
    const lastPage = r.getAttribute('flow') === 'scrolled' ? r.viewSize - r.end < 4 : r.page >= r.pages - 2
    const atEnd = index > this.bodyEndIndex || (index === this.bodyEndIndex && lastPage)
    const backMatterMinutes = Math.max(0, ((1 - this.bodyEnd) * (detail.time?.total ?? 0)) / Math.max(1e-6, 1 - detail.fraction))
    this.last = {
      fraction: atEnd ? 1 : fraction,
      sectionFraction: renderer.fraction ?? 0,
      sectionIndex: index,
      chapter: detail.tocItem?.label?.trim() || null,
      chapterHref: detail.tocItem?.href ?? null,
      minutesLeftInChapter: Math.max(0, detail.time?.section ?? 0),
      minutesLeftInBook: Math.max(0, (detail.time?.total ?? 0) - backMatterMinutes),
      cfi: detail.cfi,
      atEnd,
      atStart: index === 0 && (renderer.fraction ?? 0) === 0,
      reason: renderer.reason ?? null,
    }
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
    this.view.renderer.setStyles(pageCss(settings, colors, flow))
  }

  destroy() {
    this.view.close()
    this.view.remove()
  }
}

/** The fonts the page may use: the app's own families, with the text weights a book needs. */
function fontFaces() {
  const face = (family: string, url: string, weight: number, style = 'normal') =>
    `@font-face { font-family: '${family}'; src: url('${new URL(url, location.href).href}') format('woff2'); font-weight: ${weight}; font-style: ${style}; font-display: block; }`
  return [
    face('Libellus Serif', newsreader400, 400),
    face('Libellus Serif', newsreader400i, 400, 'italic'),
    face('Libellus Serif', newsreader600, 600),
    face('Libellus Sans', geist400, 400),
    face('Libellus Sans', geist600, 600),
  ].join('\n')
}

/**
 * The page's stylesheet: the member's type settings over the book's own CSS.
 * Colours come in as values (the iframe sees no tokens); the book keeps its
 * own structure (headings, centring, images), its colours give way to the room.
 */
export function pageCss(settings: ReaderSettings, colors: PageColors, flow: Flow = 'paginated'): string {
  const family = settings.font === 'serif' ? `'Libellus Serif', Georgia, serif` : `'Libellus Sans', system-ui, sans-serif`
  const size = FONT_SIZES[settings.size] ?? 18
  const leading = LEADINGS[settings.leading] ?? 1.55
  // Edge to edge: paragraphs lose their first-line indent's extra and the space between them shrinks, for the most text per screen.
  const dense = settings.margins === 0
  return `
${fontFaces()}
@namespace epub "http://www.idpf.org/2007/ops";
html {
  color-scheme: ${colors.scheme};
  background: ${colors.surface} !important;
  color: ${colors.ink} !important;
  font-size: ${size}px !important;
  -webkit-text-size-adjust: none;
  text-size-adjust: none;
}
body {
  background: transparent !important;
  color: inherit !important;
  font-family: ${family} !important;
  font-size: 1rem !important;
  font-optical-sizing: auto;
  font-kerning: normal;
  font-variant-ligatures: common-ligatures;
  text-rendering: optimizeLegibility;
}
body *:not(svg, svg *) {
  font-family: inherit !important;
  color: inherit !important;
  background-color: transparent !important;
  border-color: ${colors.hairline} !important;
}
p, li, blockquote, dd, div:not(:has(*)) {
  line-height: ${leading} !important;
  text-align: ${settings.justify ? 'justify' : 'start'};
  hyphens: ${settings.justify ? 'auto' : 'manual'};
  -webkit-hyphens: ${settings.justify ? 'auto' : 'manual'};
  hanging-punctuation: allow-end last;
  widows: 2;
  orphans: 2;
}
${dense ? 'p { margin-top: 0 !important; margin-bottom: 0.35em !important; }' : ''}
[align="left"] { text-align: left; }
[align="right"] { text-align: right; }
[align="center"] { text-align: center; }
h1, h2, h3, h4, h5, h6 {
  font-weight: 600 !important;
  line-height: 1.2 !important;
  letter-spacing: -0.01em;
  text-wrap: balance;
  hyphens: manual;
}
a, a:link, a:visited { color: ${colors.accent} !important; text-decoration-thickness: 0.06em; text-underline-offset: 0.15em; }
hr { border: 0 !important; border-top: 0.5px solid ${colors.hairline} !important; }
img { max-width: 100%; height: auto; }
${colors.scheme === 'dark' ? 'img:not([src$=".svg"]) { filter: brightness(0.86) contrast(1.05); }' : '/* On paper a picture\'s white is the page\'s own. */ img { mix-blend-mode: multiply; }'}
pre { white-space: pre-wrap !important; }
${flow === 'paginated' ? `/* A cover page (one picture, no text) fills its page, centred, as a printed cover does. */
body:has(> div:only-child > svg:only-child), body:has(> div:only-child > img:only-child), body:has(> img:only-child) {
  height: 100vh !important; margin: 0 !important; padding: 0 !important;
  display: flex !important; align-items: center; justify-content: center;
}
body:has(> div:only-child > svg:only-child) > div { width: 100%; height: 100%; }
body:has(> div:only-child > img:only-child) img, body:has(> img:only-child) img { max-height: 100vh; width: auto; object-fit: contain; }` : ''}
aside[epub|type~="endnote"], aside[epub|type~="footnote"], aside[epub|type~="note"], aside[epub|type~="rearnote"] { display: none; }
::selection { background: color-mix(in srgb, ${colors.accent} 28%, transparent); }
`
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

  await view.open(file)
  engine.timings.parseMs = performance.now() - options.importedAt
  engine.prepare()
  engine.cover = (await view.book.getCover?.().catch(() => null)) ?? null

  view.addEventListener('relocate', (event) => {
    const r = view.renderer
    const scrolled = r.getAttribute('flow') === 'scrolled'
    const sectionFraction = scrolled ? r.start / Math.max(1, r.viewSize - r.size) : (r.page - 1) / Math.max(1, r.pages - 3)
    engine.onRelocate((event as CustomEvent).detail, { fraction: Math.min(1, Math.max(0, sectionFraction)) })
  })
  view.renderer.addEventListener('scroll', () => {
    const r = view.renderer
    options.handlers.scroll(r.start, r.size, r.viewSize)
  })
  view.addEventListener('load', (event) => {
    const { doc } = (event as CustomEvent<{ doc: Document }>).detail
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
      options.handlers.tap((frame?.left ?? 0) + click.clientX, (frame?.top ?? 0) + click.clientY)
    })
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
