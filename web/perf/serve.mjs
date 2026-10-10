// The production build served the way Cloudflare Pages serves it, for the perf harness.
//
//   LIBELLUS_SERVE_ROOT=.output/public node perf/serve.mjs [port]      (pnpm perf:serve does this)
//
// It runs e2e/serve.mjs (`_headers`, `_redirects`, the SPA fallback, Pages Functions) and puts
// in front of it what Pages adds and that file leaves out, because transfer size and request
// timing depend on them:
//   - HTTP/2 over TLS (a throwaway self-signed certificate in .data/perf/tls; browsers are started
//     with certificate errors ignored). Pages speaks h2/h3; h1.1's six connections would make the
//     waterfall look worse than production's.
//   - Brotli (gzip when the client does not accept it) for text, as Pages does, plus an ETag and
//     `304` on If-None-Match.
//   - The API as a hosted Supabase answers: requests for the host `perf.supabase.co` (the host the
//     build is made with, mapped to this server like the covers) are proxied to the local stack
//     with brotli, which the local gateway does not do and Cloudflare in front of supabase.co does,
//     and a preflight answer that may be kept for an hour. Cross-origin, so CORS preflights stay.
//   - What the app asks of third parties, answered here (and, in Chromium, mapped to this server by
//     host) so the run needs no Playwright route, which would switch the HTTP cache off: Apple's and
//     OpenLibrary's search from the recordings in tests/fixtures after 120 ms, the Goodreads edge
//     function after 450 ms, the analytics beacon empty.
//   - The cover CDN stand-in: requests for the host `is1-ssl.mzstatic.com` (Chromium maps it to
//     127.0.0.1, perf/browser.ts) get a synthetic JPEG of the size Apple's `<w>x<h>bb.jpg` URL asks
//     for and about the bytes a real cover has (11 KB at 120x180, 37 KB at 240x360, 116 KB at 600x900), made with sharp;
//     the seeded Books' `/perf/<n>/…` URLs and any other artwork URL (the sign-in wall's) alike.
// Not emulated: Early Hints, HTTP/3, Cloudflare's edge latency.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import http from 'node:http'
import http2 from 'node:http2'
import net from 'node:net'
import { syncBuiltinESMExports } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import sharp from 'sharp'
import { appleAnswer } from '../tests/support/apple.ts'
import { openLibraryAnswer } from '../tests/support/openLibrary.ts'

const port = Number(process.argv[2] ?? process.env.PERF_APP_PORT ?? 3101)
process.argv[2] = String(port)
const webDir = fileURLToPath(new URL('..', import.meta.url))
process.env.LIBELLUS_SERVE_ROOT ??= join(webDir, '.output/public')
const tlsDir = join(dirname(webDir), '.data/perf/tls-2')
mkdirSync(tlsDir, { recursive: true })
if (!existsSync(join(tlsDir, 'cert.pem'))) {
  execFileSync(
    'openssl',
    ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(tlsDir, 'key.pem'), '-out', join(tlsDir, 'cert.pem'), '-subj', '/CN=localhost', '-days', '60', '-addext', 'subjectAltName=DNS:localhost,DNS:is1-ssl.mzstatic.com,DNS:perf.supabase.co,IP:127.0.0.1'],
    { stdio: 'ignore' },
  )
}
const tls = { key: readFileSync(join(tlsDir, 'key.pem')), cert: readFileSync(join(tlsDir, 'cert.pem')), allowHTTP1: true }

// ------------------------------------------------------------------------------ covers

const BYTES_PER_PIXEL = (w, h) => {
  // What real covers weigh (docs/covers.md: 120x180 11 KB, 200x300 25 KB), interpolated.
  const px = w * h
  if (px <= 21600) return 0.51
  if (px <= 60000) return 0.42
  if (px <= 86400) return 0.44
  return 0.22
}
const noiseFor = new Map()
async function jpeg(n, w, h) {
  const target = BYTES_PER_PIXEL(w, h) * w * h
  const render = async (noise) => {
    const raw = Buffer.alloc(w * h * 3)
    const hue = (n * 47) % 360
    let seed = (n + 1) * 2654435761
    const rnd = () => ((seed = (Math.imul(seed ^ (seed >>> 13), 1274126177) + 1) >>> 0) / 4294967296)
    const band = (hue / 360) * 255
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const block = (Math.floor(y / (h / 9)) + Math.floor(x / (w / 5))) % 3
        const base = 40 + (y / h) * 120 + block * 25
        raw[(y * w + x) * 3] = Math.max(0, Math.min(255, base + band * 0.3 + (rnd() - 0.5) * noise))
        raw[(y * w + x) * 3 + 1] = Math.max(0, Math.min(255, base * 0.8 + (rnd() - 0.5) * noise))
        raw[(y * w + x) * 3 + 2] = Math.max(0, Math.min(255, base * 0.6 + (255 - band) * 0.4 + (rnd() - 0.5) * noise))
      }
    return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 78 }).toBuffer()
  }
  const key = `${w}x${h}`
  let noise = noiseFor.get(key)
  if (noise === undefined) {
    // Calibrate once per size: bisect the noise until the file weighs what a real cover does.
    let lo = 0
    let hi = 255
    noise = 60
    for (let i = 0; i < 7; i++) {
      const size = (await render(noise)).length
      if (size > target) hi = noise
      else lo = noise
      noise = (lo + hi) / 2
    }
    noiseFor.set(key, noise)
  }
  return render(noise)
}

