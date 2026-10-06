import DOMPurify, { type Config } from 'dompurify'

/**
 * A book's pages are its publisher's (X)HTML, and an EPUB can come from
 * anywhere. The reader shows each page in a frame of the app's own origin
 * (foliate-js reaches into it for layout, selection and taps), so markup that
 * ran a script there could read the member's session. Every section, SVG and
 * stylesheet is therefore cleaned before foliate makes its blob (#131,
 * phase 2), as the second of three layers:
 *
 * 1. The frame's sandbox: no `allow-scripts` where the browser still delivers
 *    events to a scriptless frame (Chromium, Firefox); WebKit does not
 *    (https://bugs.webkit.org/show_bug.cgi?id=218086), so there the frame keeps
 *    it (`reader/engine.ts`, `frameSandbox`).
 * 2. This sanitizer: DOMPurify's allowlist over the parsed document, in place,
 *    so nothing able to run a script survives (elements, `on…` handlers,
 *    `javascript:`/`vbscript:`/`data:` URLs, frames, objects, forms, `<base>`,
 *    `<meta http-equiv>`, SVG `<script>`/`<foreignObject>`/`<set>`/`<animate>`),
 *    and nothing reaches outside the book (`<link>` and CSS `url()`/`@import`
 *    only to the book's own blobs).
 * 3. A Content-Security-Policy `<meta>` written into every (X)HTML page
 *    (`SECTION_CSP`, `script-src 'none'`): a blob document honours its own
 *    policy, so even markup the sanitizer missed cannot run, in any browser.
 *
 * DOMPurify (Apache-2.0 / MPL-2.0) rather than hand-written rules: an
 * allowlist kept current against parser quirks and mutation XSS, where a
 * denylist written here would miss the next trick. Plain DOM in, plain DOM
 * out: it runs wherever a `DOMParser` and DOMPurify do (the browser; jsdom in
 * the tests).
 */

/** The policy every (X)HTML page of a book carries: no script, no frame, nothing fetched from outside the book but the app's own fonts. */
export const SECTION_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  'img-src blob: data:',
  'media-src blob: data:',
  "font-src 'self' blob: data:",
  "style-src blob: data: 'unsafe-inline'",
].join('; ')

const XHTML_NS = 'http://www.w3.org/1999/xhtml'

/**
 * URLs an attribute may keep. foliate has already turned every resource of the
 * book into a `blob:` URL; links between pages stay relative (`chapter-2.xhtml#x`),
 * links out of the book are http(s)/mailto/tel and leave only through the
 * reader's `external-link` handler. DOMPurify's default without `ftp:`/`cid:`…,
 * with `blob:`.
 */
