/**
 * The Friends tab (Profile → Account → Friends tab): the feed as a tab of its own, after Library. On
 * for every member until she turns it off, a setting of this device kept under `libellus.`, so
 * signing out (or another member signing in) puts it back to on with the rest of what the device
 * remembered about the member (data/localData.ts). With it off, `/friends` is the pushed screen it
 * was before the tab: reached from Home's Your friends, the Profile's Friends row and a member's page.
 * Framework-free, so Vitest pins it in plain Node (tests/friends-tab.test.ts).
 */
import { LOCAL_DATA_PREFIX } from '~/data/localData'

/** The local-storage key: under `libellus.`, so signing out clears it. */
export const FRIENDS_TAB_KEY = `${LOCAL_DATA_PREFIX}friendsTab`

/** The slice of Storage the setting needs; `window.localStorage` fits. */
export type FriendsTabStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

/** What a stored string means: only an explicit `off` turns the tab off; nothing, or anything unknown, is on. */
export function parseFriendsTab(raw: string | null | undefined): boolean {
  return raw !== 'off'
}

export function readFriendsTab(storage: Pick<FriendsTabStorage, 'getItem'>): boolean {
  try {
    return parseFriendsTab(storage.getItem(FRIENDS_TAB_KEY))
  } catch {
    // Storage can be unavailable (private mode, blocked): the default, on.
    return true
  }
}

/** On is the default, so it is stored as nothing at all: only `off` is written. */
export function writeFriendsTab(storage: FriendsTabStorage & { removeItem?: (key: string) => void }, on: boolean): void {
  try {
    if (on) storage.removeItem?.(FRIENDS_TAB_KEY)
    else storage.setItem(FRIENDS_TAB_KEY, 'off')
  } catch {
    // Not persisted, but the setting still holds for this visit.
  }
}

/** The tabs of the bar, in order. Search is not a page: the bar draws it after them. */
export const TABS = [
  { key: 'home', to: '/', icon: 'home' },
  { key: 'library', to: '/library', icon: 'library' },
  { key: 'friends', to: '/friends', icon: 'people', optional: true },
] as const

export type Tab = (typeof TABS)[number]

/** The tabs showing: every one, the Friends tab only while its setting is on. */
export function visibleTabs(friendsTab: boolean): Tab[] {
  return TABS.filter((tab) => !('optional' in tab) || friendsTab)
}
