import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Voice parity of the two thread screens, before either moves onto the shared composable: `useVoicePress` takes the same option keys
 * from a Book's chapter of Notes and from a buddy read's Section, and hands the same things in the same way. Only the values differ
 * (what may be liked, the store it signs from, the two sentences), which is what `composables/useVoicePress.ts` was written for.
 *
 * Read from the two pages' own source: the option keys of their `useVoicePress({ … })` call, in order. A key one page passes and the
 * other forgets is a press that silently stops playing, liking or wording a failure on that screen — the kind of drift that no unit
 * test of the composable can see.
 */

const page = (path: string) => readFileSync(fileURLToPath(new URL(`../app/pages/${path}`, import.meta.url)), 'utf8')

/** The option keys of the page's `useVoicePress({ … })` call, in the order it passes them (`voicePlayer` alone is shorthand). */
function voicePressKeys(source: string): string[] {
  const start = source.indexOf('useVoicePress({')
  if (start < 0) throw new Error('the page no longer calls useVoicePress')
  const block = source.slice(start, source.indexOf('\n})', start))
  const assignments = [...block.matchAll(/^ {2}(\w+):/gm)].map((match) => match[1]!)
  const shorthand = [...block.matchAll(/^ {2}(\w+),$/gm)].map((match) => match[1]!)
  return [...assignments, ...shorthand].sort()
}

const NOTES = page('notes/[book]/[chapter].vue')
const TOGETHER = page('together/[id]/[section].vue')

describe('the press on a voice message, on both threads', () => {
  it('passes the same option keys, all eleven, to the one composable', () => {
    const expected = ['canLike', 'failedWord', 'isOpen', 'isPreview', 'items', 'like', 'likeEmoji', 'notice', 'offlineWord', 'voicePlayer', 'voiceUrl']
    expect(voicePressKeys(NOTES)).toEqual(expected)
    expect(voicePressKeys(TOGETHER)).toEqual(expected)
  })

  it('hands in the thread’s items and the veil’s own answer, never a copy of either', () => {
    for (const source of [NOTES, TOGETHER]) {
      expect(source).toMatch(/^ {2}items: \(\) => items\.value,$/m)
      expect(source).toMatch(/^ {2}isOpen: \(\) => view\.value\?\.open === true,$/m)
    }
  })

  it('likes with the first emoji of its own bar, through the page’s own react', () => {
    expect(NOTES).toContain('likeEmoji: NOTE_EMOJI[0]!')
    expect(TOGETHER).toContain('likeEmoji: EMOJIS[0]!')
    for (const source of [NOTES, TOGETHER]) expect(source).toMatch(/^ {2}like: \(id, emoji\) => void react\(id, emoji\),$/m)
  })

  it('signs from the thread’s own store, and lets the device’s own copy play without signing it', () => {
    for (const source of [NOTES, TOGETHER]) {
      expect(source).toMatch(/^ {2}isPreview: \(key\) => !!store\.previewOf\(key\),$/m)
      expect(source).toMatch(/^ {2}voiceUrl: \(path\) => store\.voiceUrl\(path\),$/m)
    }
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

  it('shares the one audio element: `useVoicePlayer`, once, and handed to the press', () => {
    for (const source of [NOTES, TOGETHER]) {
      expect(source.match(/useVoicePlayer\(\)/g), 'one player').toHaveLength(1)
      expect(source).toMatch(/^ {2}voicePlayer,$/m)
    }
  })
})
