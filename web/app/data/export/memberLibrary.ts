import type { SupabaseClient } from '@supabase/supabase-js'
import type { Book } from '../books'
import {
  bookFromRow,
  sessionFromRow,
  sortSessions,
  type BookRow,
  type EntryStatus,
  type ReadingSession,
  type SessionRow,
} from '../library'

/**
 * A member's whole Library with every read, for an export (issue #22): each
 * entry with its Book and all its Reading sessions, newest first
 * (`sortSessions`, the order of `latest_session`). Read only.
 */
export type MemberLibraryEntry = {
  id: string
  status: EntryStatus
  /** When the Book entered the Library (ISO date-time). */
  addedAt: string
  /** The member's own total pages (issue #60), null = the edition's `book.pageCount`. */
  pageCountOverride: number | null
  book: Book
  /** Newest first: the open one, then by the day they ended. */
  sessions: ReadingSession[]
}

type ExportRow = { id: string; status: EntryStatus; added_at: string; page_count_override: number | null; book: BookRow; sessions: SessionRow[] | null }

const PAGE = 1000

/**
 * Reads one member's Library. The client is the member's own (RLS limits it to
 * their rows) or the service role's (the export script); `memberId` picks the
 * member either way. Pages through PostgREST's row limit in a stable order.
 */
export async function readMemberLibrary(client: SupabaseClient, memberId: string): Promise<MemberLibraryEntry[]> {
  const entries: MemberLibraryEntry[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from('library_entries')
      .select('id, status, added_at, page_count_override, book:books!inner(*), sessions:reading_sessions(*)')
      .eq('member_id', memberId)
      .order('id')
      .range(from, from + PAGE - 1)
      .returns<ExportRow[]>()
    if (error) throw new Error(`Reading the Library: ${error.message}`)
    for (const row of data ?? []) {
      entries.push({
        id: row.id,
        status: row.status,
        addedAt: row.added_at,
        pageCountOverride: row.page_count_override ?? null,
        book: bookFromRow(row.book),
        sessions: sortSessions((row.sessions ?? []).map(sessionFromRow)),
      })
    }
    if ((data?.length ?? 0) < PAGE) return entries
  }
}
