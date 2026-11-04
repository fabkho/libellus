import { readFileSync } from 'node:fs'
import { createPinia, setActivePinia } from 'pinia'
import { computed, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BuddyCard, BuddyErrorCode, BuddyInvitation, MyBuddyReads } from '@/data/buddyReads'
import { inRoomsHint, leaveAndDecline, needsLeaving, turnOffPlan, turnOffView } from '@/utils/buddyTurnOff'
import { BUDDY_READS_KEY } from '@/utils/buddyReadsSwitch'

/**
 * Turning Buddy reads off (Profile → Account): the switch goes off only after she left every room and declined every invitation
 * (docs/plans/buddy-read-shared.md 4.6 and 5.5). The rules are pure (utils/buddyTurnOff.ts); the store (stores/buddyTurnOff.ts) runs here on a
 * fake buddy read store that is a small `my_buddy_reads` server, and the real switch store on a device of its own.
 */

const card = (id: string, status: BuddyCard['status'] = 'active'): BuddyCard => ({
  id,
  book: { id: `b-${id}`, title: 'The Book', authors: [], year: null, coverUrl: null, coverThumbhash: null, coverColors: null, coverKey: null, coverWidths: null, manual: false, unverified: false },
  status,
  startsOn: '2026-11-13',
  role: 'member',
  memberCount: 2,
  sections: 3,
  where: { kind: 'section', section: 1 },
  unread: 0,
})
const invitation = (id: string): BuddyInvitation => ({ id, book: card(id).book, startsOn: '2026-11-13', host: null, invitedBy: null, memberCount: 2, sections: 3 })
const mine = (reads: string[], invitations: string[] = [], ended: string[] = []): MyBuddyReads => ({
  reads: [...reads.map((id) => card(id)), ...ended.map((id) => card(id, 'finished'))],
  invitations: invitations.map(invitation),
})

describe('what turning it off has to undo', () => {
  it('is nothing for a list that is not loaded and for a list with no room and no invitation', () => {
    expect(turnOffPlan(null)).toEqual({ rooms: [], invitations: [] })
    expect(needsLeaving(turnOffPlan(null))).toBe(false)
    expect(needsLeaving(turnOffPlan(mine([])))).toBe(false)
  })

  it('counts every read she is in, an ended one too (it still shows her Section), and every invitation', () => {
    const plan = turnOffPlan(mine(['a', 'b'], ['i'], ['old']))
    expect(plan).toEqual({ rooms: ['a', 'b', 'old'], invitations: ['i'] })
    expect(needsLeaving(plan)).toBe(true)
    expect(needsLeaving(turnOffPlan(mine([], ['i'])))).toBe(true)
  })
})

describe('the confirm', () => {
  it('names how many rooms she leaves and offers the messages option', () => {
    const view = turnOffView(turnOffPlan(mine(['a', 'b'])))
    expect(view.titleKey).toBe('profile.buddyReadsOff.title')
    expect(view.actionKey).toBe('profile.buddyReadsOff.action')
    expect(view.parts).toEqual([{ key: 'profile.buddyReadsOff.rooms', count: 2 }])
    expect(view.deleteOption).toBe(true)
  })

  it('adds the invitations it declines after the rooms', () => {
    const view = turnOffView(turnOffPlan(mine(['a'], ['i', 'j'])))
    expect(view.parts).toEqual([
      { key: 'profile.buddyReadsOff.rooms', count: 1 },
      { key: 'profile.buddyReadsOff.invitations', count: 2 },
    ])
    expect(view.deleteOption).toBe(true)
  })

  it('has no messages option when only invitations wait: she has written nothing in them', () => {
    const view = turnOffView(turnOffPlan(mine([], ['i'])))
    expect(view.titleKey).toBe('profile.buddyReadsOff.titleInvitations')
    expect(view.actionKey).toBe('profile.buddyReadsOff.actionInvitations')
    expect(view.parts).toEqual([{ key: 'profile.buddyReadsOff.invitations', count: 1 }])
    expect(view.deleteOption).toBe(false)
  })

  it('says under the row how many buddy reads she is in, and nothing for an invitation or an empty list', () => {
    expect(inRoomsHint(mine(['a', 'b']))).toEqual({ key: 'profile.account.buddyReadsIn', count: 2 })
    expect(inRoomsHint(mine([], ['i']))).toBeNull()
    expect(inRoomsHint(null)).toBeNull()
  })
})

