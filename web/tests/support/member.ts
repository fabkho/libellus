import type { SupabaseClient } from '@supabase/supabase-js'
// Relative, like stack.ts, so the Playwright suite can build a member too.
import { createAuth } from '../../app/data/auth'
import type { SessionStorage } from '../../app/data/createSupabaseClient'
import { createInviteCode, newClient, readMailedCode, uniqueEmail } from './stack'

export type TestMember = {
  email: string
  id: string
  client: SupabaseClient
}

/**
 * A member who exists the only way a member can exist: an invite code, a mailed
 * code, and the code typed back in. Tests that need someone signed in start
 * here rather than reaching into auth.users, so the fixture itself proves the
 * happy path still works.
 */
export async function signUpMember(storage?: SessionStorage): Promise<TestMember> {
  const email = uniqueEmail('member')
  const client = storage ? newClient(storage) : newClient()
  const auth = createAuth(client)

  const inviteCode = await createInviteCode({ maxUses: 1 })
  const requested = await auth.requestSignUpCode({ email, inviteCode })
  if (requested.error) throw new Error(`Fixture sign-up failed: ${requested.error}`)

  const verified = await auth.verifyCode(email, await readMailedCode(email))
  if (verified.error) throw new Error(`Fixture verification failed: ${verified.error}`)

  const member = await auth.currentMember()
  if (!member) throw new Error('Fixture sign-up produced no session')

  return { email, id: member.id, client }
}
