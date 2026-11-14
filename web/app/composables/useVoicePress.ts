import { getCurrentInstance, onBeforeUnmount } from 'vue'
import { VOICE_UNSIGNED, type ThreadItem } from '~/utils/roomThread'

/**
 * The press on the play button of a **stored voice message**, taken before the base's own (the capture phase of the thread's root:
 * the base would play the placeholder it was given, `VOICE_UNSIGNED`, because nothing was signed when the thread loaded). Here the
 * first press asks the store for a URL (five minutes, kept for four) and plays it; a second press inside the double-tap window likes
 * the message, as on any bubble (and stops the sound the first one started: a double tap likes, it does not play). A press with the
 * keyboard (no `detail`) only plays or pauses: its way to react is the bubble's React button. A message still on its way, or refused,
 * plays from the device's own copy (the base's press), and so does the double tap on the card itself.
 *
 * A buddy read (`pages/together/[id]/[section].vue`) and a Book's notes (`pages/notes/[book]/[chapter].vue`) both draw one of these
 * threads, and the whole interaction is the same on both: it lives here, once, and each page hands in the four things that differ
 * (whether a message may be liked at all, which emoji that is, the store it signs from, and the sentence a failure is worded with).
 * The races — a second press while the URL is still in flight, a press on the one that is playing, a recording never signed — are the
 * part no view-model test could reach; `tests/use-voice-press.test.ts` drives them here.
 */

/** The base's double-tap window (`UiBubble`): a second press inside it likes. */
export const DOUBLE_TAP_MS = 300

/** What the store answers when asked to sign a recording (`stores/notes.ts`, `stores/buddyRead.ts`). */
export type VoiceUrlAnswer = { data: string; error: null } | { data: null; error: string }

/** The base's one audio element (`useVoicePlayer`, auto-imported from the UI layer): what of it the press uses. */
export type VoicePressPlayer = {
  current: { key: string | null; playing: boolean; positionMs: number; failed: boolean }
  toggle: (key: string, url: string) => void
  stop: () => void
}

export type VoicePressOptions = {
  /** The thread's items (`items` on the page: both derive them from a store). */
  items: () => readonly ThreadItem[]
  /** The thread is open to her: nothing of one that is not is fetched (the page's veil, one step stricter than the press itself). */
  isOpen: () => boolean
  /** A message of this thread may be liked at all (a buddy read's archived room may not; a note always may). */
  canLike: () => boolean
  /** The first reaction of this thread's bar: what a double tap puts on a message. */
  likeEmoji: string
  /** Reacts to a stored message (the page's `react`). */
  like: (id: string, emoji: string) => void
  /** Words a failure, or clears it with null (the page's `notice`). */
  notice: (message: string | null) => void
  /** The store's own copy of a recording made in this session (`store.previewOf`): the base plays that one. */
  isPreview: (key: string) => boolean
  /** Asks the store to sign a file (`store.voiceUrl`). */
  voiceUrl: (path: string) => Promise<VoiceUrlAnswer>
  /** "You are offline", in the app's words for this screen. */
  offlineWord: () => string
  /** "That recording will not play", in the app's words for this screen. */
  failedWord: () => string
  /** The base's player, one audio element for the whole app (`useVoicePlayer`). */
  voicePlayer: VoicePressPlayer
}

type Press = { at: number; started: boolean; liked: boolean }

export function useVoicePress(options: VoicePressOptions) {
  const { voicePlayer } = options
  const lastPress = new Map<string, Press>()

  // Leaving the thread silences the voice that is playing.
  if (getCurrentInstance()) onBeforeUnmount(() => voicePlayer.stop())

  /** The capture-phase press, bound to the thread's root (`@click.capture`). */
  function onPress(event: MouseEvent) {
    const button = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-testid$=".voicePlay"]')
    if (!button) return
    const key = button.closest<HTMLElement>('[data-key]')?.dataset.key
    const item = key ? options.items().find((i) => i.key === key) : undefined
    if (!item?.voice || item.delivery !== 'sent' || !item.media?.path || options.isPreview(item.key)) return
    event.stopPropagation()
    event.preventDefault()
    // Nothing of a thread that is not open to her is fetched.
    if (!options.isOpen()) return
    const now = Date.now()
    const before = lastPress.get(item.key)
    const canLike = options.canLike() && !!item.id && event.detail > 0
    if (canLike && before && now - before.at <= DOUBLE_TAP_MS) {
      lastPress.delete(item.key)
      // The first press may still be waiting for its URL: it is told not to play when it comes.
      before.liked = true
      if (before.started) voicePlayer.stop()
      options.like(item.id!, options.likeEmoji)
      return
    }
    const press: Press = { at: now, started: false, liked: false }
    lastPress.set(item.key, press)
    void play(item, press)
  }

  async function play(item: ThreadItem, press: Press) {
    options.notice(null)
    const path = item.media!.path!
    // Her press again on the one that is playing (or paused): the base's player pauses or resumes it, with no new URL.
    if (voicePlayer.current.key === item.key && !voicePlayer.current.failed) {
      const playing = voicePlayer.current.playing
      voicePlayer.toggle(item.key, VOICE_UNSIGNED)
      press.started = !playing
      return
    }
    const answer = await options.voiceUrl(path)
    if (answer.error) {
      options.notice(answer.error === 'offline' ? options.offlineWord() : options.failedWord())
      return
    }
    // A second press came while the URL was on its way: that was a double tap, which likes and does not play.
    if (press.liked) return
    voicePlayer.toggle(item.key, answer.data)
    press.started = true
  }

  return { onPress }
}
