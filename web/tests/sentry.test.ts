import { describe, expect, it } from 'vitest'
import { sentryDsn, sentryEnvironment } from '~/utils/sentryConfig'
import { clickPath, deviceContexts, scrubEvent, scrubString } from '~/utils/sentryScrub'
import { FROZEN_MS, MAX_PLAUSIBLE_MS, MAX_REPORTS, WATCH_TICK_MS, watchFrozen } from '~/utils/uiFrozen'

/** Sentry: what may leave the phone, when Sentry runs at all, and the „UI frozen“ watchdog. */

const ID = '3f2b8c1e-5a47-4d0e-9b6a-1c2d3e4f5a6b'

describe('sentryDsn: no DSN, no Sentry', () => {
  it('is off for an empty, missing or malformed value', () => {
    for (const raw of [undefined, null, '', '   ', 42, 'not a url', 'https://ingest.de.sentry.io/1']) expect(sentryDsn(raw)).toBe('')
  })
  it('accepts an EU DSN and trims it', () => {
    const dsn = 'https://abc123@o4500.ingest.de.sentry.io/4510'
    expect(sentryDsn(`  ${dsn}\n`)).toBe(dsn)
  })
  it('refuses a DSN outside the EU region or a plain-http one', () => {
    expect(sentryDsn('https://abc@o1.ingest.us.sentry.io/2')).toBe('')
    expect(sentryDsn('https://abc@o1.ingest.sentry.io/2')).toBe('')
    expect(sentryDsn('https://abc@evil.example/2')).toBe('')
    expect(sentryDsn('http://abc@o1.ingest.de.sentry.io/2')).toBe('')
  })
})

describe('sentryEnvironment', () => {
  it('tells production, preview and dev apart', () => {
    expect(sentryEnvironment('app.bookretreats-with-nina.com', false)).toBe('production')
    expect(sentryEnvironment('0a1b2c.libellus-3q1.pages.dev', false)).toBe('preview')
    expect(sentryEnvironment('main.libellus-3q1.pages.dev', false)).toBe('preview')
    expect(sentryEnvironment('localhost', false)).toBe('dev')
    expect(sentryEnvironment('app.bookretreats-with-nina.com', true)).toBe('dev')
  })
})

describe('scrubString', () => {
  it('cuts a URL at its query and hash, also inside a longer string', () => {
    expect(scrubString('https://x.supabase.co/rest/v1/profiles?select=*&name=eq.Ida#top')).toBe('https://x.supabase.co/rest/v1/profiles')
    expect(scrubString('GET https://x.supabase.co/rest/v1/rpc/feed?limit=5 failed')).toBe('GET https://x.supabase.co/rest/v1/rpc/feed failed')
    expect(scrubString('/chat/abc?draft=hallo')).toBe('/chat/abc')
  })
  it('replaces e-mail addresses and member ids', () => {
    expect(scrubString('sign-in failed for ida@example.com')).toBe('sign-in failed for [email]')
    expect(scrubString(`/members/${ID}/books`)).toBe('/members/:id/books')
    expect(scrubString(`id=eq.${ID.toUpperCase()}`)).toBe('id=eq.:id')
  })
  it('leaves an ordinary message alone', () => {
    expect(scrubString("Cannot read properties of undefined (reading 'name')")).toBe("Cannot read properties of undefined (reading 'name')")
  })
})

describe('scrubEvent failure', () => {
  it('sends a minimal safe event instead of dropping when the scrubber throws', () => {
    const event = {
      event_id: 'e1', release: '1.30.2', environment: 'production', level: 'error',
      tags: { route: '/members/:id', other: 'x' },
      exception: { values: [{ type: 'TypeError', value: 'bad for ida@example.com', stacktrace: { frames: [{ vars: { secret: 1 } }] } }] },
      breadcrumbs: [{ message: 'tap' }], extra: { a: 1 },
      get contexts(): unknown { throw new Error('boom') },
    }
    const out = scrubEvent(event) as Record<string, any>
    expect(out).not.toBeNull()
    expect(out.tags).toEqual({ 'scrub.failed': 'true', route: '/members/:id' })
    expect(out.release).toBe('1.30.2')
    expect(out.exception.values[0]).toEqual({ type: 'TypeError', value: 'bad for [email]' })
    for (const key of ['breadcrumbs', 'extra', 'contexts', 'request', 'user']) expect(out[key]).toBeUndefined()
  })
  it('still returns an event when even the minimal path hits a hostile object', () => {
    const hostile = new Proxy({}, { get() { throw new Error('boom') }, ownKeys() { throw new Error('boom') } })
    expect(scrubEvent(hostile)).toEqual({ tags: { 'scrub.failed': 'true' } })
  })
})

