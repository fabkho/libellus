/**
 * The two link-preview images of a reading page (issue #171), drawn with satori
 * (a layout to SVG) and resvg (the SVG to a PNG): the page, and one Book's card.
 * Direction D "Night Reader" (docs/DESIGN.md): the dark room, a lamp in the top
 * corner, serif book titles, mono figures.
 *
 * Everything that talks to the outside is injected (`fetch` for the covers), so
 * the tests draw both images without a network. The fonts are bundled next to
 * this file (satori cannot read woff2, so they are subset TTFs; README.md says
 * how they were made) and the resvg WebAssembly comes out of the npm package —
 * never a CDN at runtime, which would make every render depend on a third host.
 */
import satori from 'satori'
import { initWasm, Resvg } from '@resvg/resvg-wasm'
import { encodeBase64 } from '@std/encoding/base64'
import {
  clamp,
  firstAuthor,
  pageCovers,
  pageSummary,
  pageTitle,
  type PublicBook,
  type PublicBookCard,
  type PublicReadingPage,
  ratingValue,
  statusLine,
} from './page.ts'

/** Open Graph's size: what WhatsApp, Signal, Mastodon and the rest expect. */
export const WIDTH = 1200
export const HEIGHT = 630

/** The dark theme's token values (design/tokens.json), the only colours used here. */
const C = {
  surface: '#0e0c0a',
  raised: '#171512',
  ink: '#eee7dc',
  inkMuted: 'rgba(238, 231, 220, 0.74)',
  inkFaint: 'rgba(238, 231, 220, 0.56)',
  hairline: 'rgba(255, 236, 210, 0.12)',
  accent: '#efb768',
  starTrack: 'rgba(238, 231, 220, 0.2)',
  clothInk: '#f1e3c8',
} as const

/** A satori layout node. Written by hand: no JSX, no React in this function. */
type Node = {
  type: string
  props: Record<string, unknown> & { children?: Node | string | (Node | string | null)[] | null }
}

const el = (type: string, props: Node['props']): Node => ({ type, props })

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type RenderDeps = {
  /** How covers are fetched. Injected so the tests never leave the process. */
  fetch?: FetchLike
  /** A cover that takes longer than this is left out and the block stands in. */
  coverTimeoutMs?: number
}

// --------------------------------------------------------------------- fonts

type LoadedFont = { name: string; data: Uint8Array; weight: 400 | 500; style: 'normal' | 'italic' }

let fonts: Promise<LoadedFont[]> | null = null

/**
 * The bundled subsets, read once per instance. `supabase/config.toml` lists
 * them as this function's static files, so the deployed bundle carries them.
 */
function loadFonts(): Promise<LoadedFont[]> {
  const read = async (file: string) => await Deno.readFile(new URL(`./fonts/${file}`, import.meta.url))
  fonts ??= Promise.all([
    read('Geist-Regular.ttf').then((data) => ({ name: 'Geist', data, weight: 400, style: 'normal' }) as LoadedFont),
    read('GeistMono-Medium.ttf').then((data) => ({ name: 'Geist Mono', data, weight: 500, style: 'normal' }) as LoadedFont),
    read('Newsreader-Medium.ttf').then((data) => ({ name: 'Newsreader', data, weight: 500, style: 'normal' }) as LoadedFont),
    read('Newsreader-Italic.ttf').then((data) => ({ name: 'Newsreader', data, weight: 400, style: 'italic' }) as LoadedFont),
  ])
  return fonts
}

// ---------------------------------------------------------------------- resvg

let wasm: Promise<void> | null = null

/**
 * resvg's WebAssembly, from the npm package in the bundle (Deno keeps a package's
 * files next to its code, hosted as well as locally). It is initialised once per
 * instance; every later render reuses it.
 */
function loadResvg(): Promise<void> {
  wasm ??= (async () => {
    const url = import.meta.resolve('@resvg/resvg-wasm/index_bg.wasm')
    await initWasm(await Deno.readFile(new URL(url)))
  })().catch((error) => {
    // A failed init must not poison the instance: the next request tries again.
    wasm = null
    throw error
  })
  return wasm
}

// --------------------------------------------------------------------- covers

/**
 * A cover as a data URL for satori, or null when there is none, it is not
 * https, or the host is slow or unhappy. Covers come from any host a Book was
 * imported from, so this never blocks the image: the caller draws a block in
 * the cover's own colour instead.
 */
