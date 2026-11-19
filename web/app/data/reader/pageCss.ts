/**
 * The page's stylesheet (#131 phase 2): the member's type settings over the
 * book's own CSS, for the frame the book is drawn in. A string in, a string
 * out.
 *
 * Two things it takes as arguments because the frame cannot see them: the
 * room's colours (an iframe of its own origin still sees no `--color-*` token
 * of the app), and the addresses of the app's fonts (a blob document resolves a
 * relative `url()` against the blob, not the page, so they come in absolute).
 *
 * Framework-free: no `location`, no `document`, no tokens read here — so Vitest
 * pins what the sheet says in plain Node, and a native reader hands in its own
 * fonts and colours.
 */
import { FONT_SIZES, LEADINGS, type ReaderSettings } from './settings'

/** Pages turned by the paginator, or one long page per chapter. */
export type Flow = 'paginated' | 'scrolled'

/** Colours the page takes, read from the reader's tokens (the iframe cannot see CSS variables). */
export interface PageColors {
  surface: string
  ink: string
  inkMuted: string
  accent: string
  hairline: string
  scheme: 'light' | 'dark'
}

/** The app's families, as the page may use them: one `url()` per cut, in the order they are declared. */
export interface PageFonts {
  /** Serif, regular. */
  serif: string
  /** Serif, italic. */
  serifItalic: string
  /** Serif, semibold. */
  serifBold: string
  /** Sans, regular. */
  sans: string
  /** Sans, semibold. */
  sansBold: string
}

/** The `@font-face` block: the app's own families, with the text weights a book needs. `url` addresses must already be absolute. */
export function fontFaces(fonts: PageFonts): string {
  const face = (family: string, url: string, weight: number, style = 'normal') =>
    `@font-face { font-family: '${family}'; src: url('${url}') format('woff2'); font-weight: ${weight}; font-style: ${style}; font-display: block; }`
  return [
    face('Libellus Serif', fonts.serif, 400),
    face('Libellus Serif', fonts.serifItalic, 400, 'italic'),
    face('Libellus Serif', fonts.serifBold, 600),
    face('Libellus Sans', fonts.sans, 400),
    face('Libellus Sans', fonts.sansBold, 600),
  ].join('\n')
}

/**
 * The page's stylesheet: the member's type settings over the book's own CSS.
 * Colours come in as values (the iframe sees no tokens); the book keeps its
 * own structure (headings, centring, images), its colours give way to the room.
 */
export function pageCss(settings: ReaderSettings, colors: PageColors, fonts: PageFonts, flow: Flow = 'paginated', touchSelection = false): string {
  const family = settings.font === 'serif' ? `'Libellus Serif', Georgia, serif` : `'Libellus Sans', system-ui, sans-serif`
  const size = FONT_SIZES[settings.size] ?? 18
  const leading = LEADINGS[settings.leading] ?? 1.55
  // Edge to edge: paragraphs lose their first-line indent's extra and the space between them shrinks, for the most text per screen.
  const dense = settings.margins === 0
  return `
${fontFaces(fonts)}
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
${touchSelection ? `/* The reader selects (long-press, its own handles): no browser selection, no callout, no tap flash. */
html, body, body * { -webkit-user-select: none !important; user-select: none !important; -webkit-touch-callout: none !important; }
* { -webkit-tap-highlight-color: transparent; }` : ''}
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
