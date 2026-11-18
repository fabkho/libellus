import { computed, nextTick, reactive, ref, type Ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useThreadScreen, type ThreadItemsContext, type ThreadScreenAdapter, type ThreadScreenOpts } from '@/composables/useThreadScreen'
import { DOUBLE_TAP_MS, type VoicePressPlayer } from '@/composables/useVoicePress'
import { isRetryableBuddyError, type BuddyErrorCode } from '@/data/buddyReads'
import { isRetryableNoteError, type NoteErrorCode } from '@/data/notes'
import { roomItems, type QuoteSource, type QuoteWords, type ThreadItem } from '@/utils/roomThread'
import { noteItems, quoteSourceOf, sentNote, type NoteBubble, type NoteItem } from '@/utils/notes'

/**
 * The thread screen both pages draw (`composables/useThreadScreen.ts`): a fake adapter and a fake store of bubbles, in Node. No page, no
 * component, no snapshot — what the screen answers its page (the items it draws, the words a refusal gets, what a bar button does, the
 * press on a voice message) and the calls it makes on the adapter.
 */

// ------------------------------------------------------------------ fixtures

/** The base's player, as the press uses it: one sound at a time, `stop` silences whatever is playing. */
function fakePlayer(): VoicePressPlayer & { toggles: [string, string][]; stops: number } {
  const player = {
    current: { key: null as string | null, playing: false, positionMs: 0, failed: false },
    toggles: [] as [string, string][],
    stops: 0,
    toggle(key: string, url: string) {
      player.toggles.push([key, url])
      if (player.current.key === key) player.current.playing = !player.current.playing
      else player.current = { key, playing: true, positionMs: 0, failed: false }
    },
    stop() {
      player.stops++
      player.current = { key: null, playing: false, positionMs: 0, failed: false }
    },
  }
  return player
}

const words: QuoteWords = { deleted: 'Message deleted', someone: 'A reader', you: 'You', voice: 'Voice message', hidden: 'A note you can’t see' }

/** One note of a chapter, as the store holds it: stored, or on its way, or refused with a code. */
const note = (id: string, over: Partial<NoteBubble> = {}): NoteBubble =>
  Object.assign(
    sentNote({
      id,
      conversationId: 'room',
      threadId: 'ch5',
      senderId: 'ben',
      clientId: `c-${id}`,
      kind: 'text',
      body: `Words of ${id}`,
      createdAt: `2026-11-13T10:00:0${id}.000Z`,
      replyTo: null,
      spoiler: false,
      media: null,
      voice: null,
      author: { id: 'ben', name: 'Ben', photo: null },
      authorName: 'Ben',
      deletedAt: null,
      moderated: false,
      reactions: [],
      visibility: 'friends',
      effectiveVisibility: 'friends',
      quote: null,
      editedAt: null,
    }),
    over,
  )

/** The base's click, as the press walks it: `detail` 0 for the keyboard, and the two `Event` methods it calls. */
function press(key: string, { detail = 1 }: { detail?: number } = {}): MouseEvent {
  const host = { dataset: { key } }
  const button = { closest: (selector: string) => (selector === '[data-key]' ? host : null) }
  return { detail, target: { closest: () => button }, stopPropagation: () => {}, preventDefault: () => {} } as unknown as MouseEvent
}

type Sent = { id: string; reason: string; note: string | null }

