/**
 * What leaves the phone for Sentry (docs: README „Sentry“, Datenschutzerklärung). Framework-free and without
 * the SDK, so Vitest drives it in plain Node and the app loads it only together with Sentry.
 *
 * The rule: an event says WHAT broke and WHERE in the code (stack, route pattern, status code, version), never
 * WHO or WHAT she wrote. `scrubEvent` runs as `beforeSend` and `beforeSendTransaction`; it removes the person,
 * the request's headers, cookies, body and query string, the console and the typed text, and rewrites every
 * string that still carries an address, a member id or a URL's query. It never throws: an event it cannot read
 * is dropped (`null`), not sent raw. What it adds back, for finding a fault: the browser, the system and the kind
 * of device by name and version (`deviceContexts`, never the User-Agent), and where a tap landed by tag names
 * and test ids (`clickPath`, never a label or text).
 */

const EMAIL = /[^\s@<>"'()[\],;:]+@[^\s@<>"'()[\],;:]+\.[a-z]{2,}/gi
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
// `https://host/path?x=1#y` inside a longer string („GET https://…?select=…“): keep up to the path.
const URL_WITH_QUERY = /\b((?:https?|wss?):\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/gi
// A bare path (`/members/…?tab=x`), only where the whole string is one.
const PATH_WITH_QUERY = /^(\/[^\s?#]*)[?#]\S*$/

/** Keys whose value never goes out, wherever they sit. */
const DROPPED_KEYS = new Set([
  'user',
  'query_string',
  'cookies',
  'headers',
  'http.query',
  'http.fragment',
  'url.query',
  'url.fragment',
  'url.full',
  'server_name',
  'propsData',
])

/** Breadcrumb categories that can hold what she typed or what the app logged. */
const DROPPED_CRUMBS = new Set(['console', 'ui.input'])

/** A test id as the app writes them (`member.sheet`, `profile.photoButton`, `feed.post.:id` once scrubbed). */
const TEST_ID = /^[\w.:-]{1,80}$/
const CLICK_STEP = String.raw`[a-z][a-z0-9-]*(?:\[data-testid="[\w.:-]{1,80}"\])?`
/** A tap's place as `clickPath` writes it, and nothing else. */
const CLICK_PATH = new RegExp(`^${CLICK_STEP}(?: > ${CLICK_STEP}){0,4}$`)

type PathNode = { tagName?: unknown; getAttribute?: (name: string) => string | null; parentElement?: PathNode | null }

/**
 * Where a tap landed, for the `ui.click` breadcrumb: the tapped element and up to four of its ancestors, each as its
 * tag name and, where it has one, the app's test id (`div > button[data-testid="profile.photoButton"] > svg`). No
 * id attribute, no class, no label, no text: those can carry a name. Undefined without an element.
 */
export function clickPath(target: unknown): string | undefined {
  const steps: string[] = []
  let node = target as PathNode | null | undefined
  while (node && steps.length < 5 && typeof node.tagName === 'string') {
    const tag = node.tagName.toLowerCase()
    if (tag === 'body' || tag === 'html' || !/^[a-z][a-z0-9-]*$/.test(tag)) break
    const testId = node.getAttribute?.('data-testid')
    steps.unshift(testId && TEST_ID.test(testId) ? `${tag}[data-testid="${testId}"]` : tag)
    node = node.parentElement
  }
  return steps.length ? steps.join(' > ') : undefined
}

/** Browser, system and kind of device as Sentry's contexts: names and versions only, never the User-Agent itself. */
export interface DeviceContexts {
  browser?: { name: string; version?: string }
  os?: { name: string; version?: string }
  device?: { family: string }
}

const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:A|iOS)?\/(\d+)/, 'Edge'],
  [/\bSamsungBrowser\/(\d+)/, 'Samsung Internet'],
  [/\b(?:OPR|OPiOS)\/(\d+)/, 'Opera'],
  [/\bCriOS\/(\d+)/, 'Chrome'],
  [/\bFxiOS\/(\d+)/, 'Firefox'],
  [/\bFirefox\/(\d+)/, 'Firefox'],
  [/\bChrome\/(\d+)/, 'Chrome'],
  [/\bVersion\/(\d+)[\d.]*(?: Mobile\/\S+)? Safari\//, 'Safari'],
]

/**
 * What `scrubEvent` adds for the browser, the system and the device, read from the User-Agent: the browser's name and
 * major version, the system's name and version (iOS and Android; macOS and Windows by name, their User-Agent
 * version is frozen), and the device family (iPhone, iPad, Android, Mac, Windows, Linux). Never a device model.
 * On iOS every browser is WebKit, and the app from the home screen names no browser at all: `Safari (Home-Bildschirm)`.
 */
export function deviceContexts(userAgent: string): DeviceContexts {
  const out: DeviceContexts = {}
  const ios = /\b(iPhone|iPad|iPod)\b[^)]*? OS (\d+)[_.](\d+)/.exec(userAgent)
  const android = /\bAndroid (\d+(?:\.\d+)?)/.exec(userAgent)
  if (ios) {
    out.os = { name: 'iOS', version: `${ios[2]}.${ios[3]}` }
    out.device = { family: ios[1]! }
  } else if (android) {
    out.os = { name: 'Android', version: android[1] }
    out.device = { family: 'Android' }
  } else if (/\bWindows NT\b/.test(userAgent)) {
    out.os = { name: 'Windows' }
    out.device = { family: 'Windows' }
  } else if (/\bMac OS X\b/.test(userAgent)) {
    out.os = { name: 'macOS' }
    out.device = { family: 'Mac' }
  } else if (/\bCrOS\b/.test(userAgent)) {
    out.os = { name: 'ChromeOS' }
  } else if (/\bLinux\b/.test(userAgent)) {
    out.os = { name: 'Linux' }
    out.device = { family: 'Linux' }
  }
  for (const [pattern, name] of BROWSERS) {
    const match = pattern.exec(userAgent)
    if (match) {
      out.browser = { name, version: match[1] }
      break
    }
  }
  if (!out.browser && ios && /AppleWebKit\//.test(userAgent)) out.browser = { name: 'Safari (Home-Bildschirm)', version: ios[2] }
  return out
}

export function scrubString(value: string): string {
  return value
    .replace(URL_WITH_QUERY, '$1')
    .replace(PATH_WITH_QUERY, '$1')
    .replace(EMAIL, '[email]')
    .replace(UUID, ':id')
}

function scrubValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return scrubString(value)
  if (value === null || typeof value !== 'object' || depth > 12) return value
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (DROPPED_KEYS.has(key)) continue
    out[key] = scrubValue(inner, depth + 1)
  }
  return out
}

