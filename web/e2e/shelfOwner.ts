import { createInviteCode, serviceRoleKey, sql, stack, uniqueEmail } from '../tests/support/stack'

/**
 * Your shelf (#23) belongs to one member, named by her id in the app's
 * configuration. The flows' app is started with this one (playwright.config.ts,
 * NUXT_PUBLIC_SHELF_OWNER_ID), and `shelfOwner()` makes the member who has it.
 */
export const SHELF_OWNER_ID = '5e1f0000-0000-4000-8000-000000000023'

/** The library file the flows' app shows (NUXT_PUBLIC_REGAL_LIBRARY_SRC); no flow answers it now (the owner's row has none). */
export const SHELF_LIBRARY_SRC = 'https://books.fabkho.dev/v2/library.json'

/**
 * The owner: a member with that id, as a member is made anywhere else (an
 * invite, a proved address) except that the id is given, which only the auth
 * server's admin can do. Her address carries the run's tag, so the run's
 * sweep removes her and the id is free again for the next run; while she
 * exists (a flow before this one in the run, or a run beside it) she is reused.
 */
export async function shelfOwner(): Promise<{ id: string; email: string }> {
  const [existing] = await sql<{ email: string }>('select email from auth.users where id = $1', [SHELF_OWNER_ID])
  if (existing) return { id: SHELF_OWNER_ID, email: existing.email }

  const email = uniqueEmail('shelf-owner')
  const key = serviceRoleKey()
  const response = await fetch(`${stack.url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      id: SHELF_OWNER_ID,
      email,
      email_confirm: true,
      user_metadata: { invite_code: await createInviteCode({ maxUses: 1 }) },
    }),
  })
  if (!response.ok) {
    // Made meanwhile by a flow beside this one.
    const [made] = await sql<{ email: string }>('select email from auth.users where id = $1', [SHELF_OWNER_ID])
    if (made) return { id: SHELF_OWNER_ID, email: made.email }
    throw new Error(`The shelf's owner could not be made: ${response.status} ${await response.text()}`)
  }
  return { id: SHELF_OWNER_ID, email }
}
