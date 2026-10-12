import { createPinia, setActivePinia } from 'pinia'
import { computed, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodeRequest } from '@/data/auth'
import { CODE_COOLDOWN_MS, CODE_SENT_KEY, recentCode } from '@/utils/codeCooldown'

/**
 * Asking for a code (stores/session.ts) with the server's one-mail-per-address-per-20-s in mind: signing in
 * again right after signing out must not send a second mail, and a refusal for it is not a dead end.
 */
const items = new Map<string, string>()
const localStorage = {
  getItem: (key: string) => items.get(key) ?? null,
  setItem: (key: string, value: string) => void items.set(key, value),
  removeItem: (key: string) => void items.delete(key),
  get length() {
    return items.size
  },
  key: (index: number) => [...items.keys()][index] ?? null,
}

let answer: CodeRequest = { kind: 'sent' }
const requestCode = vi.fn(async (): Promise<CodeRequest> => answer)
vi.mock('~/data/auth', async (original) => ({
  ...(await original<typeof import('~/data/auth')>()),
  createAuth: () => ({ requestCode, verifyCode: async () => ({ error: null }), currentMember: async () => null }),
}))

const NOW = new Date('2026-10-25T10:00:00Z').getTime()
async function store() {
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('window', { localStorage })
  vi.stubGlobal('useBackend', () => ({}))
  setActivePinia(createPinia())
  const { useSessionStore } = await import('~/stores/session')
  return useSessionStore()
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW })
  items.clear()
  requestCode.mockClear()
  answer = { kind: 'sent' }
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('asking for a sign-in code', () => {
  it('sends one, and remembers when', async () => {
    const session = await store()
    expect(await session.submitEmail('ada@example.com')).toBe('verify')
    expect(requestCode).toHaveBeenCalledTimes(1)
    expect(session.pending).toMatchObject({ email: 'ada@example.com', flow: 'signIn', sentAt: NOW })
    expect(recentCode(localStorage, NOW)).toMatchObject({ at: NOW, used: false })
  })

  it('goes straight to the code step when one went out a moment ago and was not used: no second mail', async () => {
    const session = await store()
    await session.submitEmail('ada@example.com')
    session.changeEmail()
    vi.setSystemTime(NOW + 8_000)

    expect(await session.submitEmail(' Ada@Example.com ')).toBe('verify')
    expect(requestCode).toHaveBeenCalledTimes(1)
    expect(session.error).toBeNull()
    // The countdown runs on from the first send.
    expect(session.pending).toMatchObject({ email: 'Ada@Example.com', sentAt: NOW })
  })

  it('signing out and in again inside the window: the used code is not offered, nothing is sent, and it works again after', async () => {
    const session = await store()
    await session.submitEmail('ada@example.com')
    await session.verify('123456')
    // What signing out leaves (data/localData.ts): the record of the code, spent.
    expect(JSON.parse(items.get(CODE_SENT_KEY)!)).toMatchObject({ used: true })
    session.changeEmail()

    vi.setSystemTime(NOW + 5_000)
    expect(await session.submitEmail('ada@example.com')).toBeNull()
    expect(requestCode).toHaveBeenCalledTimes(1)

    vi.setSystemTime(NOW + CODE_COOLDOWN_MS)
    expect(await session.submitEmail('ada@example.com')).toBe('verify')
    expect(requestCode).toHaveBeenCalledTimes(2)
  })

  it('another address inside the window is sent to as usual', async () => {
    const session = await store()
    await session.submitEmail('ada@example.com')
    session.changeEmail()
    expect(await session.submitEmail('ben@example.com')).toBe('verify')
    expect(requestCode).toHaveBeenCalledTimes(2)
  })

  it('a refusal for a second code (sent from elsewhere) goes on to the code step, with the reason to show there', async () => {
    answer = { kind: 'error', code: 'code_just_sent' }
    const session = await store()

    expect(await session.submitEmail('ada@example.com')).toBe('verify')
    expect(session.error).toBe('code_just_sent')
    expect(session.pending).toMatchObject({ email: 'ada@example.com', sentAt: NOW })
    expect(recentCode(localStorage, NOW)).toMatchObject({ at: NOW, used: false })
  })

  it('too many requests stay on the form, as the generic error', async () => {
    answer = { kind: 'error', code: 'rate_limited' }
    const session = await store()

    expect(await session.submitEmail('ada@example.com')).toBeNull()
    expect(session.error).toBe('rate_limited')
    expect(session.pending).toBeNull()
  })

  it('resend refused inside the window keeps the countdown running from now', async () => {
    const session = await store()
    await session.submitEmail('ada@example.com')
    vi.setSystemTime(NOW + 25_000)
    answer = { kind: 'error', code: 'code_just_sent' }

    expect(await session.resend()).toBe(false)
    expect(session.error).toBe('code_just_sent')
    expect(session.pending?.sentAt).toBe(NOW + 25_000)
  })
})