/** A page's adapter over an in-memory list of notes, counting what the screen asks of it. */
function fakeAdapter(over: Partial<ThreadScreenAdapter<NoteBubble, NoteItem>> = {}) {
  const bubbles = reactive<NoteBubble[]>([])
  const calls = { older: 0 }
  const sends: { body: string; replyToId: string | null; quote: unknown }[] = []
  const answers: { id: string; emoji: string }[] = []
  const deleted: string[] = []
  const discarded: string[] = []
  const retried: string[] = []
  const reports: Sent[] = []
  const state = reactive({ open: true, loaded: true, more: false, loading: false, room: true, error: null as string | null, refusal: null as string | null, voiceRefusal: null as string | null })

  const adapter: ThreadScreenAdapter<NoteBubble, NoteItem> = {
    me: () => 'ada',
    isOpen: () => state.open,
    paging: () => ({ more: state.more, loading: state.loading, loaded: state.loaded, room: state.room }),
    nameOf: () => null,
    previewOf: () => null,
    errorWord: (code) => `word:${code}`,
    retryable: (code) => isRetryableNoteError(code as NoteErrorCode),
    quoteSourceOf: (item, me) => quoteSourceOf(item, me),
    bubblesOf: () => bubbles,
    itemsOf: (held, ctx: ThreadItemsContext) => noteItems(held, ctx),
    loadOlder: async () => {
      calls.older++
      if (state.more) bubbles.unshift(note(String(bubbles.length + 1)))
    },
    send: async (body, extra) => {
      sends.push({ body, ...extra })
      if (state.refusal) return { ok: false, error: state.refusal }
      bubbles.push(note('sent', { senderId: 'ada', mine: true, body }))
      return { ok: true }
    },
    sendVoice: async (_voice, extra) => {
      sends.push({ body: '', ...extra })
      if (state.voiceRefusal) return { ok: false, error: state.voiceRefusal }
      return { ok: true }
    },
    retry: async (key) => void retried.push(key),
    discard: (key) => {
      discarded.push(key)
      const at = bubbles.findIndex((bubble) => (bubble.clientId ?? bubble.id) === key)
      if (at >= 0) bubbles.splice(at, 1)
    },
    react: async (id, emoji) => {
      answers.push({ id, emoji })
      return null
    },
    deleteMessage: async (id) => {
      deleted.push(id)
      return null
    },
    report: async (id, reason, text) => {
      reports.push({ id, reason, note: text })
      return null
    },
    voiceUrl: async (path) => ({ data: `https://signed/${path}`, error: null }),
    ...over,
  }
  return { adapter, bubbles, calls, sends, answers, deleted, discarded, retried, reports, state }
}

function opts(over: Partial<ThreadScreenOpts<NoteItem>> = {}) {
  const player = fakePlayer()
  const asked: string[] = []
  const wordsOf: ThreadScreenOpts<NoteItem> = {
    emojis: ['❤️', '🔥'],
    likeEmoji: '❤️',
    canLike: () => true,
    canWrite: () => true,
    quoteWords: () => words,
    barWords: () => ({ report: 'Report', delete: 'Delete' }),
    extraActions: () => [],
    deleteText: () => 'It will read “Note removed” for everyone.',
    offlineWord: () => 'You are offline',
    failedWord: () => 'That one will not play',
    composerTestid: 'notesThread',
    voicePlayer: player,
    ...over,
  }
  void asked
  return { words: wordsOf, player }
}

function screen(over: { adapter?: Parameters<typeof fakeAdapter>[0]; opts?: Partial<ThreadScreenOpts<NoteItem>> } = {}) {
  const fake = fakeAdapter(over.adapter)
  const o = opts(over.opts)
  const made = useThreadScreen(fake.adapter, o.words)
  return { ...fake, ...o, made }
}

afterEach(() => vi.restoreAllMocks())

