/**
 * The owner's Library, read with the service role, as the entries the Regal
 * export maps (`RegalExportEntry`, web/app/data/export/regal.ts). The same read
 * as the web script's `readMemberLibrary` (web/app/data/export/memberLibrary.ts),
 * with only the columns the export uses: that one builds on the app's data
 * layer, which Deno does not run, so the row mapping is repeated here (small,
 * and pinned by library_test.ts against the export's fixture rows).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { RegalExportEntry, RegalExportSession } from '../../../web/app/data/export/regal.ts'

export type BookRow = {
  id: string
  title: string
  authors: string[] | null
  isbn13: string | null
  isbn10: string | null
  page_count: number | null
  published_year: number | null
  publisher: string | null
  description: string | null
  cover_url: string | null
  cover_dominant: string | null
  cover_secondary: string | null
}

export type SessionRow = {
  started_on: string | null
  ended_on: string | null
  outcome: 'finished' | 'abandoned' | null
  rating: number | null
  review: string | null
  created_at: string
}

export type EntryRow = {
  id: string
  added_at: string
  page_count_override: number | null
  book: BookRow
  sessions: SessionRow[] | null
}

const BOOK_COLUMNS =
  'id, title, authors, isbn13, isbn10, page_count, published_year, publisher, description, cover_url, cover_dominant, cover_secondary'
const SESSION_COLUMNS = 'started_on, ended_on, outcome, rating, review, created_at'

/** One request's worth of entries, with their Book and every read. */
export const ENTRY_SELECT =
  `id, added_at, page_count_override, book:books!inner(${BOOK_COLUMNS}), sessions:reading_sessions(${SESSION_COLUMNS})`

/** PostgREST's row limit (`max_rows` in supabase/config.toml): read in pages of this size. */
export const PAGE = 1000

type Session = RegalExportSession & { createdAt: string }

/**
 * A book's reads, newest first: the open one, then by the day they ended, then
 * started, then made; reads without a day last. `sortSessions` in
 * web/app/data/library.ts, the order of `latest_session` in the database.
 */
export function sortSessions(sessions: readonly Session[]): Session[] {
  return [...sessions].sort((a, b) => {
    if (!a.outcome !== !b.outcome) return a.outcome ? 1 : -1
    const byDay = (x: string | null, y: string | null) => (x && y ? y.localeCompare(x) : x ? -1 : y ? 1 : 0)
    return byDay(a.endedOn, b.endedOn) || byDay(a.startedOn, b.startedOn) || b.createdAt.localeCompare(a.createdAt)
  })
}

export function entryFromRow(row: EntryRow): RegalExportEntry {
  const { book } = row
  return {
    addedAt: row.added_at,
    pageCountOverride: row.page_count_override ?? null,
    book: {
      id: book.id,
      title: book.title,
      authors: book.authors ?? [],
      isbn13: book.isbn13,
      isbn10: book.isbn10,
      pageCount: book.page_count,
      year: book.published_year,
      publisher: book.publisher,
      description: book.description,
      coverUrl: book.cover_url,
      coverColors: book.cover_dominant && book.cover_secondary
        ? { dominant: book.cover_dominant, secondary: book.cover_secondary }
        : null,
    },
    sessions: sortSessions(
      (row.sessions ?? []).map((session) => ({
        startedOn: session.started_on,
        endedOn: session.ended_on,
        outcome: session.outcome,
        rating: session.rating,
        review: session.review,
        createdAt: session.created_at,
      })),
    ),
  }
}

/** The member with this address (any case), or null. Pages through the admin API. */
export async function findMemberId(client: SupabaseClient, email: string): Promise<string | null> {
  const wanted = email.trim().toLowerCase()
  for (let page = 1; ; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(`Listing members: ${error.message}`)
    const found = data.users.find((user) => user.email?.toLowerCase() === wanted)
    if (found) return found.id
    if (data.users.length < 1000) return null
  }
}

/** One member's whole Library, every read included, in a stable order. */
export async function readLibrary(client: SupabaseClient, memberId: string): Promise<RegalExportEntry[]> {
  const entries: RegalExportEntry[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from('library_entries')
      .select(ENTRY_SELECT)
      .eq('member_id', memberId)
      .order('id')
      .range(from, from + PAGE - 1)
      .returns<EntryRow[]>()
    if (error) throw new Error(`Reading the Library: ${error.message}`)
    for (const row of data ?? []) entries.push(entryFromRow(row))
    if ((data?.length ?? 0) < PAGE) return entries
  }
}
