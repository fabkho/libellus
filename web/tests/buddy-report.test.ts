import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CONTACT_KINDS, createFeedback, FEEDBACK_KINDS, itemFromRow } from '@/data/feedback'
import { reportInput } from '@/utils/buddyThread'
import { buddyOf, follows, joinRead, startRead } from './support/buddy'
import { signUpMember, type TestMember } from './support/member'
import { sql } from './support/stack'

/**
 * Reporting a buddy read's message (W4; the function is `report_buddy_message`, supabase/migrations/20261113030000_buddy_read_messages.sql):
 * what the screen sends (`reportInput`) arrives as one `report` in the owner's inbox with the reason and the note, a short excerpt, the read,
 * the Section and the author, and the owner's screen reads that kind as its own, not as "other". A member can neither choose the kind in
 * Contact nor insert one by hand.
 */

let owner: TestMember
let before: string | null

beforeAll(async () => {
  owner = await signUpMember()
  before = (await sql<{ owner_id: string | null }>('select owner_id from private.instance_owner'))[0]?.owner_id ?? null
  await sql('update private.instance_owner set owner_id = $1', [owner.id])
})
afterAll(async () => {
  await sql('update private.instance_owner set owner_id = $1', [before])
})

describe('the kinds of the inbox', () => {
  it('has `report` for the owner’s screen, and leaves it out of what a member chooses in Contact', () => {
    expect(FEEDBACK_KINDS).toContain('report')
    expect(CONTACT_KINDS).toEqual(['bug', 'feature', 'other'])
    const row = { id: '1', kind: 'report', body: 'Buddy read report: spam', context: {}, created_at: '2026-11-14T10:00:00Z', handled_at: null, member_name: null, member_email: null }
    expect(itemFromRow(row as never).kind).toBe('report')
  })
})

describe('a report through the screen’s own input', () => {
  it('reaches the owner as one report with the reason, the note and a short excerpt, and a second one by her makes no second row', async () => {
    const ada = await signUpMember()
    const ben = await signUpMember()
    await follows(ada, ben)
    const made = await startRead(ada, { title: 'Reported' })
    await joinRead(ben, made.linkToken!)
    const section = (await buddyOf(ada).read(made.id)).data!.chapters[0]!.id
    const long = 'A rude remark. '.repeat(40)
    const sent = (await buddyOf(ada).post({ readId: made.id, sectionId: section, clientId: crypto.randomUUID(), body: long })).data!

    const input = reportInput('harassment', '  She keeps doing this.  ')!
    expect(input).toEqual({ reason: 'harassment', note: 'She keeps doing this.' })
    expect((await buddyOf(ben).report(sent.id, input.reason, input.note)).error).toBeNull()
    expect((await buddyOf(ben).report(sent.id, 'spam', null)).error).toBeNull()

    const rows = await sql<{ kind: string; body: string; ctx: Record<string, string> }>('select kind, body, context as ctx from public.feedback where member_id = $1', [ben.id])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'report', body: 'Buddy read report: harassment\n\nShe keeps doing this.' })
    expect(rows[0]!.ctx).toMatchObject({ buddy_read: made.id, section, message: sent.id, author: ada.id })
    expect(rows[0]!.ctx.excerpt!.length).toBe(300)

    const inbox = await createFeedback(owner.client).list({ limit: 100 })
    expect(inbox.data!.find((item) => item.context.message === sent.id)).toMatchObject({ kind: 'report', memberEmail: ben.email })
  })

  it('refuses what the screen would not send, and a member inserting a report by hand', async () => {
    const ada = await signUpMember()
    expect(reportInput('nonsense', 'x')).toBeNull()
    const made = await startRead(ada, { title: 'Hand made' })
    const note = (await buddyOf(ada).post({ readId: made.id, sectionId: null, clientId: crypto.randomUUID(), body: 'Mine' })).data!
    expect((await buddyOf(ada).report(note.id, 'spam')).error).toBe('report_self')
    const forged = await ada.client.from('feedback').insert({ kind: 'report', body: 'A forged report, long enough.' })
    expect(forged.error?.code).toBe('42501')
  })
})
