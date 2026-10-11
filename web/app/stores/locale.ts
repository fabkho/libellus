import { defineStore } from 'pinia'
import { APP_LOCALES, readChoice, writeChoice, type AppLocale, type LocaleStorage } from '~/utils/locale'

/**
 * The app's language (utils/locale.ts has the rule). The i18n module holds what is showing; this store holds
 * what a tap on the Profile's Language row means: store the choice on the device and switch now, no reload
 * (the module loads that language's messages if they are not there yet).
 */
export const useLocaleStore = defineStore('locale', () => {
  const i18n = useNuxtApp().$i18n
  /** The device's storage; none where there is no window (a server render, a test in Node). */
  const storage = (): LocaleStorage | null => (typeof window === 'undefined' ? null : window.localStorage)
  /** Her choice on this device; null while she has made none (the phone decides). */
  const choice = ref<AppLocale | null>(readChoice(storage()))
  /** What is showing. */
  const current = computed<AppLocale>(() => (i18n.locale.value === 'de' ? 'de' : 'en'))

  /** The row: remembers the choice on the device and switches the app at once. */
  async function choose(locale: AppLocale) {
    if (!APP_LOCALES.some((entry) => entry.code === locale)) return
    choice.value = locale
    writeChoice(storage(), locale)
    if (i18n.locale.value !== locale) await i18n.setLocale(locale)
  }

  return { choice, current, choose }
})
