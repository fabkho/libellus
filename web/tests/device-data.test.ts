import { describe, expect, it } from 'vitest'
import {
  DEVICE_COLLECTIONS_KEY,
  DEVICE_DESCRIPTIONS_KEY,
  DEVICE_LIBRARY_KEY,
  DEVICE_STATS_KEY,
  readDescriptions,
  readLibrary,
  readSavedMember,
  saveDescriptions,
  saveLibrary,
} from '@/data/deviceLibrary'
import { DEVICE_FEED_KEY } from '@/data/feed'
import { DEVICE_ENRICH_KEY } from '@/data/enrich/device'
import { DEVICE_GENRES_KEY } from '@/data/enrich/deviceGenres'
import { EBOOKS_SNAPSHOT_KEY, readEbooksSnapshot, saveEbooksSnapshot } from '@/data/ebooks/snapshot'
import { DEVICE_LINK_TEMPLATES_KEY } from '@/data/linkTemplates'
import { LIBRARY_VIEW_KEY, newLibraryViews, readLibraryViews, saveLibraryViews } from '@/data/libraryView'
import {
  clearLocalDatabase,
  BUDDY_QUEUE_PREFIX,
  clearLocalFiles,
  forgetMemberData,
  LOCAL_DATABASE,
  LOCAL_STORES,
  MEMBER_KEYS_OUTSIDE_PREFIX,
  openLocalDatabase,
  otherMemberHere,
  OUTBOX_OWNER_KEY,
  type DeviceEnvironment,
  type DeviceStorage,
} from '@/data/localData'
import { BUDDY_QUEUE_PREFIX as QUEUE_PREFIX_OF_STORAGE, buddyPeekKey, buddyQueueKey } from '@/utils/buddyStorage'
import { IMPORT_HINT_KEY, readImportHint, writeImportHint } from '@/utils/importHint'
import { PENDING_BUDDY_READ_KEY } from '@/utils/pendingBuddyRead'
import { PENDING_FOLLOW_KEY } from '@/utils/pendingFollow'
import { PENDING_SHARE_KEY } from '@/utils/pendingShare'
import { CODE_SENT_KEY, keepCodeSent, whoIs } from '@/utils/codeCooldown'
import { PENDING_SIGN_IN_KEY } from '@/utils/signedOutRoute'

/**
 * What the device keeps of a member and what forgets it (security round, F10 and F11): signing out,
 * deleting the account, a session that died by itself and another member signing in on the same
 * device. Pure: the browser's storages are in memory here, and one `forgetMemberData` is what the
 * session store runs.
 */

function storage(): DeviceStorage & { keys: () => string[]; all: () => string } {
  const items = new Map<string, string>()
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
    get length() {
      return items.size
    },
    key: (index) => [...items.keys()][index] ?? null,
    keys: () => [...items.keys()].sort(),
    all: () => JSON.stringify([...items.entries()]),
  }
}

/** Cache Storage: named caches, each a set of addresses. */
function cacheStorage(names: string[]) {
  const held = new Set(names)
  return { held, delete: async (name: string) => held.delete(name) }
}

/** IndexedDB, as far as the device's database needs it: databases of stores of records. */
function indexedDb() {
  const databases = new Map<string, Map<string, Map<unknown, unknown>>>()
  const later = (run: () => void) => void queueMicrotask(run)
  const factory = {
    databases,
    deleteDatabase(name: string) {
      const req = {} as IDBOpenDBRequest
      later(() => {
        databases.delete(name)
        req.onsuccess?.(new Event('success'))
      })
      return req
    },
    open(name: string) {
      const req = {} as IDBOpenDBRequest
      later(() => {
        const fresh = !databases.has(name)
        const stores = databases.get(name) ?? new Map<string, Map<unknown, unknown>>()
        databases.set(name, stores)
        const db = {
          get objectStoreNames() {
            return Object.assign([...stores.keys()], { contains: (store: string) => stores.has(store) }) as unknown as DOMStringList
          },
          createObjectStore(store: string) {
            stores.set(store, new Map())
            return { createIndex: () => undefined }
          },
          transaction(names: string[]) {
            const tx = {} as IDBTransaction
            later(() => {
              for (const store of names) stores.get(store)!.clear()
              tx.oncomplete?.(new Event('complete'))
            })
            return Object.assign(tx, { objectStore: (store: string) => ({ clear: () => void stores.get(store)!.clear() }) })
          },
          close: () => undefined,
        }
        Object.defineProperty(req, 'result', { value: db })
        if (fresh) req.onupgradeneeded?.(new Event('upgradeneeded') as IDBVersionChangeEvent)
        req.onsuccess?.(new Event('success'))
      })
      return req
    },
  }
  return factory as unknown as IDBFactory & { databases: typeof databases }
}

