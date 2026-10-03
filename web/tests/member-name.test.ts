import { describe, expect, it } from 'vitest'
import { cleanName, createAuth, MEMBER_NAME_MAX } from '@/data/auth'
import { signUpMember } from './support/member'
import { newClient } from './support/stack'

/**
 * The first name Home greets her with (issue #49, audit item 10): optional,
 * kept with the account in Supabase Auth's user metadata, so no table and no
 * migration. The repository sets and clears it; every member read carries it.
 */
describe('a name as it is kept', () => {
  it('is trimmed, with inner runs of spaces made one', () => {
    expect(cleanName('  Fabian ')).toBe('Fabian')
    expect(cleanName('Anna   Lena')).toBe('Anna Lena')
  })

  it('is no name when nothing is left', () => {
    expect(cleanName('')).toBeNull()
    expect(cleanName('   ')).toBeNull()
    expect(cleanName(null)).toBeNull()
  })

  it('is cut at the longest the greeting takes, whole characters only', () => {
    expect(cleanName('a'.repeat(MEMBER_NAME_MAX + 5))).toHaveLength(MEMBER_NAME_MAX)
    expect([...cleanName('🙂'.repeat(MEMBER_NAME_MAX + 1))!]).toHaveLength(MEMBER_NAME_MAX)
  })
})

describe('the member name', () => {
  it('starts unset, is saved with the account and comes back on another device', async () => {
    const member = await signUpMember()
    const auth = createAuth(member.client)
    expect((await auth.currentMember())?.name).toBeUndefined()

    const saved = await auth.setName('  Ida ')
    expect(saved).toEqual({ member: { id: member.id, email: member.email, name: 'Ida' }, error: null })
    expect(await auth.currentMember()).toEqual({ id: member.id, email: member.email, name: 'Ida' })

    // Another sign-in reads it from the server, not from this device.
    const { data } = await member.client.auth.getUser()
    expect(data.user?.user_metadata.name).toBe('Ida')
  })

  it('is cleared by an empty name', async () => {
    const member = await signUpMember()
    const auth = createAuth(member.client)
    await auth.setName('Ida')

    const cleared = await auth.setName('   ')
    expect(cleared.error).toBeNull()
    expect(cleared.member).toEqual({ id: member.id, email: member.email })
    expect(await auth.currentMember()).toEqual({ id: member.id, email: member.email })
  })

  it('is refused offline before anything is sent', async () => {
    const member = await signUpMember()
    const auth = createAuth(member.client)
    expect(await auth.setName('Ida', { online: () => false })).toEqual({ member: null, error: 'offline' })
    expect((await auth.currentMember())?.name).toBeUndefined()
  })

  it('needs a session: nobody signed in has no name to set', async () => {
    const auth = createAuth(newClient())
    const result = await auth.setName('Ida')
    expect(result.member).toBeNull()
    expect(result.error).not.toBeNull()
  })
})
