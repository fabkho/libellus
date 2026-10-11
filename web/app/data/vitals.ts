/**
 * Web Vitals that went badly, as reports for the client error log (kind
 * `vitals`, data/errorLog.ts): Google's `web-vitals` measures them on the
 * member's device (plugins/vitals.client.ts loads it once the app is idle), and
 * only a poor value becomes a report, with what caused it: the element that
 * shifted most and from where to where (CLS), the element and the kind of the
 * slowest interaction and where its time went (INP), the largest element and
 * what it waited for (LCP). Cloudflare's Web Analytics shows the same figures
 * for the whole site; this says which screen and which element.
 *
 * Technical details only: elements are named by tag, classes and test ids
 * (`describeElement`), never by their text; a resource by its kind and host,
 * never its path on another host (a cover's address names the book); the route
 * as its pattern (`/book/:key`). The error log scrubs and cuts what it is given
 * once more.
 *
 * Framework-free: the metrics come in as web-vitals hands them over (only the
 * fields read here), the route and the origin are handed in.
 */

import { describeResource, POOR_LOAF } from './vitalsBasics'

/** Poor, by Google's thresholds (web.dev/articles/vitals): above these a value is reported. */
export const POOR_CLS = 0.25
/** In ms. */
export const POOR_INP = 300
/** In ms. */
export const POOR_LCP = 4000
/** Shared with data/loaf.ts, which must not import this module (data/vitalsBasics.ts says why). */
export { describeResource, POOR_LOAF }

export type VitalName = 'CLS' | 'INP' | 'LCP'

type Rect = { x: number; y: number; width: number; height: number }

/** The parts of web-vitals' metrics (the attribution build) a report is made of. */
export type VitalMetric =
  | {
      name: 'CLS'
      value: number
      attribution: {
        largestShiftTarget?: string
        largestShiftTime?: number
        largestShiftValue?: number
        largestShiftSource?: { previousRect: Rect; currentRect: Rect }
        loadState?: string
      }
    }
  | {
      name: 'INP'
      value: number
      attribution: {
        interactionTarget?: string
        interactionTime?: number
        interactionType?: string
        processedEventEntries?: readonly { name: string }[]
        inputDelay: number
        processingDuration: number
        presentationDelay: number
        loadState?: string
        longestScript?: {
          subpart: string
          intersectingDuration: number
          entry: { invoker?: string; invokerType?: string; sourceURL?: string; sourceFunctionName?: string }
        }
      }
    }
  | {
      name: 'LCP'
      value: number
      attribution: {
        target?: string
        url?: string
        timeToFirstByte: number
        resourceLoadDelay: number
        resourceLoadDuration: number
        elementRenderDelay: number
        lcpEntry?: { startTime: number }
        lcpResourceEntry?: { initiatorType?: string }
      }
    }

/** A value above its threshold. */
export function isPoor(metric: Pick<VitalMetric, 'name' | 'value'>): boolean {
  if (metric.name === 'CLS') return metric.value > POOR_CLS
  if (metric.name === 'INP') return metric.value > POOR_INP
  return metric.value > POOR_LCP
}

/** When the culprit happened (performance time): the largest shift, the interaction, the largest paint. */
export function culpritTime(metric: VitalMetric): number | null {
  if (metric.name === 'CLS') return metric.attribution.largestShiftTime ?? null
  if (metric.name === 'INP') return metric.attribution.interactionTime ?? null
  return metric.attribution.lcpEntry?.startTime ?? null
}

/** The value as it reads in a message: `0.42`, `420 ms`, `4.8 s`. */
export function formatVital(name: VitalName, value: number): string {
  if (name === 'CLS') return value.toFixed(2)
  if (name === 'INP') return `${Math.round(value / 10) * 10} ms`
  return `${(value / 1000).toFixed(1)} s`
}

/** Longest selector kept (the error log keeps 8 kB of detail, but a selector says enough in this much). */
export const SELECTOR_MAX = 240

/** At most this many classes of an element are named (Tailwind lists are long). */
const CLASSES_MAX = 4
/** How many elements, from the culprit up, name it. */
const DEPTH = 4

/** The bits of an element `describeElement` reads; a DOM `Element` has them. */
export type ElementLike = {
  nodeType: number
  nodeName: string
  parentElement?: ElementLike | null
  parentNode?: ElementLike | null
  getAttribute?: (name: string) => string | null
  classList?: Iterable<string>
}

/** A class worth naming: a word of letters, digits and the usual separators (no arbitrary values carrying text). */
const PLAIN_CLASS = /^[\w-]{1,40}$/

/**
 * An element as a short selector: the element and up to three ancestors, each
 * `tag.class.class` (`[test-id]` when it has one, where the walk stops: the id
 * names it well enough), joined by `>`. A text node is its parent's `#text`.
 * Nothing of the element's text is ever read.
 */
