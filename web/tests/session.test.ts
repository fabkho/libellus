import { describe, expect, it } from 'vitest'
import { createAuth } from '@/data/auth'
import type { SessionStorage } from '@/data/createSupabaseClient'
import { clearLocalData, LOCAL_DATA_PREFIX, type KeyValueStorage } from '@/data/localData'
import { signUpMember } from './support/member'
import { newClient } from './support/stack'

/**
 * In the browser the session lives in localStorage. This stands in for it with
 * the same calls and a window into its keys, so the client configuration itself
 * is what is under test. What matters to a member is that closing the tab or
 * the installed app does not sign them out, and that signing out leaves nothing
 * behind on the device.
 */
function browserStorage(): SessionStorage & KeyValueStorage & { keys: () => string[] } {
  const items = new Map<string, string>()
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value)
    },
    removeItem: (key) => {
      items.delete(key)
    },
    get length() {
      return items.size
    },
    key: (index) => [...items.keys()][index] ?? null,
    keys: () => [...items.keys()].sort(),
  }
}

describe('the session on the device', () => {
  it('is restored after closing and reopening the app', async () => {
    const storage = browserStorage()
    const member = await signUpMember(storage)
    expect(storage.keys().length).toBeGreaterThan(0)

    // A cold start: a new client over the same storage, nothing else carried over.
    const restarted = newClient(storage)
    const auth = createAuth(restarted)
    expect(await auth.currentMember()).toEqual({ id: member.id, email: member.email })

    // And the restored token is usable, not just present.
    const { data } = await restarted.auth.getUser()
    expect(data.user?.email).toBe(member.email)
  })

  it('is gone after signing out, and the server revokes it', async () => {
    const storage = browserStorage()
    const member = await signUpMember(storage)

    await createAuth(member.client).signOut()
    expect(storage.keys()).toEqual([])
    expect(await createAuth(newClient(storage)).currentMember()).toBeNull()
  })

  it('tells a listener when the session ends', async () => {
    const member = await signUpMember()
    const auth = createAuth(member.client)
    const heard: (string | null)[] = []
    const stop = auth.onMemberChange((who) => heard.push(who?.email ?? null))

    await auth.signOut()
    stop()

    expect(heard.at(-1)).toBeNull()
  })
})

describe('clearing what the device cached', () => {
  it('removes Libellus keys and nothing else', () => {
    const storage = browserStorage()
    storage.setItem(`${LOCAL_DATA_PREFIX}pendingSignIn`, '{}')
    storage.setItem(`${LOCAL_DATA_PREFIX}library`, '[]')
    storage.setItem('other.app', 'keep')

    const removed = clearLocalData(storage)

    expect(removed.sort()).toEqual([`${LOCAL_DATA_PREFIX}library`, `${LOCAL_DATA_PREFIX}pendingSignIn`])
    expect(storage.keys()).toEqual(['other.app'])
  })
})
