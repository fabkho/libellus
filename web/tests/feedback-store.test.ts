import { createPinia, setActivePinia } from 'pinia'
import { computed, reactive, ref, watch } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildContext, type Feedback, type FeedbackItem } from '@/data/feedback'

/**
 * The Contact sheet's logic (stores/feedback.ts) with the repository stood in: the draft is kept when a
 * send fails and when the sheet closes, a message that went through starts the next one empty, a send
 * goes once at a time and only when the text can be sent, and for a member who is not the owner the
 * inbox is never asked for.
 */

const session = reactive({ member: { id: 'ada' } as { id: string } | null })
vi.mock('~/stores/session', () => ({ useSessionStore: () => session }))

const context = buildContext({
  appVersion: 'b1', path: '/profile', standalone: false, platform: 'iOS', userAgent: 'x', locale: 'en', online: true, screen: null,
})
const item = (id: string, handled = false): FeedbackItem => ({
  id, kind: 'bug', text: `message ${id}`, context: {}, at: new Date('2026-10-24T08:00:00Z'), cursor: `c${id}`,
  handledAt: handled ? new Date() : null, memberName: null, memberEmail: null,
})

let repo: Feedback
vi.mock('~/data/feedback', async (original) => ({ ...(await original<typeof import('~/data/feedback')>()), createFeedback: () => repo }))

async function store(owner = false, fake: Partial<Feedback> = {}) {
  repo = {
    send: async () => ({ error: null }),
    list: async () => ({ data: [], error: null }),
    markHandled: async () => ({ data: true, error: null }),
    ...fake,
  }
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('useBackend', () => ({}))
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { shelfOwnerId: owner ? 'ada' : 'someone-else' } }))
  vi.stubGlobal('isOnline', () => true)
  session.member = { id: 'ada' }
  setActivePinia(createPinia())
  const { useFeedbackStore } = await import('~/stores/feedback')
  return useFeedbackStore()
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('her draft', () => {
  it('starts as a bug with no text, which cannot be sent', async () => {
    const s = await store()
    expect(s.kind).toBe('bug')
    expect(s.text).toBe('')
    expect(s.canSend).toBe(false)
    s.text = '          '
    expect(s.problem).toBe('too_short')
    s.text = 'The sheet will not close.'
    expect(s.problem).toBeNull()
    expect(s.canSend).toBe(true)
  })

  it('sends the kind and the text with the context, and says it went through', async () => {
    const calls: unknown[][] = []
    const s = await store(false, { send: async (...args) => (calls.push(args), { error: null }) })
    s.kind = 'feature'
    s.text = 'Please add an export of my shelf.'
    expect(await s.send(context)).toBe(true)
    expect(calls).toEqual([['feature', 'Please add an export of my shelf.', context]])
    expect(s.sent).toBe(true)
    expect(s.sendError).toBeNull()
  })

  it('keeps the text and says why when a send fails, and sends again on the next try', async () => {
    let answer: 'unknown' | 'rate_limited' | null = 'unknown'
    const s = await store(false, { send: async () => ({ error: answer }) })
    s.text = 'The sheet will not close.'
    expect(await s.send(context)).toBe(false)
    expect(s.sendError).toBe('unknown')
    expect(s.sent).toBe(false)
    expect(s.text).toBe('The sheet will not close.')

    answer = 'rate_limited'
    expect(await s.send(context)).toBe(false)
    expect(s.sendError).toBe('rate_limited')

    answer = null
    expect(await s.send(context)).toBe(true)
    expect(s.sendError).toBeNull()
  })

  it('keeps a draft across closing the sheet, and starts empty after a message went through', async () => {
    const s = await store()
    s.kind = 'other'
    s.text = 'A draft I will come back to.'
    s.begin()
    expect(s.text).toBe('A draft I will come back to.')
    expect(s.kind).toBe('other')

    await s.send(context)
    expect(s.sent).toBe(true)
    s.begin()
    expect(s.sent).toBe(false)
    expect(s.text).toBe('')
    expect(s.kind).toBe('bug')
  })

  it('does not send a text that is too short, nor twice at once', async () => {
    let sends = 0
    let release!: () => void
    const s = await store(false, { send: () => (sends++, new Promise((resolve) => (release = () => resolve({ error: null })))) })
    s.text = 'short'
    expect(await s.send(context)).toBe(false)
    expect(sends).toBe(0)

    s.text = 'A message long enough to go.'
    const first = s.send(context)
    expect(s.sending).toBe(true)
    expect(await s.send(context)).toBe(false)
    expect(sends).toBe(1)
    release()
    expect(await first).toBe(true)
    expect(s.sending).toBe(false)
  })

  it('forgets the draft when another member signs in', async () => {
    const s = await store()
    s.text = 'Ada’s unfinished draft here.'
    session.member = { id: 'bo' }
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(s.text).toBe('')
  })
})

describe('the owner’s inbox', () => {
  it('is never asked for by a member who is not the owner', async () => {
    let asked = 0
    const s = await store(false, { list: async () => (asked++, { data: [item('1')], error: null }) })
    await s.load()
    expect(asked).toBe(0)
    expect(s.isOwner).toBe(false)
    expect(s.items).toBeNull()
  })

  it('loads a page, counts the open ones and offers more only after a full page', async () => {
    const page = Array.from({ length: 30 }, (_, i) => item(String(i), i < 10))
    const s = await store(true, { list: async () => ({ data: page, error: null }) })
    await s.load()
    expect(s.items).toHaveLength(30)
    expect(s.openCount).toBe(20)
    expect(s.more).toBe(true)

    const short = await store(true, { list: async () => ({ data: [item('1')], error: null }) })
    await short.load()
    expect(short.more).toBe(false)
  })

  it('asks for what is older than the last message and does not show one twice', async () => {
    const befores: unknown[] = []
    const s = await store(true, {
      list: async ({ before } = {}) => {
        befores.push(before ?? null)
        return { data: before ? [item('29'), item('30')] : Array.from({ length: 30 }, (_, i) => item(String(i))), error: null }
      },
    })
    await s.load()
    await s.loadMore()
    expect(befores).toEqual([null, 'c29'])
    expect(s.items!.map((i) => i.id).filter((id) => id === '29')).toHaveLength(1)
    expect(s.items).toHaveLength(31)
  })

  it('keeps the messages on screen when a load fails', async () => {
    let fail = false
    const s = await store(true, { list: async () => (fail ? { data: null, error: 'unknown' } : { data: [item('1')], error: null }) })
    await s.load()
    fail = true
    await s.load()
    expect(s.loadError).toBe('unknown')
    expect(s.items).toHaveLength(1)
  })

  it('marks a message handled once the database says so, and says why when it does not', async () => {
    let answer: 'ok' | 'offline' = 'offline'
    const s = await store(true, {
      list: async () => ({ data: [item('1')], error: null }),
      markHandled: async () => (answer === 'ok' ? { data: true, error: null } : { data: null, error: 'offline' }),
    })
    await s.load()
    expect(await s.markHandled('1', true)).toBe(false)
    expect(s.writeError).toBe('offline')
    expect(s.items![0]!.handledAt).toBeNull()

    answer = 'ok'
    expect(await s.markHandled('1', true)).toBe(true)
    expect(s.writeError).toBeNull()
    expect(s.items![0]!.handledAt).toBeInstanceOf(Date)
    expect(s.openCount).toBe(0)
    expect(await s.markHandled('1', false)).toBe(true)
    expect(s.openCount).toBe(1)
  })
})
