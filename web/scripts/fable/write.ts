import type { SupabaseClient } from '@supabase/supabase-js'
import { bookToRow } from '../../app/data/library'
import { IMPORT_KEY_PREFIX, type ImportEntry, type ImportSession } from '../../app/data/import/fable'

/**
 * Writes a mapped Fable import into one member's Library (issue #17), as the
 * service role: Books into the Catalogue (or found there), Library entries and
 * Reading sessions. Idempotent: everything is found again by its source keys,
 * so running it twice changes nothing the second time.
 *
 * - Books by their Catalogue keys, ISBN-13 first, then Apple's or OpenLibrary's
 *   id, the way `add_to_library` finds them; an existing Book is used as it is
 *   (the first snapshot is kept), only a missing cover is filled in. A Book with
 *   no key at all cannot be in the Catalogue: it becomes the member's Manual
 *   book, private to them.
 * - Entries by `import_key` (`fable:<tracker id>`); an entry the member already
 *   made in the app for the same Book is adopted rather than doubled. When the
 *   overrides move a record to another edition, its entry moves with it.
 * - Sessions by `import_key` within their entry: changed fields are updated,
 *   imported sessions no longer in the plan are deleted, sessions made in the
 *   app (no key) are never touched. The Status follows from the database's
 *   trigger, never from here.
 *
 * The client is handed in, like every repository's: a service-role client for
 * the local stack or (#18) the hosted project, a test's client in the suite.
 */

export interface WriteOptions {
  /** Read everything, write nothing: the counts say what a real run would do. */
  dryRun?: boolean
  /** Delete this member's imported entries whose Fable record is no longer in the plan. */
  prune?: boolean
  /** Progress lines. */
  log?: (line: string) => void
}

export interface WriteResult {
  books: { created: number; reused: number; coverFilled: number; manual: number }
  entries: { created: number; adopted: number; moved: number; unchanged: number; stale: string[]; pruned: number }
  sessions: { created: number; updated: number; unchanged: number; deleted: number }
  problems: { key: string; title: string; problem: string }[]
}

type BookRef = { id: string; cover_url: string | null; owner_id: string | null }
type EntryRow = { id: string; book_id: string; import_key: string | null }
type SessionRow = {
  id: string
  import_key: string | null
  started_on: string | null
  ended_on: string | null
  outcome: string | null
  rating: number | null
  review: string | null
  abandon_reason: string | null
}

class WriteError extends Error {}

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new WriteError(`${what}: ${result.error.message}`)
  return result.data
}

/** The member's id for an email address, through the Auth admin API (service role only). */
export async function findMemberId(client: SupabaseClient, email: string): Promise<string | null> {
  const wanted = email.trim().toLowerCase()
  for (let page = 1; ; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new WriteError(`Listing members: ${error.message}`)
    const found = data.users.find((user) => user.email?.toLowerCase() === wanted)
    if (found) return found.id
    if (data.users.length < 1000) return null
  }
}

function sessionRow(session: ImportSession) {
  return {
    import_key: session.key,
    started_on: session.startedOn,
    ended_on: session.endedOn,
    outcome: session.outcome,
    rating: session.rating,
    review: session.review,
    abandon_reason: session.abandonReason,
  }
}

const sameSession = (row: SessionRow, wanted: ReturnType<typeof sessionRow>) =>
  row.started_on === wanted.started_on
  && row.ended_on === wanted.ended_on
  && row.outcome === wanted.outcome
  && row.rating === wanted.rating
  && row.review === wanted.review
  && row.abandon_reason === wanted.abandon_reason

