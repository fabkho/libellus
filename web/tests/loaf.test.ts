import { describe, expect, it } from 'vitest'
import { createErrorLog, type ErrorReport } from '@/data/errorLog'
import {
  BOOT_IGNORED_MS,
  createLoafGate,
  describeInvoker,
  describeScript,
  isPoorFrame,
  loafCulprit,
  loafReport,
  loafSupported,
  loadStateAt,
  type LoafEntry,
} from '@/data/loaf'
import { POOR_LOAF } from '@/data/vitals'

const ORIGIN = 'https://libellus.fabkho.dev'
const context = { route: '/library', origin: ORIGIN, loadState: 'complete' }

const frame = (over: Partial<LoafEntry> = {}): LoafEntry => ({
  startTime: 9000,
  duration: 312,
  renderStart: 9280,
  styleAndLayoutStart: 9300,
  blockingDuration: 262.4,
  firstUIEventTimestamp: 0,
  scripts: [
    { duration: 40, invoker: 'Window.requestAnimationFrame', invokerType: 'user-callback', sourceURL: `${ORIGIN}/_nuxt/small.js`, sourceFunctionName: 'tick' },
    { duration: 240, invoker: 'BUTTON#book-42.onclick', invokerType: 'event-listener', sourceURL: `${ORIGIN}/_nuxt/BXyz12.js?v=abc#top`, sourceFunctionName: 'filter' },
  ],
  ...over,
})

describe('which frames are reported', () => {
  it('the threshold is 200 ms, at it and above', () => {
    expect(POOR_LOAF).toBe(200)
    expect(isPoorFrame({ startTime: 9000, duration: 199 })).toBe(false)
    expect(isPoorFrame({ startTime: 9000, duration: 200 })).toBe(true)
    expect(loafReport(frame({ duration: 199 }), context)).toBeNull()
  })

  it('not the start’s: nothing in the first 3 s', () => {
    expect(isPoorFrame({ startTime: BOOT_IGNORED_MS - 1, duration: 900 })).toBe(false)
    expect(isPoorFrame({ startTime: BOOT_IGNORED_MS, duration: 900 })).toBe(true)
  })

  it('only where the browser can observe them', () => {
    expect(loafSupported({ supportedEntryTypes: ['longtask', 'long-animation-frame'] })).toBe(true)
    expect(loafSupported({ supportedEntryTypes: ['longtask', 'paint'] })).toBe(false)
    expect(loafSupported({})).toBe(false)
    expect(loafSupported(undefined)).toBe(false)
  })
})

describe('the report', () => {
  it('a message with the duration and the route pattern', () => {
    expect(loafReport(frame(), context)?.message).toBe('LoAF 312 ms on /library')
    expect(loafReport(frame(), { ...context, route: '/book/:key' })?.message).toBe('LoAF 312 ms on /book/:key')
    expect(loafReport(frame(), { ...context, route: null })?.message).toBe('LoAF 312 ms on (unknown route)')
  })

  it('a stack of what made it long: blocking, render, style/layout, the scripts longest first, what the user did, the load state', () => {
    expect(loafReport(frame({ firstUIEventTimestamp: 9005 }), context)?.detail).toBe(
      [
        'blocking: 262 ms',
        'render: 32 ms',
        'style/layout: 12 ms',
        'scripts:',
        '  BUTTON.onclick (filter) from /_nuxt/BXyz12.js 240 ms',
        '  Window.requestAnimationFrame (tick) from /_nuxt/small.js 40 ms',
        'during: interaction (click)',
        'load state: complete',
      ].join('\n'),
    )
  })

  it('at most three scripts', () => {
    const scripts = Array.from({ length: 5 }, (_, i) => ({ duration: 10 + i, invoker: `f${i}`, sourceURL: `${ORIGIN}/_nuxt/${i}.js` }))
    const lines = loafReport(frame({ scripts }), context)!.detail.split('\n')
    expect(lines.filter((line) => line.startsWith('  '))).toHaveLength(3)
    expect(lines.join('\n')).toContain('f4')
    expect(lines.join('\n')).not.toContain('f0')
  })

  it('a frame without scripts or parts says so, and leaves the missing parts out', () => {
    const detail = loafReport({ startTime: 9000, duration: 250 }, context)!.detail
    expect(detail).toBe('scripts: (none)\nload state: complete')
  })

  it('during: the event type of an interaction, `navigation` when the route changed, nothing otherwise', () => {
    const during = (entry: LoafEntry, navigated = false) =>
      loafReport(entry, { ...context, navigated })!.detail.split('\n').find((line) => line.startsWith('during:'))
    expect(during(frame())).toBeUndefined()
    expect(during(frame({ firstUIEventTimestamp: 9100 }))).toBe('during: interaction (click)')
    expect(during(frame({ firstUIEventTimestamp: 9100, scripts: [] }))).toBe('during: interaction')
    expect(during(frame({ firstUIEventTimestamp: 8990 }))).toBe('during: interaction (click)')
    expect(during(frame({ firstUIEventTimestamp: 0 }))).toBeUndefined()
    expect(during(frame(), true)).toBe('during: navigation')
  })

  it('carries no element, text, id, query or fragment', () => {
    const detail = loafReport(
      frame({
        scripts: [{ duration: 300, invoker: `${ORIGIN}/_nuxt/app.js?token=secret#frag`, sourceURL: 'https://covers.example.com/b/9780140449136.js?x=1', sourceFunctionName: 'f' }],
      }),
      context,
    )!.detail
    expect(detail).not.toMatch(/secret|frag|token|x=1|9780140449136/)
    expect(detail).toContain('/_nuxt/app.js (f) from covers.example.com 300 ms')
  })

  it('the error log takes it as kind `vitals`', () => {
    const reports: ErrorReport[] = []
    const log = createErrorLog({ send: null, online: () => true, route: () => '/library', onReport: (report) => reports.push(report) })
    const report = loafReport(frame(), context)!
    log.report('vitals', report.message, { stack: report.detail, route: '/library' })
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ kind: 'vitals', message: 'LoAF 312 ms on /library', route: '/library' })
    expect(reports[0]!.stack).toContain('scripts:')
  })
})

