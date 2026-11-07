import { describe, expect, it } from 'vitest'
import {
  clampToOffer,
  levelStates,
  noteSendOptions,
  NOTE_LEVEL_KEY,
  narrower,
  offeredLevels,
  rememberedLevel,
  rememberLevel,
  settleLevel,
  startLevel,
} from '@/utils/noteVisibility'

const store = (initial: Record<string, string> = {}) => {
  const data = { ...initial }
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) }
}

describe('what the composer offers', () => {
  it('offers three levels while Everyone is on, two while the owner’s switch is off', () => {
    expect(offeredLevels(true)).toEqual(['private', 'friends', 'public'])
    expect(offeredLevels(false)).toEqual(['private', 'friends'])
    expect(clampToOffer('public', false)).toBe('friends')
    expect(clampToOffer('public', true)).toBe('public')
    expect(clampToOffer('private', false)).toBe('private')
  })

  it('orders the levels: the narrower of two', () => {
    expect(narrower('public', 'friends')).toBe('friends')
    expect(narrower('private', 'public')).toBe('private')
    expect(narrower('friends', 'friends')).toBe('friends')
  })
})

describe('what the device remembers', () => {
  it('is Friends until a choice was kept, and keeps Only me and Friends, never Everyone', () => {
    const s = store()
    expect(rememberedLevel(s)).toBe('friends')
    rememberLevel(s, 'private')
    expect(rememberedLevel(s)).toBe('private')
    rememberLevel(s, 'public')
    expect(rememberedLevel(s)).toBe('private')
    expect(NOTE_LEVEL_KEY.startsWith('libellus.')).toBe(true)
  })

  it('reads a broken or foreign value as Friends and survives a storage that throws', () => {
    expect(rememberedLevel(store({ [NOTE_LEVEL_KEY]: 'public' }))).toBe('friends')
    expect(rememberedLevel(store({ [NOTE_LEVEL_KEY]: '{' }))).toBe('friends')
    expect(rememberedLevel(null)).toBe('friends')
    const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('full') } }
    expect(rememberedLevel(broken)).toBe('friends')
    expect(() => rememberLevel(broken, 'private')).not.toThrow()
  })
})

describe('where a note and a reply start', () => {
  it('starts a new note at the remembered level and a reply at the narrower of its parent’s and hers', () => {
    expect(startLevel('friends', null)).toBe('friends')
    expect(startLevel('private', null)).toBe('private')
    expect(startLevel('friends', 'public')).toBe('friends')
    expect(startLevel('friends', 'private')).toBe('private')
    expect(startLevel('private', 'public')).toBe('private')
  })

  it('holds wider levels back while a note is quoted, and none when it is not', () => {
    expect(levelStates(true, null).every((s) => !s.disabled)).toBe(true)
    const states = levelStates(true, 'friends')
    expect(states.map((s) => [s.level, s.disabled])).toEqual([['private', false], ['friends', false], ['public', true]])
    expect(states.some((s) => s.disabled)).toBe(true)
    expect(levelStates(false, 'friends').some((s) => s.disabled)).toBe(false)
    expect(levelStates(true, 'private').filter((s) => s.disabled).map((s) => s.level)).toEqual(['friends', 'public'])
  })

  it('settles a choice: never wider than the parent, never Everyone while it is off', () => {
    expect(settleLevel('public', true, 'friends')).toBe('friends')
    expect(settleLevel('public', false, null)).toBe('friends')
    expect(settleLevel('public', true, null)).toBe('public')
    expect(settleLevel('friends', true, 'private')).toBe('private')
  })
})

describe('the menu of the split send button', () => {
  const words = {
    levels: {
      private: { label: 'Only me', hint: 'Only you' },
      friends: { label: 'Friends', hint: 'Your friends' },
      public: { label: 'Everyone', hint: 'All members, with your name and photo' },
    },
    heldBack: 'Can’t be wider than the note you answer.',
  }
  const view = (publicEnabled: boolean, parent: Parameters<typeof noteSendOptions>[1]) => noteSendOptions(publicEnabled, parent, words).map((o) => [o.value, o.disabled, o.tone, o.icon])

  it('offers Only me, Friends and Everyone while the owner’s switch is on: a lock, two people and a globe, in the tones that colour the button', () => {
    expect(view(true, null)).toEqual([
      ['private', false, 'quiet', 'lock'],
      ['friends', false, 'neutral', 'people'],
      ['public', false, 'accent', 'globe'],
    ])
    expect(noteSendOptions(true, null, words).map((o) => [o.label, o.hint])).toEqual([
      ['Only me', 'Only you'],
      ['Friends', 'Your friends'],
      ['Everyone', 'All members, with your name and photo'],
    ])
  })

  it('has no Everyone at all while the switch is off, so Friends stays the widest choice', () => {
    expect(view(false, null).map(([value]) => value)).toEqual(['private', 'friends'])
    expect(view(false, 'friends').map(([value, disabled]) => [value, disabled])).toEqual([['private', false], ['friends', false]])
  })

  it('turns off what is wider than the note being answered, and says why in the line under it', () => {
    expect(view(true, 'friends').map(([value, disabled]) => [value, disabled])).toEqual([['private', false], ['friends', false], ['public', true]])
    expect(view(true, 'private').map(([value, disabled]) => [value, disabled])).toEqual([['private', false], ['friends', true], ['public', true]])
    expect(view(true, 'public').every(([, disabled]) => !disabled)).toBe(true)
    const held = noteSendOptions(true, 'friends', words)
    expect(held.find((o) => o.value === 'public')!.hint).toBe(words.heldBack)
    expect(held.find((o) => o.value === 'friends')!.hint).toBe('Your friends')
  })
})