const covers = new Map()
async function coverResponse(req, res) {
  const url = new URL(req.url ?? '/', 'https://is1-ssl.mzstatic.com')
  const match = /\/perf\/(\d+)\/[^/]+\/(\d+)x(\d+)bb\.jpg$/.exec(url.pathname)
  // Any other Apple artwork (the sign-in wall's real URLs): a cover too, numbered by its path.
  const other = match ? null : /\/(\d+)x(\d+)bb\.jpg$/.exec(url.pathname)
  if (!match && !other) return void res.writeHead(404).end()
  const [, n, w, h] = match ? match.map(Number) : [0, createHash('md5').update(url.pathname).digest().readUInt16BE(0), Number(other[1]), Number(other[2])]
  const key = `${n}:${w}x${h}`
  if (!covers.has(key)) covers.set(key, jpeg(n, w, h))
  const body = await covers.get(key)
  res.writeHead(200, {
    'content-type': 'image/jpeg',
    'content-length': body.length,
    'cache-control': 'public, max-age=31536000',
    'access-control-allow-origin': '*',
    'timing-allow-origin': '*',
  })
  res.end(body)
}

// ------------------------------------------------------------------- third parties

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-max-age': '3600' }
/** Answers for the hosts the app talks to besides the app and its API. */
async function thirdParty(host, req, res) {
  const url = new URL(req.url ?? '/', `https://${host}`)
  const json = (body) => (res.writeHead(200, { ...CORS, 'content-type': 'application/json' }), res.end(JSON.stringify(body)))
  if (req.method === 'OPTIONS') return void (res.writeHead(204, CORS), res.end())
  if (host === 'itunes.apple.com') return void (await wait(120), json(appleAnswer(url)))
  if (host === 'openlibrary.org') return void (await wait(120), json(openLibraryAnswer(url)))
  if (host === 'covers.openlibrary.org') return void (await coverResponse({ url: '/perf/1/x/180x270bb.jpg' }, res))
  res.writeHead(204, CORS)
  res.end()
}
const THIRD_PARTY = /^(itunes\.apple\.com|openlibrary\.org|covers\.openlibrary\.org|static\.cloudflareinsights\.com|cloudflareinsights\.com)$/

// ------------------------------------------------------------------------ the API

const UPSTREAM = process.env.PERF_UPSTREAM ?? 'http://127.0.0.1:55671'
async function apiResponse(req, res, clean, served) {
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(await Array.fromAsync(req))
  const headers = { ...clean }
  for (const h of ['host', 'connection', 'accept-encoding', 'content-length', 'transfer-encoding']) delete headers[h]
  const upstream = await fetch(UPSTREAM + req.url, { method: req.method, headers, body })
  const raw = Buffer.from(await upstream.arrayBuffer())
  const out = {}
  upstream.headers.forEach((value, name) => {
    if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(name)) out[name] = value
  })
  let payload = raw
  if (raw.length > 1024 && /json|text/.test(String(out['content-type'] ?? '')) && /\bbr\b/.test(String(clean['accept-encoding'] ?? ''))) {
    payload = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } })
    out['content-encoding'] = 'br'
    out.vary = 'Accept-Encoding'
  }
  if (req.method === 'OPTIONS') out['access-control-max-age'] = '3600'
  out['content-length'] = payload.length
  out['timing-allow-origin'] = '*'
  served.push({ t: Date.now(), path: `api ${req.method} ${req.url.slice(0, 90)}`, status: upstream.status, bytes: payload.length, raw: raw.length, enc: out['content-encoding'] ?? '', dest: '', cache: '' })
  res.writeHead(upstream.status, out)
  res.end(req.method === 'HEAD' ? undefined : payload)
}

// ------------------------------------------------------------------- Pages' extras

const TEXT = /^(text\/|application\/(json|javascript|manifest\+json|wasm)|image\/svg|font\/ttf)|javascript|json|xml/
/** Everything the server sent, for `GET /__perf/log?since=<ms>`: the wire's side of a run, service worker included. */
const served = []

/**
 * Experiments on the HTML (PERF_EXPERIMENT=no-prefetch,preload-route): what a fix to index.html would
 * do, tried without touching the app. `no-prefetch` drops the <link rel=prefetch> of every route
 * chunk; `preload-route` preloads what the first screen loads in its second and third wave (the
 * list is ../.data/perf/preload-list.json: the requests of a cold start made by scripts).
 */
