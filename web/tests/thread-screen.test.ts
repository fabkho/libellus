import { describe, expect, it } from 'vitest'
import * as roomThread from '@/utils/roomThread'
import * as voicePress from '@/composables/useVoicePress'
import * as notes from '@/utils/notes'
import * as visibility from '@/utils/noteVisibility'
import * as screen from '@/composables/useThreadScreen'

/**
 * The thread screen two pages share (`composables/useThreadScreen.ts`): its types first (the seam the two pages are moved onto),
 * and the pure modules it stands on, pinned by the names it and the pages call. Nothing of those modules changes in this work —
 * `roomThread`'s quotes and runs, the press on a voice message, and Notes' own view model are already shared and tested on their
 * own (tests/room-thread.test.ts, tests/use-voice-press.test.ts, tests/notes-thread-view.test.ts).
 */

describe('the pure modules the thread screen stands on', () => {
  it('keeps what both threads draw from `utils/roomThread.ts`', () => {
    for (const name of ['roomItems', 'sameAuthorRun', 'quoteOf', 'replyChipOf', 'toggledReaction', 'reportInput', 'VOICE_UNSIGNED', 'QUOTE_PREVIEW_MAX', 'REPORT_NOTE_MAX'])
      expect(roomThread, name).toHaveProperty(name)
  })

  it('keeps the press on a voice message, and the base’s double-tap window', () => {
    expect(voicePress.DOUBLE_TAP_MS).toBe(300)
    expect(typeof voicePress.useVoicePress).toBe('function')
  })

  it('keeps Notes’ own view model: the items, the quote’s source and the words of a refusal', () => {
    for (const name of ['noteItems', 'quoteSourceOf', 'noteQuoteOf', 'noteErrorKey', 'chapterOfSegment', 'sentNote']) expect(notes, name).toHaveProperty(name)
  })

  it('keeps the audience’s rules, which no thread screen touches', () => {
    for (const name of ['noteSendOptions', 'noteVoiceAllowed', 'settleLevel', 'startLevel', 'clampToOffer']) expect(visibility, name).toHaveProperty(name)
  })
})

describe('the thread screen’s seam', () => {
  it('is types and nothing to run, at first: the behaviour moves over page by page', () => {
    expect(Object.keys(screen)).toEqual([])
  })
})