/** Lets a promise the screen awaited land: one microtask turn is not enough after one it resolved itself. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

// ------------------------------------------------------------------ (a) a refused send

describe('a send that was refused', () => {
  /** The two code tables, each with the codes that must be retryable and the ones that must not (they differ: a rate limit is `rate_limited` on a note and `message_rate_limited` in a read). */
  const tables: { name: string; retryable: (code: string) => boolean; yes: string[]; no: string[] }[] = [
    { name: 'notes', retryable: (code) => isRetryableNoteError(code as NoteErrorCode), yes: ['offline', 'rate_limited', 'busy', 'unknown'], no: ['note_wider_than_parent', 'reply_not_visible', 'voice_private_only', 'message_rate_limited'] },
    { name: 'buddy read', retryable: (code) => isRetryableBuddyError(code as BuddyErrorCode), yes: ['offline', 'message_rate_limited', 'busy', 'unknown'], no: ['buddy_read_archived', 'not_found', 'message_body_invalid', 'rate_limited'] },
  ]

  it('says the refusal in the page’s words, and marks the item permanent exactly where the page’s own table does', async () => {
    for (const table of tables) {
      for (const [code, retryable] of [...table.yes.map((c) => [c, true]), ...table.no.map((c) => [c, false])] as [string, boolean][]) {
        const { made, bubbles, state } = screen({ adapter: { retryable: table.retryable } })
        state.refusal = code
        // The bubble the store hands back once its line refused the send, and the send's own refusal.
        bubbles.push(Object.assign(note('10', { senderId: 'ada', mine: true }), { state: 'failed' as const, error: code as NoteErrorCode }))
        made.text.value = 'Hello'
        await made.send()
        expect(made.notice.value, `${table.name} ${code}`).toBe(`word:${code}`)
        expect(made.items.value.at(-1), `${table.name} ${code}`).toMatchObject({ delivery: 'failed', permanent: !retryable })
      }
    }
  })

  it('shows "Try again" on a rate limit and none on a refusal a second try cannot change', async () => {
    const limited = screen({ adapter: { retryable: (code) => isRetryableBuddyError(code as BuddyErrorCode) } })
    limited.bubbles.push(Object.assign(note('1', { senderId: 'ada', mine: true }), { state: 'failed' as const, error: 'message_rate_limited' as NoteErrorCode }))
    expect(limited.made.items.value[0]!.permanent).toBe(false)

    const refused = screen({ adapter: { retryable: (code) => isRetryableBuddyError(code as BuddyErrorCode) } })
    refused.bubbles.push(Object.assign(note('1', { senderId: 'ada', mine: true }), { state: 'failed' as const, error: 'buddy_read_archived' as NoteErrorCode }))
    expect(refused.made.items.value[0]!.permanent).toBe(true)
  })

  it('keeps her words and the answer when it was refused, and clears both when it was not', async () => {
    const { made, bubbles, state } = screen()
    bubbles.push(note('1'))
    made.replyTo.value = made.items.value[0]!
    made.text.value = 'Hello'
    state.refusal = 'offline'
    await made.send()
    expect(made.text.value).toBe('Hello')
    expect(made.replyTo.value).not.toBeNull()

    state.refusal = null
    await made.send()
    expect(made.text.value).toBe('')
    expect(made.replyTo.value).toBeNull()
    expect(made.notice.value).toBeNull()
  })

  it('does not send an empty line, nor the spaces of one', async () => {
    const { made, sends } = screen()
    made.text.value = '  \n '
    await made.send()
    expect(sends).toEqual([])
  })
})

// ------------------------------------------------------------------ (b) the veil

describe('the veil', () => {
  it('draws nothing of a thread that is not open, although the store holds it', () => {
    const { made, bubbles, state } = screen()
    bubbles.push(note('1'), note('2', { body: 'A spoiler' }))
    expect(made.items.value).toHaveLength(2)
    state.open = false
    expect(made.items.value).toEqual([])
  })
})

// ------------------------------------------------------------------ (d) the double tap on a voice message

