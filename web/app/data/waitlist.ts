import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The waitlist (supabase/migrations/20261011040000_waitlist.sql and 20261013010000_waitlist_invite.sql,
 * issue #171).
 *
 * A visitor of a reading page leaves her address (`join`, no account, signed out
 * is the normal case) and the instance's owner reads the list, invites an entry,
 * marks entries invited and deletes one (`list`, `invite`, `setInvited`, `remove`;
 * the database refuses anyone else with `not_owner`). `invite` asks the
 * `waitlist-invite` edge function, which gets the entry a one-use code, mails it and
 * marks the entry invited; without mail (not configured, or the send failed) it still
 * answers the code, for the owner to send herself. Mark invited stays the manual path.
 *
 * Framework-free: the repository receives the Supabase client and the online
 * check; the rest is what a native port copies 1:1.
 */

/** The longest address the database keeps. */
export const EMAIL_MAX_LENGTH = 254

/**
 * Whether text looks like an address worth sending to the database: one @, something before
 * it, a dot in the domain and no blanks. The database checks again (`email_invalid`) and decides.
 */
export function looksLikeEmail(text: string): boolean {
  const email = text.trim()
  if (email.length < 6 || email.length > EMAIL_MAX_LENGTH) return false
  return /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)*\.[^@\s.]{2,}$/.test(email)
}

export type JoinErrorCode = 'invalid' | 'rate_limited' | 'offline' | 'unknown'
export type WaitlistErrorCode = 'not_owner' | 'offline' | 'unknown'
export type WaitlistResult<T> = { data: T; error: null } | { data: null; error: WaitlistErrorCode }

/** The edge function behind `invite` (supabase/functions/waitlist-invite). */
export const INVITE_FUNCTION = 'waitlist-invite'

/**
 * Why an Invite did not mail: `not_configured` (the instance has no SMTP secrets) and `send_failed`
 * (the mail server refused or was away) still come with the code; the others with nothing.
 */
export type InviteErrorCode = 'not_owner' | 'offline' | 'not_configured' | 'send_failed' | 'unknown'

/** A one-use invite code for an entry, and when it stops working. */
export type InviteCode = { code: string; expiresAt: Date }

export type InviteResult =
  /** Mailed. `marked` is false when the entry could not be marked invited afterwards (mark it by hand). */
  | { data: InviteCode & { marked: boolean }; error: null }
  /** Not mailed, the entry still waiting: the code is there to send another way, and the next Invite reuses it. */
  | { data: InviteCode; error: 'not_configured' | 'send_failed' }
  | { data: null; error: 'not_owner' | 'offline' | 'unknown' }

/** What the function answers (supabase/functions/waitlist-invite/handler.ts). */
type InviteAnswer = { code?: unknown; expiresAt?: unknown; emailed?: unknown; reason?: unknown; invited?: unknown }

/** The part of the Supabase client the repository needs: its RPCs and `functions.invoke`. */
export type WaitlistClient = Pick<SupabaseClient, 'rpc'> & {
  functions: { invoke: (name: string, options: { body: Record<string, unknown> }) => Promise<{ data: unknown; error: unknown }> }
}

/** One entry, as the owner reads it. `memberName` is the first name of the member whose page it was joined from. */
export type WaitlistEntry = {
  id: string
  email: string
  joinedAt: Date
  invitedAt: Date | null
  source: string
  memberName: string | null
  note: string | null
}

type EntryRow = {
  id: string
  email: string
  created_at: string
  invited_at: string | null
  source: string
  member_name: string | null
  note: string | null
}

export function entryFromRow(row: EntryRow): WaitlistEntry {
  return {
    id: row.id,
    email: row.email,
    joinedAt: new Date(row.created_at),
    invitedAt: row.invited_at ? new Date(row.invited_at) : null,
    source: row.source,
    memberName: row.member_name,
    note: row.note,
  }
}

/** The ones still waiting for an invite. */
export const waiting = (entries: readonly WaitlistEntry[]): WaitlistEntry[] => entries.filter((entry) => !entry.invitedAt)

/** What Copy puts on the clipboard: the addresses, comma and space between, ready for a Bcc field. */
export function emailsText(entries: readonly Pick<WaitlistEntry, 'email'>[]): string {
  return entries.map((entry) => entry.email).join(', ')
}

