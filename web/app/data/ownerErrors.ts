import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The client error log, as the instance's owner reads it in the app
 * (supabase/migrations/20261007100000_owner_client_errors.sql): the errors of
 * the last days grouped by kind and message (`owner_client_errors`), and the
 * newest report of one group with its stack (`owner_client_error_detail`).
 * The database decides who may: anyone but the instance owner is refused
 * (`not_owner`), so what the app does with `isOwner` is only the screens.
 *
 * Framework-free: the repository receives the Supabase client and the online
 * check; the rest is what a native port copies 1:1.
 */

/** The kinds the log knows (log_client_error), in the order the filter lists them. */
export const ERROR_KINDS = ['error', 'unhandledrejection', 'vue', 'chunk', 'outbox', 'shelf'] as const
export type OwnerErrorKind = (typeof ERROR_KINDS)[number]

/** One error group: every report of a kind and message in the window. */
export type OwnerErrorGroup = {
  /** What asks for its stack (`detail`). */
  hash: string
  kind: OwnerErrorKind
  message: string
  /** How often it happened (the reports' counts added). */
  times: number
  firstSeen: Date
  lastSeen: Date
  versions: string[]
  routes: string[]
  /** Times seen on an installed app / in a browser tab, and online / offline; reports that did not say are in neither. */
  standaloneTimes: number
  browserTimes: number
  onlineTimes: number
  offlineTimes: number
  /** How many members met it (never who), and how often a signed-out device did. */
  members: number
  signedOutTimes: number
}

/** The newest report of a group. */
export type OwnerErrorDetail = {
  kind: OwnerErrorKind
  message: string
  stack: string | null
  route: string | null
  version: string | null
  userAgent: string | null
  standalone: boolean | null
  online: boolean | null
  reportedAt: Date
  lastSeen: Date
}

/** The window the list asks for (the log keeps 30 days). */
export const OWNER_ERRORS_DAYS = 7
/** What counts as new on the Profile's row: a group first seen within this long. */
export const NEW_ERROR_WINDOW_MS = 24 * 60 * 60 * 1000

export type OwnerErrorsErrorCode = 'not_owner' | 'offline' | 'unknown'
export type OwnerErrorsResult<T> = { data: T; error: null } | { data: null; error: OwnerErrorsErrorCode }

export type OwnerErrors = {
  /** The last days' groups, newest first. */
  list: (days?: number) => Promise<OwnerErrorsResult<OwnerErrorGroup[]>>
  /** A group's newest report; null data when the group is gone. */
  detail: (hash: string) => Promise<OwnerErrorsResult<OwnerErrorDetail | null>>
}

type GroupRow = {
  message_hash: string
  kind: string
  message: string
  times: number | string
  first_seen: string
  last_seen: string
  app_versions: string[] | null
  routes: string[] | null
  standalone_times: number | string
  browser_times: number | string
  online_times: number | string
  offline_times: number | string
  members: number | string
  signed_out_times: number | string
}

type DetailRow = {
  kind: string
  message: string
  stack: string | null
  route: string | null
  app_version: string | null
  user_agent: string | null
  standalone: boolean | null
  online: boolean | null
  reported_at: string
  last_seen: string
}

/** A bigint as the API sends it (a number, or a string past 2^53). */
const count = (value: number | string | null | undefined): number => Number(value ?? 0)

const kindOf = (kind: string): OwnerErrorKind => ((ERROR_KINDS as readonly string[]).includes(kind) ? (kind as OwnerErrorKind) : 'error')

export function groupFromRow(row: GroupRow): OwnerErrorGroup {
  return {
    hash: row.message_hash,
    kind: kindOf(row.kind),
    message: row.message,
    times: count(row.times),
    firstSeen: new Date(row.first_seen),
    lastSeen: new Date(row.last_seen),
    versions: row.app_versions ?? [],
    routes: row.routes ?? [],
    standaloneTimes: count(row.standalone_times),
    browserTimes: count(row.browser_times),
    onlineTimes: count(row.online_times),
    offlineTimes: count(row.offline_times),
    members: count(row.members),
    signedOutTimes: count(row.signed_out_times),
  }
}

export function detailFromRow(row: DetailRow): OwnerErrorDetail {
  return {
    kind: kindOf(row.kind),
    message: row.message,
    stack: row.stack,
    route: row.route,
    version: row.app_version,
    userAgent: row.user_agent,
    standalone: row.standalone,
    online: row.online,
    reportedAt: new Date(row.reported_at),
    lastSeen: new Date(row.last_seen),
  }
}

/** Groups first seen within the last day: what the Profile's badge counts. */
export function newGroups(groups: readonly OwnerErrorGroup[], now: number): OwnerErrorGroup[] {
  return groups.filter((group) => now - group.firstSeen.getTime() < NEW_ERROR_WINDOW_MS)
}

/** The kinds the groups have, in the log's own order, with how many groups each. */
export function kindsOf(groups: readonly OwnerErrorGroup[]): { kind: OwnerErrorKind; groups: number }[] {
  return ERROR_KINDS.map((kind) => ({ kind, groups: groups.filter((group) => group.kind === kind).length })).filter((entry) => entry.groups > 0)
}

/** The groups of one kind, or all of them. */
export function ofKind(groups: readonly OwnerErrorGroup[], kind: OwnerErrorKind | 'all'): OwnerErrorGroup[] {
  return kind === 'all' ? [...groups] : groups.filter((group) => group.kind === kind)
}

/** What the copy button puts on the clipboard: the message, where it happened and the stack. */
export function detailText(group: Pick<OwnerErrorGroup, 'kind' | 'message' | 'times'>, detail: OwnerErrorDetail | null): string {
  const lines = [`[${group.kind}] ${group.message}`, `×${group.times}`]
  if (detail) {
    const where = [detail.route, detail.version, detail.userAgent].filter(Boolean).join(' · ')
    if (where) lines.push(where)
    if (detail.stack) lines.push('', detail.stack)
  }
  return lines.join('\n')
}

function mapError(failure: { message?: string; code?: string }): OwnerErrorsErrorCode {
  const message = failure.message ?? ''
  if (message.includes('not_owner') || failure.code === '42501' || failure.code === 'PGRST301') return 'not_owner'
  return 'unknown'
}

export function createOwnerErrors(client: SupabaseClient, { online = () => true }: { online?: () => boolean } = {}): OwnerErrors {
  return {
    async list(days = OWNER_ERRORS_DAYS) {
      if (!online()) return { data: null, error: 'offline' }
      const { data, error } = await client.rpc('owner_client_errors', { p_days: days })
      if (error) return { data: null, error: mapError(error) }
      return { data: ((data ?? []) as GroupRow[]).map(groupFromRow), error: null }
    },

    async detail(hash) {
      if (!online()) return { data: null, error: 'offline' }
      const { data, error } = await client.rpc('owner_client_error_detail', { p_message_hash: hash })
      if (error) return { data: null, error: mapError(error) }
      const [row] = (data ?? []) as DetailRow[]
      return { data: row ? detailFromRow(row) : null, error: null }
    },
  }
}
