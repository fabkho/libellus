/**
 * Perf harness: browsers, profiles, the in-page collectors and the network log.
 *
 * A *profile* is a browser plus what it is throttled by. Chromium can be throttled through CDP (CPU
 * rate, network conditions); WebKit cannot, it runs as is.
 *
 *   slow4g-4x   Chromium, CPU 4x slower, Slow 4G (1.6 Mbit/s, 150 ms; Lighthouse's mobile setting)
 *   chromium    Chromium unthrottled
 *   webkit      WebKit (Playwright's build of Safari's engine) unthrottled, iPhone 15 viewport
 *
 * The collectors (`COLLECT`) run in every page before the app does, as an init script: they
 * keep the browser's own performance entries (LCP, layout shifts, Event Timing, long tasks, Long
 * Animation Frames with their script attribution, paints) and a requestAnimationFrame gap sampler
 * that a step switches on. Nothing here is app code; the app is the production build.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { getCACertificates, setDefaultCACertificates } from 'node:tls'
import { createClient } from '@supabase/supabase-js'
import { chromium, devices, webkit, type Browser, type BrowserContext, type CDPSession, type Page, type Request } from '@playwright/test'
import { APP_SUPABASE_URL, appUrl, env, MEMBER_EMAIL } from './env'

export type Profile = {
  name: string
  engine: 'chromium' | 'webkit'
  /** CPU slowdown (CDP `Emulation.setCPUThrottlingRate`); Chromium only. */
  cpu: number
  /** Network (CDP `Network.emulateNetworkConditions`); Chromium only. */
  network: { latency: number; down: number; up: number } | null
  describe: string
}

export const PROFILES: Record<string, Profile> = {
  'slow4g-4x': {
    name: 'slow4g-4x',
    engine: 'chromium',
    cpu: 4,
    // Lighthouse's "Slow 4G": 150 ms RTT, 1.6 Mbit/s down, 750 kbit/s up (bytes per second here).
    network: { latency: 150, down: (1.6 * 1024 * 1024) / 8, up: (750 * 1024) / 8 },
    describe: 'Chromium, CPU 4x slower, Slow 4G (1.6 Mbit/s down, 150 ms)',
  },
  // A slower phone than Lighthouse's reference (an Android in the lower middle class): the stutters show earlier.
  'slow4g-6x': {
    name: 'slow4g-6x',
    engine: 'chromium',
    cpu: 6,
    network: { latency: 150, down: (1.6 * 1024 * 1024) / 8, up: (750 * 1024) / 8 },
    describe: 'Chromium, CPU 6x slower, Slow 4G (1.6 Mbit/s down, 150 ms)',
  },
  'chromium': { name: 'chromium', engine: 'chromium', cpu: 1, network: null, describe: 'Chromium, unthrottled' },
  'webkit': { name: 'webkit', engine: 'webkit', cpu: 1, network: null, describe: 'WebKit (no throttling available), iPhone 15 viewport' },
}

