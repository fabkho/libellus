import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  buildContext,
  cleanFeedback,
  contextRoute,
  createFeedback,
  FEEDBACK_MAX,
  feedbackProblem,
  itemFromRow,
  USER_AGENT_MAX,
  type DeviceFacts,
} from '@/data/feedback'
import { signUpMember, type TestMember } from './support/member'
import { newClient, sql } from './support/stack'

/**
 * Contact (supabase/migrations/20261024010000_feedback.sql): the text rules the sheet checks before it asks,
 * the context the device attaches (what goes in, and that no token or address with one ever does), the owner's
 * rows as the sheet shows them, then the repository against the local stack: a member sends and reads nothing
 * back, the limit answers rate_limited, and only the instance owner reads the inbox and marks messages.
 */

const device = (over: Partial<DeviceFacts> = {}): DeviceFacts => ({
  appVersion: 'build-123',
  path: '/profile',
  pattern: null,
  standalone: false,
  platform: 'iOS',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 Version/18.2 Mobile/15E148 Safari/604.1',
  locale: 'en',
  online: true,
  screen: { width: 390, height: 844, ratio: 3 },
  ...over,
})

describe('the text', () => {
  it('is trimmed, with line breaks as \\n', () => {
    expect(cleanFeedback('  hello\r\nthere\rfriend  \n')).toBe('hello\nthere\nfriend')
  })

  it('needs 10 characters once trimmed, and at most 2000', () => {
    expect(feedbackProblem('')).toBe('too_short')
    expect(feedbackProblem('         short         ')).toBe('too_short')
    expect(feedbackProblem('123456789')).toBe('too_short')
    expect(feedbackProblem('1234567890')).toBeNull()
    expect(feedbackProblem(`  ${'a'.repeat(FEEDBACK_MAX)}  `)).toBeNull()
    expect(feedbackProblem('a'.repeat(FEEDBACK_MAX + 1))).toBe('too_long')
  })

  it('counts characters, not code units (an emoji is one)', () => {
    expect(feedbackProblem('😀'.repeat(10))).toBeNull()
    expect(feedbackProblem('😀'.repeat(FEEDBACK_MAX))).toBeNull()
  })
})

describe('the route in the context', () => {
  it('is the router’s pattern when there is one, so it can hold no token', () => {
    expect(contextRoute('/r/AbCdEf123456789012345x', '/r/:token()')).toBe('/r/[token]')
    expect(contextRoute('/f/secret-token', '/f/:token()')).toBe('/f/[token]')
    expect(contextRoute('/book/xyz', '/book/:key()')).toBe('/book/[key]')
    expect(contextRoute('/r/tok/book/b1', '/r/:token()/book/:book()')).toBe('/r/[token]/book/[book]')
    expect(contextRoute('/profile', '/profile')).toBe('/profile')
  })

  it('is scrubbed when there is no pattern: reading page and follow link tokens, member ids, query and fragment', () => {
    expect(contextRoute('/r/AbCdEf123456789012345x')).toBe('/r/[token]')
    expect(contextRoute('/r/AbCdEf123456789012345x/book/abc')).toBe('/r/[token]/book/abc')
    expect(contextRoute('/f/AbCdEf123456789012345x')).toBe('/f/[token]')
    expect(contextRoute('/f/AbCdEf123456789012345x/')).toBe('/f/[token]/')
    expect(contextRoute('/friends/5e1f0000-0000-4000-8000-000000000023')).toBe('/friends/[member]')
    expect(contextRoute('/profile?token=secret#frag')).toBe('/profile')
  })

  it('is null for something that is not a path', () => {
    expect(contextRoute('https://example.org/x')).toBeNull()
    expect(contextRoute('')).toBeNull()
  })
})

