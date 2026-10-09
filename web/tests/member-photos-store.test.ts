import { createPinia, setActivePinia } from 'pinia'
import { computed, reactive, ref, watch } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * A member's photo after she is blocked, unfollowed or removed (social v1, gate 2, P2): `drop` revokes her
 * object URLs and deletes her record from the device's cache, with the auto-imports stood in.
 */

const written: [string, unknown][] = []
const cache = {
  read: async () => null,
  write: async (id: string, photo: unknown) => void written.push([id, photo]),
}
let downloads = 0
vi.mock('~/data/avatar', async (original) => ({
  ...(await original<typeof import('~/data/avatar')>()),
  createAvatar: () => ({ download: async () => (downloads++, { data: { small: new Blob(['s']), large: new Blob(['l']) }, error: null }) }),
  memoryAvatarCache: () => cache,
}))
vi.mock('~/stores/session', () => ({ useSessionStore: () => reactive({ member: { id: 'ada' } }) }))

async function store() {
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('useBackend', () => ({}))
  vi.stubGlobal('isOnline', () => true)
  setActivePinia(createPinia())
  const { useMemberPhotosStore } = await import('~/stores/memberPhotos')
  return useMemberPhotosStore()
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 10))
const ida = { id: 'ida', name: 'Ida', photo: 'ida/photo.jpg' }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  written.length = 0
  downloads = 0
})

describe('drop', () => {
  it('revokes her object URLs and deletes her record from the device', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const photos = await store()
    photos.photoOf(ida)
    await flush()
    const url = photos.photoOf(ida)
    expect(url).toMatch(/^blob:/)
    expect(written.at(-1)?.[0]).toBe('ida')

    written.length = 0
    photos.drop('ida')
    expect(revoke).toHaveBeenCalledWith(url)
    expect(written).toEqual([['ida', null]])
  })

  it('throws away a download that was on its way when she was dropped', async () => {
    const photos = await store()
    photos.photoOf(ida)
    // The run has begun (it waits on the cache) when she is dropped.
    await Promise.resolve()
    photos.drop('ida')
    await flush()
    expect(downloads).toBe(0)
    // Nothing of that download is shown or kept (the next ask starts afresh).
    expect(written.filter(([, photo]) => photo !== null)).toEqual([])
  })
})