/** In-page collectors, installed before the app's scripts. Entries are kept raw; the harness cuts windows out of them. */
export const COLLECT = () => {
  const w = window as unknown as Record<string, unknown> & { __perf?: unknown }
  if (w.__perf) return
  const perf = {
    lcp: [] as unknown[],
    cls: [] as unknown[],
    events: [] as unknown[],
    longtasks: [] as unknown[],
    loaf: [] as unknown[],
    paints: [] as unknown[],
    frames: [] as number[],
    sampling: false,
    seen: {} as Record<string, number>,
  }
  w.__perf = perf
  const observe = (type: string, onEntries: (entries: PerformanceEntry[]) => void, extra: Record<string, unknown> = {}) => {
    try {
      new PerformanceObserver((list) => onEntries(list.getEntries())).observe({ type, buffered: true, ...extra })
    } catch {
      /* the engine does not know this entry type */
    }
  }
  const name = (el: Element | null | undefined) =>
    el ? `${el.tagName.toLowerCase()}${el.getAttribute('data-testid') ? `[${el.getAttribute('data-testid')}]` : ''}${el.id ? `#${el.id}` : ''}` : null
  observe('largest-contentful-paint', (es) =>
    es.forEach((e) => {
      const l = e as unknown as { size: number; url: string; element: Element | null; renderTime: number; loadTime: number }
      perf.lcp.push({ startTime: e.startTime, size: l.size, url: l.url, element: name(l.element), render: l.renderTime, load: l.loadTime })
    }),
  )
  observe('layout-shift', (es) =>
    es.forEach((e) => {
      const s = e as unknown as { value: number; hadRecentInput: boolean; sources?: { node: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }[] }
      perf.cls.push({
        startTime: e.startTime,
        value: s.value,
        hadRecentInput: s.hadRecentInput,
        sources: (s.sources ?? []).slice(0, 3).map((x) => ({ node: name(x.node as Element), from: [x.previousRect.x, x.previousRect.y, x.previousRect.width, x.previousRect.height].map(Math.round), to: [x.currentRect.x, x.currentRect.y, x.currentRect.width, x.currentRect.height].map(Math.round) })),
      })
    }),
  )
  observe(
    'event',
    (es) =>
      es.forEach((e) => {
        const v = e as unknown as { processingStart: number; processingEnd: number; interactionId: number; target: Element | null }
        perf.events.push({ type: e.name, startTime: e.startTime, duration: e.duration, inputDelay: v.processingStart - e.startTime, processing: v.processingEnd - v.processingStart, presentation: e.startTime + e.duration - v.processingEnd, interactionId: v.interactionId, target: name(v.target) })
      }),
    { durationThreshold: 16 },
  )
  observe('longtask', (es) => es.forEach((e) => perf.longtasks.push({ startTime: e.startTime, duration: e.duration })))
  observe('long-animation-frame', (es) =>
    es.forEach((e) => {
      const l = e as unknown as {
        blockingDuration: number
        renderStart: number
        styleAndLayoutStart: number
        firstUIEventTimestamp: number
        scripts: { sourceURL: string; sourceFunctionName: string; invoker: string; invokerType: string; duration: number; forcedStyleAndLayoutDuration: number; sourceCharPosition: number }[]
      }
      perf.loaf.push({
        startTime: e.startTime,
        duration: e.duration,
        blocking: l.blockingDuration,
        renderStart: l.renderStart,
        styleAndLayoutStart: l.styleAndLayoutStart,
        firstUI: l.firstUIEventTimestamp,
        scripts: l.scripts.map((s) => ({ src: s.sourceURL.split('/').pop(), fn: s.sourceFunctionName, invoker: s.invoker, type: s.invokerType, d: s.duration, forced: s.forcedStyleAndLayoutDuration, pos: s.sourceCharPosition })),
      })
    }),
  )
  observe('paint', (es) => es.forEach((e) => perf.paints.push({ name: e.name, startTime: e.startTime })))
  // rAF gaps while a step samples.
  let last = 0
  const tick = (t: number) => {
    if (perf.sampling) {
      if (last) perf.frames.push(t - last)
      last = t
    } else last = 0
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  // The first time a selector is on screen (visible box): exact, taken in the page's own frame loop.
  w.__perfWatch = (selector: string) => {
    if (perf.seen[selector] !== undefined) return
    const check = () => {
      const el = document.querySelector(selector)
      const box = el?.getBoundingClientRect()
      if (box && box.width > 0 && box.height > 0) perf.seen[selector] = performance.now()
      else requestAnimationFrame(check)
    }
    check()
  }
}

/** A session for the seeded member, made as the sign-in's last step would (admin link → verifyOtp); no mailed code. */
export async function memberSession(): Promise<Record<string, string>> {
  const admin = createClient(env.supabaseUrl, env.serviceKey, { auth: { persistSession: false } })
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: MEMBER_EMAIL })
  if (link.error) throw new Error(`no session: ${link.error.message} (did you run pnpm perf:seed?)`)
  const store: Record<string, string> = {}
  const storage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => void (store[k] = v),
    removeItem: (k: string) => void delete store[k],
  }
  const anon = createClient(env.supabaseUrl, env.anonKey, { auth: { storage, persistSession: true, autoRefreshToken: false } })
  const verified = await anon.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'magiclink' })
  if (verified.error) throw verified.error
  // supabase-js names the entry after the API's host (`sb-<first label>-auth-token`): the one the build is made with.
  const [value] = Object.values(store)
  return { [`sb-${new URL(APP_SUPABASE_URL).hostname.split('.')[0]}-auth-token`]: value! }
}

/** The certificate perf/serve.mjs serves with: it makes one for itself in .data/perf/tls-2 before it listens. */
const harnessCertPath = new URL('../../.data/perf/tls-2/cert.pem', import.meta.url).pathname

/** The SPKI hash of that certificate: Chromium then trusts it fully (a bare ignore-certificate-errors leaves the page an insecure context, with no service worker). */
function spkiHash() {
  const der = execFileSync('openssl', ['x509', '-in', harnessCertPath, '-pubkey', '-noout'], { encoding: 'utf8' })
  const raw = execFileSync('openssl', ['pkey', '-pubin', '-outform', 'der'], { input: der })
  return createHash('sha256').update(raw).digest('base64')
}

/**
 * Node's side of the same trust: what the harness itself asks of that server (the WebKit cover and API
 * routes below, which go through `fetch`) trusts this certificate, rather than certificate validation
 * being switched off for the process. Before anything connects: a TLS client that has connected keeps
 * the store it was built with, so this must not wait for the first request.
 */