describe('the context', () => {
  it('holds the build, route, display mode, platform, browser, locale, online state and screen', () => {
    expect(buildContext(device())).toEqual({
      appVersion: 'build-123',
      route: '/profile',
      displayMode: 'browser',
      platform: 'iOS',
      userAgent: device().userAgent,
      locale: 'en',
      online: true,
      screen: '390×844@3',
    })
  })

  it('says standalone for an installed app, nothing for a device that does not say', () => {
    expect(buildContext(device({ standalone: true })).displayMode).toBe('standalone')
    expect(buildContext(device({ standalone: null })).displayMode).toBeNull()
  })

  it('cuts the browser string and takes no address, token or id out of it', () => {
    const long = buildContext(device({ userAgent: `Mozilla ${'x'.repeat(500)}` }))
    expect(long.userAgent!.length).toBeLessThanOrEqual(USER_AGENT_MAX)
    const leaky = buildContext(device({ userAgent: 'Agent ada@example.org eyJabcd.eyJabcd.abcdef5 5e1f0000-0000-4000-8000-000000000023' }))
    expect(leaky.userAgent).not.toMatch(/ada@example\.org|eyJabcd|5e1f0000/)
  })

  it('carries a reading page’s token nowhere, whatever the route', () => {
    const context = buildContext(device({ path: '/r/AbCdEf123456789012345x?x=1', pattern: '/r/:token()' }))
    expect(JSON.stringify(context)).not.toContain('AbCdEf123456789012345x')
    expect(context.route).toBe('/r/[token]')
  })

  it('has only its own fields and stays far under the database’s 4000 bytes', () => {
    const context = buildContext(device({ appVersion: 'v'.repeat(1000), userAgent: 'u'.repeat(1000), platform: 'p'.repeat(1000), locale: 'l'.repeat(100) }))
    expect(Object.keys(context).sort()).toEqual(['appVersion', 'displayMode', 'locale', 'online', 'platform', 'route', 'screen', 'userAgent'])
    expect(new TextEncoder().encode(JSON.stringify(context)).length).toBeLessThan(1000)
  })
})

describe('a message as the owner reads it', () => {
  const row = { id: 'x', kind: 'feature', body: '<b>hi</b>', context: { route: '/profile' }, created_at: '2026-10-24T08:00:00.123456+00:00', handled_at: null, member_name: 'Ada', member_email: 'a@example.org' }

  it('is read from the database row, the time kept as written for paging', () => {
    expect(itemFromRow(row)).toEqual({
      id: 'x',
      kind: 'feature',
      text: '<b>hi</b>',
      context: { route: '/profile' },
      at: new Date('2026-10-24T08:00:00.123Z'),
      cursor: '2026-10-24T08:00:00.123456+00:00',
      handledAt: null,
      memberName: 'Ada',
      memberEmail: 'a@example.org',
    })
  })

  it('falls back on "other" for an unknown kind and on an empty context for one that is not an object', () => {
    expect(itemFromRow({ ...row, kind: 'nope', context: [1] }).kind).toBe('other')
    expect(itemFromRow({ ...row, context: [1] }).context).toEqual({})
    expect(itemFromRow({ ...row, context: null }).context).toEqual({})
  })
})

