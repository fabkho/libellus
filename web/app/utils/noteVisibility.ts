/**
 * Who sees a note, as the composer and the action bar work it out (docs/plans/book-notes.md parts 2.3.2 and 2.3.5): the three levels and their
 * order, what a new note and a reply start at, what the device remembers, what is on offer while the owner's switch for *Everyone* is off.
 * Pure functions on plain values, so Vitest drives them in Node; the database decides who really sees a note (`can_see_note`), this only keeps
 * the composer from offering what the database would refuse.
 */

/** From the narrowest: her own notebook, the members she follows who follow her back, every signed-in member. */
export const NOTE_LEVELS = ['private', 'friends', 'public'] as const
export type NoteLevel = (typeof NOTE_LEVELS)[number]

/** Where the device keeps the last choice that was not Everyone (under `libellus.`: signing out clears it). */
export const NOTE_LEVEL_KEY = 'libellus.notes.visibility'

/** What the device may remember: Everyone is chosen per note, never kept. */
export type RememberedLevel = Exclude<NoteLevel, 'public'>

/** The level the device falls back to. */
export const DEFAULT_LEVEL: RememberedLevel = 'friends'

export const isNoteLevel = (value: unknown): value is NoteLevel => typeof value === 'string' && (NOTE_LEVELS as readonly string[]).includes(value)

/** Private 0, Friends 1, Everyone 2 (`private.note_level`). */
export const levelRank = (level: NoteLevel): number => NOTE_LEVELS.indexOf(level)

/** The narrower of two levels. */
export const narrower = (a: NoteLevel, b: NoteLevel): NoteLevel => (levelRank(a) <= levelRank(b) ? a : b)

/** The levels the control offers: Everyone only while the owner's switch is on (`notes_config().publicEnabled`). */
export const offeredLevels = (publicEnabled: boolean): NoteLevel[] => (publicEnabled ? [...NOTE_LEVELS] : NOTE_LEVELS.filter((level) => level !== 'public'))

/** The level to pick when a stored one is not on offer: the widest that is. */
export const clampToOffer = (level: NoteLevel, publicEnabled: boolean): NoteLevel => (level === 'public' && !publicEnabled ? 'friends' : level)

/** What the device remembers; a broken or missing value reads as Friends. */
export function rememberedLevel(storage: Pick<Storage, 'getItem'> | null | undefined): RememberedLevel {
  try {
    const value = storage?.getItem(NOTE_LEVEL_KEY)
    return value === 'private' || value === 'friends' ? value : DEFAULT_LEVEL
  } catch {
    return DEFAULT_LEVEL
  }
}

/** Keeps a choice for the next note; Everyone is not kept (a public note is a decision every time). */
export function rememberLevel(storage: Pick<Storage, 'setItem'> | null | undefined, level: NoteLevel): void {
  if (level === 'public') return
  try {
    storage?.setItem(NOTE_LEVEL_KEY, level)
  } catch {
    // A full or blocked storage: the choice lasts until she leaves the page.
  }
}

/**
 * The level a composer starts at: a new note at the remembered one; a reply at the narrower of the parent's level (as it shows to her:
 * `effectiveVisibility`, so a public parent counts as friends while Everyone is off) and the remembered one.
 */
export function startLevel(remembered: RememberedLevel, parent: NoteLevel | null): NoteLevel {
  return parent ? narrower(parent, remembered) : remembered
}

/** The state of each level for the control: on offer, or off because the note it answers is narrower ("Can't be wider than the note you answer."). */
export type LevelState = { level: NoteLevel; disabled: boolean }

export function levelStates(publicEnabled: boolean, parent: NoteLevel | null): LevelState[] {
  return offeredLevels(publicEnabled).map((level) => ({ level, disabled: parent !== null && levelRank(level) > levelRank(parent) }))
}

/** The level a choice becomes once a parent is quoted (or the switch changed): never wider than the parent, never one that is not on offer. */
export function settleLevel(level: NoteLevel, publicEnabled: boolean, parent: NoteLevel | null): NoteLevel {
  const offered = clampToOffer(level, publicEnabled)
  return parent ? narrower(offered, parent) : offered
}

/** What the split send button's menu says of each audience (the screen's words: `notes.level.*`) and why a wider one is off. */
export type SendAsWords = { levels: Record<NoteLevel, { label: string; hint: string }>; heldBack: string }

/** The base's `SendOption` for a note's audience (`UiComposer` `sendOptions`): the glyph on the tab, the tone that colours the send button, the line in the menu. */
export type NoteSendOption = { value: NoteLevel; label: string; hint: string; icon: 'lock' | 'people' | 'globe'; tone: 'quiet' | 'neutral' | 'accent'; disabled: boolean }

const SEND_ICON: Record<NoteLevel, NoteSendOption['icon']> = { private: 'lock', friends: 'people', public: 'globe' }
/** Friends is the plain ink button (nothing to read); Only me is the calm one, Everyone the lamp amber: the audience is seen on the button before anything is sent. */
const SEND_TONE: Record<NoteLevel, NoteSendOption['tone']> = { private: 'quiet', friends: 'neutral', public: 'accent' }

/**
 * The menu of the split send button: Only me, Friends and, while the owner's switch is on, Everyone. A level wider than the note being answered is in the menu but
 * off, and its line says why (a reply is never wider than its parent). A reply to a private note leaves only Only me.
 */
export function noteSendOptions(publicEnabled: boolean, parent: NoteLevel | null, words: SendAsWords): NoteSendOption[] {
  return levelStates(publicEnabled, parent).map(({ level, disabled }) => ({
    value: level,
    label: words.levels[level].label,
    hint: disabled ? words.heldBack : words.levels[level].hint,
    icon: SEND_ICON[level],
    tone: SEND_TONE[level],
    disabled,
  }))
}

/**
 * Whether the microphone is offered with this audience: **Only me** alone, and only when the note is new or answers her own **live private** note (the database takes
 * a voice answer to nothing else, `voice_private_only`). The screen passes `sendAs`; the gate is a rule, so it is tested in Node (tests/note-visibility.test.ts).
 */
export function noteVoiceAllowed(level: NoteLevel, parent: { mine: boolean; visibility: NoteLevel; removed: boolean } | null): boolean {
  if (level !== 'private') return false
  return !parent || (parent.mine && parent.visibility === 'private' && !parent.removed)
}
