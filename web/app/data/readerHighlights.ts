import type { SupabaseClient } from '@supabase/supabase-js'
import { HIGHLIGHT_COLORS, type Highlight, type HighlightColor, type LocalHighlight } from './reader/device'
import { isNoAnswer } from './network'
import type { QueuedWrite } from './queuedWrites'

/**
 * The reader's highlights, kept server-side (issue #131, phase 2): the words a
 * member marked in one Library entry's ebook, so another device of hers that
 * holds the same file draws them too.
 *
 * What is kept, per highlight (table `reader_highlights`, hers alone by RLS):
 *   `id`         made on the device (a v4 UUID), so a highlight can be written
 *                offline and sent later, once;
 *   `fileHash`   the fingerprint of the file the CFI was taken in (SHA-256 of its
 *                first megabyte, `ebooks/files.ts`): a device whose copy has the
 *                same one draws the highlight, one whose copy differs lists it as
 *                *Highlights from another copy* and places nothing;
 *   `cfi`, `index`  the range and the book's section it is in;
 *   `color`      one of the four tokens;
 *   `text`       the words she selected, cut at `EXCERPT_MAX` characters — her own
 *                reading; the book itself and the file never leave the device;
 *   `note`       her own words on it (none yet);
 *   `createdAt`, `updatedAt`, `deletedAt`   when it was made, last changed on the
 *                device that changed it, and removed (the tombstone).
 *
 * Merging: two devices change highlights independently, so the newer change of
 * each id wins (`mergeHighlights`, last write wins on `updatedAt`, the server's
 * rule too) and a removal is a tombstone that beats an older edit instead of a
 * missing row that would let it come back. A tombstone holds no words.
 *
 * Local first: the device keeps the list (`data/reader/device.ts`) and shows it
 * at once; a change goes to the outbox as the `save_reader_highlight` write
 * (`highlightWrite`), so it waits offline and is sent once. The server's list is
 * read when the reader opens and while it stays open (`ReaderHighlights.list`).
 * Highlights that only exist on the device from before the sync are adopted with
 * an id and sent once (`adoptLegacy`).
 *
 * Framework-free: the repository receives the Supabase client and the online
 * check, the pure rules receive their clock and ids, so Vitest drives them in
 * plain Node and a native port copies them 1:1.
 */

/** The longest excerpt kept (the database's limit too); a longer selection is cut. */
export const EXCERPT_MAX = 1000
/** How long a removed highlight stays as a tombstone on the device once the server has it. */
export const TOMBSTONE_KEEP_MS = 30 * 24 * 60 * 60 * 1000