function trustHarnessCertificate() {
  if (!existsSync(harnessCertPath)) return
  setDefaultCACertificates([...getCACertificates('default'), readFileSync(harnessCertPath, 'utf8')])
}
trustHarnessCertificate()

export async function launch(profile: Profile): Promise<Browser> {
  if (profile.engine === 'webkit') return webkit.launch()
  return chromium.launch({
    args: [
      `--ignore-certificate-errors-spki-list=${spkiHash()}`,
      // The cover CDN's host is ours (perf/serve.mjs), so the service worker's `mzstatic.com` cover route applies as in production.
      `--host-resolver-rules=${['is1-ssl.mzstatic.com', new URL(APP_SUPABASE_URL).hostname, 'itunes.apple.com', 'openlibrary.org', 'covers.openlibrary.org', 'static.cloudflareinsights.com', 'cloudflareinsights.com'].map((h) => `MAP ${h} 127.0.0.1:${env.coverPort}`).join(', ')}`,
      '--enable-precise-memory-info',
      '--js-flags=--expose-gc',
    ],
  })
}

/** A fresh browser context: phone viewport, the session in localStorage, the collectors, Search/Goodreads stubs. */
export async function newContext(browser: Browser, profile: Profile, session: Record<string, string>): Promise<BrowserContext> {
  const device = profile.engine === 'webkit' ? devices['iPhone 15'] : { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, userAgent: devices['Pixel 7'].userAgent }
  const context = await browser.newContext({ ...device, colorScheme: 'dark', ignoreHTTPSErrors: true, serviceWorkers: 'allow' })
  // tsx compiles with keepNames: the helper it wraps functions in must exist in the page too.
  await context.addInitScript('window.__name = (fn) => fn')
  await context.addInitScript(COLLECT)
  await context.addInitScript((s: Record<string, string>) => {
    for (const [k, v] of Object.entries(s)) if (!localStorage.getItem(k)) localStorage.setItem(k, v)
  }, session)
  return context
}

/**
 * What the app asks of the world that is not ours: Apple's and OpenLibrary's search (answered from
 * the recordings in tests/fixtures, as the Playwright flows do, with a fixed 120 ms of server time),
 * Goodreads (the edge function, not on this stack), the cover CDNs for WebKit (which cannot map a
 * host: answered from perf/serve.mjs through Node), analytics.
 */
export async function stubTheWorld(context: BrowserContext, profile: Profile) {
  // Chromium needs none of this: perf/serve.mjs answers for these hosts, and a route would switch its HTTP cache off.
  if (profile.engine !== 'webkit') return
  const { appleAnswer } = await import('../tests/support/apple')
  const { openLibraryAnswer } = await import('../tests/support/openLibrary')
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) })
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  await context.route('https://itunes.apple.com/**', async (route) => {
    await wait(120)
    await route.fulfill(json(appleAnswer(new URL(route.request().url()))))
  })
  await context.route('https://openlibrary.org/**', async (route) => {
    await wait(120)
    await route.fulfill(json(openLibraryAnswer(new URL(route.request().url()))))
  })
  await context.route('https://covers.openlibrary.org/**', (route) => route.fulfill({ status: 204 }))
  await context.route(/^https:\/\/(static\.)?cloudflareinsights\.com\//, (route) => route.fulfill({ status: 204 }))
  await context.route('**/functions/v1/**', async (route) => {
    await wait(450)
    await route.fulfill({ ...json({ status: 'found', goodreadsId: '1', rating: 4.12, ratingsCount: 183000, reviewsCount: 9800 }), headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
  })
  if (profile.engine === 'webkit') {
    // WebKit cannot map a host to a port: the API's look-alike host goes through Node to the server, like the covers.
    await context.route(new RegExp(`^${APP_SUPABASE_URL.replace(/[.]/g, '\\.')}/`), async (route) => {
      const r = route.request()
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
      if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      const res = await fetch(r.url().replace(APP_SUPABASE_URL, `https://localhost:${env.coverPort}`), { method: r.method(), headers: { ...(await r.allHeaders()), 'x-perf-host': 'perf.supabase.co', 'accept-encoding': 'identity' }, body: r.postDataBuffer() ?? undefined })
      const headers: Record<string, string> = { ...cors }
      res.headers.forEach((value, name) => {
        if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(name)) headers[name] = value
      })
      await route.fulfill({ status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) })
    })
    await context.route(/^https:\/\/is1-ssl\.mzstatic\.com\//, async (route) => {
      const res = await fetch(route.request().url().replace('is1-ssl.mzstatic.com', `localhost:${env.coverPort}`), { headers: { 'x-perf-host': 'is1-ssl.mzstatic.com' } }).catch(() => null)
      // Node's fetch trusts the harness's certificate itself (see trustHarnessCertificate).
      if (!res?.ok) return route.fulfill({ status: 404 })
      await route.fulfill({ status: 200, contentType: 'image/jpeg', headers: { 'access-control-allow-origin': '*' }, body: Buffer.from(await res.arrayBuffer()) })
    })
  }
}