const ALLOWED_URI = /^(?:(?:https?|mailto|tel|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i

const PURIFY: Config = {
  IN_PLACE: true,
  WHOLE_DOCUMENT: true,
  // The head's stylesheets and `<meta name="viewport">` (fixed layout) stay; `prepare` drops the unsafe ones first.
  ADD_TAGS: ['link', 'meta'],
  ADD_ATTR: ['epub:type', 'xml:lang', 'charset', 'content', 'rel', 'media', 'type'],
  FORBID_TAGS: ['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'base', 'form', 'portal', 'noscript', 'foreignObject', 'foreignobject'],
  FORBID_ATTR: ['srcdoc', 'action', 'formaction', 'target', 'ping', 'http-equiv'],
  ALLOWED_URI_REGEXP: ALLOWED_URI,
}

/** A URL inside the book (one of foliate's blobs, a fragment, or inline data that is not a document). */
function isBookUrl(url: string): boolean {
  const value = url.trim().replace(/[\s\u0000-\u001f]/g, '')
  if (value.startsWith('#')) return true
  if (/^blob:/i.test(value)) return true
  return /^data:/i.test(value) && !/^data:(?:text\/html|application\/xhtml|image\/svg|text\/xml|application\/xml)/i.test(value)
}

/**
 * A stylesheet (a file, a `<style>` or a `style` attribute) keeps only what is
 * inside the book: any other `url()` becomes `none` and any other `@import` goes.
 * The section's CSP blocks those fetches too; this keeps the request from being made at all.
 */
export function sanitizeCss(css: string): string {
  return css
    .replace(/@import\s+(?:url\(\s*)?(["']?)([^"')\s;]*)\1\s*\)?[^;]*;?/gi, (rule, _quote, url: string) => (isBookUrl(url) ? rule : ''))
    .replace(/url\(\s*(["']?)([^"')]*)\1\s*\)/gi, (whole, _quote, url: string) => (isBookUrl(url) ? whole : 'none'))
}

type MarkupType = 'application/xhtml+xml' | 'text/html' | 'image/svg+xml'

/** Bytes a frame never parses into a page: pictures, sound, fonts, subtitles. Anything else (no type, an unknown one) is labelled a download. */
const PASSTHROUGH = /^\s*(?:(?:image|audio|video|font)\/[\w.+-]+|text\/vtt|application\/(?:x-)?font[\w.+-]*|application\/vnd\.ms-(?:opentype|fontobject)|application\/octet-stream)\s*(?:;|$)/i

/** What a resource's media type means here: markup to parse, a stylesheet, or bytes shown as they are. */
function kindOf(type: string): MarkupType | 'xml' | 'css' | null {
  const essence = type.split(';')[0]!.trim().toLowerCase()
  if (essence === 'text/css') return 'css'
  if (essence === 'text/html') return 'text/html'
  if (essence === 'application/xhtml+xml') return 'application/xhtml+xml'
  if (essence === 'image/svg+xml') return 'image/svg+xml'
  if (/(?:\/|\+)xml$/.test(essence)) return 'xml'
  return null
}

/** Before DOMPurify: what an allowlist cannot judge by name alone. */
function prepare(doc: Document) {
  // Processing instructions before the root: only a stylesheet of the book's own (never XSLT).
  for (const node of [...doc.childNodes]) {
    if (node.nodeType !== 7) continue
    const pi = node as ProcessingInstruction
    const href = /href\s*=\s*["']([^"']*)["']/i.exec(pi.data)?.[1] ?? ''
    if (pi.target !== 'xml-stylesheet' || !/type\s*=\s*["']text\/css["']/i.test(pi.data) || !isBookUrl(href)) pi.remove()
  }
  for (const link of [...doc.querySelectorAll('link')]) {
    const rel = (link.getAttribute('rel') ?? '').toLowerCase().split(/\s+/)
    if (!rel.includes('stylesheet') || !/^blob:/i.test(link.getAttribute('href') ?? '')) link.remove()
  }
  for (const meta of [...doc.querySelectorAll('meta')]) if (meta.hasAttribute('http-equiv')) meta.remove()
}

/** After DOMPurify: the stylesheets inside the page, then the page's own policy, first in its head. */
function finish(doc: Document, type: MarkupType) {
  for (const style of [...doc.querySelectorAll('style')]) style.textContent = sanitizeCss(style.textContent ?? '')
  for (const el of [...doc.querySelectorAll('[style]')]) el.setAttribute('style', sanitizeCss(el.getAttribute('style') ?? ''))
  if (type === 'image/svg+xml') return
  const root = doc.documentElement
  const make = (name: string) => (type === 'text/html' ? doc.createElement(name) : doc.createElementNS(XHTML_NS, name))
  let head = doc.head ?? [...root.children].find((el) => el.localName === 'head') ?? null
  if (!head) {
    head = make('head')
    root.insertBefore(head, root.firstChild)
  }
  const csp = make('meta')
  csp.setAttribute('http-equiv', 'Content-Security-Policy')
  csp.setAttribute('content', SECTION_CSP)
  head.insertBefore(csp, head.firstChild)
}

function purifier(): typeof DOMPurify {
  // Without a DOM, DOMPurify hands its input back untouched: refuse rather than show an unclean page.
  if (!DOMPurify.isSupported) throw new Error('No DOM to sanitize a book page with')
  return DOMPurify
}

/**
 * One section document (or an SVG) of a book, cleaned: parsed as its type,
 * sanitized in place, given its CSP, and serialized again (XML for XHTML and
 * SVG, HTML for HTML). Markup that does not parse becomes an empty page.
 */
export function sanitizeSection(markup: string, type: MarkupType): string {
  const doc = new DOMParser().parseFromString(markup, type)
  if (type !== 'text/html' && (doc.getElementsByTagName('parsererror').length || !doc.documentElement)) return emptyPage(type)
  prepare(doc)
  try {
    purifier().sanitize(doc.documentElement, PURIFY)
  } catch {
    // DOMPurify refuses a root it does not allow (and leaves it neutralized): nothing of it is shown.
    return emptyPage(type)
  }
  finish(doc, type)
  return type === 'text/html' ? `<!DOCTYPE html>\n${doc.documentElement.outerHTML}` : new XMLSerializer().serializeToString(doc)
}

function emptyPage(type: MarkupType): string {
  if (type === 'image/svg+xml') return '<svg xmlns="http://www.w3.org/2000/svg"/>'
  const meta = `<meta http-equiv="Content-Security-Policy" content="${SECTION_CSP}"/>`
  return type === 'text/html'
    ? `<!DOCTYPE html>\n<html><head>${meta}</head><body></body></html>`
    : `<html xmlns="${XHTML_NS}"><head>${meta}</head><body></body></html>`
}

/**
 * The type a resource is shown as, known before its bytes are: pages keep
 * theirs (without parameters), other XML is shown as text, and a resource with
 * no type or an unknown one is labelled a download, never sniffed into a page.
 */
export function resourceType(type: string): string {
  const kind = kindOf(type ?? '')
  if (kind === null) return PASSTHROUGH.test(type ?? '') ? type : 'application/octet-stream'
  if (kind === 'css') return 'text/css'
  if (kind === 'xml') return 'text/plain'
  return kind
}

/**
 * Any resource foliate is about to turn into a blob (its `data` event): pages
 * and SVG are sanitized, stylesheets cleaned, other XML passed on as text (see
 * `resourceType`). Images, fonts and media pass as they are.
 */
export async function sanitizeResource(data: unknown, type: string): Promise<{ data: unknown; type: string }> {
  const kind = kindOf(type ?? '')
  const shown = resourceType(type)
  if (kind === null || kind === 'xml') return { data, type: shown }
  const text = typeof data === 'string' ? data : data instanceof Blob ? await data.text() : null
  if (text === null) return { data, type: shown }
  if (kind === 'css') return { data: sanitizeCss(text), type: shown }
  return { data: sanitizeSection(text, kind), type: shown }
}