describe('leaving and declining', () => {
  const calls = (failOn: Record<string, BuddyErrorCode> = {}) => {
    const log: string[] = []
    return {
      log,
      leave: async (id: string, withMessages: boolean) => (log.push(`leave ${id} ${withMessages}`), { error: failOn[id] ?? null }),
      decline: async (id: string) => (log.push(`decline ${id}`), { error: failOn[id] ?? null }),
    }
  }

  it('leaves the rooms in order, then declines the invitations', async () => {
    const c = calls()
    expect(await leaveAndDecline({ rooms: ['a', 'b'], invitations: ['i', 'j'] }, c, false)).toBeNull()
    expect(c.log).toEqual(['leave a false', 'leave b false', 'decline i', 'decline j'])
  })

  it('hands the delete option to every leave', async () => {
    const c = calls()
    await leaveAndDecline({ rooms: ['a', 'b'], invitations: [] }, c, true)
    expect(c.log).toEqual(['leave a true', 'leave b true'])
  })

  it('stops at the first refusal and answers its code: what is after it is not touched', async () => {
    const c = calls({ b: 'rate_limited' })
    expect(await leaveAndDecline({ rooms: ['a', 'b', 'c'], invitations: ['i'] }, c, false)).toBe('rate_limited')
    expect(c.log).toEqual(['leave a false', 'leave b false'])
  })

  it('stops at a refused invitation too, after the rooms are left', async () => {
    const c = calls({ i: 'offline' })
    expect(await leaveAndDecline({ rooms: ['a'], invitations: ['i', 'j'] }, c, false)).toBe('offline')
    expect(c.log).toEqual(['leave a false', 'decline i'])
  })

  it('does not take "she is not in it any more" for a refusal', async () => {
    const c = calls({ a: 'not_found', i: 'not_found' })
    expect(await leaveAndDecline({ rooms: ['a', 'b'], invitations: ['i'] }, c, false)).toBeNull()
    expect(c.log).toEqual(['leave a false', 'leave b false', 'decline i'])
  })
})

// ------------------------------------------------------------------ the store

/** The fake of stores/buddyRead.ts: a server that knows her reads and invitations, and the four calls the store makes. */
const server = {
  reads: [] as string[],
  invitations: [] as string[],
  /** Ids whose leave is refused, with the code. */
  refuse: {} as Record<string, BuddyErrorCode>,
  loadFails: null as BuddyErrorCode | null,
  log: [] as string[],
}
vi.mock('~/stores/buddyRead', async () => {
  const { reactive } = await import('vue')
  const state = reactive({
    mine: null as MyBuddyReads | null,
    async loadMine() {
      server.log.push('mine')
      if (server.loadFails) return server.loadFails
      state.mine = { reads: server.reads.map((id) => card(id)), invitations: server.invitations.map(invitation) }
      return null
    },
    async leave(id: string, withMessages: boolean) {
      server.log.push(`leave ${id} ${withMessages}`)
      if (server.refuse[id]) return { data: null, error: server.refuse[id] }
      server.reads = server.reads.filter((x) => x !== id)
      // As the real store does: a left read is forgotten from her list at once.
      if (state.mine) state.mine = { ...state.mine, reads: state.mine.reads.filter((x) => x.id !== id) }
      return { data: undefined, error: null }
    },
    async answerInvite(id: string, accept: boolean) {
      server.log.push(`answer ${id} ${accept}`)
      server.invitations = server.invitations.filter((x) => x !== id)
      return { data: undefined, error: null }
    },
  })
  return { useBuddyReadStore: () => state }
})
const invitesReset = vi.fn()
vi.mock('~/stores/buddyInvites', () => ({ useBuddyInvitesStore: () => ({ reset: invitesReset }) }))

