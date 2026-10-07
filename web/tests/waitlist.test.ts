import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createWaitlist, emailsText, entryFromRow, looksLikeEmail, waiting, type WaitlistEntry } from '@/data/waitlist'
import { createAuth } from '@/data/auth'
import { createReadingPages } from '@/data/readingPage'
import { signUpMember, type TestMember } from './support/member'
import { newClient, resetWaitlistLimits, sql, uniqueEmail } from './support/stack'

/**
 * The waitlist on a reading page (issue #171): the pure part (the address check the form makes before it
 * asks, the list the owner reads, what Copy puts on the clipboard), then the repository against the local
 * stack. A signed-out client joins through `join_waitlist` and nothing else; the owner (named in
 * `private.instance_owner`) reads, marks and deletes, every other member and a signed-out client are
 * refused, and nobody is answered while no owner is named.
 */

const entry = (over: Partial<WaitlistEntry> = {}): WaitlistEntry => ({
  id: 'e',
  email: 'a@example.org',
  joinedAt: new Date('2026-10-07T08:00:00Z'),
  invitedAt: null,
  source: 'reading_page',
  memberName: 'Ada',
  note: null,
  ...over,
})

describe('the address check', () => {
  it('lets through what looks like an address', () => {
    for (const ok of ['a@example.org', ' ada.l+books@mail.example.co.uk ', 'x_y-z@sub.domain.de']) expect(looksLikeEmail(ok), ok).toBe(true)
  })

  it('stops what does not, before anything is asked', () => {
    for (const bad of ['', '   ', 'plain', 'a@b', 'a@b.c', 'a b@example.org', 'a@@example.org', 'a@example..org', '@example.org', `${'a'.repeat(250)}@b.org`])
      expect(looksLikeEmail(bad), bad).toBe(false)
  })
})

describe('the list', () => {
  it('is read from the database rows', () => {
    expect(
      entryFromRow({ id: 'x', email: 'a@example.org', created_at: '2026-10-07T08:00:00Z', invited_at: '2026-10-08T08:00:00Z', source: 'reading_page', member_name: null, note: 'n' }),
    ).toEqual({ id: 'x', email: 'a@example.org', joinedAt: new Date('2026-10-07T08:00:00Z'), invitedAt: new Date('2026-10-08T08:00:00Z'), source: 'reading_page', memberName: null, note: 'n' })
  })

  it('knows who is still waiting, and copies their addresses ready for a Bcc field', () => {
    const all = [entry({ id: '1', email: 'one@example.org' }), entry({ id: '2', email: 'two@example.org', invitedAt: new Date() }), entry({ id: '3', email: 'three@example.org' })]
    expect(waiting(all).map((e) => e.id)).toEqual(['1', '3'])
    expect(emailsText(waiting(all))).toBe('one@example.org, three@example.org')
    expect(emailsText([])).toBe('')
  })
})

describe('the repository', () => {
  let owner: TestMember
  let other: TestMember
  let token: string
  let before: string | null

  beforeAll(async () => {
    owner = await signUpMember()
    other = await signUpMember()
    await createAuth(owner.client).setName('Ada')
    token = (await createReadingPages(owner.client).setOn(true)).data!.token!
    before = (await sql<{ owner_id: string | null }>('select owner_id from private.instance_owner'))[0]?.owner_id ?? null
  })
  afterAll(async () => {
    await sql('update private.instance_owner set owner_id = $1', [before])
    await resetWaitlistLimits()
  })
  beforeEach(resetWaitlistLimits)

  const name = (id: string | null) => sql('update private.instance_owner set owner_id = $1', [id])
  const visitor = () => createWaitlist(newClient())

  it('lets a signed-out visitor join from a page, and shows the owner whose page it was', async () => {
    await name(owner.id)
    const address = uniqueEmail('wl-join')
    expect(await visitor().join(address, token)).toEqual({ error: null })

    const list = (await createWaitlist(owner.client).list()).data!
    const ours = list.find((e) => e.email === address)!
    expect(ours).toMatchObject({ source: 'reading_page', memberName: 'Ada', invitedAt: null, note: null })
    // Never the token or her id.
    expect(JSON.stringify(list)).not.toContain(token)
    expect(JSON.stringify(list)).not.toContain(owner.id)
  })

  it('answers the same for an address that is already there, in any letters', async () => {
    const address = uniqueEmail('wl-twice')
    expect(await visitor().join(address, token)).toEqual({ error: null })
    expect(await visitor().join(address.toUpperCase(), token)).toEqual({ error: null })
    const rows = await sql('select 1 from private.waitlist where email::text = $1', [address.toLowerCase()])
    expect(rows).toHaveLength(1)
  })

  it('says an address is not one', async () => {
    expect(await visitor().join('nope', token)).toEqual({ error: 'invalid' })
    expect(await visitor().join('a@b', null)).toEqual({ error: 'invalid' })
  })

  it('thanks a bot that filled the honeypot and keeps nothing', async () => {
    const address = uniqueEmail('wl-bot')
    expect(await visitor().join(address, token, 'https://spam.example')).toEqual({ error: null })
    expect(await sql('select 1 from private.waitlist where email::text = $1', [address])).toHaveLength(0)
  })

  it('stops a caller after five new entries in the hour, and says so', async () => {
    const client = visitor()
    for (let i = 0; i < 5; i++) expect(await client.join(uniqueEmail(`wl-cap${i}`), token)).toEqual({ error: null })
    expect(await client.join(uniqueEmail('wl-cap6'), token)).toEqual({ error: 'rate_limited' })
  })

  it('asks nothing offline', async () => {
    expect(await createWaitlist(newClient(), { online: () => false }).join('a@example.org', token)).toEqual({ error: 'offline' })
    expect(await createWaitlist(owner.client, { online: () => false }).list()).toEqual({ data: null, error: 'offline' })
  })

  it('lets the owner mark an entry invited and waiting again, and delete it', async () => {
    await name(owner.id)
    const address = uniqueEmail('wl-owner')
    await visitor().join(address, token)
    const repo = createWaitlist(owner.client)
    const find = async () => (await repo.list()).data!.find((e) => e.email === address)
    const id = (await find())!.id

    expect(await repo.setInvited([id], true)).toEqual({ data: 1, error: null })
    expect((await find())!.invitedAt).toBeInstanceOf(Date)
    expect(await repo.setInvited([id], false)).toEqual({ data: 1, error: null })
    expect((await find())!.invitedAt).toBeNull()

    expect(await repo.remove(id)).toEqual({ data: true, error: null })
    expect(await find()).toBeUndefined()
    expect(await repo.remove(id)).toEqual({ data: false, error: null })
  })

  it('refuses another member, a signed-out client, and everyone while no owner is named', async () => {
    await name(owner.id)
    for (const client of [other.client, newClient()]) {
      const repo = createWaitlist(client)
      expect((await repo.list()).error).toBe('not_owner')
      expect((await repo.setInvited(['00000000-0000-4000-8000-000000000000'], true)).error).toBe('not_owner')
      expect((await repo.remove('00000000-0000-4000-8000-000000000000')).error).toBe('not_owner')
    }
    await name(null)
    expect(await createWaitlist(owner.client).list()).toEqual({ data: null, error: 'not_owner' })
  })

  it('keeps the list out of the API: nobody reads the table', async () => {
    await name(owner.id)
    const { error } = await owner.client.from('waitlist').select('*')
    expect(error).not.toBeNull()
    const direct = await newClient().schema('private' as 'public').from('waitlist').select('*')
    expect(direct.error).not.toBeNull()
  })
})
