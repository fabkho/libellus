import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The client error log: the errors the app meets on a device (an exception, a
 * write that waited offline and was finally refused, the owner's shelf failing to
 * load, a chunk that is gone after a deploy, a Web Vital that went badly), sent to the database's own log
 * (`log_client_error`, supabase/migrations/…_client_errors.sql) instead of a
 * third-party service. The owner reads them in the dashboard (docs/OPERATIONS.md).
 *
 * Technical details only. A report is a kind, a message and a stack, scrubbed of
 * e-mail addresses, tokens and the query and fragment of every URL, and cut to
 * size; the route is the path, never its query. The callers that report on their
 * own (the outbox, the shelf, the vitals) name actions, codes and elements, never a book. The database
 * scrubs and cuts again.
 *
 * `createErrorLog` keeps what waits in a short line on the device (memory, and
 * `storage` so a reload after a missing chunk does not lose it), folds the same
 * error into one report with a count, and sends the line a moment after the last
 * report, while there is a connection. It never throws and never reports itself:
 * a send that fails is tried again later and is never an error of its own.
 *
 * Framework-free: the sender, the storage, the clock and the device's details are
 * handed in (plugins/error-log.client.ts, the tests).
 */

export const ERROR_KINDS = ['error', 'unhandledrejection', 'vue', 'chunk', 'outbox', 'shelf', 'vitals'] as const
export type ErrorKind = (typeof ERROR_KINDS)[number]

/** The sizes the database keeps (it cuts too). */
export const MESSAGE_MAX = 1000
export const STACK_MAX = 8000
export const ROUTE_MAX = 200

/** One report waiting to be sent. `count`: how often it happened before it was. */
export type ErrorReport = {
  kind: ErrorKind
  message: string
  stack: string | null
  route: string | null
  online: boolean | null
  count: number
}

/** What the database is told about the device with every report. */
export type ErrorContext = {
  appVersion: string | null
  userAgent: string | null
  standalone: boolean | null
}