describe('a double tap on a voice message', () => {
  it('likes with the page’s emoji, stops the player, and plays nothing', async () => {
    const { made, bubbles, answers, player } = screen()
    bubbles.push(note('7', { senderId: 'ben', kind: 'voice', body: '', voice: { path: 'voice/7.webm', mime: 'audio/webm', durationMs: 2000, peaks: [1, 2] } }))
    const now = Date.now()
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now)

    made.onPress(press('c-7'))
    await settle()
    expect(player.current).toMatchObject({ key: 'c-7', playing: true })
    made.onPress(press('c-7'))

    expect(answers).toEqual([{ id: '7', emoji: '❤️' }])
    expect(player.stops).toBe(1)
    expect(player.toggles).toEqual([['c-7', 'https://signed/voice/7.webm']])
    spy.mockRestore()
  })

  it('is a second press only inside the base’s window: after it, the press plays again', async () => {
    const { made, bubbles, answers, player } = screen()
    bubbles.push(note('7', { kind: 'voice', body: '', voice: { path: 'voice/7.webm', mime: 'audio/webm', durationMs: 2000, peaks: [1, 2] } }))
    const spy = vi.spyOn(Date, 'now')
    spy.mockReturnValue(1000)
    made.onPress(press('c-7'))
    await settle()
    spy.mockReturnValue(1000 + DOUBLE_TAP_MS + 1)
    made.onPress(press('c-7'))
    await settle()
    expect(answers).toEqual([])
    expect(player.toggles).toHaveLength(2)
    spy.mockRestore()
  })

  it('never likes where the page says it may not (an archived read), but still plays and pauses', async () => {
    const { made, bubbles, answers, player } = screen({ opts: { canLike: () => false } })
    bubbles.push(note('7', { kind: 'voice', body: '', voice: { path: 'voice/7.webm', mime: 'audio/webm', durationMs: 2000, peaks: [1, 2] } }))
    const spy = vi.spyOn(Date, 'now').mockReturnValue(1000)
    made.onPress(press('c-7'))
    await settle()
    made.onPress(press('c-7'))
    expect(answers).toEqual([])
    expect(player.stops).toBe(0)
    expect(player.toggles).toEqual([['c-7', 'https://signed/voice/7.webm'], ['c-7', expect.any(String)]])
    spy.mockRestore()
  })

  it('fetches nothing of a thread that is not open to her', async () => {
    const { made, bubbles, player, state } = screen()
    bubbles.push(note('7', { kind: 'voice', body: '', voice: { path: 'voice/7.webm', mime: 'audio/webm', durationMs: 2000, peaks: [1, 2] } }))
    state.open = false
    made.onPress(press('c-7'))
    await settle()
    expect(player.toggles).toEqual([])
  })
})

// ------------------------------------------------------------------ (e) the four shapes of a quote

