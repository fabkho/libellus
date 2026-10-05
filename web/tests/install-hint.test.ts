import { describe, expect, it } from 'vitest'
import {
  INSTALL_HINT_KEY,
  INSTALL_HINT_QUIET_MS,
  isInstalled,
  isIos,
  isQuiet,
  isSafari,
  readDismissedAt,
  shouldShowInstallHint,
  writeDismissedAt,
} from '@/utils/installHint'

/**
 * The install hint's rules (issue #94): Safari on an iPhone or iPad, not yet
 * installed, not dismissed within the last week.
 */
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
const IPAD_SAFARI =
  'Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
// iPadOS 13+ asks for the desktop site by default and says it is a Mac.
const IPADOS_DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15'
const MAC_SAFARI = IPADOS_DESKTOP
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/137.0.7151.79 Mobile/15E148 Safari/604.1'
const IPHONE_FIREFOX =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/139.0 Mobile/15E148 Safari/605.1.15'
const IPHONE_INSTAGRAM =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 380.0.0'
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36'
const DESKTOP_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'

const NOW = Date.UTC(2026, 5, 15, 12)
const DAY = 24 * 60 * 60 * 1000

describe('isIos', () => {
  it('knows iPhone, iPod and iPad', () => {
    expect(isIos({ userAgent: IPHONE_SAFARI })).toBe(true)
    expect(isIos({ userAgent: IPAD_SAFARI })).toBe(true)
    expect(isIos({ userAgent: IPHONE_SAFARI.replace('iPhone', 'iPod') })).toBe(true)
  })

  it('knows an iPad that says it is a Mac by its touch screen', () => {
    expect(isIos({ userAgent: IPADOS_DESKTOP, platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true)
  })

  it('does not take a Mac for an iPad', () => {
    expect(isIos({ userAgent: MAC_SAFARI, platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false)
    expect(isIos({ userAgent: MAC_SAFARI, platform: 'MacIntel' })).toBe(false)
    // A touch-screen laptop is no Mac.
    expect(isIos({ userAgent: DESKTOP_CHROME, platform: 'Win32', maxTouchPoints: 10 })).toBe(false)
  })

  it('does not take Android or a desktop for iOS', () => {
    expect(isIos({ userAgent: ANDROID_CHROME, platform: 'Linux armv81', maxTouchPoints: 5 })).toBe(false)
    expect(isIos({ userAgent: DESKTOP_CHROME })).toBe(false)
  })
})

describe('isSafari', () => {
  it('knows Safari on iPhone, iPad and the iPad that says it is a Mac', () => {
    expect(isSafari({ userAgent: IPHONE_SAFARI })).toBe(true)
    expect(isSafari({ userAgent: IPAD_SAFARI })).toBe(true)
    expect(isSafari({ userAgent: IPADOS_DESKTOP })).toBe(true)
  })

  it('leaves other iOS browsers and in-app web views alone', () => {
    expect(isSafari({ userAgent: IPHONE_CHROME })).toBe(false)
    expect(isSafari({ userAgent: IPHONE_FIREFOX })).toBe(false)
    expect(isSafari({ userAgent: IPHONE_INSTAGRAM })).toBe(false)
  })
})

describe('isInstalled', () => {
  it('is the Home Screen app when iOS or the display mode says standalone', () => {
    expect(isInstalled({ userAgent: IPHONE_SAFARI, standalone: true })).toBe(true)
    expect(isInstalled({ userAgent: IPHONE_SAFARI, displayModeStandalone: true })).toBe(true)
  })

  it('is a browser tab otherwise (standalone is false in Safari, absent elsewhere)', () => {
    expect(isInstalled({ userAgent: IPHONE_SAFARI, standalone: false, displayModeStandalone: false })).toBe(false)
    expect(isInstalled({ userAgent: IPHONE_SAFARI })).toBe(false)
  })
})

describe('isQuiet', () => {
  it('is quiet for a week after a dismissal, then over', () => {
    expect(isQuiet(null, NOW)).toBe(false)
    expect(isQuiet(NOW, NOW)).toBe(true)
    expect(isQuiet(NOW - 6 * DAY, NOW)).toBe(true)
    expect(isQuiet(NOW - INSTALL_HINT_QUIET_MS, NOW)).toBe(false)
    expect(isQuiet(NOW - 8 * DAY, NOW)).toBe(false)
  })

  it('does not stay quiet for longer than a week when the clock was set back', () => {
    expect(isQuiet(NOW + 30 * DAY, NOW)).toBe(false)
  })
})

describe('shouldShowInstallHint', () => {
  const safari = { userAgent: IPHONE_SAFARI, platform: 'iPhone', maxTouchPoints: 5, standalone: false, displayModeStandalone: false }

  it('shows in Safari on an iPhone that has not dismissed it', () => {
    expect(shouldShowInstallHint(safari, null, NOW)).toBe(true)
  })

  it('shows on an iPad, including the one that says it is a Mac', () => {
    expect(shouldShowInstallHint({ ...safari, userAgent: IPAD_SAFARI, platform: 'iPad' }, null, NOW)).toBe(true)
    expect(shouldShowInstallHint({ ...safari, userAgent: IPADOS_DESKTOP, platform: 'MacIntel' }, null, NOW)).toBe(true)
  })

  it('is gone once installed', () => {
    expect(shouldShowInstallHint({ ...safari, standalone: true }, null, NOW)).toBe(false)
    expect(shouldShowInstallHint({ ...safari, displayModeStandalone: true }, null, NOW)).toBe(false)
  })

  it('stays away a week after a dismissal, then asks again', () => {
    expect(shouldShowInstallHint(safari, NOW - 2 * DAY, NOW)).toBe(false)
    expect(shouldShowInstallHint(safari, NOW - 8 * DAY, NOW)).toBe(true)
  })

  it('never shows on Android, a desktop, a Mac, or another iOS browser', () => {
    expect(shouldShowInstallHint({ userAgent: ANDROID_CHROME, platform: 'Linux armv81', maxTouchPoints: 5 }, null, NOW)).toBe(false)
    expect(shouldShowInstallHint({ userAgent: DESKTOP_CHROME, platform: 'MacIntel', maxTouchPoints: 0 }, null, NOW)).toBe(false)
    expect(shouldShowInstallHint({ userAgent: MAC_SAFARI, platform: 'MacIntel', maxTouchPoints: 0 }, null, NOW)).toBe(false)
    expect(shouldShowInstallHint({ ...safari, userAgent: IPHONE_CHROME }, null, NOW)).toBe(false)
  })
})

describe('what a dismissal remembers', () => {
  function memoryStorage(initial: Record<string, string> = {}) {
    const items = new Map(Object.entries(initial))
    return {
      items,
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
    }
  }

  it('keeps the time, outside the prefix sign-out clears', () => {
    const storage = memoryStorage()
    expect(readDismissedAt(storage)).toBeNull()
    writeDismissedAt(storage, NOW)
    expect(readDismissedAt(storage)).toBe(NOW)
    expect(INSTALL_HINT_KEY.startsWith('libellus.')).toBe(false)
  })

  it('reads anything unreadable as never dismissed', () => {
    expect(readDismissedAt(memoryStorage({ [INSTALL_HINT_KEY]: 'yesterday' }))).toBeNull()
    expect(readDismissedAt(memoryStorage({ [INSTALL_HINT_KEY]: '-5' }))).toBeNull()
  })

  it('survives storage that refuses', () => {
    const refusing = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    expect(readDismissedAt(refusing)).toBeNull()
    expect(() => writeDismissedAt(refusing, NOW)).not.toThrow()
  })
})
