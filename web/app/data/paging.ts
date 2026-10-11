/**
 * Reading a whole table of the member's, past PostgREST's row cap. The API answers at most `max_rows`
 * rows a request (supabase/config.toml, 1,000) and says nothing when it cuts: a Library of 1,300
 * entries read in one request would silently be 1,000. The cap reaches the rows embedded under one parent too (a Collection's
 * entries), where `.range(from, to, { referencedTable })` pages them. Every read that can exceed it goes
 * through `allPages`. Framework-free.
 */

/**
 * The most rows the API returns for one request: `max_rows` in supabase/config.toml, which the
 * hosted project matches. A page must not be larger than the server's cap, or its short answer
 * would be taken for the last page; keep the two in step.
 */
export const PAGE_SIZE = 1000

type Failure = { message?: string; code?: string }
type PageAnswer<Row> = { data: Row[] | null; error: Failure | null }

/**
 * Every row of a query, page by page (`.range(from, to)`, inclusive) until a page comes back
 * short. The query must have a total order (a unique column last) for the pages to meet. All or
 * nothing: the first failed page ends the read with its error and no rows, so a caller never
 * holds a partial list for a whole one. Pages are asked one after another (a short list is one
 * request, as before).
 */
export async function allPages<Row>(
  page: (from: number, to: number) => PromiseLike<PageAnswer<Row>>,
  size = PAGE_SIZE,
): Promise<{ data: Row[]; error: null } | { data: null; error: Failure }> {
  const rows: Row[] = []
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1)
    if (error) return { data: null, error }
    rows.push(...(data ?? []))
    if (!data || data.length < size) return { data: rows, error: null }
  }
}

/** The rows with a repeated `id` (a write between two pages moved a row onto both) kept once, in order. */
export function uniqueById<Row extends { id: string }>(rows: readonly Row[]): Row[] {
  const seen = new Set<string>()
  return rows.filter((row) => !seen.has(row.id) && seen.add(row.id))
}