describe('path reduction', () => {
  it('a script address is its path; another host, its host', () => {
    expect(describeInvoker(`${ORIGIN}/_nuxt/a.js?v=1#x`, ORIGIN)).toBe('/_nuxt/a.js')
    expect(describeInvoker('https://cdn.example.com/lib.js?v=1', ORIGIN)).toBe('cdn.example.com')
    expect(describeInvoker('DIV#hero.onpointerdown', ORIGIN)).toBe('DIV.onpointerdown')
    expect(describeInvoker(undefined, ORIGIN)).toBe('(unnamed)')
    expect(describeScript({ duration: 123.4, invoker: 'x', sourceURL: undefined }, ORIGIN)).toBe('x from (none) 123 ms')
  })
})

describe('load state', () => {
  const nav = { domInteractive: 800, domContentLoadedEventStart: 900, domComplete: 2000 }
  it('names where the page was when the frame began', () => {
    expect(loadStateAt(500, nav)).toBe('loading')
    expect(loadStateAt(850, nav)).toBe('dom-interactive')
    expect(loadStateAt(1500, nav)).toBe('dom-content-loaded')
    expect(loadStateAt(9000, nav)).toBe('complete')
    expect(loadStateAt(9000, undefined)).toBe('loading')
    expect(loadStateAt(9000, { domInteractive: 800, domContentLoadedEventStart: 900, domComplete: 0 })).toBe('dom-content-loaded')
  })
})

describe('the limits', () => {
  it('three per route, ten per page life', () => {
    const gate = createLoafGate()
    const taken = (route: string, i: number) => gate.take(route, `${route}|${i}`)
    expect([0, 1, 2, 3].map((i) => taken('/library', i))).toEqual([true, true, true, false])
    expect(taken('/', 0)).toBe(true)
    for (let i = 0; i < 3; i++) taken('/a', i)
    for (let i = 0; i < 3; i++) taken('/b', i)
    // 3 + 1 + 3 + 3 = 10 taken: a new route has no room left.
    expect(taken('/c', 0)).toBe(false)
  })

  it('one per culprit: the same script in the same route is one stutter', () => {
    const gate = createLoafGate()
    const entry = frame()
    const culprit = loafCulprit(entry, context)
    expect(gate.take('/library', culprit)).toBe(true)
    expect(gate.take('/library', loafCulprit(frame({ duration: 500 }), context))).toBe(false)
    expect(loafCulprit(entry, { ...context, route: '/' })).not.toBe(culprit)
    expect(loafCulprit({ startTime: 9000, duration: 250 }, context)).toBe('/library|no script')
    // The longest script names it, whatever its order.
    expect(culprit).toBe('/library|filter@/_nuxt/BXyz12.js')
  })
})