describe('a quote', () => {
  it('jumps to the message it answers, and words what it cannot show', () => {
    const { made, bubbles } = screen()
    bubbles.push(
      note('1', { body: 'First words', senderId: 'ben' }),
      note('2', { senderId: 'ada', mine: true, body: 'Mine' }),
      note('3', { body: '', senderId: 'ben', kind: 'voice', voice: { path: 'v', mime: 'audio/webm', durationMs: 1, peaks: [] } }),
    )
    const items = made.items.value
    const quote = (source: QuoteSource | null) => {
      const item = items.find((i) => i.id === '1')!
      return { item, source }
    }
    // The item the reply names among the loaded page.
    void quote
    expect(made.quoteFor({ ...items[0]!, replyTo: '1' } as NoteItem)).toMatchObject({ id: '1', name: 'Ben', preview: 'First words' })
    expect(made.quoteFor({ ...items[0]!, replyTo: '2' } as NoteItem)).toMatchObject({ mine: true, name: 'You' })
    // A voice message says so; a tombstone is deleted and does not jump; a reply to nothing loaded is a note she may not see.
    expect(made.quoteFor({ ...items[0]!, replyTo: '3' } as NoteItem)).toMatchObject({ id: '3', preview: 'Voice message' })
    expect(made.quoteFor({ ...items[0]!, replyTo: 'gone' } as NoteItem)).toEqual({ id: null, mine: false, name: '', preview: 'A note you can’t see' })
    expect(made.quoteFor({ ...items[0]!, replyTo: null } as NoteItem)).toBeNull()
  })

  it('carries the server’s own three shapes: hidden, removed and a note she may read', () => {
    const { made, bubbles } = screen()
    bubbles.push(note('1', { body: 'First words' }), note('2', { quote: { kind: 'hidden' } }), note('3', { quote: { kind: 'removed' } }))
    const items = made.items.value
    expect(made.quoteFor({ ...items[0]!, quote: { kind: 'hidden' } } as NoteItem)).toEqual({ id: null, mine: false, name: '', preview: 'A note you can’t see' })
    expect(made.quoteFor({ ...items[0]!, quote: { kind: 'removed' } } as NoteItem)).toEqual({ id: null, mine: false, name: '', preview: 'Message deleted' })
    const server = { kind: 'note' as const, id: '1', author: { id: 'ben', name: 'Ben', photo: null }, excerpt: 'First words', voice: false }
    expect(made.quoteFor({ ...items[0]!, quote: server } as NoteItem)).toEqual({ id: '1', mine: false, name: 'Ben', preview: 'First words' })
    // A note the server sent that is not in the loaded page: its words, no jump.
    expect(made.quoteFor({ ...items[0]!, quote: { ...server, id: 'far', excerpt: 'Far away' } } as NoteItem)).toMatchObject({ id: null, preview: 'Far away' })
  })

  it('cuts the chip over the composer from the message she answers', () => {
    const { made, bubbles } = screen()
    bubbles.push(note('1', { body: '  The   ending\nwas  great ', senderId: 'ben' }))
    made.replyTo.value = made.items.value[0]!
    expect(made.replyChip.value).toEqual({ name: 'Ben', preview: 'The ending was great' })
    made.replyTo.value = null
    expect(made.replyChip.value).toBeNull()
  })
})

// ------------------------------------------------------------------ (f) discard

describe('giving a refused message up', () => {
  it('removes the bubble and with it the refusal the device kept', async () => {
    const { made, bubbles, discarded } = screen()
    bubbles.push(note('1'), Object.assign(note('2', { senderId: 'ada', mine: true }), { state: 'failed' as const, error: 'note_wider_than_parent' as const }))
    const refused = made.items.value.at(-1)!
    expect(refused).toMatchObject({ delivery: 'failed', permanent: true })
    made.discard(refused.key)
    expect(discarded).toEqual([refused.key])
    expect(made.items.value).toHaveLength(1)
  })
})

// ------------------------------------------------------------------ (g) retry

describe('trying again', () => {
  it('is a no-op on a refusal no second try can change, and asks again on the ones that may', async () => {
    const { made, bubbles, retried } = screen()
    bubbles.push(
      Object.assign(note('1', { senderId: 'ada', mine: true }), { state: 'failed' as const, error: 'note_wider_than_parent' as const }),
      Object.assign(note('2', { senderId: 'ada', mine: true }), { state: 'failed' as const, error: 'offline' as const }),
    )
    const [permanent, retryable] = made.items.value
    await made.retry(permanent!.key)
    expect(retried).toEqual([])
    await made.retry(retryable!.key)
    expect(retried).toEqual([retryable!.key])
  })
})

// ------------------------------------------------------------------ (h) loadOlder

describe('the page before the oldest message', () => {
  it('answers whether the list grew, and leaves it be when there is no page', async () => {
    const { made, bubbles, calls, state } = screen()
    bubbles.push(note('1'))
    expect(await made.loadOlder()).toBe(false)
    expect(calls.older).toBe(1)

    state.more = true
    expect(await made.loadOlder()).toBe(true)
    expect(made.items.value).toHaveLength(2)
  })

  it('says whether an earlier page is on its way, and whether there is one', () => {
    const { made, state } = screen()
    expect([made.hasMore.value, made.olderStatus.value]).toEqual([false, 'idle'])
    state.more = true
    state.loading = true
    expect([made.hasMore.value, made.olderStatus.value]).toEqual([true, 'loading'])
  })
})

