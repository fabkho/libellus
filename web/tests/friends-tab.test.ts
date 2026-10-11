import { createPinia, setActivePinia } from 'pinia'
import { computed, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearLocalData, forgetMemberData, LOCAL_DATA_PREFIX, type DeviceStorage } from '@/data/localData'
import { FRIENDS_TAB_KEY, parseFriendsTab, readFriendsTab, TABS, visibleTabs, writeFriendsTab } from '@/utils/friendsTab'
import { createTabPlaces, TAB_ROOTS } from '@/utils/tabPlaces'

/**
 * The Friends tab (Profile → Account → Friends tab): on by default for every member, off when she turns
 * it off, kept on this device under `libellus.` so signing out puts it back to on. The setting's rule is
 * framework-free (utils/friendsTab.ts); the store is what the tab bar, the palette's tabs, the Profile's
 * switch and the route middleware read, run here with the auto-imports it uses stood in for.
 */

/** The device's storage: a map, the slice of Storage the setting and `clearLocalData` need. */
function storage(initial: Record<string, string> = {}): DeviceStorage & { items: Map<string, string> } {
  const items = new Map(Object.entries(initial))
  return {
    items,
    get length() {
      return items.size
    },
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  }
}

describe('the setting', () => {
  it('is on unless it was turned off', () => {
    expect(parseFriendsTab(null)).toBe(true)
    expect(parseFriendsTab(undefined)).toBe(true)
    expect(parseFriendsTab('')).toBe(true)
    expect(parseFriendsTab('on')).toBe(true)
    expect(parseFriendsTab('nonsense')).toBe(true)
    expect(parseFriendsTab('off')).toBe(false)
  })

  it('is on for a device that never stored anything (a new member, an existing one)', () => {
    expect(readFriendsTab(storage())).toBe(true)
  })

  it('persists off, and on again as nothing stored', () => {
    const device = storage()
    writeFriendsTab(device, false)
    expect(device.items.get(FRIENDS_TAB_KEY)).toBe('off')
    expect(readFriendsTab(device)).toBe(false)
    writeFriendsTab(device, true)
    expect(device.items.has(FRIENDS_TAB_KEY)).toBe(false)
    expect(readFriendsTab(device)).toBe(true)
  })

  it('is on when storage cannot be read or written, and holds for the visit', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(readFriendsTab(blocked)).toBe(true)
    expect(() => writeFriendsTab(blocked, false)).not.toThrow()
  })

  it('is cleared by signing out, with the rest of what the device kept of the member', async () => {
    expect(FRIENDS_TAB_KEY.startsWith(LOCAL_DATA_PREFIX)).toBe(true)
    const device = storage({ [FRIENDS_TAB_KEY]: 'off' })
    expect(clearLocalData(device)).toContain(FRIENDS_TAB_KEY)
    expect(readFriendsTab(device)).toBe(true)

    const again = storage({ [FRIENDS_TAB_KEY]: 'off' })
    await forgetMemberData({ storage: again })
    expect(readFriendsTab(again)).toBe(true)
  })
})

describe('the tab list', () => {
  it('is Home, Library, Friends: Friends after Library, Search being the bar’s own', () => {
    expect(visibleTabs(true).map((tab) => tab.key)).toEqual(['home', 'library', 'friends'])
    expect(visibleTabs(true).map((tab) => tab.to)).toEqual(['/', '/library', '/friends'])
    expect(TABS.map((tab) => tab.key)).toEqual(['home', 'library', 'friends'])
  })

  it('has no Friends with the setting off, and keeps Home and Library', () => {
    expect(visibleTabs(false).map((tab) => tab.key)).toEqual(['home', 'library'])
  })

  it('draws the people icon for Friends', () => {
    expect(visibleTabs(true).find((tab) => tab.key === 'friends')?.icon).toBe('people')
  })

  it('keeps a place for /friends only while it is a tab', () => {
    expect(TAB_ROOTS).toContain('/friends')
    const places = createTabPlaces()
    places.leave('/friends', 480)
    expect(places.arrive({ to: '/friends', fromShell: true, saved: null })).toEqual({ left: 0, top: 480 })
    // Pushed (the tab is off): it opens at the top and is not remembered.
    places.leave('/friends', 900, true)
    expect(places.arrive({ to: '/friends', fromShell: true, saved: null, pushed: true })).toEqual({ left: 0, top: 0 })
    expect(places.arrive({ to: '/friends', fromShell: true, saved: null })).toEqual({ left: 0, top: 480 })
  })
})

describe('the store', () => {
  let device: ReturnType<typeof storage>

  async function fresh(initial: Record<string, string> = {}) {
    device = storage(initial)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('window', { localStorage: device })
    setActivePinia(createPinia())
    const { useFriendsTabStore } = await import('@/stores/friendsTab')
    return useFriendsTabStore()
  }

  beforeEach(() => vi.unstubAllGlobals())

  it('starts on, with the three tabs', async () => {
    const store = await fresh()
    expect(store.enabled).toBe(true)
    expect(store.tabs.map((tab) => tab.key)).toEqual(['home', 'library', 'friends'])
  })

  it('starts off when the device kept it off', async () => {
    const store = await fresh({ [FRIENDS_TAB_KEY]: 'off' })
    expect(store.enabled).toBe(false)
    expect(store.tabs.map((tab) => tab.key)).toEqual(['home', 'library'])
  })

  it('turns off and on at once and stores the choice', async () => {
    const store = await fresh()
    store.set(false)
    expect(store.tabs.map((tab) => tab.key)).toEqual(['home', 'library'])
    expect(device.items.get(FRIENDS_TAB_KEY)).toBe('off')
    store.set(true)
    expect(store.tabs.map((tab) => tab.key)).toEqual(['home', 'library', 'friends'])
    expect(device.items.has(FRIENDS_TAB_KEY)).toBe(false)
  })

  it('is on again once the device forgot the member (sign-out), without a reload', async () => {
    const store = await fresh()
    store.set(false)
    await forgetMemberData({ storage: device })
    store.reload()
    expect(store.enabled).toBe(true)
  })
})
