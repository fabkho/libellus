import { recordedAppleIds } from '../tests/support/apple'
import { recordedOpenLibraryKeys } from '../tests/support/openLibrary'
import { sql, sweepRun } from '../tests/support/stack'

// Removes the members this run signed up and nothing else (the dev member, other
// runs' fixtures); their accounts and Library entries go with them. Then the
// Catalogue Books the flows added from the recordings, once no Library holds
// them: their covers were the recorded stand-in, not their own, and must not
// become the kept first snapshot of the developer's Catalogue.
export default async function globalTeardown() {
  await sweepRun()
  await sql(
    `delete from public.books b where b.owner_id is null
       and (b.apple_id = any($1) or b.openlibrary_edition_key = any($2))
       and not exists (select 1 from public.library_entries e where e.book_id = b.id)`,
    [recordedAppleIds(), recordedOpenLibraryKeys()],
  )
}
