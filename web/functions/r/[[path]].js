// Cloudflare Pages Function (docs/HOSTING.md): the link previews and the images of a shared
// reading page, `/r/<token>` and `/r/<token>/book/<id>` (issue #171). The app renders both pages
// in the browser, which is enough for a visitor but not for the crawlers that make a preview of a
// pasted link (WhatsApp, Signal, iMessage, Mastodon, Slack): they read the HTML and run no
// JavaScript. So this answers those addresses with the same app shell, with the Open Graph tags
// and the title written into its <head>, and serves `…/og.png` by asking the `reading-page-og`
// edge function for the image once and keeping it at Cloudflare's edge.
//
// What it reads of her page comes from the two public database functions (`public_reading_page`,
// `public_book_card`) with the anon key, exactly what the app reads. They return null for a token
// that is off, renewed or never was: then this answers 404 — the shell all the same, so the app
// shows its "no such page" screen — and an image address stops serving at once.
//
// Env (the Pages project, production only): NUXT_PUBLIC_SUPABASE_URL and
// NUXT_PUBLIC_SUPABASE_ANON_KEY. A preview deployment has no backend, so there is nothing to ask:
// the shell goes out as it is, noindex like every answer here. Copy is English literals: a Pages
// Function has no i18n, and only crawlers read it.

/** `/r/<token>`, `/r/<token>/og.png`, `/r/<token>/book/<id>`, `/r/<token>/book/<id>/og.png`. */
const ADDRESS = /^\/r\/([A-Za-z0-9_-]{22})(?:\/book\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))?(\/og\.png)?\/?$/i

/** Open Graph's size, what reading-page-og draws. */
const IMAGE = { width: 1200, height: 630 }

/** A day, the same age the edge function puts on the image itself. */
const IMAGE_MAX_AGE = 86400

/**
 * The headers `web/public/_headers` puts on every static answer. Pages applies that file to its
 * static assets only — a Function's response goes out as the Function wrote it — and `ASSETS.fetch`
 * hands back the asset without them too, so they are read off the shell's response where they are
 * there and set from here where they are not. Keep in step with the `/*` rule of
 * `web/public/_headers`; the app shell is the same app under `/r/` as everywhere else.
 */
const SITE_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy-Report-Only':
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://books.fabkho.dev https://itunes.apple.com https://openlibrary.org https://covers.openlibrary.org https://*.mzstatic.com https://cloudflareinsights.com https://api.mymemory.translated.net https://en.wiktionary.org; frame-src 'self' blob:; media-src 'self' blob:; worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
}

