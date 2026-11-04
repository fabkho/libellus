import type { BookSnapshot } from '../../app/data/books'
import type { createLibrary } from '../../app/data/library'
import type { ProgressValue } from '../../app/data/progress'
import type { ProgressDay } from '../../app/data/progressDays'
import { addDays } from '../../app/utils/dates'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from './stack'

/** The database's UTC today: what `set_progress_day` measures `date_invalid` against. */
export const utcToday = () => new Date().toISOString().slice(0, 10)

export function dayBook(title: string, pageCount: number | null): BookSnapshot {
  return {
    title: runTitle(title),
    authors: ['Susanna Clarke'],
    isbn13: null,
    isbn10: null,
    pageCount,
    year: 2020,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: null,
    coverUrl: null,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

/**
 * Days as the member's own updates would have booked them (a read begun long ago books none for its first value), and
 * the value that follows, written as the database owner does: members cannot write days.
 */
export async function bookDays(session: string, rows: [ago: number, start: number | null, end: number][], current: number | null) {
  const today = utcToday()
  for (const [ago, start, end] of rows) {
    await sql('insert into public.reading_progress_days (session_id, day, start_page, end_page) values ($1, $2, $3, $4)', [
      session,
      addDays(today, -ago),
      start,
      end,
    ])
  }
  if (current === null) return
  await sql('update public.reading_sessions set progress_page = $2, progress_updated_at = now() where id = $1', [session, current])
}

/** The read's rows as the repository returns them. */
export async function daysOf(library: ReturnType<typeof createLibrary>, session: string): Promise<ProgressDay[]> {
  return (await library.progressDays([session])).data![session]!
}

/** The read's value and the page count that counts, straight from the database. */
export async function stateOf(session: string): Promise<{ current: ProgressValue | null; pageCount: number | null }> {
  const [row] = await sql<{ progress_page: number | null; progress_percent: number | null; count: number | null }>(
    `select s.progress_page, s.progress_percent, coalesce(e.page_count_override, b.page_count) as count
       from public.reading_sessions s
       join public.library_entries e on e.id = s.entry_id
       join public.books b on b.id = e.book_id
      where s.id = $1`,
    [session],
  )
  return {
    current: row!.progress_page !== null ? { page: row!.progress_page } : row!.progress_percent !== null ? { percent: row!.progress_percent } : null,
    pageCount: row!.count,
  }
}
