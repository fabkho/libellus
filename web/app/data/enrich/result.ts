/**
 * What the enrichment repositories answer (issues #167, #168): data or a
 * stable error code. The copy for each code is the screens' business
 * (phase 2), under `<screen>.error.<code>`.
 */

export type EnrichErrorCode =
  /** No such Library entry of hers (gone, or never hers). */
  | 'entry_not_found'
  /** An unknown genre, more than three, or a malformed series correction. */
  | 'invalid'
  /** The series she named by id is not one she may see. */
  | 'series_not_found'
  | 'not_signed_in'
  /** The device has no connection: nothing was sent. */
  | 'offline'
  | 'unknown'

export type EnrichResult<T> = { data: T; error: null } | { data: null; error: EnrichErrorCode }

export const OFFLINE = { data: null, error: 'offline' } as const

export function mapError(failure: { message?: string; code?: string }): EnrichErrorCode {
  const message = failure.message ?? ''
  if (message.includes('entry_not_found')) return 'entry_not_found'
  if (message.includes('series_not_found')) return 'series_not_found'
  if (message.includes('genres_invalid') || message.includes('series_invalid') || failure.code === '22023') return 'invalid'
  if (message.includes('not_signed_in') || failure.code === '42501' || failure.code === 'PGRST301') return 'not_signed_in'
  return 'unknown'
}
