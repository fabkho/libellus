import { describe, expect, it } from 'vitest'
import {
  anyHeldBack,
  clampToOffer,
  levelStates,
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
    expect(anyHeldBack(states)).toBe(true)
    expect(anyHeldBack(levelStates(false, 'friends'))).toBe(false)
    expect(levelStates(true, 'private').filter((s) => s.disabled).map((s) => s.level)).toEqual(['friends', 'public'])
  })

  it('settles a choice: never wider than the parent, never Everyone while it is off', () => {
    expect(settleLevel('public', true, 'friends')).toBe('friends')
    expect(settleLevel('public', false, null)).toBe('friends')
    expect(settleLevel('public', true, null)).toBe('public')
    expect(settleLevel('friends', true, 'private')).toBe('private')
  })
})
