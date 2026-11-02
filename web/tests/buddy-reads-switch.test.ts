import { createPinia, setActivePinia } from 'pinia'
import { computed, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearLocalData, forgetMemberData, LOCAL_DATA_PREFIX, type DeviceStorage } from '@/data/localData'
import {
  BUDDY_READS_DEFAULT_ON,
  BUDDY_READS_KEY,
  parseBuddyReads,
  readBuddyReads,
  writeBuddyReads,
} from '@/utils/buddyReadsSwitch'

/**
 * Buddy reads (Profile → Account → Buddy reads): off by default in the first release, on when she turns
 * it on, kept on this device under `libellus.` so signing out puts it back to the default. The setting's
 * rule is framework-free (utils/buddyReadsSwitch.ts); the store is what the Profile's switch and, later,
 * the entry points read, run here with the auto-imports it uses stood in for.
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
  it('is off unless it was turned on, and off for every value that is not one of the two', () => {
    expect(BUDDY_READS_DEFAULT_ON).toBe(false)
    expect(parseBuddyReads(null)).toBe(false)
    expect(parseBuddyReads(undefined)).toBe(false)
    expect(parseBuddyReads('')).toBe(false)
    expect(parseBuddyReads('off')).toBe(false)
    expect(parseBuddyReads('nonsense')).toBe(false)
    expect(parseBuddyReads('ON')).toBe(false)
    expect(parseBuddyReads('on')).toBe(true)
  })

  it('is off for a device that never stored anything (a new member, an existing one)', () => {
    expect(readBuddyReads(storage())).toBe(false)
  })

  it('persists on, and off again as nothing stored', () => {
    const device = storage()
    writeBuddyReads(device, true)
    expect(device.items.get(BUDDY_READS_KEY)).toBe('on')
    expect(readBuddyReads(device)).toBe(true)
    writeBuddyReads(device, false)
    expect(device.items.has(BUDDY_READS_KEY)).toBe(false)
    expect(readBuddyReads(device)).toBe(false)
  })

  it('is off when storage cannot be read or written, and holds for the visit', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    }
    expect(readBuddyReads(blocked)).toBe(false)
    expect(() => writeBuddyReads(blocked, true)).not.toThrow()
    expect(() => writeBuddyReads(blocked, false)).not.toThrow()
  })

  it('is cleared by signing out, with the rest of what the device kept of the member', async () => {
    expect(BUDDY_READS_KEY.startsWith(LOCAL_DATA_PREFIX)).toBe(true)
    const device = storage({ [BUDDY_READS_KEY]: 'on' })
    expect(clearLocalData(device)).toContain(BUDDY_READS_KEY)
    expect(readBuddyReads(device)).toBe(false)

    const again = storage({ [BUDDY_READS_KEY]: 'on' })
    await forgetMemberData({ storage: again })
    expect(readBuddyReads(again)).toBe(false)
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
    const { useBuddyReadsSwitchStore } = await import('@/stores/buddyReadsSwitch')
    return useBuddyReadsSwitchStore()
  }

  beforeEach(() => vi.unstubAllGlobals())

  it('starts off on a fresh device, and off when the device stores nothing it knows', async () => {
    expect((await fresh()).enabled).toBe(false)
    expect((await fresh({ [BUDDY_READS_KEY]: 'yes please' })).enabled).toBe(false)
  })

  it('starts on when the device kept it on', async () => {
    expect((await fresh({ [BUDDY_READS_KEY]: 'on' })).enabled).toBe(true)
  })

  it('turns on and off at once and stores the choice', async () => {
    const store = await fresh()
    expect(store.set(true)).toBe(true)
    expect(store.enabled).toBe(true)
    expect(device.items.get(BUDDY_READS_KEY)).toBe('on')
    expect(store.set(false)).toBe(true)
    expect(store.enabled).toBe(false)
    expect(device.items.has(BUDDY_READS_KEY)).toBe(false)
  })

  it('refuses to turn off while she is in an active buddy read, and changes nothing', async () => {
    const store = await fresh({ [BUDDY_READS_KEY]: 'on' })
    store.canTurnOff = false
    expect(store.set(false)).toBe(false)
    expect(store.enabled).toBe(true)
    expect(device.items.get(BUDDY_READS_KEY)).toBe('on')
    // On is never refused.
    expect(store.set(true)).toBe(true)
  })

  it('is off again once the device forgot the member (sign-out), without a reload', async () => {
    const store = await fresh()
    store.set(true)
    await forgetMemberData({ storage: device })
    store.reload()
    expect(store.enabled).toBe(false)
    expect(store.canTurnOff).toBe(true)
  })
})