export async function loadCover(book: PublicBook, deps: RenderDeps): Promise<string | null> {
  const url = book.cover_url
  if (!url || !url.startsWith('https://')) return null
  const fetchImpl = deps.fetch ?? ((input, init) => fetch(input, init))
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), deps.coverTimeoutMs ?? 2500)
  try {
    const response = await fetchImpl(url, { signal: abort.signal, redirect: 'follow' })
    const type = response.headers.get('content-type') ?? ''
    if (!response.ok || !type.startsWith('image/')) return null
    const bytes = new Uint8Array(await response.arrayBuffer())
    // Five megabytes is far more than any cover; anything larger is a mistake.
    if (!bytes.length || bytes.length > 5_000_000) return null
    return `data:${type.split(';')[0]};base64,${encodeBase64(bytes)}`
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** The covers of several Books at once, each one failing on its own. */
function loadCovers(books: PublicBook[], deps: RenderDeps): Promise<(string | null)[]> {
  return Promise.all(books.map((book) => loadCover(book, deps)))
}

// ---------------------------------------------------------------------- stars

const STAR_PATH =
  'M12 1.6l3.1 6.4 7 1-5.1 4.9 1.2 7-6.2-3.3-6.2 3.3 1.2-7L1.9 9l7-1z'

/**
 * A Rating as five stars, filled to the quarter (1–20), drawn as an SVG rather
 * than typed: the bundled fonts carry letters, not star glyphs.
 */
export function starsSvg(quarters: number, size = 36, gap = 10): string {
  const width = size * 5 + gap * 4
  const parts: string[] = []
  for (let i = 0; i < 5; i++) {
    const x = i * (size + gap)
    const filled = Math.max(0, Math.min(1, quarters / 4 - i))
    parts.push(`<g transform="translate(${x} 0) scale(${size / 24})">`)
    parts.push(`<path d="${STAR_PATH}" fill="${C.starTrack}"/>`)
    if (filled > 0) {
      parts.push(
        `<clipPath id="c${i}"><rect x="0" y="0" width="${(24 * filled).toFixed(3)}" height="24"/></clipPath>`,
        `<path d="${STAR_PATH}" fill="${C.accent}" clip-path="url(#c${i})"/>`,
      )
    }
    parts.push('</g>')
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${size}" viewBox="0 0 ${width} ${size}">${parts.join('')}</svg>`
}

const dataUrl = (svg: string) => `data:image/svg+xml;base64,${encodeBase64(svg)}`

// -------------------------------------------------------------------- pieces

/** "libellus" in the serif italic, the wordmark the app shows. */
function wordmark(size = 36): Node {
  return el('div', {
    style: { display: 'flex', fontFamily: 'Newsreader', fontStyle: 'italic', fontWeight: 400, fontSize: size, color: C.accent },
    children: 'libellus',
  })
}

/** A mono, letter-spaced, faint label: the app's eyebrow. */
function eyebrow(text: string, size = 20): Node {
  return el('div', {
    style: {
      display: 'flex',
      fontFamily: 'Geist Mono',
      fontWeight: 500,
      fontSize: size,
      letterSpacing: size * 0.12,
      textTransform: 'uppercase',
      color: C.inkFaint,
    },
    children: text,
  })
}

/**
 * One cover: the image when it arrived, otherwise a block in the Book's own
 * colour with its title on it, the way the app draws a Book without a cover.
 */
function cover(book: PublicBook, src: string | null, width: number): Node {
  const height = Math.round(width * 1.5)
  const style = {
    display: 'flex',
    width,
    height,
    borderRadius: width >= 100 ? 5 : 3.5,
    overflow: 'hidden',
    backgroundColor: book.cover_dominant ?? C.raised,
    border: `1px solid ${C.hairline}`,
  }
  if (src) {
    return el('div', { style, children: el('img', { src, width, height, style: { objectFit: 'cover' } }) })
  }
  return el('div', {
    style: {
      ...style,
      flexDirection: 'column',
      justifyContent: 'flex-end',
      padding: Math.round(width * 0.09),
      backgroundImage: `linear-gradient(160deg, ${book.cover_secondary ?? book.cover_dominant ?? C.raised}, ${book.cover_dominant ?? C.raised})`,
    },
    children: el('div', {
      style: {
        display: 'flex',
        fontFamily: 'Newsreader',
        fontWeight: 500,
        fontSize: Math.round(width * 0.13),
        lineHeight: 1.15,
        color: C.clothInk,
      },
      children: clamp(book.title, 42),
    }),
  })
}

// --------------------------------------------------------------------- images

/** The reading page's image: her name, what the page shows, a row of covers. */
export async function renderPage(page: PublicReadingPage, deps: RenderDeps = {}): Promise<Uint8Array> {
  const books = pageCovers(page, 5)
  const sources = await loadCovers(books, deps)
  const node = el('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      width: WIDTH,
      height: HEIGHT,
      padding: 64,
      backgroundColor: C.surface,
      backgroundImage: `linear-gradient(145deg, rgba(239, 183, 104, 0.18), rgba(239, 183, 104, 0.02) 45%, rgba(14, 12, 10, 0) 70%)`,
    },
    children: [
      el('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
        children: [wordmark(), eyebrow('Reading page')],
      }),
      el('div', {
        style: {
          display: 'flex',
          fontFamily: 'Newsreader',
          fontWeight: 500,
          fontSize: 68,
          lineHeight: 1.1,
          color: C.ink,
          marginTop: 40,
        },
        children: clamp(pageTitle(page.name), 42),
      }),
      el('div', {
        style: { display: 'flex', fontFamily: 'Geist Mono', fontWeight: 500, fontSize: 24, color: C.inkMuted, marginTop: 16 },
        children: clamp(pageSummary(page), 64),
      }),
      el('div', {
        style: { display: 'flex', gap: 20, marginTop: 'auto' },
        children: books.map((book, i) => cover(book, sources[i] ?? null, 196)),
      }),
    ],
  })
  return await toPng(node)
}