describe('the store', () => {
  let device: Map<string, string>

  /** The turn-off store of a member whose device has it on, in a build that carries buddy reads (or not). */
  async function fresh(build: 'on' | 'off' = 'on') {
    device = new Map(build === 'on' ? [[BUDDY_READS_KEY, 'on']] : [])
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('useBuddyReadsFlag', () => build === 'on')
    vi.stubGlobal('window', {
      localStorage: { getItem: (k: string) => device.get(k) ?? null, setItem: (k: string, v: string) => void device.set(k, v), removeItem: (k: string) => void device.delete(k) },
    })
    setActivePinia(createPinia())
    const { useBuddyReadsSwitchStore } = await import('@/stores/buddyReadsSwitch')
    const { useBuddyTurnOffStore } = await import('@/stores/buddyTurnOff')
    const { useBuddyReadStore } = await import('~/stores/buddyRead')
    const buddy = useBuddyReadStore() as unknown as { mine: MyBuddyReads | null }
    buddy.mine = null
    return { turnOff: useBuddyTurnOffStore(), switchStore: useBuddyReadsSwitchStore(), buddy }
  }

  beforeEach(() => {
    vi.unstubAllGlobals()
    Object.assign(server, { reads: [], invitations: [], refuse: {}, loadFails: null, log: [] })
    invitesReset.mockClear()
  })

  it('turns off at once when she is in no room and has no invitation, after reading her list', async () => {
    const { turnOff, switchStore } = await fresh()
    expect(await turnOff.request()).toBe('off')
    expect(server.log).toEqual(['mine'])
    expect(switchStore.enabled).toBe(false)
    expect(device.has(BUDDY_READS_KEY)).toBe(false)
    expect(turnOff.asking).toBe(false)
  })

  it('stays on and asks while she is in a room: nothing is left or declined until she confirms', async () => {
    server.reads = ['a', 'b']
    const { turnOff, switchStore } = await fresh()
    expect(await turnOff.request()).toBe('asking')
    expect(turnOff.asking).toBe(true)
    expect(turnOff.deleteMessages).toBe(false)
    expect(turnOff.view.parts[0]).toEqual({ key: 'profile.buddyReadsOff.rooms', count: 2 })
    expect(switchStore.enabled).toBe(true)
    expect(device.get(BUDDY_READS_KEY)).toBe('on')
    expect(server.log).toEqual(['mine'])
  })

  it('asks for an invitation alone too', async () => {
    server.invitations = ['i']
    const { turnOff, switchStore } = await fresh()
    expect(await turnOff.request()).toBe('asking')
    expect(turnOff.view.deleteOption).toBe(false)
    expect(switchStore.enabled).toBe(true)
  })

  it('reads her list first when it was not loaded: a room joined on another device is found, not missed', async () => {
    const { turnOff, buddy } = await fresh()
    expect(buddy.mine).toBeNull()
    server.reads = ['elsewhere']
    expect(await turnOff.request()).toBe('asking')
    expect(buddy.mine?.reads.map((r) => r.id)).toEqual(['elsewhere'])
  })

  it('reads it fresh every time: a list loaded earlier with no room does not let the switch off', async () => {
    const { turnOff, switchStore, buddy } = await fresh()
    buddy.mine = mine([])
    switchStore.noteRooms(0)
    server.reads = ['joined-on-the-phone']
    expect(await turnOff.request()).toBe('asking')
    expect(switchStore.enabled).toBe(true)
  })

  it('cannot tell without an answer: the switch stays on and says so', async () => {
    server.loadFails = 'offline'
    const { turnOff, switchStore } = await fresh()
    expect(await turnOff.request()).toBe('failed')
    expect(turnOff.checkError).toBe('offline')
    expect(turnOff.asking).toBe(false)
    expect(switchStore.enabled).toBe(true)
  })

  it('the switch store refuses to turn off by itself while the list says she is in a room', async () => {
    server.reads = ['a']
    const { turnOff, switchStore } = await fresh()
    await turnOff.refresh()
    expect(switchStore.canTurnOff).toBe(false)
    expect(switchStore.set(false)).toBe(false)
    expect(switchStore.enabled).toBe(true)
    // And an invitation counts the same; an empty list lets it go.
    server.reads = []
    server.invitations = ['i']
    await turnOff.refresh()
    expect(switchStore.canTurnOff).toBe(false)
    server.invitations = []
    await turnOff.refresh()
    expect(switchStore.canTurnOff).toBe(true)
  })

  it('Leave and turn off: leaves each room in order, keeps her messages, declines the invitations, then turns off', async () => {
    server.reads = ['a', 'b']
    server.invitations = ['i']
    const { turnOff, switchStore } = await fresh()
    await turnOff.request()
    server.log.length = 0
    expect(await turnOff.confirm()).toBe(true)
    expect(server.log).toEqual(['leave a false', 'leave b false', 'answer i false'])
    expect(switchStore.enabled).toBe(false)
    expect(device.has(BUDDY_READS_KEY)).toBe(false)
    expect(turnOff.asking).toBe(false)
    expect(invitesReset).toHaveBeenCalled()
  })

  it('passes "Also delete my messages" to every leave when she ticked it', async () => {
    server.reads = ['a', 'b']
    const { turnOff } = await fresh()
    await turnOff.request()
    turnOff.deleteMessages = true
    server.log.length = 0
    await turnOff.confirm()
    expect(server.log).toEqual(['leave a true', 'leave b true'])
  })

  it('opens unticked every time, whatever she chose before', async () => {
    server.reads = ['a']
    const { turnOff } = await fresh()
    await turnOff.request()
    turnOff.deleteMessages = true
    turnOff.cancel()
    await turnOff.request()
    expect(turnOff.deleteMessages).toBe(false)
  })

  it('Keep on: nothing changes, the switch is still on, nothing was left', async () => {
    server.reads = ['a']
    const { turnOff, switchStore } = await fresh()
    await turnOff.request()
    turnOff.cancel()
    expect(turnOff.asking).toBe(false)
    expect(switchStore.enabled).toBe(true)
    expect(server.log).toEqual(['mine'])
    expect(server.reads).toEqual(['a'])
  })

  it('stops at the first refusal: the room left stays left, the switch stays on, the dialog stays with the failure', async () => {
    server.reads = ['a', 'b', 'c']
    server.refuse = { b: 'rate_limited' }
    const { turnOff, switchStore } = await fresh()
    await turnOff.request()
    server.log.length = 0
    expect(await turnOff.confirm()).toBe(false)
    expect(server.log).toEqual(['leave a false', 'leave b false'])
    expect(turnOff.error).toBe('rate_limited')
    expect(turnOff.asking).toBe(true)
    expect(switchStore.enabled).toBe(true)
    expect(server.reads).toEqual(['b', 'c'])
    // The text now names the two that are left.
    expect(turnOff.view.parts[0]).toEqual({ key: 'profile.buddyReadsOff.rooms', count: 2 })
  })

  it('tries again with the rest only, and turns off when that goes through', async () => {
    server.reads = ['a', 'b']
    server.refuse = { b: 'offline' }
    const { turnOff, switchStore } = await fresh()
    await turnOff.request()
    await turnOff.confirm()
    expect(switchStore.enabled).toBe(true)
    server.refuse = {}
    server.log.length = 0
    expect(await turnOff.confirm()).toBe(true)
    expect(server.log).toEqual(['leave b false'])
    expect(turnOff.error).toBeNull()
    expect(switchStore.enabled).toBe(false)
  })

  it('does nothing when the confirm is not open, and asks nothing in a build without buddy reads', async () => {
    server.reads = ['a']
    const open = await fresh()
    expect(await open.turnOff.confirm()).toBe(false)
    expect(server.log).toEqual([])
    const closed = await fresh('off')
    expect(await closed.turnOff.request()).toBe('failed')
    expect(await closed.turnOff.refresh()).toBeNull()
    expect(server.log).toEqual([])
  })
})

