import type { SupabaseClient } from '@supabase/supabase-js'
import { scrubRoute, scrubText } from '~/data/errorLog'

/**
 * Contact (supabase/migrations/20261024010000_feedback.sql): a member reports a bug, asks for a feature or
 * writes about something else from the Profile, without e-mail.
 *
 * Her side is one insert into `feedback` (RLS lets a member insert her own row and nothing else: she cannot
 * read it back, and the sheet needs no list). The database holds the rules again: 10 to 2000 characters, one
 * of three kinds, a context of at most 4000 bytes, and at most 5 messages an hour and 20 a day (refused with
 * `rate_limited`, HTTP 429). The instance's owner reads the inbox and marks messages handled through two
 * functions that refuse anyone else (`feedback_list`, `feedback_mark_handled`, `not_owner`).
 *
 * What the app attaches without being asked (`buildContext`, and the sheet says so in one line): the build,
 * the route's pattern, how the app is shown, the platform and a cut browser string, the locale, whether it is
 * online and the screen's size. Never the Library, a token, or the address of a page with one in it.
 *
 * Framework-free: the repository receives the Supabase client and the online check; the rest is what a
 * native port copies 1:1.
 */

export const FEEDBACK_KINDS = ['bug', 'feature', 'other'] as const
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]

/** What the database keeps (feedback_body_length). */
export const FEEDBACK_MIN = 10
export const FEEDBACK_MAX = 2000
/** The most of the browser string that goes along. */
export const USER_AGENT_MAX = 200
const ROUTE_MAX = 120

/** What is wrong with a text, before anything is sent. */
export type FeedbackProblem = 'too_short' | 'too_long'

/** The text as it is sent: line breaks as `\n`, blanks around it gone. */
export const cleanFeedback = (text: string): string => text.replace(/\r\n?/g, '\n').trim()

/** Whether a text can be sent (null), or why not. The database checks again. */
export function feedbackProblem(text: string): FeedbackProblem | null {
  const length = [...cleanFeedback(text)].length
  if (length < FEEDBACK_MIN) return 'too_short'
  if (length > FEEDBACK_MAX) return 'too_long'
  return null
}

// ------------------------------------------------------------------ context

/** What is read off the device when a message is sent. */
export type DeviceFacts = {
  /** The build the app was made from (`app.buildId`). */
  appVersion: string | null
  /** The address path as it is (no query, no fragment is needed: they are dropped). */
  path: string
  /** The router's pattern for it (`/r/:token()`), when there is one: it can hold no token. */
  pattern?: string | null
  standalone: boolean | null
  platform: string | null
  userAgent: string | null
  locale: string
  online: boolean
  screen: { width: number; height: number; ratio: number } | null
}

/** The context stored with a message (feedback.context). */
export type FeedbackContext = {
  appVersion: string | null
  route: string | null
  displayMode: 'standalone' | 'browser' | null
  platform: string | null
  userAgent: string | null
  locale: string
  online: boolean
  screen: string | null
}

// A reading page's address carries its token as the second segment, as a follow link's does (`/f/<token>`).
const READING_TOKEN = /^\/r\/[^/]+/

/**
 * The route as a pattern, never an address with a secret in it: the router's own pattern when it is known
 * (`/r/:token()` becomes `/r/[token]`), else the path with the secret parts replaced (a follow link's and a
 * reading page's token, a member's or a Book's id).
 */
export function contextRoute(path: string, pattern?: string | null): string | null {
  if (pattern?.startsWith('/')) return pattern.replace(/:(\w+)(\([^)]*\))?[*+?]?/g, '[$1]').slice(0, ROUTE_MAX)
  const scrubbed = scrubRoute(path)
  return scrubbed ? scrubbed.replace(READING_TOKEN, '/r/[token]').slice(0, ROUTE_MAX) : null
}

const cut = (text: string | null | undefined, max: number): string | null => {
  const value = text?.trim()
  return value ? value.slice(0, max) : null
}

/** The context to send, from what the device says: scrubbed, cut, and only these fields. */
export function buildContext(facts: DeviceFacts): FeedbackContext {
  const screen = facts.screen
  return {
    appVersion: cut(facts.appVersion, 80),
    route: contextRoute(facts.path, facts.pattern),
    displayMode: facts.standalone === null ? null : facts.standalone ? 'standalone' : 'browser',
    platform: cut(facts.platform, 60),
    userAgent: facts.userAgent ? cut(scrubText(facts.userAgent), USER_AGENT_MAX) : null,
    locale: cut(facts.locale, 20) ?? 'en',
    online: facts.online,
    screen: screen ? `${Math.round(screen.width)}×${Math.round(screen.height)}@${Math.round(screen.ratio * 100) / 100}` : null,
  }
}