describe('scrubEvent', () => {
  const event = () => ({
    event_id: 'e1',
    release: '1.29.0',
    environment: 'production',
    server_name: 'ida-iphone',
    user: { id: ID, email: 'ida@example.com', username: 'Ida', ip_address: '1.2.3.4' },
    request: {
      url: `https://app.bookretreats-with-nina.com/members/${ID}?tab=books#x`,
      query_string: 'tab=books',
      cookies: { sb: 'secret' },
      headers: { 'User-Agent': 'x', Authorization: 'Bearer abc' },
      data: { body: 'Hallo Nina, wie geht es dir?' },
    },
    exception: { values: [{ type: 'Error', value: 'insert failed for ida@example.com', stacktrace: { frames: [{ filename: 'app:///_nuxt/a.js', lineno: 3 }] } }] },
    contexts: { vue: { propsData: { text: 'Hallo Nina' }, componentName: 'ChatBubble' } },
    breadcrumbs: [
      { category: 'console', message: 'draft: Hallo Nina' },
      { category: 'ui.input', message: 'input#message' },
      { category: 'ui.click', message: 'button[aria-label="Ida Müller"]', timestamp: 1 },
      { category: 'fetch', data: { url: `https://x.supabase.co/rest/v1/profiles?id=eq.${ID}`, status_code: 500 } },
      { category: 'navigation', data: { from: `/chat/${ID}?x=1`, to: '/feed' } },
    ],
    spans: [{ description: 'GET https://x.supabase.co/rest/v1/rpc/feed?limit=5', data: { 'http.query': '?limit=5', 'http.response.status_code': 200, 'url.full': 'https://x.supabase.co/rest/v1/rpc/feed?limit=5' } }],
    transaction: `/members/${ID}`,
  })

  it('removes the person, the IP and the server name', () => {
    const out = scrubEvent(event()) as Record<string, unknown>
    expect(out).not.toHaveProperty('user')
    expect(out).not.toHaveProperty('server_name')
    expect(JSON.stringify(out)).not.toMatch(/1\.2\.3\.4|Ida|ida@|ida-iphone/)
  })
  it('keeps of the request only the URL without query and hash, with the id replaced', () => {
    const out = scrubEvent(event()) as { request: Record<string, unknown> }
    expect(out.request).toEqual({ url: 'https://app.bookretreats-with-nina.com/members/:id' })
  })
  it('drops console and typing breadcrumbs, a click\'s selector and every query string', () => {
    const out = scrubEvent(event()) as { breadcrumbs: Record<string, unknown>[] }
    expect(out.breadcrumbs.map((b) => b.category)).toEqual(['ui.click', 'fetch', 'navigation'])
    expect(out.breadcrumbs[0]).toEqual({ category: 'ui.click', timestamp: 1 })
    expect(out.breadcrumbs[1]).toEqual({ category: 'fetch', data: { url: 'https://x.supabase.co/rest/v1/profiles', status_code: 500 } })
    expect(out.breadcrumbs[2]).toEqual({ category: 'navigation', data: { from: '/chat/:id', to: '/feed' } })
  })
  it('keeps what says what broke: stack, release, environment, status', () => {
    const out = scrubEvent(event()) as Record<string, any>
    expect(out.release).toBe('1.29.0')
    expect(out.environment).toBe('production')
    expect(out.exception.values[0].stacktrace.frames[0]).toEqual({ filename: 'app:///_nuxt/a.js', lineno: 3 })
    expect(out.exception.values[0].value).toBe('insert failed for [email]')
    expect(out.breadcrumbs[1].data.status_code).toBe(500)
  })
  it('cleans a transaction: route, spans, no component props', () => {
    const out = scrubEvent(event()) as Record<string, any>
    expect(out.transaction).toBe('/members/:id')
    expect(out.spans[0]).toEqual({ description: 'GET https://x.supabase.co/rest/v1/rpc/feed', data: { 'http.response.status_code': 200 } })
    expect(out.contexts.vue).toEqual({ componentName: 'ChatBubble' })
  })
  it('does not mutate its input and survives an event with only a message', () => {
    const input = event()
    const copy = JSON.parse(JSON.stringify(input))
    scrubEvent(input)
    expect(input).toEqual(copy)
    expect(scrubEvent({ message: 'hello' })).toEqual({ message: 'hello' })
  })
  it('sends only a minimal event when it cannot read the original', () => {
    const loop: Record<string, unknown> = {}
    Object.defineProperty(loop, 'boom', { enumerable: true, get() { throw new Error('x') } })
    expect((scrubEvent(loop) as { tags: unknown }).tags).toEqual({ 'scrub.failed': 'true' })
  })
})

