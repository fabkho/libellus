import { describe, expect, it } from 'vitest'
import { createErrorLog, type ErrorReport } from '@/data/errorLog'
import { createRouteTimeline, routePattern } from '@/data/routeTimeline'
import {
  culpritTime,
  describeElement,
  describeResource,
  formatVital,
  isPoor,
  POOR_CLS,
  POOR_INP,
  POOR_LCP,
  SELECTOR_MAX,
  vitalReport,
  type ElementLike,
  type VitalMetric,
} from '@/data/vitals'

const ORIGIN = 'https://libellus.fabkho.dev'
const box = (y: number, height: number) => ({ x: 12, y, width: 388, height })

const cls = (value: number, attribution: Partial<Extract<VitalMetric, { name: 'CLS' }>['attribution']> = {}): VitalMetric => ({
  name: 'CLS',
  value,
  attribution: {
    largestShiftTarget: 'section[search.overlay]>div.drawn.pointer-events-none.absolute.inset-x-0',
    largestShiftTime: 4120,
    largestShiftValue: 0.31,
    largestShiftSource: { previousRect: box(686, 230), currentRect: box(378, 538) },
    loadState: 'complete',
    ...attribution,
  },
})

const inp = (value: number): VitalMetric => ({
  name: 'INP',
  value,
  attribution: {
    interactionTarget: 'button[library.segment.finished]',
    interactionTime: 9000,
    interactionType: 'pointer',
    processedEventEntries: [{ name: 'pointerdown' }, { name: 'pointerup' }, { name: 'click' }, { name: 'click' }],
    inputDelay: 12.4,
    processingDuration: 288.9,
    presentationDelay: 40,
    loadState: 'complete',
    longestScript: {
      subpart: 'processing-duration',
      intersectingDuration: 250,
      entry: { invokerType: 'event-listener', invoker: 'BUTTON.onclick', sourceURL: `${ORIGIN}/_nuxt/library.BUJWl24j.js?v=1#x` },
    },
  },
})

const lcp = (value: number, url = 'https://is1-ssl.mzstatic.com/image/thumb/Publication116/v4/1c/df/9780547999548.jpg/600x900bb.jpg'): VitalMetric => ({
  name: 'LCP',
  value,
  attribution: {
    target: 'img.relative.object-cover',
    url,
    timeToFirstByte: 320,
    resourceLoadDelay: 1200,
    resourceLoadDuration: 2400,
    elementRenderDelay: 300,
    lcpEntry: { startTime: 4300 },
    lcpResourceEntry: { initiatorType: 'img' },
  },
})

describe('which values are reported', () => {
  it('only poor ones: above Google’s thresholds, not at them', () => {
    expect([POOR_CLS, POOR_INP, POOR_LCP]).toEqual([0.25, 300, 4000])
    expect(isPoor({ name: 'CLS', value: 0.25 })).toBe(false)
    expect(isPoor({ name: 'CLS', value: 0.2501 })).toBe(true)
    expect(isPoor({ name: 'INP', value: 300 })).toBe(false)
    expect(isPoor({ name: 'INP', value: 301 })).toBe(true)
    expect(isPoor({ name: 'LCP', value: 4000 })).toBe(false)
    expect(isPoor({ name: 'LCP', value: 4001 })).toBe(true)
    expect(vitalReport(cls(0.1), { route: '/library', origin: ORIGIN })).toBeNull()
    expect(vitalReport(inp(200), { route: '/library', origin: ORIGIN })).toBeNull()
    expect(vitalReport(lcp(2500), { route: '/', origin: ORIGIN })).toBeNull()
  })

  it('a message names the metric, its value and the route', () => {
    expect(formatVital('CLS', 0.4234)).toBe('0.42')
    expect(formatVital('INP', 412)).toBe('410 ms')
    expect(formatVital('LCP', 4830)).toBe('4.8 s')
    expect(vitalReport(cls(1), { route: '/library', origin: ORIGIN })!.message).toBe('CLS 1.00 on /library')
    expect(vitalReport(inp(412), { route: '/book/:key', origin: ORIGIN })!.message).toBe('INP 410 ms on /book/:key')
    expect(vitalReport(lcp(4830), { route: null, origin: ORIGIN })!.message).toBe('LCP 4.8 s on (unknown route)')
  })
})

describe('the culprit', () => {
  it('CLS: the element that shifted most, from where to where', () => {
    expect(vitalReport(cls(0.42), { route: '/library', origin: ORIGIN })!.detail).toBe(
      [
        'largest shift: section[search.overlay]>div.drawn.pointer-events-none.absolute.inset-x-0',
        'its score: 0.310',
        'from: x 12 y 686 w 388 h 230',
        'to: x 12 y 378 w 388 h 538',
        'at: 4120 ms',
        'load state: complete',
      ].join('\n'),
    )
    expect(culpritTime(cls(0.42))).toBe(4120)
  })

  it('INP: the element, the type and its events, where the time went and the longest script', () => {
    expect(vitalReport(inp(412), { route: '/library', origin: ORIGIN })!.detail).toBe(
      [
        'target: button[library.segment.finished]',
        'type: pointer (pointerdown, pointerup, click)',
        'input delay: 12 ms, processing: 289 ms, presentation: 40 ms',
        'longest script: event-listener BUTTON.onclick in /_nuxt/library.BUJWl24j.js, 250 ms of the processing-duration',
        'load state: complete',
      ].join('\n'),
    )
    expect(culpritTime(inp(412))).toBe(9000)
  })

  it('LCP: the element and what it waited for; a cover elsewhere by its host only (its address names the book)', () => {
    const detail = vitalReport(lcp(4830), { route: '/', origin: ORIGIN })!.detail
    expect(detail).toBe(
      [
        'element: img.relative.object-cover',
        'resource: is1-ssl.mzstatic.com (img)',
        'time to first byte: 320 ms, resource delay: 1200 ms, resource load: 2400 ms, render delay: 300 ms',
      ].join('\n'),
    )
    expect(detail).not.toContain('9780547999548')
    expect(vitalReport(lcp(5000, '/icon-192.png?v=2'), { route: '/', origin: ORIGIN })!.detail).toContain('resource: /icon-192.png')
    expect(culpritTime(lcp(4830))).toBe(4300)
  })
})

