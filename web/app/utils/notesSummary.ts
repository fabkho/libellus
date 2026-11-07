import type { NotesSummary } from '~/data/notes'

/** The lines of the Book page's Notes section; null for a row with nothing to say (a count of 0). Types only from the repository: the Book page loads no repository for this. */
export type SummaryRows = {
  friends: { count: number; authors: NotesSummary['friends']['authors']; authorCount: number; first: number | null; last: number | null } | null
  public: { count: number; authorCount: number } | null
}

export function summaryRows(summary: NotesSummary | null | undefined): SummaryRows {
  if (!summary) return { friends: null, public: null }
  const f = summary.friends
  return {
    friends: f.count > 0 ? { count: f.count, authors: f.authors, authorCount: f.authorCount, first: f.firstChapter, last: f.lastChapter } : null,
    public: summary.public.count > 0 ? { count: summary.public.count, authorCount: summary.public.authorCount } : null,
  }
}