export async function onRequest(context) {
  const { request, env, next } = context
  const url = new URL(request.url)
  const match = url.pathname.match(ADDRESS)
  // Anything else under /r/ leads nowhere either: a token is 22 characters, so an address that is
  // not shaped like one cannot be a page. No database is asked; the answer is the same 404 as for
  // a link that was renewed (the shell for the app's "no such page" screen, nothing for a picture).
  // Not a static 200: the SPA fallback would tell a crawler and a link checker that the page exists.
  if (!match) return await onNoSuchAddress(context, url)

  const [, token, book, image] = match
  const supabaseUrl = (env.NUXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
  const anonKey = env.NUXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  const backend = supabaseUrl && anonKey ? { url: supabaseUrl, key: anonKey } : null

  if (image) return await onImage(context, { token, book, backend })

  const data = backend ? await readPage(backend, token, book) : undefined
  // undefined: nothing was asked (a preview) or the database could not answer. The shell goes out
  // as a plain page then; the app asks again in the browser.
  const shell = await appShell(context)
  const head = data === undefined ? '' : data === null ? notFoundTags() : tagsFor(data, { url, token, book, payload: await version(data) })
  return html(shell, inject(await shell.text(), head, titleFor(data, book)), data === null ? 404 : 200)
}

/** `/r/<anything that is not a token>`: a 404, with the shell unless a picture was asked for. */
async function onNoSuchAddress(context, url) {
  if (/\/og\.png\/?$/i.test(url.pathname)) return new Response('Not found', { status: 404, headers: noIndex() })
  const shell = await appShell(context)
  return html(shell, inject(await shell.text(), notFoundTags(), titleFor(null)), 404)
}

// ------------------------------------------------------------------------------------ the image

/**
 * `…/og.png`: the picture of the page or the card. The token is checked against the database
 * first, so a renewed link stops serving its image immediately, and the answer is kept at the
 * edge under an address that carries the hash of what it shows, so a changed page gets a new one.
 */
async function onImage(context, { token, book, backend }) {
  const { request, env, waitUntil } = context
  const url = new URL(request.url)
  // No backend (a preview deployment): there is no page to draw, so the app's own icon stands in.
  if (!backend) return Response.redirect(new URL('/icon-512.png', url).toString(), 302)

  const data = await readPage(backend, token, book)
  if (data === null || data === undefined) return new Response('Not found', { status: 404, headers: noIndex() })

  const payload = await version(data)
  const canonical = new URL(`${imagePath(token, book)}?v=${payload}`, `https://${url.host}`).toString()
  // `caches` is missing in Node (the tests) and on *.pages.dev; then every request renders again.
  const cache = typeof caches !== 'undefined' ? caches.default : null
  const hit = cache ? await cache.match(canonical) : null
  if (hit) return hit

  const asked = new URL(`${backend.url}/functions/v1/reading-page-og`)
  asked.searchParams.set('token', token)
  if (book) asked.searchParams.set('book', book)
  let rendered = null
  try {
    rendered = await fetch(asked.toString(), {
      headers: { apikey: backend.key, authorization: `Bearer ${backend.key}` },
    })
  } catch {
    rendered = null
  }
  if (!rendered || !rendered.ok || !(rendered.headers.get('content-type') ?? '').startsWith('image/png')) {
    // The renderer is not deployed yet, or it failed: a preview is better than a broken image.
    return Response.redirect(fallbackImage(data, book, url), 302)
  }

  const image = new Response(rendered.body, {
    headers: {
      ...SITE_HEADERS,
      'Content-Type': 'image/png',
      'Cache-Control': `public, max-age=${IMAGE_MAX_AGE}, immutable`,
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
  if (cache && waitUntil) waitUntil(cache.put(canonical, image.clone()))
  return image
}

/** Where a link preview goes while there is no rendered image: her cover, else the app's icon. */
function fallbackImage(data, book, url) {
  const cover = book ? data.book?.cover_url : null
  if (typeof cover === 'string' && cover.startsWith('https://')) return cover
  return new URL('/icon-512.png', url).toString()
}

// --------------------------------------------------------------------------------- the database

/**
 * The page or the card behind the token: the row the database hands a visitor, `null` when the
 * token leads nowhere, `undefined` when the database could not be asked at all.
 */
async function readPage(backend, token, book) {
  const name = book ? 'public_book_card' : 'public_reading_page'
  const args = book ? { p_token: token, p_book: book } : { p_token: token }
  try {
    const response = await fetch(`${backend.url}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: backend.key,
        authorization: `Bearer ${backend.key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(args),
    })
    // Not OK (a 5xx, a rejected key, a gone function): the database could not be asked, which is
    // not the same as "no such page", so the caller keeps the plain shell and the app retries.
    if (!response.ok) return undefined
    // An unknown token is a 200 with `null` (the functions return null, they never raise); an
    // empty body (204) says the same.
    const body = await response.text()
    return body.trim() ? ((JSON.parse(body) ?? null)) : null
  } catch {
    return undefined
  }
}

/** The first sixteen hex digits of the payload's SHA-256: the image's version in its address. */
async function version(data) {
  const bytes = new TextEncoder().encode(JSON.stringify(data))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

// ------------------------------------------------------------------------------------- the HTML

/** The app shell, the file every address of the app is answered with. */
function appShell({ env, request }) {
  return env.ASSETS.fetch(new URL('/', request.url))
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const meta = (name, content) => `<meta name="${name}" content="${escapeHtml(content)}">`
const property = (name, content) => `<meta property="${name}" content="${escapeHtml(content)}">`

/** A shared link is never a search result: hers to hand out, not to be found. */
const noIndexTag = () => meta('robots', 'noindex, nofollow')

function notFoundTags() {
  return noIndexTag() + property('og:title', 'Libellus') + property('og:description', 'This reading page is not here any more.')
}

/** What a crawler shows for the link: the title, a line about it, and the image. */
function tagsFor(data, { url, token, book, payload }) {
  const image = new URL(`${imagePath(token, book)}?v=${payload}`, `https://${url.host}`).toString()
  const page = new URL(`/r/${token}${book ? `/book/${book}` : ''}`, `https://${url.host}`).toString()
  return [
    noIndexTag(),
    property('og:title', ogTitle(data, book)),
    property('og:description', description(data, book)),
    property('og:type', book ? 'article' : 'website'),
    property('og:site_name', 'Libellus'),
    property('og:url', page),
    property('og:image', image),
    property('og:image:width', String(IMAGE.width)),
    property('og:image:height', String(IMAGE.height)),
    property('og:image:alt', ogTitle(data, book)),
    meta('twitter:card', 'summary_large_image'),
  ].join('')
}

/** Where the picture of this address lives. */
function imagePath(token, book) {
  return `/r/${token}${book ? `/book/${book}` : ''}/og.png`
}

const firstName = (data) => (typeof data?.name === 'string' ? data.name.trim() : '')

/** "<Title> by <Author>" for a card, "<Name>'s reading" for a page. */
function ogTitle(data, book) {
  if (book) {
    const author = (data?.book?.authors ?? []).find((name) => name && name.trim())
    return author ? `${data.book.title} by ${author}` : String(data?.book?.title ?? 'A book')
  }
  const name = firstName(data)
  return name ? `${name}’s reading` : 'A reading page'
}

/** The browser tab's title, and what a plain link list shows. */
function titleFor(data, book) {
  if (data === undefined) return null
  if (data === null) return 'Not found · Libellus'
  return `${ogTitle(data, book)} · Libellus`
}

/** A Rating in whole and half stars, as a sentence says it: "4½ stars", "5 stars", "1 star". */
function stars(quarters) {
  if (typeof quarters !== 'number' || quarters < 1 || quarters > 20) return null
  const halves = Math.round(quarters / 2)
  const whole = Math.floor(halves / 2)
  const value = `${whole || ''}${halves % 2 ? '½' : ''}` || '½'
  return `${value} ${value === '1' ? 'star' : 'stars'}`
}

/** One short line under the title: what she is reading, her year, her Rating, her review. */
function description(data, book) {
  if (book) return cardDescription(data)
  const parts = []
  const reading = data?.reading?.[0]?.book?.title
  if (reading) parts.push(`Reading ${reading}`)
  const year = data?.year
  if (year && year.books > 0) parts.push(`${year.books} ${year.books === 1 ? 'book' : 'books'} in ${year.year}`)
  const finished = data?.finished?.length ?? 0
  if (!parts.length && finished) parts.push(`${finished} ${finished === 1 ? 'book' : 'books'} finished`)
  const name = firstName(data)
  if (!parts.length) parts.push(name ? `Books ${name} has read` : 'A shelf of books')
  return parts.join(' · ')
}

function cardDescription(data) {
  const name = firstName(data) || 'She'
  const rating = stars(data?.rating)
  const line = rating
    ? `${name} rated it ${rating}`
    : data?.status === 'reading'
      ? `${name} is reading it`
      : data?.status === 'want_to_read'
        ? `${name} wants to read it`
        : `${name} finished it`
  const review = typeof data?.review === 'string' ? data.review.replace(/\s+/g, ' ').trim() : ''
  if (!review) return `${line}.`
  const excerpt = review.length > 160 ? `${review.slice(0, 160).replace(/\s+\S*$/, '')}…` : review
  return `${line}. “${excerpt}”`
}

/**
 * The tags and the title into the shell's <head>, by string replacement rather than HTMLRewriter,
 * so the same code runs in the Vitest suite in plain Node.
 */
function inject(shellHtml, tags, title) {
  let out = shellHtml
  let head = tags
  if (title) {
    const titled = out.replace(/<title[^>]*>[\s\S]*?<\/title>/i, () => `<title>${escapeHtml(title)}</title>`)
    if (titled === out) head += `<title>${escapeHtml(title)}</title>`
    else out = titled
  }
  if (!head) return out
  // A function, not a string: `$&` or `$'` in a title must stay text, not a replacement pattern.
  return out.includes('</head>') ? out.replace('</head>', () => `${head}</head>`) : head + out
}

/** The shell's own headers, plus what this address decides on top of them. */
function html(shell, body, status) {
  const headers = new Headers(shell.headers)
  for (const [name, value] of Object.entries(SITE_HEADERS)) if (!headers.has(name)) headers.set(name, value)
  headers.set('Content-Type', 'text/html; charset=utf-8')
  // Never cached: not by a CDN, not by the service worker. The page is one member's, and she can
  // switch it off between two views of the same address.
  headers.set('Cache-Control', 'no-store')
  headers.delete('ETag')
  headers.set('X-Robots-Tag', 'noindex, nofollow')
  return new Response(body, { status, headers })
}

function noIndex() {
  return { ...SITE_HEADERS, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' }
}