const EXPERIMENTS = new Set((process.env.PERF_EXPERIMENT ?? '').split(',').filter(Boolean))
const preloadList = EXPERIMENTS.has('preload-route') ? JSON.parse(readFileSync(join(dirname(webDir), '.data/perf/preload-list.json'), 'utf8')) : null
function experiment(html) {
  if (EXPERIMENTS.has('no-prefetch')) html = html.replace(/<link rel="prefetch"[^>]*>/g, '')
  if (preloadList)
    html = html.replace(
      '</head>',
      `${preloadList.js.map((u) => `<link rel="modulepreload" crossorigin href="${u}">`).join('')}${preloadList.css.map((u) => `<link rel="preload" as="style" crossorigin href="${u}">`).join('')}</head>`,
    )
  return html
}
function pages(req, res, handler) {
  const host = String(req.headers['x-perf-host'] ?? req.headers[':authority'] ?? req.headers.host ?? req.authority ?? '')
  // HTTP/2's pseudo-headers (and Node's symbol key) are not header names to `new Request`.
  const clean = {}
  for (const [name, value] of Object.entries(req.headers)) if (!name.startsWith(':')) clean[name] = value
  Object.defineProperty(req, 'headers', { value: clean })
  if (host.startsWith('is1-ssl.mzstatic.com')) return void coverResponse(req, res)
  if (THIRD_PARTY.test(host.replace(/:\d+$/, ''))) return void thirdParty(host.replace(/:\d+$/, ''), req, res)
  if (host.startsWith('perf.supabase.co') && req.url?.startsWith('/functions/v1/')) {
    if (req.method === 'OPTIONS') return void (res.writeHead(204, CORS), res.end())
    return void wait(450).then(() => (res.writeHead(200, { ...CORS, 'content-type': 'application/json' }), res.end(JSON.stringify({ status: 'found', goodreadsId: '1', rating: 4.12, ratingsCount: 183000, reviewsCount: 9800 }))))
  }
  if (host.startsWith('perf.supabase.co')) return void apiResponse(req, res, clean, served).catch((e) => (res.writeHead(502), res.end(String(e))))
  if (req.url?.startsWith('/__perf/log')) {
    const since = Number(new URL(req.url, 'https://x').searchParams.get('since') ?? 0)
    res.writeHead(200, { 'content-type': 'application/json' })
    return void res.end(JSON.stringify(served.filter((e) => e.t >= since)))
  }
  const accepts = String(req.headers['accept-encoding'] ?? '')
  const writeHead = res.writeHead.bind(res)
  let status = 200
  let headers = {}
  res.writeHead = (s, h) => {
    status = s
    headers = h ?? {}
    return res
  }
  const end = res.end.bind(res)
  res.end = (given) => {
    let body = given
    if (body === undefined || !Buffer.isBuffer(body)) {
      writeHead(status, headers)
      return end(given)
    }
    const type = String(headers['content-type'] ?? '')
    if (EXPERIMENTS.size && /text\/html/.test(type) && status === 200) body = Buffer.from(experiment(body.toString('utf8')))
    const etag = `"${createHash('sha1').update(body).digest('hex').slice(0, 16)}"`
    if (status === 200 && req.method === 'GET') headers.etag = etag
    if (status === 200 && req.headers['if-none-match'] === etag) {
      served.push({ t: Date.now(), path: req.url, status: 304, bytes: 0, raw: 0, enc: '', dest: clean['sec-fetch-dest'] ?? '', cache: clean['cache-control'] ?? '' })
      writeHead(304, { etag, 'cache-control': headers['cache-control'] })
      return end()
    }
    let out = body
    if (status === 200 && TEXT.test(type) && body.length > 256) {
      if (/\bbr\b/.test(accepts)) {
        out = brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } })
        headers['content-encoding'] = 'br'
      } else if (/\bgzip\b/.test(accepts)) {
        out = gzipSync(body)
        headers['content-encoding'] = 'gzip'
      }
      headers.vary = 'Accept-Encoding'
    }
    headers['content-length'] = out.length
    served.push({ t: Date.now(), path: req.url, status, bytes: out.length, raw: body.length, enc: headers['content-encoding'] ?? '', dest: clean['sec-fetch-dest'] ?? '', cache: clean['cache-control'] ?? '' })
    writeHead(status, headers)
    end(out)
  }
  return handler(req, res)
}

// e2e/serve.mjs makes its server with http.createServer(listener). Give it one port that speaks
// both: TLS (first byte 0x16) goes to an HTTP/2 server, anything else to a plain HTTP/1.1 one.
// Chromium uses https://localhost (h2, as Pages); WebKit http://localhost, because it blocks the
// local stack's http://127.0.0.1 API from an https page as mixed content.
const createPlain = http.createServer
http.createServer = (listener) => {
  const handle = (req, res) => void pages(req, res, listener)
  const secure = http2.createSecureServer(tls, handle)
  const plain = createPlain(handle)
  return net.createServer((socket) => {
    socket.once('data', (first) => {
      socket.pause()
      socket.unshift(first)
      ;(first[0] === 0x16 ? secure : plain).emit('connection', socket)
      process.nextTick(() => socket.resume())
    })
  })
}
syncBuiltinESMExports()
await import('../e2e/serve.mjs')
