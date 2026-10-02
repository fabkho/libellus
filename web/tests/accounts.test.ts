import { describe, expect, it } from 'vitest'
import { signUpMember } from './support/member'
import { createInviteCode } from './support/stack'

/**
 * What a signed-in member can reach through the API, as that member (the pgTAP
 * suite proves the same rules inside the database).
 */
describe('accounts and invite codes, as a member', () => {
  it('reads their own account and nobody else’s', async () => {
    const ida = await signUpMember()
    const olle = await signUpMember()

    const own = await ida.client.from('accounts').select('id').eq('id', ida.id)
    expect(own.data).toEqual([{ id: ida.id }])

    const other = await ida.client.from('accounts').select('id').eq('id', olle.id)
    expect(other.error).toBeNull()
    expect(other.data).toEqual([])
  })

  it('cannot read the invite codes', async () => {
    const ida = await signUpMember()
    const code = await createInviteCode()

    const { data, error } = await ida.client.from('invite_codes').select('code').eq('code', code)

    expect(data).toBeNull()
    expect(error?.code).toBe('42501')
  })

  it('cannot change an account', async () => {
    const ida = await signUpMember()

    const update = await ida.client.from('accounts').update({ invite_code_id: null }).eq('id', ida.id)
    expect(update.error?.code).toBe('42501')

    const removal = await ida.client.from('accounts').delete().eq('id', ida.id)
    expect(removal.error?.code).toBe('42501')
  })
})