describe('the repository', () => {
  let ada: TestMember
  let bo: TestMember
  let owner: TestMember
  let before: string | null

  beforeAll(async () => {
    ada = await signUpMember()
    bo = await signUpMember()
    owner = await signUpMember()
    before = (await sql<{ owner_id: string | null }>('select owner_id from private.instance_owner'))[0]?.owner_id ?? null
    await sql('update private.instance_owner set owner_id = $1', [owner.id])
  })
  afterAll(async () => {
    await sql('update private.instance_owner set owner_id = $1', [before])
  })

  const context = buildContext(device())

  it('sends a message under her own id and gives her nothing back', async () => {
    const result = await createFeedback(ada.client).send('bug', '  The sheet will not close on my phone.  ', context)
    expect(result).toEqual({ error: null })
    const [row] = await sql<{ member_id: string; kind: string; body: string; ctx: Record<string, unknown> }>(
      "select member_id::text, kind, body, context as ctx from public.feedback where member_id = $1 and body like 'The sheet will not close%'",
      [ada.id],
    )
    expect(row).toMatchObject({ member_id: ada.id, kind: 'bug', body: 'The sheet will not close on my phone.' })
    expect(row!.ctx).toMatchObject({ route: '/profile', displayMode: 'browser' })
    // Not even her own row can be read back.
    const read = await ada.client.from('feedback').select('*')
    expect(read.error?.code).toBe('42501')
  })

  it('refuses a text that is too short before it asks, and offline before anything', async () => {
    expect(await createFeedback(ada.client).send('bug', 'short', context)).toEqual({ error: 'invalid' })
    expect(await createFeedback(ada.client, { online: () => false }).send('bug', 'A long enough message.', context)).toEqual({ error: 'offline' })
  })

  it('cannot write a message as someone else, nor mark one handled', async () => {
    const forged = await ada.client.from('feedback').insert({ member_id: bo.id, kind: 'bug', body: 'Pretending to be Bo, ten chars.' })
    expect(forged.error?.code).toBe('42501')
    const [{ n }] = await sql<{ n: string }>('select count(*) as n from public.feedback where member_id = $1', [bo.id])
    expect(n).toBe('0')
    expect(await ada.client.from('feedback').update({ handled_at: new Date().toISOString() }).eq('member_id', ada.id).select()).toMatchObject({ error: { code: '42501' } })
  })

  it('answers rate_limited from the sixth message in an hour', async () => {
    const cy = await signUpMember()
    const feedback = createFeedback(cy.client)
    for (let i = 1; i <= 5; i++) expect(await feedback.send('other', `A message, number ${i} of five.`, context)).toEqual({ error: null })
    expect(await feedback.send('other', 'A message, number six.', context)).toEqual({ error: 'rate_limited' })
  })

  it('shows the owner the inbox with who wrote it, and nobody else', async () => {
    const list = await createFeedback(owner.client).list({ limit: 100 })
    expect(list.error).toBeNull()
    const ours = list.data!.find((item) => item.text === 'The sheet will not close on my phone.')!
    expect(ours).toMatchObject({ kind: 'bug', memberEmail: ada.email, handledAt: null })
    expect(ours.context).toMatchObject({ route: '/profile' })

    for (const member of [ada, bo]) expect(await createFeedback(member.client).list()).toEqual({ data: null, error: 'not_owner' })
    expect(await createFeedback(newClient()).list()).toEqual({ data: null, error: 'not_owner' })
  })

  it('pages the inbox with the time of the last message', async () => {
    const feedback = createFeedback(owner.client)
    const first = (await feedback.list({ limit: 2 })).data!
    expect(first).toHaveLength(2)
    const next = (await feedback.list({ limit: 2, before: first.at(-1)!.cursor })).data!
    expect(next.map((item) => item.id)).not.toContain(first[0]!.id)
    expect(next.map((item) => item.id)).not.toContain(first[1]!.id)
  })

  it('lets the owner mark a message handled and open again; nobody else', async () => {
    const feedback = createFeedback(owner.client)
    const id = (await feedback.list({ limit: 100 })).data!.find((item) => item.text === 'The sheet will not close on my phone.')!.id
    expect(await createFeedback(ada.client).markHandled(id, true)).toEqual({ data: null, error: 'not_owner' })
    expect(await feedback.markHandled(id, true)).toEqual({ data: true, error: null })
    expect((await feedback.list({ limit: 100 })).data!.find((item) => item.id === id)!.handledAt).toBeInstanceOf(Date)
    expect(await feedback.markHandled(id, false)).toEqual({ data: true, error: null })
    expect((await feedback.list({ limit: 100 })).data!.find((item) => item.id === id)!.handledAt).toBeNull()
    expect(await feedback.markHandled('00000000-0000-4000-8000-000000000000', true)).toEqual({ data: false, error: null })
  })
})