// ------------------------------------------------------------------ scrubbing

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu
const JWT = /\beyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]{4,}/g
// A URL's query and fragment; a stack frame's `:line:column` after them stays.
const URL_TAIL = /([a-z][a-z0-9+.-]*:\/\/[^\s?#"'<>()]*)[?#][^\s"'<>()]*?((?::\d+){0,2})(?=[\s"'<>()]|$)/gi
// A route's secret or personal part: a member's id (`/friends/<uuid>`, then anything after it) and a follow link's token (`/f/<token>`).
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const MEMBER_ROUTE = new RegExp(`^/friends/${UUID}(?=/|$)`, 'i')
// Any id, anywhere (a Nuxt 404 words `Page not found: /friends/<uuid>/x`, a stack carries the address): a member's, a Book's, a request's.
const ANY_UUID = new RegExp(`\\b${UUID}\\b`, 'gi')
// A follow link's token wherever `/f/` stands, whatever follows it (a trailing slash, `/x`, a query): in text it ends at the first character a token has not.
const FOLLOW_TOKEN = /\/f\/[\w-]+/g

/** A text without e-mail addresses, tokens or the query and fragment of its URLs. */
export function scrubText(text: string): string {
  return text
    .replace(EMAIL, '[email]')
    .replace(JWT, '[token]')
    .replace(URL_TAIL, '$1$2')
    .replace(ANY_UUID, '[id]')
    .replace(FOLLOW_TOKEN, '/f/[token]')
}
/**
 * The path of a route or address, nothing after it; null for anything else. A member's
 * page and a follow link carry their secret id or token, so they go in by their pattern
 * (`/friends/[member]`, `/f/[token]`), never as they are.
 */
export function scrubRoute(route: string | null | undefined): string | null {
  if (!route) return null
  const path = route.split(/[?#]/, 1)[0]!.trim()
  if (!path.startsWith('/')) return null
  const scrubbed = path
    .replace(MEMBER_ROUTE, '/friends/[member]')
    .replace(ANY_UUID, '[id]')
    .replace(FOLLOW_TOKEN, '/f/[token]')
  return scrubbed.slice(0, ROUTE_MAX)
}

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

// --------------------------------------------------------------- what it was

/** A thrown or rejected value as a message and a stack, whatever it was. */
export function describeError(value: unknown): { message: string; stack: string | null } {
  if (value instanceof Error || (value && typeof value === 'object' && 'message' in value)) {
    const error = value as { name?: unknown; message?: unknown; stack?: unknown; code?: unknown }
    const name = typeof error.name === 'string' && error.name !== 'Error' ? error.name : ''
    const text = typeof error.message === 'string' ? error.message : String(error.message)
    // A database error (supabase-js) has a code worth more than its wording.
    const code = typeof error.code === 'string' && error.code ? ` [${error.code}]` : ''
    return {
      message: `${name ? `${name}: ` : ''}${text}${code}`.trim() || name || 'Error without a message',
      stack: typeof error.stack === 'string' && error.stack ? error.stack : null,
    }
  }
  if (typeof value === 'string') return { message: value || 'Empty error', stack: null }
  if (value === undefined || value === null) return { message: `Rejected with ${value}`, stack: null }
  return { message: `Non-error value: ${Object.prototype.toString.call(value)}`, stack: null }
}

/**
 * A chunk of the build that could not be loaded: a deploy replaced it, or the connection broke.
 * A chunk that is gone is answered with the app shell (`text/html`, status 200) wherever the host
 * falls back to the shell; Safari and Firefox then complain about the MIME type, not the request.
 */
export function isChunkError(message: string): boolean {
  return /dynamically imported module|Importing a module script failed|not a valid JavaScript MIME type|disallowed MIME type|Expected a JavaScript(-or-Wasm)? module script|Unable to preload CSS|Loading (CSS )?chunk [\w-]+ failed|error loading dynamically imported module/i.test(
    message,
  )
}

const NOISE = [
  // The browser's own complaint about a layout that settles over two frames.
  /ResizeObserver loop/i,
  // A script from another origin (an extension, a translation overlay): nothing to read.
  /^Script error\.?$/i,
  // A request the app cancelled itself (a newer search, a screen that left).
  /AbortError|aborted|The operation was cancell?ed|^cancell?ed$/i,
  // No connection: not a bug, and the outbox and the shelf say so on their own.
  /^(TypeError: )?(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?|Network request failed)$/i,
]
const EXTENSION = /(chrome|moz|safari(-web)?|ms-browser)-extension:\/\//i

/** Errors not worth a row: browser noise, cancelled requests, no connection, extensions. */
export function isNoise(message: string, stack: string | null, source?: string | null): boolean {
  if (isChunkError(message)) return false
  if (NOISE.some((pattern) => pattern.test(message))) return true
  return EXTENSION.test(stack ?? '') || EXTENSION.test(source ?? '')
}

/** The browser in a few words ("iOS 18.2 Safari 18.2", "Android 15 Chrome 140"): no full user agent. */
export function shortUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null
  const version = (pattern: RegExp) => ua.match(pattern)?.[1]?.replace(/_/g, '.') ?? ''
  const os = /iPhone|iPad|iPod/.test(ua)
    ? `iOS ${version(/OS (\d+[_.]\d+)/)}`
    : /Android/.test(ua)
      ? `Android ${version(/Android (\d+(?:\.\d+)?)/)}`
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : ''
  const browsers: [RegExp, string][] = [
    [/EdgA?\/(\d+)/, 'Edge'],
    [/SamsungBrowser\/(\d+)/, 'Samsung'],
    [/FxiOS\/(\d+)/, 'Firefox'],
    [/Firefox\/(\d+)/, 'Firefox'],
    [/CriOS\/(\d+)/, 'Chrome'],
    [/Chrome\/(\d+)/, 'Chrome'],
    [/Version\/(\d+(?:\.\d+)?).*Safari/, 'Safari'],
  ]
  const found = browsers.find(([pattern]) => pattern.test(ua))
  const browser = found ? `${found[1]} ${version(found[0])}` : /AppleWebKit/.test(ua) ? 'WebKit' : ''
  return `${os.trim()} ${browser}`.trim().slice(0, 200) || 'unknown'
}

// ---------------------------------------------------------------- the line

/** Different reports waiting at most; the same error again is counted, not added. */
export const QUEUE_MAX = 20
/** Reports one page may send in its life: an error in a loop must not flood the log. */
export const SESSION_MAX = 60
/** How long after the last report the line is sent (a burst goes in one go). */
export const SEND_DELAY_MS = 3_000
/** The pause after a send that did not get through. */
export const RETRY_MS = 60_000

/** What the database answered: taken (logged, counted, or dropped by its limit), or try again later. */
export type ErrorSendOutcome = 'done' | 'retry'
export type ErrorSend = (report: ErrorReport, context: ErrorContext) => Promise<ErrorSendOutcome>

export type ErrorLogStorage = {
  read: () => ErrorReport[] | null
  write: (reports: ErrorReport[]) => void
}

/**
 * What a reporter knows beyond the error itself: the stack to keep instead of the
 * error's own, the route, and the script the error came from (an extension's is noise).
 */
export type ReportExtra = { stack?: string | null; route?: string | null; source?: string | null }

export type ErrorLog = {
  /** Notes an error. Noise is left out; `false` then. Never throws. */
  report: (kind: ErrorKind, error: unknown, extra?: ReportExtra) => boolean
  /** Sends what waits, while there is a connection. Never throws. */
  flush: () => Promise<void>
  /** What waits. */
  pending: () => readonly ErrorReport[]
}

export function createErrorLog({
  send,
  storage,
  online,
  context,
  route,
  onReport,
  schedule = (run, ms) => setTimeout(run, ms),
}: {
  /** Null: nothing is sent (development), reports only reach `onReport`. */
  send: ErrorSend | null
  storage?: ErrorLogStorage
  online: () => boolean
  context: () => ErrorContext
  /** The route the device is on (its path). */
  route: () => string | null
  /** Hears every report taken (development prints it). */
  onReport?: (report: ErrorReport) => void
  schedule?: (run: () => void, ms: number) => unknown
}): ErrorLog {
  let queue: ErrorReport[] = []
  try {
    queue = (storage?.read() ?? []).filter((item) => ERROR_KINDS.includes(item?.kind)).slice(0, QUEUE_MAX)
  } catch {
    queue = []
  }
  let sent = 0
  let timer = false
  let flushing: Promise<void> | null = null

  function save() {
    try {
      storage?.write(queue)
    } catch {
      // Full or forbidden storage: the line lives in memory only.
    }
  }

  function later(ms: number) {
    if (timer || !send) return
    timer = true
    try {
      schedule(() => {
        timer = false
        void flush()
      }, ms)
    } catch {
      timer = false
    }
  }

  function report(kind: ErrorKind, error: unknown, extra: ReportExtra = {}): boolean {
    try {
      const described = describeError(error)
      const stack = extra.stack !== undefined ? extra.stack : described.stack
      if (isNoise(described.message, stack, extra.source)) return false
      const item: ErrorReport = {
        kind,
        message: cut(scrubText(described.message), MESSAGE_MAX),
        stack: stack ? cut(scrubText(stack), STACK_MAX) : null,
        route: scrubRoute(extra.route !== undefined ? extra.route : route()),
        online: online(),
        count: 1,
      }
      onReport?.(item)
      if (!send) return true
      const same = queue.find((waiting) => waiting.kind === item.kind && waiting.message === item.message && waiting.stack === item.stack)
      if (same) same.count += 1
      else if (queue.length < QUEUE_MAX) queue.push(item)
      else return true
      save()
      later(SEND_DELAY_MS)
      return true
    } catch {
      return false
    }
  }

  async function run() {
    if (!send) return
    while (queue.length && online()) {
      const item = queue[0]!
      if (sent >= SESSION_MAX) {
        queue = []
        break
      }
      const count = item.count
      let outcome: ErrorSendOutcome
      try {
        outcome = await send({ ...item }, context())
      } catch {
        outcome = 'retry'
      }
      if (outcome === 'retry') {
        later(RETRY_MS)
        break
      }
      sent += 1
      // Counted again while it was on its way: the rest goes next time. Otherwise it leaves.
      if (item.count > count) item.count -= count
      else queue = queue.filter((waiting) => waiting !== item)
      save()
      if (queue[0] === item) {
        later(SEND_DELAY_MS)
        break
      }
    }
  }

  function flush(): Promise<void> {
    flushing ??= run()
      .catch(() => undefined)
      .finally(() => (flushing = null))
    return flushing
  }

  return { report, flush, pending: () => queue }
}

// --------------------------------------------------------------- the sender

/**
 * Sends one report through `log_client_error`. An answer of any kind but a
 * server error, a rate limit or none at all is done: a report the database
 * refuses (an unknown kind) would be refused again.
 */
export function createErrorSender(client: SupabaseClient): ErrorSend {
  return async (report, context) => {
    const { error, status } = await client.rpc('log_client_error', {
      p_kind: report.kind,
      p_message: report.message,
      p_stack: report.stack,
      p_route: report.route,
      p_app_version: context.appVersion,
      p_user_agent: context.userAgent,
      p_standalone: context.standalone,
      p_online: report.online,
      p_count: report.count,
    })
    if (!error) return 'done'
    if (!status || status >= 500 || status === 401 || status === 408 || status === 429) return 'retry'
    return 'done'
  }
}

/** The line in `localStorage` (or anything like it), under one key. */
export function keyValueErrorStorage(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  key: string,
): ErrorLogStorage {
  return {
    read() {
      const text = storage.getItem(key)
      const parsed: unknown = text ? JSON.parse(text) : null
      return Array.isArray(parsed) ? (parsed as ErrorReport[]) : null
    },
    write(reports) {
      if (reports.length) storage.setItem(key, JSON.stringify(reports))
      else storage.removeItem(key)
    },
  }
}