export function describeElement(node: ElementLike | null | undefined): string {
  if (!node) return ''
  const parts: string[] = []
  let current: ElementLike | null | undefined = node
  if (current.nodeType === 3) {
    parts.push('#text')
    current = current.parentElement ?? (current.parentNode as ElementLike | null)
  }
  while (current && current.nodeType === 1 && parts.length < DEPTH) {
    const tag = current.nodeName.toLowerCase()
    if (tag === 'html' || tag === 'body') break
    const testid = current.getAttribute?.('data-testid')
    if (testid) {
      parts.push(`${tag}[${testid}]`)
      break
    }
    const classes = [...(current.classList ?? [])].filter((name) => PLAIN_CLASS.test(name)).slice(0, CLASSES_MAX)
    parts.push([tag, ...classes].join('.'))
    current = current.parentElement
  }
  return cutSelector(parts.reverse().join('>'))
}

function cutSelector(selector: string): string {
  return selector.length > SELECTOR_MAX ? `…${selector.slice(-(SELECTOR_MAX - 1))}` : selector
}

/** A selector web-vitals made (or `describeElement`), cut and stripped of anything that is not a selector's. */
function selectorOf(selector: string | undefined): string {
  if (!selector) return '(none)'
  // Brackets hold a test id at most (`describeElement`); one with a value, quotes or spaces could
  // carry text (an `alt`), which never belongs here, so it goes, and so does anything else loose.
  return cutSelector(selector.replace(/\[[^\]]*[=\s"'][^\]]*\]/g, '').replace(/["'\s]+/g, ''))
}

const rect = (box: Rect) => `x ${Math.round(box.x)} y ${Math.round(box.y)} w ${Math.round(box.width)} h ${Math.round(box.height)}`
const ms = (value: number) => `${Math.round(value)} ms`

/**
 * What the error log gets for a poor metric: the message (`CLS 0.42 on
 * /library`), the detail that goes where an error's stack would (the culprit,
 * line by line), null for a value that is not poor.
 */
export function vitalReport(
  metric: VitalMetric,
  { route, origin }: { route: string | null; origin: string },
): { message: string; detail: string } | null {
  if (!isPoor(metric)) return null
  const message = `${metric.name} ${formatVital(metric.name, metric.value)} on ${route ?? '(unknown route)'}`
  const lines: string[] = []
  if (metric.name === 'CLS') {
    const a = metric.attribution
    lines.push(`largest shift: ${a.largestShiftTarget ? selectorOf(a.largestShiftTarget) : '(none)'}`)
    if (a.largestShiftValue !== undefined) lines.push(`its score: ${a.largestShiftValue.toFixed(3)}`)
    if (a.largestShiftSource) {
      lines.push(`from: ${rect(a.largestShiftSource.previousRect)}`)
      lines.push(`to: ${rect(a.largestShiftSource.currentRect)}`)
    }
    if (a.largestShiftTime !== undefined) lines.push(`at: ${ms(a.largestShiftTime)}`)
    if (a.loadState) lines.push(`load state: ${a.loadState}`)
  } else if (metric.name === 'INP') {
    const a = metric.attribution
    const events = [...new Set((a.processedEventEntries ?? []).map((entry) => entry.name))].slice(0, 6)
    lines.push(`target: ${selectorOf(a.interactionTarget)}`)
    lines.push(`type: ${a.interactionType ?? '(unknown)'}${events.length ? ` (${events.join(', ')})` : ''}`)
    lines.push(`input delay: ${ms(a.inputDelay)}, processing: ${ms(a.processingDuration)}, presentation: ${ms(a.presentationDelay)}`)
    const script = a.longestScript
    if (script) {
      const where = [script.entry.invokerType, script.entry.invoker, script.entry.sourceFunctionName]
        .filter(Boolean)
        .join(' ')
      lines.push(`longest script: ${where || '(unnamed)'} in ${describeResource(script.entry.sourceURL, origin)}, ${ms(script.intersectingDuration)} of the ${script.subpart}`)
    }
    if (a.loadState) lines.push(`load state: ${a.loadState}`)
  } else {
    const a = metric.attribution
    lines.push(`element: ${selectorOf(a.target)}`)
    lines.push(`resource: ${describeResource(a.url, origin)}${a.lcpResourceEntry?.initiatorType ? ` (${a.lcpResourceEntry.initiatorType})` : ''}`)
    lines.push(
      `time to first byte: ${ms(a.timeToFirstByte)}, resource delay: ${ms(a.resourceLoadDelay)}, resource load: ${ms(a.resourceLoadDuration)}, render delay: ${ms(a.elementRenderDelay)}`,
    )
  }
  return { message, detail: lines.join('\n') }
}
