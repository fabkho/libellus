import { describe, expect, it, vi } from 'vitest'
import { DOUBLE_TAP_MS, useVoicePress, type VoicePressOptions, type VoicePressPlayer } from '@/composables/useVoicePress'
import { VOICE_UNSIGNED, type ThreadItem } from '@/utils/roomThread'

/**
 * The press-to-play interaction of a voice message (`composables/useVoicePress.ts`): the four races the two pages each carried their own,
 * untested, copy of. Plain data and a fake player in Node — no page, no store, no audio element.
 */

const item = (over: Partial<ThreadItem> = {}): ThreadItem => ({
  key: 'k1',
  id: 'm1',
  mine: false,
  kind: 'voice',
  body: '',
  createdAt: '2026-11-13T10:00:00Z',
  delivery: 'sent',
  error: null,
  media: { kind: 'voice', url: null, path: 'voice/k1.webm', width: 1, height: 1, removed: false, durationMs: 2400, peaks: [10, 40], mime: 'audio/webm' },
  reactions: [],
  myReaction: null,
  authorId: 'ben',
  author: 'Ben',
  replyTo: null,
  removed: false,
  voice: true,
  permanent: false,
  ...over,
})

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

/**
 * The click the base hands over: its `detail` (0 for the keyboard), the two `Event` methods the press calls, and a stand-in for the node
 * tree it climbs (`closest`, `dataset`). Node has no DOM, and the press uses none of it.
 */
function press(key: string, { detail = 1, play = true }: { detail?: number; play?: boolean } = {}): MouseEvent {
  const host = { dataset: { key } }
  const button = { closest: (selector: string) => (selector === '[data-key]' ? host : null) }
  const target = play ? { closest: () => button } : { closest: () => null }
  return { detail, target, stopPropagation: () => {}, preventDefault: () => {} } as unknown as MouseEvent
}

function setup(over: Partial<VoicePressOptions> = {}) {
  const player = over.voicePlayer ?? fakePlayer()
  const notices: (string | null)[] = []
  const likes: [string, string][] = []
  const options: VoicePressOptions = {
    items: () => [item()],
    isOpen: () => true,
    canLike: () => true,
    likeEmoji: '❤️',
    like: (id, emoji) => void likes.push([id, emoji]),
    notice: (message) => void notices.push(message),
    isPreview: () => false,
    voiceUrl: () => new Promise((resolve) => resolve({ data: 'https://signed/k1', error: null })),
    offlineWord: () => 'offline!',
    failedWord: () => 'that one will not play',
    voicePlayer: player,
    ...over,
  }
  const voiceUrl = vi.fn(options.voiceUrl)
  options.voiceUrl = voiceUrl
  return { ...useVoicePress(options), player, notices, likes, voiceUrl, options }
}

