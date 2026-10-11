import type { SupabaseClient } from '@supabase/supabase-js'
import type { ReadoCollection } from '../../app/data/import/reado'

/**
 * Writes the Reado lists that became Collections into one member's Library, as
 * the service role, after the entries are there. Additive and idempotent: a
 * Collection is found by its name in any case (or made at the end of her list),
 * an entry is put on it by its import key and never taken off, so a rerun adds
 * only what is new and never undoes what the member arranged in the app. This
 * is what `import_books` does for the Goodreads import (`import_place_in_collections`),
 * for rows of entries that already exist.
 */

export interface CollectionsResult {
  collections: { created: number; existing: number }
  memberships: { added: number; present: number }
  /** Entry keys a Collection names that are not in the Library (their book could not be written). */
  missingEntries: string[]
}

class CollectionsError extends Error {}

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new CollectionsError(`${what}: ${result.error.message}`)
  return result.data
}

const CHUNK = 100

export async function writeCollections(
  client: SupabaseClient,
  memberId: string,
  collections: readonly ReadoCollection[],
  options: { dryRun?: boolean; log?: (line: string) => void } = {},
): Promise<CollectionsResult> {
  const { dryRun = false, log = () => {} } = options
  const result: CollectionsResult = { collections: { created: 0, existing: 0 }, memberships: { added: 0, present: 0 }, missingEntries: [] }

  // Every key of every Collection, resolved to an entry id once.
  const wanted = [...new Set(collections.flatMap((collection) => collection.keys))]
  const entryOf = new Map<string, string>()
  for (let from = 0; from < wanted.length; from += CHUNK) {
    const rows = check(
      await client.from('library_entries').select('id, import_key').eq('member_id', memberId).in('import_key', wanted.slice(from, from + CHUNK)),
      'Finding the entries',
    ) as { id: string; import_key: string }[]
    for (const row of rows) entryOf.set(row.import_key, row.id)
  }

  const owned = check(
    await client.from('collections').select('id, name, position').eq('member_id', memberId),
    'Reading the Collections',
  ) as { id: string; name: string; position: number }[]
  const byName = new Map(owned.map((row) => [row.name.toLowerCase(), row]))
  let lastPosition = owned.reduce((top, row) => Math.max(top, row.position), 0)

  for (const collection of collections) {
    let row = byName.get(collection.name.toLowerCase())
    if (row) {
      result.collections.existing++
    } else {
      result.collections.created++
      if (!dryRun) {
        row = check(
          await client.from('collections').insert({ member_id: memberId, name: collection.name, position: ++lastPosition }).select('id, name, position').single(),
          'Adding the Collection',
        ) as { id: string; name: string; position: number }
        byName.set(collection.name.toLowerCase(), row)
      }
    }

    const ids = collection.keys.flatMap((key) => {
      const id = entryOf.get(key)
      if (!id) result.missingEntries.push(key)
      return id ? [id] : []
    })
    const members = row
      ? (check(await client.from('collection_entries').select('entry_id, position').eq('collection_id', row.id), 'Reading the Collection') as { entry_id: string; position: number }[])
      : []
    const present = new Set(members.map((member) => member.entry_id))
    let position = members.reduce((top, member) => Math.max(top, member.position), 0)
    const added = ids.filter((id) => !present.has(id))
    result.memberships.present += ids.length - added.length
    result.memberships.added += added.length
    if (!dryRun && row && added.length) {
      check(
        await client.from('collection_entries').insert(added.map((entryId) => ({ collection_id: row.id, entry_id: entryId, position: ++position }))),
        'Putting the entries on the Collection',
      )
    }
    log(`  ${collection.name}: ${added.length} added, ${ids.length - added.length} there already`)
  }
  return result
}
