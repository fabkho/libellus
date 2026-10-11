import { phoneLanguages, searchLanguages } from '~/utils/locale'

/**
 * The languages Apple's storefronts, the edition lookups and the import ask in: the app's language first (a member who
 * chose German on an English phone gets German editions), then the phone's (utils/locale.ts, `searchLanguages`).
 * A function, because the app language can change while a store lives: a store makes its repository again when
 * the first entry differs from the one it was made for.
 */
export function useSearchLanguages(): () => string[] {
  const { locale } = useNuxtApp().$i18n
  return () => searchLanguages(String(locale.value), phoneLanguages())
}
