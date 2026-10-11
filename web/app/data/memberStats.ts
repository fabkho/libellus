import type { SupabaseClient } from '@supabase/supabase-js'
import { isNoAnswer } from './network'
import { mapSocialError, type SocialResult } from './socialShapes'
import { readsFromRows, type SessionStatsRow, type StatsRead } from './stats'
import { shownBook } from '../utils/unverifiedBook'

/**
 * A member's reading in figures (social v1, contract §1.5 `member_reading_record`): the rows the
 * Profile reads for her own figures (`createStats`), so `figuresOf` gives the same numbers for her
 * follower as for her. Framework-free, like every repository; a native port copies it 1:1.
 *
 * `null` is "not for you": she is not visible to the caller, or she switched her figures (`year`) off.
 * `wantToRead` and `reading` are the database's, null while her Want to read / Reading switch is off.
 */

export type MemberRecord = { reads: StatsRead[]; wantToRead: number | null; reading: number | null }

type MemberRecordJson = { reads: SessionStatsRow[] | null; wantToRead: number | null; reading: number | null }

export type MemberStats = {
  /** Her figures: null when they are not for the caller (see above). Refused `offline` without a connection. */
  record: (member: string) => Promise<SocialResult<MemberRecord | null>>
}

/**
 * `outside`: the one string an unverified Book (one the server check could not confirm, which the record
 * hands out as an id and nothing else) is shown as, in the words of the caller's language.
 */
export function createMemberStats(
  client: SupabaseClient,
  { online = () => true, outside = () => 'Outside the catalogue' }: { online?: () => boolean; outside?: () => string } = {},
): MemberStats {
  return {
    async record(member) {
      if (!online()) return { data: null, error: 'offline' }
      const answer = await client.rpc('member_reading_record', { p_member: member })
      if (isNoAnswer(answer)) return { data: null, error: 'offline' }
      if (answer.error) return { data: null, error: mapSocialError(answer.error) }
      const json = answer.data as MemberRecordJson | null
      if (!json) return { data: null, error: null }
      return {
        data: {
          reads: readsFromRows(json.reads ?? []).map((read) => (read.book.unverified ? { ...read, book: shownBook(read.book, outside()) } : read)),
          wantToRead: json.wantToRead ?? null,
          reading: json.reading ?? null,
        },
        error: null,
      }
    },
  }
}