describe('privacy', () => {
  /** A stand-in for a DOM element: what `describeElement` reads, and text it must never read. */
  function element(tag: string, classes: string[] = [], testid: string | null = null, parent: ElementLike | null = null): ElementLike {
    return {
      nodeType: 1,
      nodeName: tag.toUpperCase(),
      parentElement: parent,
      getAttribute: (name) => (name === 'data-testid' ? testid : null),
      classList: classes,
      get textContent(): string {
        throw new Error('the text of an element is never read')
      },
    } as ElementLike
  }

  it('an element is named by its tag, a few plain classes and the nearest test id, never by its text', () => {
    const body = element('body')
    const row = element('a', ['row', 'flex', 'items-center', 'gap-inset', 'active:bg-fill'], 'library.entry', body)
    const title = element('span', ['book-title', 'title-wrap', 'text-body-large', 'h-(--size-query)', 'extra'], null, row)
    expect(describeElement(title)).toBe('a[library.entry]>span.book-title.title-wrap.text-body-large.extra')
    const text = { nodeType: 3, nodeName: '#text', parentElement: title, parentNode: title } as ElementLike
    expect(describeElement(text)).toBe('a[library.entry]>span.book-title.title-wrap.text-body-large.extra>#text')
    // Four levels at most, and never past the body.
    let deep: ElementLike = body
    for (let i = 0; i < 8; i++) deep = element('div', [`level-${i}`], null, deep)
    expect(describeElement(deep)).toBe('div.level-4>div.level-5>div.level-6>div.level-7')
    expect(describeElement(null)).toBe('')
  })

  it('a selector is cut and loses anything that could be text', () => {
    const long = vitalReport(cls(0.5, { largestShiftTarget: `div.${'x'.repeat(400)}` }), { route: '/', origin: ORIGIN })!.detail
    expect(long.split('\n')[0]!.length).toBeLessThanOrEqual('largest shift: '.length + SELECTOR_MAX)
    const quoted = vitalReport(cls(0.5, { largestShiftTarget: 'img[alt="The Left Hand of Darkness"]' }), { route: '/', origin: ORIGIN })!
    expect(quoted.detail.split('\n')[0]).toBe('largest shift: img')
  })

  it('a resource elsewhere is its host; one of the app’s own its path, never its query', () => {
    expect(describeResource('https://covers.openlibrary.org/b/isbn/9780441478125-L.jpg', ORIGIN)).toBe('covers.openlibrary.org')
    expect(describeResource(`${ORIGIN}/_nuxt/entry.js?token=abc`, ORIGIN)).toBe('/_nuxt/entry.js')
    expect(describeResource('data:image/png;base64,AAAA', ORIGIN)).toBe('data: URL')
    expect(describeResource(undefined, ORIGIN)).toBe('(none)')
  })

  it('the error log takes a report as kind `vitals` and scrubs it like any error', () => {
    const seen: ErrorReport[] = []
    const log = createErrorLog({
      send: async () => 'done',
      online: () => true,
      context: () => ({ appVersion: 'build-1', userAgent: 'Android 15 Chrome 151', standalone: true }),
      route: () => '/library?q=le+guin',
      onReport: (report) => seen.push(report),
      schedule: () => undefined,
    })
    const report = vitalReport(cls(0.42, { largestShiftTarget: 'div.someone@example.com' }), { route: '/library', origin: ORIGIN })!
    expect(log.report('vitals', report.message, { stack: report.detail })).toBe(true)
    expect(seen[0]).toMatchObject({ kind: 'vitals', message: 'CLS 0.42 on /library', route: '/library' })
    expect(seen[0]!.stack).toContain('[email]')
    expect(seen[0]!.stack).not.toContain('someone@example.com')
  })
})

describe('the route of a culprit', () => {
  it('is the route the app was on when it happened, by its pattern', () => {
    const timeline = createRouteTimeline()
    expect(timeline.at(100)).toBeNull()
    timeline.visit('/', 0)
    timeline.visit('/library', 2000)
    timeline.visit('/library', 2500)
    timeline.visit(routePattern('/book/:key()'), 6000)
    expect(timeline.at(1000)).toBe('/')
    expect(timeline.at(4120)).toBe('/library')
    expect(timeline.at(7000)).toBe('/book/:key')
    expect(timeline.at(null)).toBe('/book/:key')
    expect(routePattern('/profile/:year()')).toBe('/profile/:year')
    expect(routePattern('/:slug(.*)*')).toBe('/:slug*')
  })
})
