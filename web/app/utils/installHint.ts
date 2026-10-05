/**
 * The install hint's rules (issue #94), framework-free so Vitest pins them in
 * plain Node and a native port can drop them (a native app has nothing to
 * install).
 *
 * iOS has no install prompt: a member has to know Safari's Share → Add to Home
 * Screen. Home shows a small hint for that, only where it helps:
 * - on an iPhone or iPad, in Safari itself (other iOS browsers and in-app web
 *   views lay their Share menu out differently, so the steps would be wrong);
 * - while Libellus is not installed (`navigator.standalone`, or the standalone
 *   display mode, says the installed app is what is running);
 * - never again for a week once dismissed, so it asks at most once a week.
 *
 * What a dismissal remembers is a setting of this device, not of the member: it
 * lives in local storage outside the `libellus.` prefix that signing out
 * clears (data/localData.ts), like the theme.
 */

/** The local-storage key. Not under `libellus.`: sign-out keeps it. */
export const INSTALL_HINT_KEY = 'libellus-install-hint'

/** How long a dismissal keeps the hint away. */
export const INSTALL_HINT_QUIET_MS = 7 * 24 * 60 * 60 * 1000

/** The slice of the browser the rules read; `navigator` fits (plus `standalone`). */
export type InstallEnvironment = {
  userAgent: string
  /** `navigator.platform`: iPadOS 13+ reports 'MacIntel' in its desktop-class UA. */
  platform?: string
  maxTouchPoints?: number
  /** `navigator.standalone`: true only in an iOS Home Screen app. */
  standalone?: boolean
  /** `matchMedia('(display-mode: standalone)').matches`. */
  displayModeStandalone?: boolean
}

/** iPhone, iPod or iPad, including an iPad that says it is a Mac (the touch screen gives it away). */
export function isIos({ userAgent, platform, maxTouchPoints }: InstallEnvironment): boolean {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true
  return platform === 'MacIntel' && (maxTouchPoints ?? 0) > 1
}

/** Safari itself: not Chrome, Firefox, Edge, Opera, Google's app or another iOS browser, not an in-app web view. */
export function isSafari({ userAgent }: InstallEnvironment): boolean {
  if (!/Safari\/[\d.]+/.test(userAgent) || !/Version\/[\d.]+/.test(userAgent)) return false
  return !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|DuckDuckGo|Brave|YaBrowser|FBAN|FBAV|Instagram|Line\/|MicroMessenger|Snapchat|Twitter/i.test(userAgent)
}

/** The installed app (Home Screen) is what is running. */
export function isInstalled({ standalone, displayModeStandalone }: InstallEnvironment): boolean {
  return standalone === true || displayModeStandalone === true
}

/** Whether a dismissal made at `dismissedAt` (epoch ms, or null for none) still keeps the hint away. */
export function isQuiet(dismissedAt: number | null, now: number): boolean {
  if (dismissedAt === null) return false
  // A clock set back leaves a "future" dismissal: it keeps the hint away for at most the week.
  return now - dismissedAt < INSTALL_HINT_QUIET_MS && dismissedAt - now < INSTALL_HINT_QUIET_MS
}

/** Whether Home shows the hint to this browser right now. */
export function shouldShowInstallHint(env: InstallEnvironment, dismissedAt: number | null, now: number): boolean {
  return isIos(env) && isSafari(env) && !isInstalled(env) && !isQuiet(dismissedAt, now)
}

/** The slice of Storage the hint needs; `window.localStorage` fits. */
export type InstallHintStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

/** When the hint was last dismissed; null for never (or anything unreadable, or storage that refuses). */
export function readDismissedAt(storage: Pick<InstallHintStorage, 'getItem'>): number | null {
  try {
    const value = Number(storage.getItem(INSTALL_HINT_KEY))
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

/** Remembers a dismissal; storage that refuses (private mode) just forgets, and the hint stays for the visit. */
export function writeDismissedAt(storage: Pick<InstallHintStorage, 'setItem'>, now: number): void {
  try {
    storage.setItem(INSTALL_HINT_KEY, String(now))
  } catch {
    // Nothing to keep it in; the hint is hidden for this visit by the caller.
  }
}
