/**
 * The app's language (issue #257): English or German, nothing else. The rule is one line each:
 *
 * - A member who chose one (the Profile's Language row) keeps it. It is stored on the device.
 * - Everyone else follows the phone: the first language in `navigator.languages` the app speaks
 *   (`de`, `de-AT`, … is German; `en`, `en-GB`, … is English); a phone in French, or with no list at all, is English.
 *
 * Nothing here asks the network: the list is the browser's own, so the language is right on the first launch,
 * offline included. Like the theme (utils/theme.ts), the choice is a setting of this device, not of the member:
 * it lives in local storage outside the `libellus.` prefix that signing out clears (data/localData.ts), so the
 * sign-in screens keep the language she picked. The Nuxt plugin (plugins/locale.client.ts) puts the result on
 * the i18n module before the app is first drawn, so German never starts as English.
 */

export type AppLocale = 'en' | 'de'

/** The languages the app speaks, each named in its own language (the Profile row shows these names). */
export const APP_LOCALES: readonly { code: AppLocale; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'de', name: 'Deutsch' },
]

/** The local-storage key. Not under `libellus.`: sign-out keeps it. */
export const LOCALE_KEY = 'libellus-locale'

/** The slice of Storage the choice needs; `window.localStorage` fits. */
export type LocaleStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

/** What a stored string means; anything unknown is no choice. */
export function parseLocale(raw: string | null | undefined): AppLocale | null {
  return raw === 'en' || raw === 'de' ? raw : null
}

/** The app language of one language tag (`de-AT`, `EN_gb`, `fr`): null when the app does not speak it. */
export function localeOfTag(tag: string | null | undefined): AppLocale | null {
  const primary = String(tag ?? '').trim().toLowerCase().split(/[-_]/)[0]
  return primary === 'de' || primary === 'en' ? primary : null
}

/** The phone's language: its first listed language the app speaks, else English. No list is English. */
export function detectLocale(languages: readonly string[] | null | undefined): AppLocale {
  for (const tag of languages ?? []) {
    const locale = localeOfTag(tag)
    if (locale) return locale
  }
  return 'en'
}

/** What the app shows: her choice, or the phone's while she has made none. */
export function resolveLocale(choice: AppLocale | null, languages: readonly string[] | null | undefined): AppLocale {
  return choice ?? detectLocale(languages)
}

export function readChoice(storage: LocaleStorage | null | undefined): AppLocale | null {
  try {
    return parseLocale(storage?.getItem(LOCALE_KEY))
  } catch {
    // Storage can be unavailable (private mode, blocked); the phone decides then.
    return null
  }
}

export function writeChoice(storage: LocaleStorage | null | undefined, locale: AppLocale): void {
  try {
    storage?.setItem(LOCALE_KEY, locale)
  } catch {
    // Not persisted, but the choice still works for this visit.
  }
}

/** The browser's languages, safe where there is no window (a server render, a test in Node). */
export function phoneLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return []
  return navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : []
}

/**
 * The languages a search asks in, app language first: the Apple storefronts, the edition and the import's
 * language preference read the first entry (data/apple.ts, `storefrontsFor`), so a member who chose German on an
 * English phone gets German editions, and the phone's other languages follow.
 */
export function searchLanguages(locale: string, languages: readonly string[]): string[] {
  return [locale, ...languages.filter((tag) => tag.toLowerCase() !== locale)]
}