export type ReaderHighlight = {
  id: string
  entryId: string
  fileHash: string
  cfi: string
  /** The book's section the range is in. */
  index: number
  color: HighlightColor
  /** The words, at most `EXCERPT_MAX` characters; empty on a tombstone. */
  text: string
  note: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

/** Stable codes for what can go wrong; reading is quiet, so the copy is only for the log. */
export type ReaderHighlightsErrorCode = 'offline' | 'not_signed_in' | 'unknown'
export type ReaderHighlightsResult<T> = { data: T; error: null } | { data: null; error: ReaderHighlightsErrorCode }

export type ReaderHighlights = {
  /**
   * Every highlight the server has for this entry, tombstones included (RLS
   * hands her her own only). Refused offline, before anything is sent.
   */
  list: (entryId: string) => Promise<ReaderHighlightsResult<ReaderHighlight[]>>
}

/** The `reader_highlights` row, as PostgREST returns it. */
type Row = {
  id: string
  entry_id: string
  file_hash: string
  cfi: string
  section_index: number
  color: string
  excerpt: string
  note: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

const COLUMNS = 'id, entry_id, file_hash, cfi, section_index, color, excerpt, note, created_at, updated_at, deleted_at'

function fromRow(row: Row): ReaderHighlight | null {
  // A colour this build does not know (a later version added one): not drawn, not lost on the server.
  if (!HIGHLIGHT_COLORS.includes(row.color as HighlightColor)) return null
  return {
    id: row.id,
    entryId: row.entry_id,
    fileHash: row.file_hash,
    cfi: row.cfi,
    index: row.section_index,
    color: row.color as HighlightColor,
    text: row.excerpt,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  }
}

export function createReaderHighlights(client: SupabaseClient, { online = () => true }: { online?: () => boolean } = {}): ReaderHighlights {
  return {
    async list(entryId) {
      if (!online()) return { data: null, error: 'offline' }
      const found = await client.from('reader_highlights').select(COLUMNS).eq('entry_id', entryId).order('created_at').returns<Row[]>()
      if (isNoAnswer(found)) return { data: null, error: 'offline' }
      if (found.error) {
        const code = (found.error as { code?: string }).code
        return { data: null, error: code === '42501' || code === 'PGRST301' ? 'not_signed_in' : 'unknown' }
      }
      return { data: found.data.map(fromRow).filter((h): h is ReaderHighlight => h !== null), error: null }
    },
  }
}

// ---------------------------------------------------------------- the rules

/** The words, cut at `EXCERPT_MAX` characters (as the database counts them: code points, not UTF-16 units). */
export function capExcerpt(text: string): string {
  const points = Array.from(text)
  return points.length > EXCERPT_MAX ? points.slice(0, EXCERPT_MAX).join('') : text
}

const at = (iso: string) => Date.parse(iso)
export const isLive = (h: Pick<ReaderHighlight, 'deletedAt'>) => h.deletedAt === null

/**
 * The moment of a change made now: the clock, but never at or before the last
 * change of the same highlight (a device whose clock stepped back must still
 * win over its own earlier change, which the server holds already).
 */
export function stampAfter(previous: string | null, now: Date): string {
  const t = now.getTime()
  return new Date(previous && at(previous) >= t ? at(previous) + 1 : t).toISOString()
}

/** The highlights the page shows for the copy `fileHash`: live ones made in that file. */
export function placedOn<T extends ReaderHighlight>(list: readonly T[], fileHash: string): T[] {
  return list.filter((h) => isLive(h) && h.fileHash === fileHash)
}

/** The live highlights made in another copy of the book: listed, never placed. */
export function fromAnotherCopy<T extends ReaderHighlight>(list: readonly T[], fileHash: string): T[] {
  return list.filter((h) => isLive(h) && h.fileHash !== fileHash).sort((a, b) => at(a.createdAt) - at(b.createdAt))
}

/** What the engine draws. */
export const toEngine = (h: ReaderHighlight): Highlight => ({ cfi: h.cfi, color: h.color, text: h.text, index: h.index })

/**
 * The newer change of every highlight wins, from the device's list and the
 * server's; the same moment goes to the server's (it has it). A change that is
 * the server's is `sent`; the device's own newer one keeps its flag, so it goes
 * out if it has not. Old tombstones the server has are let go.
 */
export function mergeHighlights(local: readonly LocalHighlight[], remote: readonly ReaderHighlight[], now: Date = new Date()): LocalHighlight[] {
  const merged = new Map<string, LocalHighlight>(local.map((h) => [h.id, h]))
  for (const theirs of remote) {
    const mine = merged.get(theirs.id)
    if (!mine || at(theirs.updatedAt) >= at(mine.updatedAt)) merged.set(theirs.id, { ...theirs, sent: true })
  }
  return [...merged.values()]
    .filter((h) => !(h.deletedAt !== null && h.sent && now.getTime() - at(h.deletedAt) > TOMBSTONE_KEEP_MS))
    .sort((a, b) => at(a.createdAt) - at(b.createdAt) || (a.id < b.id ? -1 : 1))
}

/**
 * Highlights that only live on the device from before they were synced have no
 * id: each gets one, belongs to the copy it was made in (`fileHash`, the one
 * open now) and is unsent, so it goes up once.
 */
export function adoptLegacy(legacy: readonly Highlight[], fileHash: string, entryId: string, now: Date, newId: () => string): LocalHighlight[] {
  const stamp = now.toISOString()
  return legacy.map((h) => ({
    id: newId(),
    entryId,
    fileHash,
    cfi: h.cfi,
    index: h.index,
    color: h.color,
    text: capExcerpt(h.text),
    note: null,
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
    sent: false,
  }))
}

/**
 * A highlight made or recoloured on the copy `fileHash`: the live one over the
 * same range changes colour (a new moment), else a new highlight is made. A
 * removed one stays a tombstone, so the new one is not the old.
 */
export function withHighlight(
  list: readonly LocalHighlight[],
  entryId: string,
  fileHash: string,
  highlight: Highlight,
  now: Date,
  newId: () => string,
): LocalHighlight[] {
  const same = list.find((h) => isLive(h) && h.fileHash === fileHash && h.cfi === highlight.cfi)
  if (same) {
    const changed: LocalHighlight = { ...same, color: highlight.color, updatedAt: stampAfter(same.updatedAt, now), sent: false }
    return list.map((h) => (h.id === same.id ? changed : h))
  }
  const stamp = now.toISOString()
  return [
    ...list,
    {
      id: newId(),
      entryId,
      fileHash,
      cfi: highlight.cfi,
      index: highlight.index,
      color: highlight.color,
      text: capExcerpt(highlight.text),
      note: null,
      createdAt: stamp,
      updatedAt: stamp,
      deletedAt: null,
      sent: false,
    },
  ]
}

/** A highlight removed on the copy `fileHash`: a tombstone with none of her words, newer than what it replaces. */
export function withoutHighlight(list: readonly LocalHighlight[], fileHash: string, cfi: string, now: Date): LocalHighlight[] {
  const same = list.find((h) => isLive(h) && h.fileHash === fileHash && h.cfi === cfi)
  if (!same) return [...list]
  const stamp = stampAfter(same.updatedAt, now)
  return list.map((h) => (h.id === same.id ? { ...h, text: '', note: null, updatedAt: stamp, deletedAt: stamp, sent: false } : h))
}

/** A highlight removed from the "another copy" list: there is no range to match, so it goes by id. */
export function withoutHighlightId(list: readonly LocalHighlight[], id: string, now: Date): LocalHighlight[] {
  const same = list.find((h) => h.id === id && isLive(h))
  if (!same) return [...list]
  const stamp = stampAfter(same.updatedAt, now)
  return list.map((h) => (h.id === id ? { ...h, text: '', note: null, updatedAt: stamp, deletedAt: stamp, sent: false } : h))
}

/** The change `updatedAt` of `id` has been handed to the outbox; a newer one made meanwhile is still to go. */
export function markSent(list: readonly LocalHighlight[], id: string, updatedAt: string): LocalHighlight[] {
  return list.map((h) => (h.id === id && h.updatedAt === updatedAt ? { ...h, sent: true } : h))
}

/** The highlights still to go to the outbox, oldest change first. */
export const unsent = (list: readonly LocalHighlight[]) => list.filter((h) => !h.sent).sort((a, b) => at(a.updatedAt) - at(b.updatedAt))

/**
 * The write the outbox carries to `sync_write`: `save_reader_highlight` with
 * its arguments by name. `about` is what the member knows it by (the Book's
 * title). No `entryId`: it changes nothing the Library shows.
 */
export function highlightWrite(h: ReaderHighlight, about: string): QueuedWrite {
  const removed = !isLive(h)
  return {
    action: 'save_reader_highlight',
    about,
    queuedAt: h.updatedAt,
    args: {
      p_id: h.id,
      p_entry_id: h.entryId,
      p_file_hash: h.fileHash,
      p_cfi: h.cfi,
      p_section_index: h.index,
      p_color: h.color,
      p_excerpt: removed ? '' : capExcerpt(h.text),
      p_note: removed ? null : h.note,
      p_deleted: removed,
      p_at: h.updatedAt,
      p_created_at: h.createdAt,
    },
  }
}