/** The request of an event: the URL without query and hash, nothing else (no body, no cookies, no headers). */
function scrubRequest(request: unknown): unknown {
  if (!request || typeof request !== 'object') return undefined
  const url = (request as { url?: unknown }).url
  return typeof url === 'string' ? { url: scrubString(url.split(/[?#]/)[0] ?? '') } : undefined
}

function scrubBreadcrumbs(crumbs: unknown): unknown {
  if (!Array.isArray(crumbs)) return crumbs
  return crumbs
    .filter((crumb) => !DROPPED_CRUMBS.has((crumb as { category?: string } | null)?.category ?? ''))
    .map((crumb) => {
      const clean = scrubValue(crumb, 0) as Record<string, unknown>
      // A click's `message` is Sentry's CSS path through her screen (ids, classes, a label with a name in it): it
      // goes. What stays is the path `clickPath` wrote instead (`beforeBreadcrumb`, sentryInit.ts): tag names and the
      // app's own test ids, nothing she typed or sees.
      if (clean.category === 'ui.click' && !(typeof clean.message === 'string' && CLICK_PATH.test(clean.message))) delete clean.message
      return clean
    })
}

/**
 * `beforeSend` / `beforeSendTransaction`. Typed loosely on purpose: the SDK's event types stay out of this file.
 * A scrubber failure never drops the event silently (that would swallow errors): `minimalEvent` goes out instead.
 */
export function scrubEvent<T extends object>(event: T, device?: DeviceContexts): T | null {
  try {
    const source = event as Record<string, unknown>
    const { request, breadcrumbs, user: _user, ...rest } = source
    const cleaned = scrubValue(rest, 0) as Record<string, unknown>
    const scrubbedRequest = scrubRequest(request)
    if (scrubbedRequest) cleaned.request = scrubbedRequest
    if (breadcrumbs !== undefined) cleaned.breadcrumbs = scrubBreadcrumbs(breadcrumbs)
    // The request's headers (with the User-Agent Sentry would read the browser from) are gone: the browser, the
    // system and the kind of device come as `deviceContexts` read them, and nothing more of the User-Agent.
    if (device && Object.keys(device).length) {
      const contexts = (cleaned.contexts && typeof cleaned.contexts === 'object' ? cleaned.contexts : {}) as Record<string, unknown>
      cleaned.contexts = { ...contexts, ...device }
    }
    return cleaned as T
  } catch {
    return minimalEvent(event)
  }
}

/**
 * What goes out when the scrubber itself throws: type, message (scrubbed, cut), level, release, environment, route
 * and the tag `scrub.failed`. No stack, breadcrumbs, contexts, extras or request: nothing that was not cleaned.
 * Written to never throw; the last resort is an event with the tag alone.
 */
function minimalEvent<T extends object>(event: T): T {
  const safe = (v: unknown) => {
    try {
      return typeof v === 'string' ? scrubString(v).slice(0, 500) : undefined
    } catch {
      return undefined
    }
  }
  const plain = (v: unknown) => (typeof v === 'string' ? v.slice(0, 200) : undefined)
  try {
    const source = event as Record<string, any>
    const exception = source.exception?.values?.[0]
    const route = source.tags?.route
    const out: Record<string, unknown> = {
      event_id: plain(source.event_id),
      timestamp: typeof source.timestamp === 'number' ? source.timestamp : undefined,
      platform: 'javascript',
      level: plain(source.level),
      release: plain(source.release),
      environment: plain(source.environment),
      fingerprint: Array.isArray(source.fingerprint) ? source.fingerprint.filter((f: unknown) => typeof f === 'string') : undefined,
      tags: { 'scrub.failed': 'true', ...(typeof route === 'string' ? { route: route.slice(0, 200) } : {}) },
    }
    if (source.type === 'transaction') out.type = 'transaction'
    if (exception) out.exception = { values: [{ type: plain(exception.type), value: safe(exception.value) }] }
    else if (typeof source.message === 'string') out.message = safe(source.message)
    return out as T
  } catch {
    return { tags: { 'scrub.failed': 'true' } } as unknown as T
  }
}