describe('what an event says about the device and the tap (for finding a fault, never who)', () => {
  const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1'
  const IPHONE_HOME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
  const IPAD_CHROME = 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.96 Mobile/15E148 Safari/604.1'
  const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 15; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
  const ANDROID_SAMSUNG = 'Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36'
  const MAC_FIREFOX = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0'

  it('names browser and major version, system and version, and the device family, never a model', () => {
    expect(deviceContexts(IPHONE_SAFARI)).toEqual({ browser: { name: 'Safari', version: '18' }, os: { name: 'iOS', version: '18.6' }, device: { family: 'iPhone' } })
    expect(deviceContexts(IPAD_CHROME)).toEqual({ browser: { name: 'Chrome', version: '141' }, os: { name: 'iOS', version: '17.4' }, device: { family: 'iPad' } })
    expect(deviceContexts(ANDROID_CHROME)).toEqual({ browser: { name: 'Chrome', version: '141' }, os: { name: 'Android', version: '15' }, device: { family: 'Android' } })
    expect(deviceContexts(ANDROID_SAMSUNG).browser).toEqual({ name: 'Samsung Internet', version: '28' })
    expect(deviceContexts(MAC_FIREFOX)).toEqual({ browser: { name: 'Firefox', version: '144' }, os: { name: 'macOS' }, device: { family: 'Mac' } })
    expect(JSON.stringify(deviceContexts(ANDROID_CHROME))).not.toMatch(/SM-S918B/)
  })
  it('says so when the app runs from the home screen (no browser in the User-Agent)', () => {
    expect(deviceContexts(IPHONE_HOME).browser).toEqual({ name: 'Safari (Home-Bildschirm)', version: '26' })
  })
  it('adds nothing it cannot read', () => {
    expect(deviceContexts('')).toEqual({})
  })
  it('scrubEvent puts them into the contexts, beside what is there', () => {
    const out = scrubEvent({ contexts: { trace: { trace_id: 'a' } } }, deviceContexts(IPHONE_SAFARI)) as { contexts: Record<string, unknown> }
    expect(out.contexts).toEqual({ trace: { trace_id: 'a' }, browser: { name: 'Safari', version: '18' }, os: { name: 'iOS', version: '18.6' }, device: { family: 'iPhone' } })
  })

  /** A stand-in element: tag, test id, parent. */
  const el = (tagName: string, attrs: Record<string, string> = {}, parentElement: unknown = null) => ({ tagName, parentElement, getAttribute: (name: string) => attrs[name] ?? null })

  it('a tap is named by tag names and test ids, never an id, a class, a label or text', () => {
    const body = el('BODY')
    const sheet = el('DIV', { 'data-testid': 'member.sheet', id: 'x', class: 'fixed', 'aria-label': 'Anna Becker' }, body)
    const head = el('HEADER', {}, sheet)
    const button = el('BUTTON', { 'data-testid': 'profile.photoButton', 'aria-label': 'Foto von Anna vergrößern' }, head)
    const icon = el('svg', {}, button)
    expect(clickPath(icon)).toBe('div[data-testid="member.sheet"] > header > button[data-testid="profile.photoButton"] > svg')
    expect(clickPath(null)).toBeUndefined()
    // At most five steps, from the tapped element up.
    let deep: unknown = body
    for (let i = 0; i < 8; i++) deep = el('DIV', {}, deep)
    expect(clickPath(el('SPAN', {}, deep))).toBe('div > div > div > div > span')
  })
  it('scrubEvent keeps that path, with an id in a test id replaced, and drops any other selector', () => {
    const out = scrubEvent({
      breadcrumbs: [
        { category: 'ui.click', message: 'div[data-testid="member.sheet"] > button[data-testid="profile.photoButton"]' },
        { category: 'ui.click', message: `li[data-testid="feed.post.${ID}"]` },
        { category: 'ui.click', message: 'body > div#__nuxt > button.inline-flex[aria-label="Ida Müller"]' },
        { category: 'ui.click', message: 'button[data-testid="x"][aria-label="Ida"]' },
      ],
    }) as { breadcrumbs: { message?: string }[] }
    expect(out.breadcrumbs.map((crumb) => crumb.message)).toEqual([
      'div[data-testid="member.sheet"] > button[data-testid="profile.photoButton"]',
      'li[data-testid="feed.post.:id"]',
      undefined,
      undefined,
    ])
  })
})