const A = { id: 'aaaaaaaa-0000-4000-8000-00000000000a', email: 'ada.private@libellus.test', name: 'Ada' }
const B = { id: 'bbbbbbbb-0000-4000-8000-00000000000b', email: 'ben@libellus.test' }

const emptyLists = { want_to_read: [], reading: [], finished: [] }

/** Member A has used this device: every kind of thing the app keeps for a member is on it. */
function memberAUsedTheDevice() {
  const local = storage()
  saveLibrary(local, { member: A, lists: { ...emptyLists, reading: [{ id: 'e1', book: { title: 'PRIVATE TITLE OF ADA' } } as never] }, readInYear: null })
  saveDescriptions(local, A.id, { b1: 'PRIVATE DESCRIPTION OF ADA' })
  saveEbooksSnapshot(local, A.id, { records: [{ id: 'f1', state: 'linked', name: 'ADAS-PRIVATE-BOOK.epub' } as never], missing: new Set(), folder: null })
  saveLibraryViews(local, A.id, { ...newLibraryViews(), reading: { ...newLibraryViews().reading, readAs: ['ebook'] } })
  writeImportHint(local, A.id, 'dismissed')
  // The rest of what is kept under `libellus.`, as the stores write it.
  for (const key of [DEVICE_COLLECTIONS_KEY, DEVICE_STATS_KEY, DEVICE_ENRICH_KEY, DEVICE_GENRES_KEY, DEVICE_FEED_KEY, DEVICE_LINK_TEMPLATES_KEY]) {
    local.setItem(key, JSON.stringify({ memberId: A.id, note: 'PRIVATE DATA OF ADA' }))
  }
  local.setItem(`libellus.reader.place.${A.id}.e1`, '{"cfi":"PRIVATE PLACE OF ADA"}')
  local.setItem(`libellus.reader.highlights.${A.id}.e1`, '[{"text":"PRIVATE HIGHLIGHT OF ADA"}]')
  // What is not hers: the device's settings and the intents that wait for a sign-in.
  local.setItem('libellus-theme', 'dark')
  local.setItem('libellus-glass', '2')
  local.setItem('libellus-install-hint', '1')
  local.setItem('libellus-reader', '{"size":3}')
  local.setItem(PENDING_SIGN_IN_KEY, '{"email":"someone@libellus.test"}')
  local.setItem(PENDING_SHARE_KEY, '{"title":"x"}')
  local.setItem(PENDING_FOLLOW_KEY, '{"code":"x"}')
  // A buddy read: her unsent messages (the send queue, one key a tab), the Sections she opened anyway, and a link opened signed out that waits for a sign-in.
  local.setItem(`${buddyQueueKey(A.id)}.tab1`, JSON.stringify({ v: 1, jobs: [{ id: 'j1', key: 'send:c1', attempts: 0, payload: { conversationId: 'r', threadId: null, clientId: 'c1', body: 'Unsent hello' } }], refusals: [] }))
  local.setItem(buddyPeekKey(A.id), JSON.stringify(['section-9']))
  local.setItem(PENDING_BUDDY_READ_KEY, JSON.stringify({ token: 'AbCdEfGhIjKlMnOpQrStUv', at: 1 }))

  const databases = indexedDb()
  const stores = new Map(Object.keys(LOCAL_STORES).map((name) => [name, new Map<unknown, unknown>([[A.id, `PRIVATE ${name} OF ADA`]])]))
  databases.databases.set(LOCAL_DATABASE, stores)
  databases.databases.set('workbox-expiration', new Map([['cache-entries', new Map([['covers', 'https://covers.openlibrary.org/ada-private-search.jpg']])]]))

  const caches = cacheStorage(['libellus-covers', 'libellus-cover-cache', 'libellus-own-covers', 'libellus-portraits', 'libellus-shared-ebooks', 'libellus-reader', 'libellus-barcode-decoder'])
  let removed: string[] = []
  const files = { getDirectory: async () => ({ removeEntry: async (name: string) => void removed.push(name) }) as unknown as FileSystemDirectoryHandle }
  const env: DeviceEnvironment = { storage: local, indexedDB: databases, caches, files }
  return { local, databases, caches, env, removed: () => removed, stores }
}