/** Lets the press's `await` land: one microtask turn is not enough after a promise it resolved itself. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('a press on a voice message', () => {
  it('a second press while the signed URL is still in flight likes and does not play', async () => {
    let answer!: (value: { data: string; error: null }) => void
    const { onPress, player, likes, voiceUrl } = setup({
      voiceUrl: () => new Promise((resolve) => (answer = resolve)) as Promise<{ data: string; error: null }>,
    })

    onPress(press('k1'))
    expect(voiceUrl).toHaveBeenCalledTimes(1)
    onPress(press('k1'))
    // The first press was still waiting: it is told not to play, and the double tap is the like.
    expect(likes).toEqual([['m1', '❤️']])
    expect(player.toggles).toEqual([])

    answer({ data: 'https://signed/k1', error: null })
    await settle()
    expect(player.toggles).toEqual([])
  })

  it('a press on the key that is currently playing pauses it, with no URL fetch', async () => {
    const { onPress, player, voiceUrl } = setup()
    player.current = { key: 'k1', playing: true, positionMs: 900, failed: false }

    onPress(press('k1'))

    expect(voiceUrl).not.toHaveBeenCalled()
    expect(player.toggles).toEqual([['k1', VOICE_UNSIGNED]])
    expect(player.current).toMatchObject({ key: 'k1', playing: false })
  })

  it('a press on a key the device holds its own copy of (`previewOf`) is left to the base', () => {
    const { onPress, player, voiceUrl } = setup({ isPreview: () => true })

    onPress(press('k1'))

    expect(voiceUrl).not.toHaveBeenCalled()
    expect(player.toggles).toEqual([])
  })

  it('a failed sign words the failure and plays nothing', async () => {
    const { onPress, player, notices, voiceUrl } = setup({
      voiceUrl: async () => ({ data: null, error: 'unknown' }),
    })

    onPress(press('k1'))
    await settle()

    expect(voiceUrl).toHaveBeenCalledWith('voice/k1.webm')
    expect(notices).toEqual([null, 'that one will not play'])
    expect(player.toggles).toEqual([])
  })
})

describe('the same press, on the page', () => {
  it('words an offline sign with the page’s own sentence, and a lost one with the other', async () => {
    const offline = setup({ voiceUrl: async () => ({ data: null, error: 'offline' }) })
    offline.onPress(press('k1'))
    await settle()
    expect(offline.notices).toEqual([null, 'offline!'])

    const lost = setup({ voiceUrl: async () => ({ data: null, error: 'not_signed_in' }) })
    lost.onPress(press('k1'))
    await settle()
    expect(lost.notices).toEqual([null, 'that one will not play'])
  })

  it('plays the signed URL on the first press, from the file’s path', async () => {
    const { onPress, player, voiceUrl } = setup()

    onPress(press('k1'))
    await settle()

    expect(voiceUrl).toHaveBeenCalledWith('voice/k1.webm')
    expect(player.toggles).toEqual([['k1', 'https://signed/k1']])
  })

  it('likes with the emoji the page hands in, and stops the sound the first press started', async () => {
    const { onPress, player, likes, options } = setup({ likeEmoji: '🔥' })
    options.items = () => [item({ id: 'm7' })]
    const now = Date.now()
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now)

    // The first press played it: the second, inside the double-tap window, likes and silences it.
    onPress(press('k1'))
    await settle()
    expect(player.current).toMatchObject({ key: 'k1', playing: true })
    onPress(press('k1'))

    expect(likes).toEqual([['m7', '🔥']])
    expect(player.stops).toBe(1)
    spy.mockRestore()
  })

  it('fetches nothing at all in a thread that is not open to her', () => {
    const { onPress, player, voiceUrl, likes } = setup({ isOpen: () => false })

    onPress(press('k1'))
    onPress(press('k1'))

    expect(voiceUrl).not.toHaveBeenCalled()
    expect(player.toggles).toEqual([])
    expect(likes).toEqual([])
  })

  it('does not like when the page says a message may not be liked (an archived room), but still plays and pauses it', async () => {
    const { onPress, player, likes, voiceUrl } = setup({ canLike: () => false })
    const spy = vi.spyOn(Date, 'now').mockReturnValue(Date.now())

    onPress(press('k1'))
    await settle()
    // No double tap in an archived room: the second press is the player's own pause.
    onPress(press('k1'))

    expect(likes).toEqual([])
    expect(player.stops).toBe(0)
    expect(voiceUrl).toHaveBeenCalledTimes(1)
    expect(player.toggles).toEqual([['k1', 'https://signed/k1'], ['k1', VOICE_UNSIGNED]])
    spy.mockRestore()
  })

  it('leaves a keyboard press (no `detail`) to play or pause only, never to like', async () => {
    const { onPress, player, likes } = setup()

    onPress(press('k1', { detail: 0 }))
    await settle()
    onPress(press('k1', { detail: 0 }))

    expect(likes).toEqual([])
    expect(player.toggles).toEqual([['k1', 'https://signed/k1'], ['k1', VOICE_UNSIGNED]])
  })

  it('a second press after the double-tap window is a play again, not a like', async () => {
    const { onPress, likes, player } = setup()
    const now = Date.now()
    const spy = vi.spyOn(Date, 'now')

    spy.mockReturnValue(now)
    onPress(press('k1'))
    await settle()
    spy.mockReturnValue(now + DOUBLE_TAP_MS + 1)
    onPress(press('k1'))
    await settle()

    expect(likes).toEqual([])
    expect(player.toggles).toHaveLength(2)
    spy.mockRestore()
  })

  it('ignores a message still on its way, and a press that is not the play button at all', () => {
    const { onPress, voiceUrl } = setup({ items: () => [item({ delivery: 'sending' })] })

    onPress(press('k1'))
    onPress(press('k1', { play: false }))

    expect(voiceUrl).not.toHaveBeenCalled()
  })
})