describe('watchFrozen', () => {
  function rig(longWork?: (from: number, to: number) => number | undefined) {
    let t = 0
    let tick = () => {}
    let visibility = () => {}
    let visible = true
    const stops = { timer: 0, visibility: 0 }
    const reports: number[] = []
    const stop = watchFrozen((ms) => reports.push(ms), {
      now: () => t,
      every: (fn) => { tick = fn; return () => { stops.timer += 1 } },
      onVisibility: (fn) => { visibility = fn; return () => { stops.visibility += 1 } },
      isVisible: () => visible,
      longWork: longWork && ((a, b) => longWork(a, b)),
    })
    return {
      reports, stop, stops,
      advance(ms: number) { t += ms; tick() },
      pass(ms: number) { t += ms },
      sleepSignal() { visibility() },
      hide() { visible = false; visibility() },
      show() { visible = true; visibility() },
    }
  }

  it('stays quiet while the ticks come on time, also at a slow 4 s block', () => {
    const w = rig()
    for (let i = 0; i < 10; i++) w.advance(WATCH_TICK_MS)
    w.advance(WATCH_TICK_MS + FROZEN_MS - 1)
    expect(w.reports).toEqual([])
  })
  it('reports a block of 5 s or more, as the time beyond the tick', () => {
    const w = rig()
    w.advance(WATCH_TICK_MS + FROZEN_MS)
    w.advance(WATCH_TICK_MS + 12_000)
    expect(w.reports).toEqual([5_000, 12_000])
  })
  it('ignores a gap while the page was in the background', () => {
    const w = rig()
    w.hide()
    w.advance(60_000)
    w.show()
    w.advance(WATCH_TICK_MS)
    expect(w.reports).toEqual([])
  })
  it('treats a sleep signal (freeze/pagehide/blur) since the last tick as sleep', () => {
    const w = rig()
    w.advance(WATCH_TICK_MS)
    w.pass(20_000) // timers frozen, clock runs
    w.sleepSignal() // resume/pageshow fires
    w.advance(WATCH_TICK_MS)
    expect(w.reports).toEqual([])
  })
  it('without a long-task API (iOS) reports up to 60 s and calls longer gaps sleep', () => {
    const w = rig(() => undefined)
    w.advance(WATCH_TICK_MS + MAX_PLAUSIBLE_MS)
    w.advance(WATCH_TICK_MS + MAX_PLAUSIBLE_MS + 1)
    expect(w.reports).toEqual([MAX_PLAUSIBLE_MS])
  })
  it('with a long-task API reports only when long work covered the gap', () => {
    let covered = 0
    const w = rig(() => covered)
    w.advance(WATCH_TICK_MS + 227_000) // phone asleep: no long task
    expect(w.reports).toEqual([])
    covered = 20_000
    w.advance(WATCH_TICK_MS + 25_000) // 20 s of 25 s busy
    expect(w.reports).toEqual([25_000])
    covered = 1_000
    w.advance(WATCH_TICK_MS + 8_000) // one short task only
    expect(w.reports).toEqual([25_000])
  })
  it('reports a long real block above 60 s when long work proves it', () => {
    const w = rig((from, to) => to - from)
    w.advance(WATCH_TICK_MS + 90_000)
    expect(w.reports).toEqual([90_000])
  })
  it('reports at most MAX_REPORTS a page load and stops cleanly', () => {
    const w = rig()
    for (let i = 0; i < MAX_REPORTS + 3; i++) w.advance(WATCH_TICK_MS + FROZEN_MS)
    expect(w.reports).toHaveLength(MAX_REPORTS)
    w.stop()
    expect(w.stops).toEqual({ timer: 1, visibility: 1 })
  })
})