const DEVICE_SETTINGS = ['libellus-glass', 'libellus-install-hint', 'libellus-reader', 'libellus-theme']
const WAITING = [PENDING_BUDDY_READ_KEY, PENDING_FOLLOW_KEY, PENDING_SHARE_KEY, PENDING_SIGN_IN_KEY]
/** What a dead session leaves of her buddy reads: the line of unsent messages, never the peeks. */
const LINE = `${buddyQueueKey(A.id)}.tab1`

describe('signing out (F10)', () => {
  it('leaves nothing of the member: every key, the database, the files, the browsed covers and their expiry list', async () => {
    const device = memberAUsedTheDevice()
    expect(readLibrary(device.local, A.id)).not.toBeNull()

    await forgetMemberData(device.env)

    // Only the device's own settings stay; not even a waiting intent does.
    expect(device.local.keys()).toEqual(DEVICE_SETTINGS)
    expect(device.databases.databases.has(LOCAL_DATABASE)).toBe(false)
    expect(device.databases.databases.has('workbox-expiration')).toBe(false)
    expect(device.removed()).toEqual(['ebooks'])
    // The app's own files are the same for everyone and stay: a book opens offline after the next sign-in too.
    expect([...device.caches.held].sort()).toEqual(['libellus-barcode-decoder', 'libellus-reader'])
    expect(device.local.all()).not.toMatch(/ADA|ada\.private|PRIVATE/i)
  })

  it('keeps when a code was last mailed, for the 20 s window of the server that it describes, with no address in it', async () => {
    const device = memberAUsedTheDevice()
    keepCodeSent(device.local, { who: whoIs(A.email), at: Date.now(), used: true })

    await forgetMemberData(device.env)

    expect(device.local.keys()).toEqual([...DEVICE_SETTINGS, CODE_SENT_KEY].sort())
    expect(device.local.all()).not.toMatch(/ada/i)
  })

  it('names the member-keyed keys outside the prefix as their owners do', () => {
    expect([...MEMBER_KEYS_OUTSIDE_PREFIX].sort()).toEqual([IMPORT_HINT_KEY, LIBRARY_VIEW_KEY].sort())
  })

  it('clears the two member-keyed keys outside the prefix, and no other key outside it', async () => {
    const device = memberAUsedTheDevice()
    await forgetMemberData(device.env)
    expect(device.local.getItem(IMPORT_HINT_KEY)).toBeNull()
    expect(device.local.getItem(LIBRARY_VIEW_KEY)).toBeNull()
    expect(device.local.getItem('libellus-theme')).toBe('dark')
  })

  it('also empties the browsed covers on their own (clearLocalFiles)', async () => {
    const caches = cacheStorage(['libellus-covers', 'libellus-cover-cache', 'libellus-own-covers', 'libellus-portraits', 'libellus-reader'])
    await clearLocalFiles({ caches })
    expect([...caches.held]).toEqual(['libellus-reader'])
  })
})

describe('deleting the account (#101)', () => {
  it('clears when a code was last mailed as well: nothing of hers outlives the account', async () => {
    const device = memberAUsedTheDevice()
    keepCodeSent(device.local, { who: whoIs(A.email), at: Date.now(), used: true })

    await forgetMemberData(device.env, { accountDeleted: true })

    expect(device.local.keys()).toEqual(DEVICE_SETTINGS)
    expect(device.local.all()).not.toMatch(/ADA|ada\.private|PRIVATE/i)
  })

  it('keeps what a plain keep list names, but never the code that was mailed', async () => {
    const device = memberAUsedTheDevice()
    keepCodeSent(device.local, { who: whoIs(A.email), at: Date.now(), used: true })

    await forgetMemberData(device.env, { accountDeleted: true, keep: WAITING })

    expect(device.local.keys()).toEqual([...DEVICE_SETTINGS, ...WAITING].sort())
  })
})

