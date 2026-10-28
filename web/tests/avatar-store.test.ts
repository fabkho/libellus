import { createPinia, setActivePinia } from 'pinia'
import { reactive, ref, watch } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Her own photo in the avatar store (stores/avatar.ts): `small` and `large` are published only once their pictures
 * are decoded (a header mounted with a blob WebKit has not decoded yet drew the initials first), the decoded images
 * are kept, and an old object URL is revoked only after the new ones are out, never while an avatar may still use it.
 */

const session = reactive<{ member: { id: string } | null }>({ member: { id: 'ada' } })
let kept: unknown = null
const cache = { read: async () => kept, write: async () => {} }
let saved = { data: { path: 'ada/new.webp' }, error: null as null | string }
vi.mock('~/data/avatar', async (original) => ({
  ...(await original<typeof import('~/data/avatar')>()),
  createAvatar: () => ({ save: async () => saved }),
  memoryAvatarCache: () => cache,
  indexedDbAvatarCache: () => cache,
}))
vi.mock('~/stores/session', () => ({ useSessionStore: () => session }))

/** An `Image` whose decode the test settles by hand. */
type Decode = { url: string; settle: (ok: boolean) => void }
const images: Decode[] = []
class FakeImage {
  src = ''
  decode() {
    return new Promise<void>((resolve, reject) => {
      const url = this.src
      images.push({ url, settle: (ok) => (ok ? resolve() : reject(new Error('EncodingError'))) })
    })
  }
}
const decodeAll = (ok = true) => images.splice(0).forEach((d) => d.settle(ok))

let counter = 0
const created: string[] = []
const revoked: string[] = []

async function store() {
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('useBackend', () => ({}))
  vi.stubGlobal('isOnline', () => false)
  vi.stubGlobal('Image', FakeImage)
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    const url = `blob:${++counter}`
    created.push(url)
    return url
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => void revoked.push(url))
  setActivePinia(createPinia())
  const { useAvatarStore } = await import('~/stores/avatar')
  return useAvatarStore()
}

const photo = (path: string) => ({ path, small: new Blob(['s']), large: new Blob(['l']) })
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  images.length = 0
  created.length = 0
  revoked.length = 0
  kept = null
  session.member = { id: 'ada' }
  saved = { data: { path: 'ada/new.webp' }, error: null }
})

describe('the avatar store publishes decoded photos', () => {
  it('shows nothing of the device’s copy until both pictures are decoded', async () => {
    kept = photo('ada/a.webp')
    const avatar = await store()
    const loading = avatar.load()
    await settle()
    expect(images).toHaveLength(2)
    expect(avatar.small).toBeNull()
    expect(avatar.large).toBeNull()
    expect(avatar.path).toBeNull()
    decodeAll()
    await loading
    expect(avatar.small).toBe(created[0])
    expect(avatar.large).toBe(created[1])
    expect(avatar.path).toBe('ada/a.webp')
  })

  it('still shows a photo whose decode fails, and one whose decode never ends', async () => {
    vi.useFakeTimers()
    kept = photo('ada/a.webp')
    const avatar = await store()
    const failing = avatar.load()
    await vi.advanceTimersByTimeAsync(0)
    decodeAll(false)
    await failing
    expect(avatar.small).toBe(created[0])

    const hanging = avatar.save({ small: new Blob(['s2']), large: new Blob(['l2']) } as never)
    await vi.advanceTimersByTimeAsync(0)
    expect(avatar.small).toBe(created[0])
    await vi.advanceTimersByTimeAsync(1500)
    await hanging
    expect(avatar.small).toBe(created[2])
  })

  it('revokes the old URLs only after the new ones are published, and not at once', async () => {
    vi.useFakeTimers()
    kept = photo('ada/a.webp')
    const avatar = await store()
    const first = avatar.load()
    await vi.advanceTimersByTimeAsync(0)
    decodeAll()
    await first
    const [oldSmall, oldLarge] = [avatar.small, avatar.large]

    const next = avatar.save({ small: new Blob(['s2']), large: new Blob(['l2']) } as never)
    await vi.advanceTimersByTimeAsync(0)
    // The new photo is still decoding: the old one stays, its URLs alive.
    expect(avatar.small).toBe(oldSmall)
    expect(revoked).toEqual([])
    decodeAll()
    await next
    expect(avatar.small).not.toBe(oldSmall)
    expect(avatar.path).toBe('ada/new.webp')
    // Published, but an avatar that is mid-render may still point at the old URL for a moment.
    expect(revoked).toEqual([])
    await vi.advanceTimersByTimeAsync(2000)
    expect(revoked.sort()).toEqual([oldSmall, oldLarge].sort())
  })

  it('drops a photo that was still decoding when she signed out, and revokes what it made', async () => {
    kept = photo('ada/a.webp')
    const avatar = await store()
    const loading = avatar.load()
    await settle()
    session.member = { id: 'grace' }
    await settle()
    decodeAll()
    await loading
    expect(avatar.small).toBeNull()
    expect(avatar.path).toBeNull()
    expect(revoked.sort()).toEqual([...created].sort())
  })

  it('clears the photo at once when the member changes', async () => {
    kept = photo('ada/a.webp')
    const avatar = await store()
    const loading = avatar.load()
    await settle()
    decodeAll()
    await loading
    expect(avatar.small).not.toBeNull()
    session.member = { id: 'grace' }
    await settle()
    expect(avatar.small).toBeNull()
    expect(avatar.large).toBeNull()
  })
})
