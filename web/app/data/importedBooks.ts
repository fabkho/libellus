import type { SupabaseClient } from '@supabase/supabase-js'
import { mapLibraryError, type Result } from './library'

/**
 * Whether the member has an entry that came in through an import (Goodreads, Hardcover:
 * any `import_key`). Home asks it, once, for a member with a few entries and no memory of
 * an import on this device, so an import made on another device hides the offer too.
 */
export async function hasImportedBooks(client: SupabaseClient): Promise<Result<boolean>> {
  const { data, error } = await client.from('library_entries').select('id').not('import_key', 'is', null).limit(1)
  if (error) return { data: null, error: mapLibraryError(error) }
  return { data: data.length > 0, error: null }
}