/** One Book's card: the cover large, her Rating, and what she wrote if she shared it. */
export async function renderCard(card: PublicBookCard, deps: RenderDeps = {}): Promise<Uint8Array> {
  const src = await loadCover(card.book, deps)
  const author = firstAuthor(card.book)
  const value = ratingValue(card.rating)
  const review = card.review ? clamp(card.review, 150) : null
  const name = (card.name ?? '').trim()
  return await toPng(
    el('div', {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: WIDTH,
        height: HEIGHT,
        padding: 64,
        backgroundColor: C.surface,
        backgroundImage: `linear-gradient(145deg, rgba(239, 183, 104, 0.18), rgba(239, 183, 104, 0.02) 45%, rgba(14, 12, 10, 0) 70%)`,
      },
      children: [
        el('div', {
          style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
          children: [wordmark(32), eyebrow(name ? `${name}’s reading` : 'A reading page', 18)],
        }),
        el('div', {
          style: { display: 'flex', alignItems: 'center', gap: 56, marginTop: 'auto', marginBottom: 'auto' },
          children: [
            cover(card.book, src, 252),
            el('div', {
              style: { display: 'flex', flexDirection: 'column', width: 700 },
              children: [
                el('div', {
                  style: { display: 'flex', fontFamily: 'Newsreader', fontWeight: 500, fontSize: 58, lineHeight: 1.1, color: C.ink },
                  children: clamp(card.book.title, 70),
                }),
                author
                  ? el('div', {
                    style: { display: 'flex', fontFamily: 'Geist', fontSize: 30, color: C.inkMuted, marginTop: 14 },
                    children: clamp(author, 50),
                  })
                  : null,
                value
                  ? el('div', {
                    style: { display: 'flex', alignItems: 'center', gap: 16, marginTop: 26 },
                    children: [
                      el('img', { src: dataUrl(starsSvg(card.rating ?? 0)), width: 220, height: 36 }),
                      el('div', {
                        style: { display: 'flex', fontFamily: 'Geist Mono', fontWeight: 500, fontSize: 26, color: C.accent },
                        children: value,
                      }),
                    ],
                  })
                  : eyebrow(statusLine(card), 22),
                review
                  ? el('div', {
                    style: {
                      display: 'flex',
                      fontFamily: 'Newsreader',
                      fontStyle: 'italic',
                      fontWeight: 400,
                      fontSize: 26,
                      lineHeight: 1.35,
                      color: C.inkFaint,
                      marginTop: 26,
                    },
                    children: `“${review}”`,
                  })
                  : null,
              ],
            }),
          ],
        }),
      ],
    }),
  )
}

/** The layout, through satori and resvg, as the PNG bytes an image response holds. */
async function toPng(node: Node): Promise<Uint8Array> {
  const loaded = await loadFonts()
  await loadResvg()
  const svg = await satori(node as unknown as Parameters<typeof satori>[0], {
    width: WIDTH,
    height: HEIGHT,
    // satori wants the bytes as an ArrayBuffer; Deno.readFile hands out a view on one.
    fonts: loaded.map((font) => ({
      name: font.name,
      data: font.data.buffer as ArrayBuffer,
      weight: font.weight,
      style: font.style,
    })),
  })
  return new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } }).render().asPng()
}
