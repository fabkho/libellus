import type { SupabaseClient } from '@supabase/supabase-js'
import { isNoAnswer } from './network'

/**
 * The reader's place in a book, kept server-side (issue #131, phase 2; owner
 * decision 3): where the member stopped reading one Library entry's ebook, so
 * another device of hers holding the same file opens it there.
 *
 * The place only, never the content — no ebook ever leaves the device:
 *   `cfi`       the EPUB CFI the reader left off at,
 *   `fraction`  how far through the book that is, 0–1,
 *   `fileHash`  the fingerprint of the file it was read in (SHA-256 of its
 *               first megabyte, phase 1's `hash`; `ebooks/files.ts`).
 *
 * The other device compares the fingerprint with its own copy's: the same file
 * follows the CFI exactly, another copy of the same Book falls back to the
 * fraction. One place per entry, hers alone (RLS).
 *
 * Saving is one row, so it is one call — `save_reader_place`, which never lets
 * a place travel backwards: a save older than the stored one leaves it alone
 * and gives it back (two devices, and the one that syncs last is not the one
 * that read last). `at` is when the place was taken on this device; the
 * database brings a clock that runs far ahead back to now.
 *
 * Offline, a save is refused before anything is sent, like every other write
 * (web/AGENTS.md). It does not wait in the outbox: a place is best-effort and
 * the device keeps its own copy of where it is anyway, so a stale place queued
 * for later would only overwrite a newer one from somewhere else.
 *
 * Framework-free: the repository receives the Supabase client and the online
 * check, so Vitest drives it in plain Node and a native port copies it 1:1.
 */

export type ReaderPlace = {
  entryId: string
  cfi: string
  fraction: number
  /** SHA-256 (64 lower-case hex characters) of the first megabyte of the file. */
  fileHash: string
  /** When the place was taken, as the database stored it. */
  updatedAt: string
}

/** What a save carries: the place, and the moment this device took it (ISO 8601). */
export type ReaderPlaceSave = Omit<ReaderPlace, 'updatedAt'> & { at: string }

/** Stable codes for what can go wrong; the copy lives under `reader.error.<code>`. */
export type ReaderPlaceErrorCode =
  /** No such entry in the member's Library (gone, or never hers). */
  | 'entry_not_found'
  /** An empty or over-long CFI, a fraction outside 0–1, a fingerprint that is not a SHA-256. */
  | 'place_invalid'
  | 'not_signed_in'
  /** The device has no connection: nothing was sent. */
  | 'offline'
  | 'unknown'

export type ReaderPlaceResult<T> = { data: T; error: null } | { data: null; error: ReaderPlaceErrorCode }

/** The database's limits (reader_places' own checks). */
export const CFI_MAX_LENGTH = 2000
export const FILE_HASH_PATTERN = /^[0-9a-f]{64}$/

export type ReaderPlaces = {
  /** The place saved for this entry, null when no device has saved one yet. */
  get: (entryId: string) => Promise<ReaderPlaceResult<ReaderPlace | null>>
  /**
   * Saves where the member is and answers with the place that stands afterwards:
   * the one sent, or the newer one another device had saved already. Refused
   * offline, before anything is sent.
   */
  save: (place: ReaderPlaceSave) => Promise<ReaderPlaceResult<ReaderPlace>>
}

/** The `reader_places` row, as PostgREST returns it. */
type ReaderPlaceRow = {
  entry_id: string
  cfi: string
  fraction: number
  file_hash: string
  updated_at: string
}

function placeFromRow(row: ReaderPlaceRow): ReaderPlace {
  return {
    entryId: row.entry_id,
    cfi: row.cfi,
    fraction: row.fraction,
    fileHash: row.file_hash,
    updatedAt: row.updated_at,
  }
}

/** What the database refuses, refused here too, before anything is sent. */
function isWellFormed({ cfi, fraction, fileHash }: ReaderPlaceSave): boolean {
  return (
    cfi.length > 0 &&
    cfi.length <= CFI_MAX_LENGTH &&
    Number.isFinite(fraction) &&
    fraction >= 0 &&
    fraction <= 1 &&
    FILE_HASH_PATTERN.test(fileHash)
  )
}

function mapError(failure: { message?: string; code?: string }): ReaderPlaceErrorCode {
  const message = failure.message ?? ''
  if (message.includes('entry_not_found')) return 'entry_not_found'
  if (message.includes('place_invalid') || failure.code === '23514') return 'place_invalid'
  if (message.includes('not_signed_in') || failure.code === '42501' || failure.code === 'PGRST301') return 'not_signed_in'
  return 'unknown'
}

const OFFLINE = { data: null, error: 'offline' } as const

export function createReaderPlaces(
  client: SupabaseClient,
  { online = () => true }: { online?: () => boolean } = {},
): ReaderPlaces {
  return {
    async get(entryId) {
      // RLS hands her her own places only; none saved yet is no place.
      const { data, error } = await client
        .from('reader_places')
        .select('entry_id, cfi, fraction, file_hash, updated_at')
        .eq('entry_id', entryId)
        .maybeSingle<ReaderPlaceRow>()
      if (error) return { data: null, error: mapError(error) }
      return { data: data ? placeFromRow(data) : null, error: null }
    },

    async save(place) {
      if (!isWellFormed(place)) return { data: null, error: 'place_invalid' }
      if (!online()) return OFFLINE
      const saved = await client
        .rpc('save_reader_place', {
          p_entry_id: place.entryId,
          p_cfi: place.cfi,
          p_fraction: place.fraction,
          p_file_hash: place.fileHash,
          p_at: place.at,
        })
        .single<ReaderPlaceRow>()
      // No answer at all (a timeout, a dead connection): the place does not wait.
      if (isNoAnswer(saved)) return OFFLINE
      if (saved.error) return { data: null, error: mapError(saved.error) }
      return { data: placeFromRow(saved.data), error: null }
    },
  }
}
