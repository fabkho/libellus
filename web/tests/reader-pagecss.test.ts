import { describe, expect, it } from 'vitest'
import { fontFaces, pageCss, type PageColors, type PageFonts } from '../app/data/reader/pageCss'
import { DEFAULT_SETTINGS, FONT_SIZES, LEADINGS, type ReaderSettings } from '../app/data/reader/settings'

/**
 * The book page's stylesheet (#131 phase 2): what the frame says for the
 * member's type settings, the room's colours and the app's fonts — plain
 * strings in and out, so it can be read here without a browser.
 */

const FONTS: PageFonts = {
  serif: 'https://books.example/fonts/newsreader-400.woff2',
  serifItalic: 'https://books.example/fonts/newsreader-400-italic.woff2',
  serifBold: 'https://books.example/fonts/newsreader-600.woff2',
  sans: 'https://books.example/fonts/geist-400.woff2',
  sansBold: 'https://books.example/fonts/geist-600.woff2',
}

const SEPIA: PageColors = { surface: '#f4efe4', ink: '#2b2622', inkMuted: '#6b625a', accent: '#a5502f', hairline: '#d8cfc2', scheme: 'light' }
const NIGHT: PageColors = { surface: '#12100e', ink: '#e6e0d8', inkMuted: '#a49b90', accent: '#e0825e', hairline: '#2f2a25', scheme: 'dark' }

const settings = (over: Partial<ReaderSettings> = {}): ReaderSettings => ({ ...DEFAULT_SETTINGS, ...over })
const css = (over: Partial<ReaderSettings> = {}, colors: PageColors = SEPIA, flow: 'paginated' | 'scrolled' = 'paginated', touch = false) =>
  pageCss(settings(over), colors, FONTS, flow, touch)

describe('the page’s stylesheet', () => {
  it('paints the room in the member’s theme, in both light and dark', () => {
    expect(css()).toContain('color-scheme: light;')
    expect(css()).toContain('background: #f4efe4 !important;')
    expect(css()).toContain('color: #2b2622 !important;')

    expect(css({}, NIGHT)).toContain('color-scheme: dark;')
    expect(css({}, NIGHT)).toContain('background: #12100e !important;')
    expect(css({}, NIGHT)).toContain('color: #e6e0d8 !important;')
  })

  it('leaves the book’s own structure alone but its colours to the room', () => {
    const sheet = css()
    // The body and everything in it inherit the room's ink; borders and links come from the tokens.
    expect(sheet).toContain('body *:not(svg, svg *) {')
    expect(sheet).toContain('border-color: #d8cfc2 !important;')
    expect(sheet).toContain('a, a:link, a:visited { color: #a5502f !important;')
    expect(sheet).toContain('hr { border: 0 !important; border-top: 0.5px solid #d8cfc2 !important; }')
    // Headings keep their weight, centring attributes keep working.
    expect(sheet).toContain('[align="center"] { text-align: center; }')
    expect(sheet).toContain('img { max-width: 100%; height: auto; }')
    // The book's own endnotes are not drawn over the page.
    expect(sheet).toContain('aside[epub|type~="footnote"]')
  })

  it('turns a dark room’s pictures down, and multiplies them onto paper', () => {
    expect(css({}, NIGHT)).toContain('img:not([src$=".svg"]) { filter: brightness(0.86) contrast(1.05); }')
    expect(css()).toContain('img { mix-blend-mode: multiply; }')
    expect(css()).not.toContain('brightness(0.86)')
  })

  it('says which app fonts the page may use, at absolute addresses', () => {
    for (const url of Object.values(FONTS)) expect(css()).toContain(`src: url('${url}') format('woff2')`)
    expect(fontFaces(FONTS).split('\n')).toHaveLength(5)
    expect(fontFaces(FONTS)).toContain("font-family: 'Libellus Serif'; src: url('https://books.example/fonts/newsreader-400-italic.woff2') format('woff2'); font-weight: 400; font-style: italic")
    expect(fontFaces(FONTS)).toContain("font-family: 'Libellus Sans'; src: url('https://books.example/fonts/geist-600.woff2') format('woff2'); font-weight: 600")
  })

  it('sets the family and the size from the settings', () => {
    expect(css({ font: 'serif' })).toContain("font-family: 'Libellus Serif', Georgia, serif !important;")
    expect(css({ font: 'sans' })).toContain("font-family: 'Libellus Sans', system-ui, sans-serif !important;")
    // A step in the table, and the default where the index names none.
    expect(css({ size: 0 })).toContain(`font-size: ${FONT_SIZES[0]}px !important;`)
    expect(css({ size: 6 })).toContain(`font-size: ${FONT_SIZES[6]}px !important;`)
    expect(css({ size: 99 })).toContain('font-size: 18px !important;')
    expect(css({ leading: 0 })).toContain(`line-height: ${LEADINGS[0]} !important;`)
    expect(css({ leading: 99 })).toContain('line-height: 1.55 !important;')
  })

  it('justifies the words, or leaves them ragged, and hyphenates with it', () => {
    expect(css({ justify: true })).toContain('text-align: justify;')
    expect(css({ justify: true })).toContain('hyphens: auto;')
    expect(css({ justify: false })).toContain('text-align: start;')
    expect(css({ justify: false })).toContain('hyphens: manual;')
  })

  it('tightens the paragraphs only at the edge-to-edge margins', () => {
    expect(css({ margins: 0 })).toContain('p { margin-top: 0 !important; margin-bottom: 0.35em !important; }')
    for (const margins of [1, 2, 3]) expect(css({ margins })).not.toContain('margin-bottom: 0.35em')
  })

  it('fills a cover page on its own page when the pages turn, not when a chapter scrolls', () => {
    expect(css({}, SEPIA, 'paginated')).toContain('body:has(> img:only-child)')
    expect(css({}, SEPIA, 'paginated')).toContain('height: 100vh !important;')
    expect(css({}, SEPIA, 'scrolled')).not.toContain('body:has(> img:only-child)')
    expect(css({}, SEPIA, 'scrolled')).not.toContain('100vh')
  })

  it('keeps the flow to the cover-page rule alone: the rest of the sheet is the same in both', () => {
    const withPages = css({}, SEPIA, 'paginated').replace(/\/\* A cover page[\s\S]*?object-fit: contain; \}/, '')
    const withScroll = css({}, SEPIA, 'scrolled')
    expect(withPages).toBe(withScroll)
  })

  it('turns the browser’s own selection off only where the reader selects for itself', () => {
    expect(css({}, SEPIA, 'paginated', true)).toContain('-webkit-user-select: none !important;')
    expect(css({}, SEPIA, 'paginated', true)).toContain('* { -webkit-tap-highlight-color: transparent; }')
    expect(css({}, SEPIA, 'paginated', false)).not.toContain('-webkit-user-select: none')
    // The wash over selected words is drawn either way.
    expect(css()).toContain('::selection { background: color-mix(in srgb, #a5502f 28%, transparent); }')
  })
})