// ------------------------------------------------------------------ the bar, the delete, the report

describe('the action bar', () => {
  it('offers Report on somebody else’s message, Delete on hers, then what the page adds', () => {
    const { made, bubbles } = screen({ opts: { extraActions: (item) => (item.mine ? [{ id: 'edit', label: 'Edit', icon: 'pencil' }] : [{ id: 'block', label: 'Block', icon: 'ban' }]) } })
    bubbles.push(note('1', { senderId: 'ben' }), note('2', { senderId: 'ada', mine: true }))
    const [theirs, hers] = made.items.value
    expect(made.actionsOf(theirs!).map((button) => button.id)).toEqual(['report', 'block'])
    expect(made.actionsOf(hers!).map((button) => button.id)).toEqual(['delete', 'edit'])
  })

  it('offers nothing where the page takes no writing, on a tombstone, or on a message still on its way', () => {
    const { made, bubbles, state } = screen()
    bubbles.push(note('1', { deletedAt: '2026-11-13T11:00:00Z' }), Object.assign(note('2', { senderId: 'ada', mine: true }), { state: 'sending' as const }))
    for (const item of made.items.value) expect(made.actionsOf(item)).toEqual([])
    state.open && bubbles.push(note('3'))
    state.room = true
    const readOnly = screen({ opts: { canWrite: () => false } })
    readOnly.bubbles.push(note('1'))
    expect(readOnly.made.actionsOf(readOnly.made.items.value[0]!)).toEqual([])
  })

  it('opens the delete confirm with the page’s words, and deletes on confirm', async () => {
    const { made, bubbles, deleted } = screen({ opts: { deleteText: (item) => (item.voice ? 'The recording goes too.' : 'It will read “Note removed”.') } })
    bubbles.push(note('1', { senderId: 'ada', mine: true }))
    const item = made.items.value[0]!
    made.action('delete', item.key)
    expect(made.deleteOpen.value).toBe(true)
    expect(made.deleteText.value).toBe('It will read “Note removed”.')
    await made.confirmDelete()
    expect(deleted).toEqual(['1'])
    expect(made.deleteOpen.value).toBe(false)
  })

  it('opens the report sheet with the message’s id, and sends the reason and the note through the adapter', async () => {
    const { made, bubbles, reports } = screen()
    bubbles.push(note('1', { senderId: 'ben' }))
    made.action('report', made.items.value[0]!.key)
    expect(made.reportId.value).toBe('1')
    expect(made.reportOpen.value).toBe(true)
    expect(await made.report('1', 'spam', 'Looks like an ad.')).toBeNull()
    expect(reports).toEqual([{ id: '1', reason: 'spam', note: 'Looks like an ad.' }])
  })

  it('leaves the page’s own buttons to the page, and the screen’s two to itself', async () => {
    const asked: string[] = []
    const { made, bubbles, deleted } = screen({ opts: { extraActions: (item) => (item.mine ? [] : [{ id: 'block', label: 'Block', icon: 'ban' }]), onAction: (id) => (asked.push(id), true) } })
    bubbles.push(note('1', { senderId: 'ben' }))
    const key = made.items.value[0]!.key
    made.action('block', key)
    expect(asked).toEqual(['block'])
    expect(made.reportOpen.value).toBe(false)
    // The page may take Delete for its own words (a Host's); it is asked first.
    made.action('report', key)
    expect(asked).toEqual(['block', 'report'])
    expect(made.reportOpen.value).toBe(false)
    expect(deleted).toEqual([])
  })

  it('answers only what the bar was drawn with: a stale press does nothing', () => {
    const { made, bubbles, deleted } = screen()
    bubbles.push(note('1', { deletedAt: '2026-11-13T11:00:00Z' }))
    made.action('delete', made.items.value[0]!.key)
    expect(made.deleteOpen.value).toBe(false)
    expect(deleted).toEqual([])
  })
})
