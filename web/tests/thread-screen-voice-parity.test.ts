import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Voice parity of the two thread screens: `useVoicePress` takes the same option keys from a Book's chapter of Notes and from a buddy
 * read's Section, and hands the same things in the same way. Only the values differ (what may be liked, the store it signs from, the
 * two sentences), which is what `composables/useVoicePress.ts` was written for.
 *
 * Read from the source: the option keys of the `useVoicePress({ … })` call, in order. A key one caller passes and the other forgets is
 * a press that silently stops playing, liking or wording a failure on that screen — the kind of drift no unit test of the composable
 * can see. While each page carried its own call both were read (the move onto the shared screen kept them identical); once one call
 * site serves both, it is that one.
 */

const page = (path: string) => readFileSync(fileURLToPath(new URL(`../app/pages/${path}`, import.meta.url)), 'utf8')

/** The option keys of the page's `useVoicePress({ … })` call, in the order it passes them (`voicePlayer` alone is shorthand). */
function voicePressKeys(source: string): string[] {
  const start = source.indexOf('useVoicePress({')
  if (start < 0) throw new Error('the page no longer calls useVoicePress')
  const rest = source.slice(start)
  const end = rest.search(/\n {0,2}\}\)/)
  const block = end < 0 ? rest : rest.slice(0, end)
  const assignments = [...block.matchAll(/^ +(\w+):/gm)].map((match) => match[1]!)
  const shorthand = [...block.matchAll(/^ +(\w+),$/gm)].map((match) => match[1]!)
  return [...assignments, ...shorthand].sort()
}

const NOTES = page('notes/[book]/[chapter].vue')
const TOGETHER = page('together/[id]/[section].vue')
/**
 * Where the options are taken: the page's own call while each page carried one, the shared screen once the press lives there. The
 * pages hand in what differs either way (what may be liked, the store it signs from, the two sentences).
 */
const SCREEN = readFileSync(fileURLToPath(new URL('../app/composables/useThreadScreen.ts', import.meta.url)), 'utf8')
const pressOf = (source: string) => (source.includes('useVoicePress({') ? source : SCREEN)

describe('the press on a voice message, on both threads', () => {
  it('passes the same option keys, all eleven, to the one composable', () => {
    const expected = ['canLike', 'failedWord', 'isOpen', 'isPreview', 'items', 'like', 'likeEmoji', 'notice', 'offlineWord', 'voicePlayer', 'voiceUrl']
    expect(voicePressKeys(pressOf(NOTES))).toEqual(expected)
    expect(voicePressKeys(pressOf(TOGETHER))).toEqual(expected)
  })

  it('hands in the thread’s items and the veil’s own answer, never a copy of either', () => {
    // One call site, both screens: its items are the screen's own, and the veil is the page's answer through the adapter.
    const press = pressOf(NOTES)
    expect(press).toMatch(/^ {2,}items: \(\) => items\.value,$/m)
    expect(press).toMatch(/^ {2,}isOpen: adapter\.isOpen,$/m)
  })

  it('likes with the first emoji of its own bar, through the page’s own react', () => {
    // Each page still says which emoji its bar opens with; the call site is one.
    expect(NOTES).toMatch(/likeEmoji: NOTE_EMOJI\[0\]!/)
    expect(TOGETHER).toMatch(/likeEmoji: EMOJIS\[0\]!/)
    expect(pressOf(NOTES)).toMatch(/^ {2,}likeEmoji: opts\.likeEmoji,$/m)
    expect(pressOf(NOTES)).toMatch(/^ {2,}like: \(id, emoji\) => void react\(id, emoji\),$/m)
  })

  it('signs from the thread’s own store, and lets the device’s own copy play without signing it', () => {
    const press = pressOf(NOTES)
    expect(press).toMatch(/^ {2,}isPreview: \(key\) => !!adapter\.previewOf\(key\),$/m)
    expect(press).toMatch(/^ {2,}voiceUrl: \(path\) => adapter\.voiceUrl\(path\),$/m)
    // And each adapter signs through its own store's one call.
    expect(readFileSync(fileURLToPath(new URL('../app/utils/notesThreadAdapter.ts', import.meta.url)), 'utf8')).toMatch(/voiceUrl: \(path\) => store\.voiceUrl\(path\)/)
    expect(readFileSync(fileURLToPath(new URL('../app/utils/buddyThreadAdapter.ts', import.meta.url)), 'utf8')).toMatch(/voiceUrl: \(path\) => store\.voiceUrl\(path\)/)
  })

  it('words a failure in the page’s own two sentences, and leaves an archived read unable to like', () => {
    expect(NOTES).toContain("offlineWord: () => t(noteErrorKey('offline'))")
    expect(TOGETHER).toContain("offlineWord: () => t(buddyErrorKey('offline'))")
    expect(NOTES).toContain("failedWord: () => t('notes.thread.voicePlayFailed')")
    expect(TOGETHER).toContain("failedWord: () => t('together.thread.voice.playFailed')")
    // A note is always hers to like; a read that was archived is not.
    expect(NOTES).toContain('canLike: () => true')
    expect(TOGETHER).toContain('canLike: () => !archived.value')
  })

  it('takes the press in the capture phase of the thread’s root, where the base’s own press cannot run first', () => {
    expect(NOTES).toContain('@click.capture="voicePress"')
    expect(TOGETHER).toContain('@click.capture="voicePress"')
  })

  it('shares the one audio element: `useVoicePlayer`, once a page, and handed to the press', () => {
    for (const source of [NOTES, TOGETHER]) expect(source.match(/useVoicePlayer\(\)/g), 'one player').toHaveLength(1)
    expect(pressOf(NOTES)).toMatch(/^ {2,}voicePlayer: opts\.voicePlayer,$/m)
  })
})