export async function writeImport(
  client: SupabaseClient,
  memberId: string,
  entries: readonly ImportEntry[],
  options: WriteOptions = {},
): Promise<WriteResult> {
  const { dryRun = false, log = () => {} } = options
  const result: WriteResult = {
    books: { created: 0, reused: 0, coverFilled: 0, manual: 0 },
    entries: { created: 0, adopted: 0, moved: 0, unchanged: 0, stale: [], pruned: 0 },
    sessions: { created: 0, updated: 0, unchanged: 0, deleted: 0 },
    problems: [],
  }

  /** The Catalogue Book with one of these keys, ISBN-13 first (as add_to_library). */
  async function catalogueBook(entry: ImportEntry): Promise<BookRef | null> {
    const { book } = entry
    const keys: [string, string | null][] = [
      ['isbn13', book.isbn13],
      ['apple_id', book.appleId],
      ['openlibrary_edition_key', book.openLibraryEditionKey],
    ]
    for (const [column, value] of keys) {
      if (!value) continue
      const rows = check(
        await client.from('books').select('id, cover_url, owner_id').is('owner_id', null).eq(column, value).limit(1),
        `Finding the Book by ${column}`,
      ) as BookRef[]
      if (rows[0]) return rows[0]
    }
    return null
  }

  async function bookFor(entry: ImportEntry, existing: EntryRow | null): Promise<string | null> {
    const { book } = entry
    const hasKey = Boolean(book.isbn13 || book.appleId || book.openLibraryEditionKey)
    const row = { ...bookToRow(book), cover_dominant: book.coverColors?.dominant.toLowerCase() ?? null, cover_secondary: book.coverColors?.secondary.toLowerCase() ?? null }

    if (!hasKey) {
      // No key to find it by in the Catalogue: the member's own Manual book.
      result.books.manual++
      if (existing) {
        const rows = check(
          await client.from('books').select('id, cover_url, owner_id').eq('id', existing.book_id).eq('owner_id', memberId),
          'Finding the Manual book',
        ) as BookRef[]
        if (rows[0]) {
          result.books.reused++
          return rows[0].id
        }
      }
      if (dryRun) {
        result.books.created++
        return null
      }
      const created = check(
        await client.from('books').insert({ ...row, source: 'manual', owner_id: memberId }).select('id').single(),
        'Adding the Manual book',
      ) as { id: string }
      result.books.created++
      return created.id
    }

    const found = await catalogueBook(entry)
    if (found) {
      result.books.reused++
      if (!found.cover_url && book.coverUrl) {
        result.books.coverFilled++
        if (!dryRun) {
          check(
            await client.from('books').update({
              cover_url: row.cover_url,
              cover_thumbhash: row.cover_thumbhash,
              cover_dominant: row.cover_dominant,
              cover_secondary: row.cover_secondary,
            }).eq('id', found.id),
            'Filling in the cover',
          )
        }
      }
      return found.id
    }
    if (dryRun) {
      result.books.created++
      return null
    }
    const created = check(await client.from('books').insert(row).select('id').single(), 'Adding the Book') as { id: string }
    result.books.created++
    return created.id
  }

  async function entryFor(entry: ImportEntry, bookId: string | null, existing: EntryRow | null): Promise<string | null> {
    if (existing) {
      if (bookId && existing.book_id !== bookId) {
        // The overrides moved this record to another edition: the entry follows,
        // unless the member already holds that edition in another entry.
        const clash = check(
          await client.from('library_entries').select('id, book_id, import_key').eq('member_id', memberId).eq('book_id', bookId),
          'Finding the entry of the new edition',
        ) as EntryRow[]
        if (clash[0]) {
          result.problems.push({ key: entry.key, title: entry.book.title, problem: `moved to an edition already in entry ${clash[0].id}; left on its old edition` })
        } else {
          result.entries.moved++
          if (!dryRun) {
            check(await client.from('library_entries').update({ book_id: bookId }).eq('id', existing.id), 'Moving the entry')
          }
        }
      } else result.entries.unchanged++
      return existing.id
    }

    if (bookId) {
      // Already in the Library (added in the app, or another record of the same edition).
      const held = check(
        await client.from('library_entries').select('id, book_id, import_key').eq('member_id', memberId).eq('book_id', bookId),
        'Finding the entry by its Book',
      ) as EntryRow[]
      if (held[0]) {
        if (held[0].import_key && held[0].import_key !== entry.key) {
          result.problems.push({ key: entry.key, title: entry.book.title, problem: `same edition as ${held[0].import_key}; its reads join that entry` })
        } else {
          result.entries.adopted++
          if (!dryRun) {
            check(await client.from('library_entries').update({ import_key: entry.key }).eq('id', held[0].id), 'Adopting the entry')
          }
        }
        return held[0].id
      }
    }

    result.entries.created++
    if (dryRun || !bookId) return null
    const created = check(
      await client.from('library_entries').insert({
        member_id: memberId,
        book_id: bookId,
        import_key: entry.key,
        // Noon UTC: the same calendar day wherever the member is.
        ...(entry.addedOn ? { added_at: `${entry.addedOn}T12:00:00Z` } : {}),
      }).select('id').single(),
      'Adding the entry',
    ) as { id: string }
    return created.id
  }

  async function sessionsFor(entry: ImportEntry, entryId: string | null) {
    const existing = entryId
      ? (check(
          await client.from('reading_sessions')
            .select('id, import_key, started_on, ended_on, outcome, rating, review, abandon_reason')
            .eq('entry_id', entryId)
            .like('import_key', `${IMPORT_KEY_PREFIX}%`),
          'Reading the sessions',
        ) as SessionRow[])
      : []
    const byKey = new Map(existing.map((row) => [row.import_key, row]))
    const wanted = new Set(entry.sessions.map((session) => session.key))

    // Gone from the plan first, so a corrected read never meets its old self.
    for (const row of existing) {
      if (wanted.has(row.import_key!)) continue
      result.sessions.deleted++
      if (!dryRun) check(await client.from('reading_sessions').delete().eq('id', row.id), 'Deleting a stale session')
    }
    for (const session of entry.sessions) {
      const row = sessionRow(session)
      const current = byKey.get(session.key)
      if (current && sameSession(current, row)) {
        result.sessions.unchanged++
        continue
      }
      if (current) {
        result.sessions.updated++
        if (!dryRun) check(await client.from('reading_sessions').update(row).eq('id', current.id), 'Updating a session')
        continue
      }
      result.sessions.created++
      if (dryRun || !entryId) continue
      check(await client.from('reading_sessions').insert({ ...row, entry_id: entryId }), 'Adding a session')
    }
  }

  for (const [index, entry] of entries.entries()) {
    try {
      const existing = (check(
        await client.from('library_entries').select('id, book_id, import_key').eq('member_id', memberId).eq('import_key', entry.key),
        'Finding the entry',
      ) as EntryRow[])[0] ?? null
      const bookId = await bookFor(entry, existing)
      const entryId = await entryFor(entry, bookId, existing)
      await sessionsFor(entry, entryId)
      log(`${String(index + 1).padStart(3)}/${entries.length} ${entry.book.title}`)
    } catch (error) {
      result.problems.push({ key: entry.key, title: entry.book.title, problem: error instanceof Error ? error.message : String(error) })
    }
  }

  // Imported entries whose record the plan no longer has (an override now skips it).
  const planned = new Set(entries.map((entry) => entry.key))
  const imported = check(
    await client.from('library_entries').select('id, book_id, import_key').eq('member_id', memberId).like('import_key', `${IMPORT_KEY_PREFIX}%`),
    'Reading the imported entries',
  ) as EntryRow[]
  for (const row of imported) {
    if (planned.has(row.import_key!)) continue
    result.entries.stale.push(row.import_key!)
    if (options.prune) {
      result.entries.pruned++
      if (!dryRun) check(await client.from('library_entries').delete().eq('id', row.id), 'Pruning a stale entry')
    }
  }

  return result
}
