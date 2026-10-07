import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The waitlist (supabase/migrations/20261011040000_waitlist.sql, issue #171).
 *
 * A visitor of a reading page leaves her address (`join`, no account, signed out
 * is the normal case) and the instance's owner reads the list, marks entries
 * invited and deletes one (`list`, `setInvited`, `remove`; the database refuses
 * anyone else with `not_owner`). No e-mail is sent from here: inviting is by hand.
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
  /** Marks entries invited, or waiting again (false). */
  setInvited: (ids: readonly string[], invited: boolean) => Promise<WaitlistResult<number>>
  /** Deletes one entry for good (a request to be forgotten). */
  remove: (id: string) => Promise<WaitlistResult<boolean>>
}

export function createWaitlist(client: SupabaseClient, { online = () => true }: { online?: () => boolean } = {}): Waitlist {
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
