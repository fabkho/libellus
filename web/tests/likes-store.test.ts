import { createPinia, setActivePinia } from 'pinia'
import { computed, nextTick, reactive, readonly, ref, watch } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The likes store (social v2a, stores/likes.ts): a tap shows its result at once and the database's answer
 * replaces it; a refusal takes it back and marks the read; offline nothing is sent. Run as in Nuxt, with the
 * auto-imports it uses stood in for: a fake backend and a signed-in member.
 */

const online = ref(true)
const calls: { fn: string; args: Record<string, unknown> }[] = []
let answer: (fn: string) => { data?: unknown; error?: { message: string } } = () => ({ data: { likes: 1, liked: true } })
let release: (() => void) | null = null
const backend = {
  rpc: async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args })
    if (release === null && pending) await new Promise<void>((resolve) => (release = resolve))
    const out = answer(fn)
    return { data: out.data ?? null, error: out.error ?? null, status: out.error ? 400 : 200 }
  },
}
let pending = false

vi.mock('~/stores/session', () => ({ useSessionStore: () => reactive({ member: { id: 'ada' } }) }))

async function store() {
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('reactive', reactive)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('useBackend', () => backend)
  vi.stubGlobal('useOnline', () => readonly(online))
  vi.stubGlobal('isOnline', () => online.value)
  setActivePinia(createPinia())
  const { useLikesStore } = await import('~/stores/likes')
  return useLikesStore()
}

beforeEach(() => {
  calls.length = 0
  online.value = true
  pending = false
  release = null
  answer = () => ({ data: { likes: 1, liked: true } })
})

describe('likes store', () => {
  const base = { likes: 0, liked: false }

  it('shows a like at once and keeps the count the database answers', async () => {
    const likes = await store()
    pending = true
    const done = likes.toggle('s1', base)
    await nextTick()
    expect(likes.face('s1', base)).toEqual({ likes: 1, liked: true })
    expect(likes.busy.s1).toBe(true)
    answer = () => ({ data: { likes: 2, liked: true } })
    release?.()
    expect(await done).toBe(true)
    expect(likes.face('s1', base)).toEqual({ likes: 2, liked: true })
    expect(calls.map((c) => c.fn)).toEqual(['like'])
    expect(calls[0]!.args).toEqual({ p_session: 's1' })
  })

  it('takes a like back through unlike', async () => {
    const likes = await store()
    answer = () => ({ data: { likes: 2, liked: false } })
    await likes.toggle('s1', { likes: 3, liked: true })
    expect(calls.map((c) => c.fn)).toEqual(['unlike'])
    expect(likes.face('s1', { likes: 3, liked: true })).toEqual({ likes: 2, liked: false })
  })

  it('rolls a refused like back and marks the read', async () => {
    const likes = await store()
    answer = () => ({ error: { message: 'not_found' } })
    expect(await likes.toggle('s1', base)).toBe(false)
    expect(likes.face('s1', base)).toEqual(base)
    expect(likes.failed.s1).toBe(true)
    // The next tap is a new try.
    answer = () => ({ data: { likes: 1, liked: true } })
    await likes.toggle('s1', base)
    expect(likes.failed.s1).toBe(false)
  })

  it('sends nothing offline', async () => {
    const likes = await store()
    online.value = false
    expect(await likes.toggle('s1', base)).toBe(false)
    expect(calls).toEqual([])
    expect(likes.face('s1', base)).toEqual(base)
  })
})

describe('a member who leaves her circle (privacy review M2)', () => {
  const ben = { id: 'ben', name: 'Ben', photo: null }
  const cleo = { id: 'cleo', name: 'Cleo', photo: null }
  const book = { id: 'b1', title: 'Piranesi', authors: [], year: null, coverUrl: null, coverThumbhash: null, coverColors: null, manual: false, unverified: false }
  const recent = (session: string, likers: unknown[], count: number) => ({ session, book, likers, count, at: '2026-10-20T10:00:00Z' })
  const stored = () => JSON.parse(window.localStorage.getItem('libellus.likes') ?? 'null')

  beforeEach(() => {
    const data = new Map<string, string>()
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) } })
  })

  it('goes from Home\'s likes, and from the device\'s copy; an item with nobody left goes', async () => {
    const likes = await store()
    answer = (fn) => ({ data: fn === 'my_recent_likes' ? [recent('s1', [ben, cleo], 5), recent('s2', [ben], 1)] : null })
    await likes.loadRecent()
    expect(likes.recent).toHaveLength(2)
    likes.dropMember('ben')
    expect(likes.recent).toEqual([recent('s1', [cleo], 4)])
    expect(stored()?.items).toEqual([recent('s1', [cleo], 4)])
  })

  it('leaves the likes of the others alone', async () => {
    const likes = await store()
    answer = (fn) => ({ data: fn === 'my_recent_likes' ? [recent('s1', [cleo], 1)] : null })
    await likes.loadRecent()
    likes.dropMember('ben')
    expect(likes.recent).toEqual([recent('s1', [cleo], 1)])
  })

  it('forgets the hearts tapped on her reads, and a tap that lands after she left', async () => {
    const likes = await store()
    await likes.toggle('s1', { likes: 0, liked: false }, 'ben')
    expect(likes.face('s1', { likes: 0, liked: false })).toEqual({ likes: 1, liked: true })
    likes.dropMember('ben')
    expect(likes.face('s1', { likes: 0, liked: false })).toEqual({ likes: 0, liked: false })

    pending = true
    const late = likes.toggle('s2', { likes: 0, liked: false }, 'ben')
    await nextTick()
    likes.dropMember('ben')
    release?.()
    expect(await late).toBe(false)
    expect(likes.face('s2', { likes: 0, liked: false })).toEqual({ likes: 0, liked: false })
  })
})
