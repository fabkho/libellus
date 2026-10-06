import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createOwnerErrors,
  detailText,
  groupFromRow,
  kindsOf,
  newGroups,
  ofKind,
  type OwnerErrorGroup,
} from '@/data/ownerErrors'
import { relativeTime } from '@/utils/relativeTime'
import { signUpMember, type TestMember } from './support/member'
import { newClient, runTag, sql } from './support/stack'

/**
 * The client error log as the instance's owner reads it in the app: the last
 * days' errors grouped by kind and message, and the newest report of a group.
 * The pure part first (grouping, the filter, what counts as new, what Copy
 * puts on the clipboard), then the repository against the local stack: the
 * owner (named in `private.instance_owner`) is answered, any other member and
 * a signed-out client are refused, and nobody is answered while no owner is named.
 */

const group = (over: Partial<OwnerErrorGroup> = {}): OwnerErrorGroup => ({
  hash: 'h',
  kind: 'error',
  message: 'boom',
  times: 3,
  firstSeen: new Date('2026-10-07T08:00:00Z'),
  lastSeen: new Date('2026-10-07T09:00:00Z'),
  versions: ['b1'],
  routes: ['/library'],
  standaloneTimes: 1,
  browserTimes: 2,
  onlineTimes: 3,
  offlineTimes: 0,
  members: 2,
  signedOutTimes: 0,
  ...over,
})

describe('the groups', () => {
  it('are read from the database rows, big counts included', () => {
    expect(
      groupFromRow({
        message_hash: 'abc',
        kind: 'chunk',
        message: 'Failed to fetch',
        times: '12',
        first_seen: '2026-10-07T08:00:00Z',
        last_seen: '2026-10-07T09:30:00Z',
        app_versions: null,
        routes: ['/'],
        standalone_times: 1,
        browser_times: '11',
        online_times: 12,
        offline_times: 0,
        members: 3,
        signed_out_times: 0,
      }),
    ).toMatchObject({ hash: 'abc', kind: 'chunk', times: 12, versions: [], browserTimes: 11, members: 3 })
  })

  it('are filtered by kind, the kinds listed in the log\'s order with their groups', () => {
    const all = [group({ kind: 'vue', hash: '1' }), group({ kind: 'error', hash: '2' }), group({ kind: 'vue', hash: '3' })]
    expect(kindsOf(all)).toEqual([
      { kind: 'error', groups: 1 },
      { kind: 'vue', groups: 2 },
    ])
    expect(ofKind(all, 'vue').map((g) => g.hash)).toEqual(['1', '3'])
    expect(ofKind(all, 'all')).toHaveLength(3)
    expect(ofKind(all, 'shelf')).toEqual([])
  })

  it('are new when first seen in the last 24 hours', () => {
    const now = Date.parse('2026-10-07T12:00:00Z')
    const fresh = group({ hash: 'new', firstSeen: new Date('2026-10-07T00:00:00Z') })
    const old = group({ hash: 'old', firstSeen: new Date('2026-10-05T00:00:00Z') })
    expect(newGroups([fresh, old], now).map((g) => g.hash)).toEqual(['new'])
  })

  it('copy as the message, the count, where it happened and the stack', () => {
    const detail = {
      kind: 'error' as const,
      message: 'boom',
      stack: 'at f (a.js:1:2)',
      route: '/library',
      version: 'b1',
      userAgent: 'iOS 18 Safari',
      standalone: true,
      online: true,
      reportedAt: new Date(),
      lastSeen: new Date(),
    }
    expect(detailText(group(), detail)).toBe('[error] boom\n×3\n/library · b1 · iOS 18 Safari\n\nat f (a.js:1:2)')
    expect(detailText(group(), null)).toBe('[error] boom\n×3')
  })
})

describe('how long ago', () => {
  const now = Date.parse('2026-10-07T12:00:00Z')
  const ago = (ms: number) => relativeTime(new Date(now - ms), now, 'en')
  it('is said in the largest unit that fits', () => {
    expect(ago(20_000)).toBe('now')
    expect(ago(5 * 60_000)).toBe('5 minutes ago')
    expect(ago(3 * 3_600_000)).toBe('3 hours ago')
    expect(ago(24 * 3_600_000)).toBe('yesterday')
    expect(ago(3 * 24 * 3_600_000)).toBe('3 days ago')
  })
})

describe('the owner\'s repository', () => {
  let owner: TestMember
  let other: TestMember
  let before: string | null
  const tag = `owner-errors ${runTag()}`

  beforeAll(async () => {
    owner = await signUpMember()
    other = await signUpMember()
    before = (await sql<{ owner_id: string | null }>('select owner_id from private.instance_owner'))[0]?.owner_id ?? null
    for (const [user, message, stack, count] of [
      [owner.id, `${tag} boom`, 'at f (https://app.test/_nuxt/a.js:1:2)', 2],
      [other.id, `${tag} boom`, 'at g (https://app.test/_nuxt/b.js:3:4)', 3],
    ] as const) {
      await sql(
        `insert into private.client_errors (user_id, caller_key, kind, message, stack, route, app_version, standalone, online, count)
         values ($1, $2, 'error', $3, $4, '/library', 'b1', false, true, $5)`,
        [user, `member:${user}`, message, stack, count],
      )
    }
  })

  afterAll(async () => {
    await sql('update private.instance_owner set owner_id = $1', [before])
  })

  const name = (id: string | null) => sql('update private.instance_owner set owner_id = $1', [id])

  it('answers the owner the groups, counting members and never naming them', async () => {
    await name(owner.id)
    const result = await createOwnerErrors(owner.client).list()
    expect(result.error).toBeNull()
    const ours = result.data!.find((g) => g.message === `${tag} boom`)!
    expect(ours).toMatchObject({ kind: 'error', times: 5, members: 2, versions: ['b1'], routes: ['/library'], browserTimes: 5, onlineTimes: 5 })
    expect(JSON.stringify(result.data)).not.toContain(other.id)
    expect(JSON.stringify(result.data)).not.toContain(owner.id)
  })

  it('answers the owner a group\'s newest stack', async () => {
    await name(owner.id)
    const repo = createOwnerErrors(owner.client)
    const listed = (await repo.list()).data!.find((g) => g.message === `${tag} boom`)!
    const detail = await repo.detail(listed.hash)
    expect(detail.error).toBeNull()
    expect(detail.data?.stack).toBe('at g (https://app.test/_nuxt/b.js:3:4)')
    expect((await repo.detail('nothing')).data).toBeNull()
  })

  it('refuses another member', async () => {
    await name(owner.id)
    const repo = createOwnerErrors(other.client)
    expect(await repo.list()).toEqual({ data: null, error: 'not_owner' })
    expect(await repo.detail('x')).toEqual({ data: null, error: 'not_owner' })
  })

  it('refuses everyone while no owner is named', async () => {
    await name(null)
    expect(await createOwnerErrors(owner.client).list()).toEqual({ data: null, error: 'not_owner' })
  })

  it('refuses a signed-out client', async () => {
    await name(owner.id)
    expect((await createOwnerErrors(newClient()).list()).error).toBe('not_owner')
  })

  it('asks nothing offline', async () => {
    expect(await createOwnerErrors(owner.client, { online: () => false }).list()).toEqual({ data: null, error: 'offline' })
  })
})