// -------------------------------------------------------------- the repository

export type FeedbackSendError = 'offline' | 'rate_limited' | 'invalid' | 'unknown'
export type FeedbackOwnerError = 'not_owner' | 'offline' | 'unknown'
export type FeedbackResult<T> = { data: T; error: null } | { data: null; error: FeedbackOwnerError }

/** One message as the owner reads it. `text` is plain text: render it as text, never as markup. */
export type FeedbackItem = {
  id: string
  kind: FeedbackKind
  text: string
  context: Record<string, unknown>
  at: Date
  /** The time as the database wrote it, microseconds and all: the next page asks for what is older than it. */
  cursor: string
  handledAt: Date | null
  memberName: string | null
  memberEmail: string | null
}

type ItemRow = {
  id: string
  kind: string
  body: string
  context: unknown
  created_at: string
  handled_at: string | null
  member_name: string | null
  member_email: string | null
}

const isKind = (kind: string): kind is FeedbackKind => (FEEDBACK_KINDS as readonly string[]).includes(kind)

export function itemFromRow(row: ItemRow): FeedbackItem {
  const context = row.context && typeof row.context === 'object' && !Array.isArray(row.context) ? (row.context as Record<string, unknown>) : {}
  return {
    id: row.id,
    kind: isKind(row.kind) ? row.kind : 'other',
    text: row.body,
    context,
    at: new Date(row.created_at),
    cursor: row.created_at,
    handledAt: row.handled_at ? new Date(row.handled_at) : null,
    memberName: row.member_name,
    memberEmail: row.member_email,
  }
}

/** The page the owner's inbox asks for. */
export const FEEDBACK_PAGE = 30

type Failure = { message?: string; code?: string; status?: number }

function sendError(failure: Failure): FeedbackSendError {
  const message = failure.message ?? ''
  if (failure.code === 'PT429' || failure.status === 429 || message.includes('rate_limited')) return 'rate_limited'
  if (failure.code === '23514') return 'invalid'
  return 'unknown'
}

function ownerError(failure: Failure): FeedbackOwnerError {
  const message = failure.message ?? ''
  if (message.includes('not_owner') || failure.code === '42501' || failure.code === 'PGRST301') return 'not_owner'
  return 'unknown'
}

export type Feedback = {
  /** Sends one message with the context the device attached. */
  send: (kind: FeedbackKind, text: string, context: FeedbackContext) => Promise<{ error: FeedbackSendError | null }>
  /** The owner's inbox, newest first, a page of `limit` older than `before` (an item's `cursor`). */
  list: (options?: { limit?: number; before?: string | null }) => Promise<FeedbackResult<FeedbackItem[]>>
  /** Marks one message handled, or open again (false); whether it was found. */
  markHandled: (id: string, handled: boolean) => Promise<FeedbackResult<boolean>>
}

export function createFeedback(client: SupabaseClient, { online = () => true }: { online?: () => boolean } = {}): Feedback {
  return {
    async send(kind, text, context) {
      if (!online()) return { error: 'offline' }
      const body = cleanFeedback(text)
      if (feedbackProblem(body)) return { error: 'invalid' }
      // The member's id is the database's default (auth.uid()); RLS refuses a row that is not hers.
      const { error } = await client.from('feedback').insert({ kind, body, context })
      return { error: error ? sendError(error) : null }
    },

    async list({ limit = FEEDBACK_PAGE, before = null } = {}) {
      if (!online()) return { data: null, error: 'offline' }
      const { data, error } = await client.rpc('feedback_list', { p_limit: limit, p_before: before })
      if (error) return { data: null, error: ownerError(error) }
      return { data: ((data ?? []) as ItemRow[]).map(itemFromRow), error: null }
    },

    async markHandled(id, handled) {
      if (!online()) return { data: null, error: 'offline' }
      const { data, error } = await client.rpc('feedback_mark_handled', { p_id: id, p_handled: handled })
      if (error) return { data: null, error: ownerError(error) }
      return { data: Boolean(data), error: null }
    },
  }
}