describe('the Profile', () => {
  const account = readFileSync(new URL('../app/components/profile/Account.vue', import.meta.url), 'utf8')

  it('asks the question instead of switching off, and builds the asking store only in a build that carries the feature, from a lazy import', () => {
    // The store (and the chat layer under it) is imported when it is needed, never statically: with the flag off nothing of it loads.
    expect(account).not.toMatch(/^import \{[^}]*useBuddyTurnOffStore[^}]*\} from/m)
    expect(account).toMatch(/import type \{ useBuddyTurnOffStore \} from '~\/stores\/buddyTurnOff'/)
    expect(account).toMatch(/if \(!turnOff\.value && buddyReads\.available\) turnOff\.value = \(await import\('~\/stores\/buddyTurnOff'\)\)\.useBuddyTurnOffStore\(\)/)
    expect(account).toMatch(/else void turnOffStore\(\)\.then\(\(store\) => store\?\.request\(\)\)/)
    expect(account).not.toMatch(/buddyReads\.set\(on\)/)
    expect(account).toMatch(/<LazyProfileBuddyReadsOff v-if="turnOff" \/>/)
  })

  it('reads her rooms only with the switch on', () => {
    expect(account).toMatch(/if \(buddyReads\.available && buddyReads\.enabled\) void turnOffStore\(\)\.then\(\(store\) => store\?\.refresh\(\)\)/)
  })
})