describe('a session that ended by itself (F11)', () => {
  it('forgets the member as a sign-out does, but keeps what waits for a sign-in and her unsynced writes', async () => {
    const device = memberAUsedTheDevice()

    await forgetMemberData(device.env, { sessionEnded: true, memberId: A.id, keep: WAITING })

    expect(device.local.keys()).toEqual([...DEVICE_SETTINGS, OUTBOX_OWNER_KEY, LINE, ...WAITING].sort())
    // Her Library, her descriptions, her ebook records: gone. Her outbox: kept.
    expect(readSavedMember(device.local)).toBeNull()
    expect(readDescriptions(device.local, A.id)).toBeNull()
    expect(device.stores.get('outbox')!.size).toBe(1)
    for (const store of Object.keys(LOCAL_STORES).filter((name) => name !== 'outbox')) expect(device.stores.get(store)!.size).toBe(0)
    expect(device.databases.databases.has('workbox-expiration')).toBe(false)
    expect([...device.caches.held].sort()).toEqual(['libellus-barcode-decoder', 'libellus-reader'])
    expect(device.removed()).toEqual(['ebooks'])
    // What stayed shows nothing of her: no title, description or address of hers.
    expect(device.local.all()).not.toMatch(/ada\.private|PRIVATE/i)
  })

  it('keeps the outbox only for her: another member signing in clears all of it', async () => {
    const device = memberAUsedTheDevice()
    await forgetMemberData(device.env, { sessionEnded: true, memberId: A.id, keep: WAITING })

    expect(otherMemberHere(device.local, A.id, readSavedMember(device.local)?.id ?? null)).toBe(false)
    expect(otherMemberHere(device.local, B.id, readSavedMember(device.local)?.id ?? null)).toBe(true)

    await forgetMemberData(device.env)
    expect(device.databases.databases.has(LOCAL_DATABASE)).toBe(false)
    expect(device.local.getItem(OUTBOX_OWNER_KEY)).toBeNull()
  })

  it('empties the stores but one without deleting the database (clearLocalDatabase keep)', async () => {
    const databases = indexedDb()
    const db = await openLocalDatabase(databases)
    db.close()
    for (const store of databases.databases.get(LOCAL_DATABASE)!.values()) store.set('k', 'v')
    await clearLocalDatabase(databases, LOCAL_DATABASE, { keep: ['outbox'] })
    const stores = databases.databases.get(LOCAL_DATABASE)!
    expect(stores.get('outbox')!.size).toBe(1)
    expect(stores.get('ebooks')!.size).toBe(0)
  })
})

describe('another member signing in on the same device (F11)', () => {
  const kinds = ['sign-out', 'dead session'] as const
  for (const kind of kinds) {
    it(`never shows the previous member’s data after a ${kind}`, async () => {
      const device = memberAUsedTheDevice()
      await forgetMemberData(device.env, kind === 'sign-out' ? {} : { sessionEnded: true, memberId: A.id, keep: WAITING })

      // B signs in: whatever the stores read for her is hers (nothing yet), and nothing of Ada's is on the device.
      const savedId = readSavedMember(device.local)?.id ?? null
      if (otherMemberHere(device.local, B.id, savedId)) await forgetMemberData(device.env)
      expect(readLibrary(device.local, B.id)).toBeNull()
      expect(readLibrary(device.local, A.id)).toBeNull()
      expect(readDescriptions(device.local, B.id)).toBeNull()
      expect(readEbooksSnapshot(device.local, B.id)).toBeNull()
      expect(readLibraryViews(device.local, B.id)).toEqual(newLibraryViews())
      expect(readImportHint(device.local, B.id)).toBeNull()
      expect(device.local.all()).not.toMatch(/ada|PRIVATE/i)
      for (const store of device.databases.databases.get(LOCAL_DATABASE)?.values() ?? []) expect(store.size).toBe(0)
    })
  }

  it('is also true when the device still holds her Library and B signs in over it (an old device, another tab)', async () => {
    const device = memberAUsedTheDevice()
    expect(otherMemberHere(device.local, B.id, readSavedMember(device.local)?.id ?? null)).toBe(true)
    expect(otherMemberHere(device.local, A.id, readSavedMember(device.local)?.id ?? null)).toBe(false)
    await forgetMemberData(device.env)
    expect(device.local.all()).not.toMatch(/ada|PRIVATE/i)
  })
})

