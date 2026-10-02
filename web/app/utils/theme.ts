/**
 * The theme rule (docs/DESIGN.md, Themes; issue #1 story 70), framework-free so
 * Vitest pins it in plain Node and a native port copies it line for line.
 *
 * - The stored preference is `null | 'light' | 'dark'`. `null`, the default,
 *   follows the device's appearance.
 * - The switch shows two states only, Light and Dark. Its first tap stores the
 *   opposite of what is showing right now; every later tap flips. There is no
 *   way back to `null` from the interface.
 *
 * The preference is a setting of this device, not of the member: it lives in
 * local storage, never in Supabase, and deliberately outside the `libellus.`
 * prefix that signing out clears (data/localData.ts), so the way in keeps the
 * theme the member chose.
 */

export type Theme = 'light' | 'dark'
export type ThemePreference = Theme | null

/** The local-storage key. Not under `libellus.`: sign-out keeps it. */
export const THEME_KEY = 'libellus-theme'

/** The colour the browser chrome and the status bar take in each theme. */
export type ThemeColors = Record<Theme, string>

/** The slice of Storage the theme needs; `window.localStorage` fits. */
export type ThemeStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

/** What a stored string means; anything unknown is no preference. */
export function parsePreference(raw: string | null | undefined): ThemePreference {
  return raw === 'light' || raw === 'dark' ? raw : null
}

/** The theme that is showing: the preference, or the device's while there is none. */
export function resolveTheme(preference: ThemePreference, deviceIsDark: boolean): Theme {
  return preference ?? (deviceIsDark ? 'dark' : 'light')
}

/**
 * The preference one tap on the switch stores: the opposite of what is
 * showing. On a dark phone with no preference that is Light; afterwards it
 * flips between the two.
 */
export function nextPreference(preference: ThemePreference, deviceIsDark: boolean): Theme {
  return resolveTheme(preference, deviceIsDark) === 'dark' ? 'light' : 'dark'
}

export function readPreference(storage: ThemeStorage): ThemePreference {
  try {
    return parsePreference(storage.getItem(THEME_KEY))
  } catch {
    // Storage can be unavailable (private mode, blocked); the device decides then.
    return null
  }
}

export function writePreference(storage: ThemeStorage, preference: Theme): void {
  try {
    storage.setItem(THEME_KEY, preference)
  } catch {
    // Not persisted, but the switch still works for this visit.
  }
}

/** The slice of Document the theme touches. */
export type ThemeDocument = {
  documentElement: { setAttribute: (name: string, value: string) => void; removeAttribute: (name: string) => void }
  querySelectorAll: (selector: string) => ArrayLike<{ setAttribute: (name: string, value: string) => void; getAttribute: (name: string) => string | null }>
}

/**
 * Puts a preference on the page. A chosen theme becomes `data-theme` on <html>,
 * which the generated CSS switches on, and the colour of every theme-color tag
 * (the browser chrome; the status bar of the installed app). No preference
 * removes the attribute and gives each tag its own theme's colour back: the
 * static HTML carries one tag per `prefers-color-scheme`, so the device decides.
 */
export function applyPreference(doc: ThemeDocument, preference: ThemePreference, colors: ThemeColors): void {
  if (preference) doc.documentElement.setAttribute('data-theme', preference)
  else doc.documentElement.removeAttribute('data-theme')
  const tags = doc.querySelectorAll('meta[name="theme-color"]')
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i]!
    const media = tag.getAttribute('media') ?? ''
    const own: Theme = media.includes('dark') ? 'dark' : 'light'
    tag.setAttribute('content', colors[preference ?? own])
  }
}

/**
 * The script inlined at the top of <head> (nuxt.config.ts), so a stored theme
 * is on the page before the first paint: no flash of the wrong theme while the
 * app boots. It runs before any module loads, so it is a string that repeats
 * readPreference + applyPreference in plain ES5; tests/theme.test.ts runs it
 * against the same cases as the functions above. It runs first thing in
 * <head>, before the theme-color tags are parsed, so the theme store repaints
 * those once the app starts (stores/theme.ts, start).
 */
export function themeBootScript(colors: ThemeColors): string {
  return `(function(){try{var p=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(p!=="light"&&p!=="dark")return;var c=${JSON.stringify(colors)};document.documentElement.setAttribute("data-theme",p);var m=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<m.length;i++)m[i].setAttribute("content",c[p])}catch(e){}})()`
}