export type NetEntry = {
  url: string
  host: 'app' | 'supabase' | 'covers' | 'other'
  type: string
  status: number
  /** Bytes over the wire (headers excluded in WebKit, included by CDP's encodedDataLength). */
  transfer: number
  /** Bytes after decompression (Chromium only). */
  decoded: number
  fromCache: boolean
  fromSW: boolean
  protocol: string
  /** Wall-clock ms the request started at (Date.now()). */
  at: number
  /** ms from request to its last byte. */
  ms: number
  initiator: string
}

const hostOf = (url: string): NetEntry['host'] => {
  const u = new URL(url)
  if (u.hostname === 'localhost' && u.port === String(env.appPort)) return 'app'
  if (u.hostname === new URL(APP_SUPABASE_URL).hostname) return 'supabase'
  if (/mzstatic\.com$|openlibrary\.org$/.test(u.hostname)) return 'covers'
  return 'other'
}

/** Every request a page makes, with sizes: from CDP in Chromium, from Playwright's request events in WebKit. */
export async function netLog(page: Page, cdp: CDPSession | null) {
  const entries: NetEntry[] = []
  if (cdp) {
    await cdp.send('Network.enable')
    const open = new Map<string, Partial<NetEntry> & { t0: number }>()
    cdp.on('Network.requestWillBeSent', (e) => {
      if (e.request.url.startsWith('data:') || e.request.url.startsWith('blob:')) return
      open.set(e.requestId, { url: e.request.url, at: Date.now(), t0: e.timestamp, type: (e.type ?? 'Other').toLowerCase(), decoded: 0, initiator: e.initiator.type })
    })
    cdp.on('Network.responseReceived', (e) => {
      const r = open.get(e.requestId)
      if (!r) return
      r.status = e.response.status
      r.fromCache = Boolean(e.response.fromDiskCache || e.response.fromPrefetchCache)
      r.fromSW = Boolean(e.response.fromServiceWorker)
      r.protocol = e.response.protocol ?? ''
      r.type = (e.type ?? r.type ?? 'other').toLowerCase()
    })
    cdp.on('Network.dataReceived', (e) => {
      const r = open.get(e.requestId)
      if (r) r.decoded = (r.decoded ?? 0) + e.dataLength
    })
    cdp.on('Network.loadingFinished', (e) => {
      const r = open.get(e.requestId)
      if (!r?.url) return
      open.delete(e.requestId)
      entries.push({ url: r.url, host: hostOf(r.url), type: r.type ?? 'other', status: r.status ?? 0, transfer: r.fromCache || r.fromSW ? 0 : Math.round(e.encodedDataLength), decoded: r.decoded ?? 0, fromCache: r.fromCache ?? false, fromSW: r.fromSW ?? false, protocol: r.protocol ?? '', at: r.at!, ms: Math.round((e.timestamp - r.t0) * 1000), initiator: r.initiator ?? '' })
    })
    cdp.on('Network.loadingFailed', (e) => open.delete(e.requestId))
    return { entries, inFlight: () => open.size }
  }
  const started = new Map<Request, number>()
  let inFlight = 0
  page.on('request', (r) => {
    started.set(r, Date.now())
    inFlight++
  })
  page.on('requestfailed', () => inFlight--)
  page.on('requestfinished', async (r) => {
    inFlight--
    const at = started.get(r) ?? Date.now()
    const sizes = await r.sizes().catch(() => null)
    const res = await r.response().catch(() => null)
    if (!/^https?:/.test(r.url())) return
    entries.push({ url: r.url(), host: hostOf(r.url()), type: r.resourceType(), status: res?.status() ?? 0, transfer: (sizes?.responseBodySize ?? 0) + (sizes?.responseHeadersSize ?? 0), decoded: 0, fromCache: false, fromSW: res?.fromServiceWorker() ?? false, protocol: '', at, ms: Date.now() - at, initiator: '' })
  })
  return { entries, inFlight: () => inFlight }
}

/** Applies a profile's throttling to a page's CDP session (the one that also reads metrics). */
export async function throttle(cdp: CDPSession | null, profile: Profile) {
  if (!cdp) return
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu })
  await cdp.send('Network.enable')
  if (profile.network)
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: profile.network.latency, downloadThroughput: profile.network.down, uploadThroughput: profile.network.up })
}