function joinError(failure: { message?: string; code?: string }): JoinErrorCode {
  const message = failure.message ?? ''
  if (message.includes('email_invalid') || failure.code === '22023') return 'invalid'
  if (message.includes('rate_limited') || failure.code === '54000') return 'rate_limited'
  return 'unknown'
}

function ownerError(failure: { message?: string; code?: string }): WaitlistErrorCode {
  const message = failure.message ?? ''
  if (message.includes('not_owner') || failure.code === '42501' || failure.code === 'PGRST301') return 'not_owner'
  return 'unknown'
}

export type Waitlist = {
  /**
   * Leaves an address on the waitlist from a reading page: `token` is the page's (the database finds whose page it
   * was, and keeps nothing of the token), `website` the honeypot field, which stays empty for a person.
   * The answer is the same for an address that was already there.
   */
  join: (email: string, token: string | null, website?: string) => Promise<{ error: JoinErrorCode | null }>
  /** The owner's list, newest first. */
  list: () => Promise<WaitlistResult<WaitlistEntry[]>>
  /**
   * Invites one entry: a one-use code (the entry's own while it is unused and unexpired), mailed to
   * the address, the entry then marked invited. Not mailed: the code all the same, the entry waiting.
   */
  invite: (id: string) => Promise<InviteResult>
  /** Marks entries invited, or waiting again (false). */
  setInvited: (ids: readonly string[], invited: boolean) => Promise<WaitlistResult<number>>
  /** Deletes one entry for good (a request to be forgotten). */
  remove: (id: string) => Promise<WaitlistResult<boolean>>
}

/** The function's refusal, read off the answer it came with: 403 is the database's `not_owner`. */
async function inviteError(error: unknown): Promise<'not_owner' | 'unknown'> {
  const context = (error as { context?: unknown } | null)?.context
  if (context instanceof Response) {
    if (context.status === 403) return 'not_owner'
    try {
      if (((await context.clone().json()) as { error?: unknown } | null)?.error === 'not_owner') return 'not_owner'
    } catch {
      // Not JSON: nothing more to learn from it.
    }
  }
  return 'unknown'
}

export function createWaitlist(client: WaitlistClient, { online = () => true }: { online?: () => boolean } = {}): Waitlist {
  return {
    async join(email, token, website = '') {
      if (!online()) return { error: 'offline' }
      const { error } = await client.rpc('join_waitlist', { p_email: email, p_token: token, p_website: website })
      return { error: error ? joinError(error) : null }
    },

    async list() {
      if (!online()) return { data: null, error: 'offline' }
      const { data, error } = await client.rpc('owner_waitlist')
      if (error) return { data: null, error: ownerError(error) }
      return { data: ((data ?? []) as EntryRow[]).map(entryFromRow), error: null }
    },

    async invite(id) {
      if (!online()) return { data: null, error: 'offline' }
      try {
        const { data, error } = await client.functions.invoke(INVITE_FUNCTION, { body: { id } })
        if (error) return { data: null, error: await inviteError(error) }
        const answer = data as InviteAnswer | null
        const expiresAt = typeof answer?.expiresAt === 'string' ? new Date(answer.expiresAt) : null
        if (typeof answer?.code !== 'string' || !answer.code || !expiresAt || Number.isNaN(expiresAt.getTime())) return { data: null, error: 'unknown' }
        const code = { code: answer.code, expiresAt }
        if (answer.emailed === true) return { data: { ...code, marked: answer.invited !== false }, error: null }
        return { data: code, error: answer.reason === 'not_configured' ? 'not_configured' : 'send_failed' }
      } catch {
        return { data: null, error: 'unknown' }
      }
    },

    async setInvited(ids, invited) {
      if (!online()) return { data: null, error: 'offline' }
      const { data, error } = await client.rpc('owner_waitlist_set_invited', { p_ids: [...ids], p_invited: invited })
      if (error) return { data: null, error: ownerError(error) }
      return { data: Number(data ?? 0), error: null }
    },

    async remove(id) {
      if (!online()) return { data: null, error: 'offline' }
      const { data, error } = await client.rpc('owner_waitlist_delete', { p_id: id })
      if (error) return { data: null, error: ownerError(error) }
      return { data: Boolean(data), error: null }
    },
  }
}