describe('what a buddy read keeps on the device', () => {
  const kept = (device: ReturnType<typeof memberAUsedTheDevice>) => device.local.keys().filter((key) => key.startsWith('libellus.buddyRead.') || key === PENDING_BUDDY_READ_KEY)

  it('is what the storage layer says it is: one prefix for the queue, one key for the peeks', () => {
    expect(buddyQueueKey(A.id).startsWith(BUDDY_QUEUE_PREFIX)).toBe(true)
    // The shell's sign-out writes the prefix itself (it does not carry the storage file): the two are one.
    expect(BUDDY_QUEUE_PREFIX).toBe(QUEUE_PREFIX_OF_STORAGE)
    expect(buddyPeekKey(A.id)).toBe(`libellus.buddyRead.peeks.${A.id}`)
  })

  it('is forgotten when she signs out: the unsent messages, the peeks, and not even a waiting link', async () => {
    const device = memberAUsedTheDevice()
    expect(kept(device)).toHaveLength(3)
    await forgetMemberData(device.env)
    expect(kept(device)).toEqual([])
    expect(device.local.all()).not.toMatch(/Unsent hello|section-9/)
  })

  it('is forgotten when another member signs in over it, but the link she opened to get here stays', async () => {
    const device = memberAUsedTheDevice()
    // A's session died: her line stays, for her.
    await forgetMemberData(device.env, { sessionEnded: true, memberId: A.id, keep: WAITING })
    expect(kept(device).sort()).toEqual([LINE, PENDING_BUDDY_READ_KEY].sort())
    // B signs in: the device holds A's, so it is cleared first (stores/session.ts `signedInAs`), keeping B's link.
    expect(otherMemberHere(device.local, B.id, readSavedMember(device.local)?.id ?? null)).toBe(true)
    await forgetMemberData(device.env, { keepForNext: [PENDING_BUDDY_READ_KEY] })
    expect(kept(device)).toEqual([PENDING_BUDDY_READ_KEY])
    expect(device.local.all()).not.toMatch(/Unsent hello|section-9/)
  })

  it('does not take the waiting link with it into a sign-out or another member’s clearing unless told to', async () => {
    const device = memberAUsedTheDevice()
    await forgetMemberData(device.env, { keepForNext: [] })
    expect(device.local.getItem(PENDING_BUDDY_READ_KEY)).toBeNull()
  })

  it('keeps her unsent messages through a session that died, and sends them for her only: the line is keyed by her id and the outbox owner is hers', async () => {
    const device = memberAUsedTheDevice()
    await forgetMemberData(device.env, { sessionEnded: true, memberId: A.id, keep: WAITING })
    // The line, not the peeks: a peek is a choice of a session, a message is words she wrote.
    expect(device.local.getItem(LINE)).toContain('Unsent hello')
    expect(device.local.getItem(buddyPeekKey(A.id))).toBeNull()
    expect(device.local.getItem(OUTBOX_OWNER_KEY)).toBe(A.id)
    expect(otherMemberHere(device.local, A.id, readSavedMember(device.local)?.id ?? null)).toBe(false)
  })

  it('deleting the account takes the line too: nothing of hers outlives it', async () => {
    const device = memberAUsedTheDevice()
    await forgetMemberData(device.env, { accountDeleted: true })
    expect(kept(device)).toEqual([])
  })
})

// Referenced so the key lists above stay in step with the owners'.
void [DEVICE_LIBRARY_KEY, DEVICE_DESCRIPTIONS_KEY, EBOOKS_SNAPSHOT_KEY]
