import { phoneLanguages, readChoice, resolveLocale } from '~/utils/locale'

/**
 * The app's language before the first paint (utils/locale.ts has the rule). @nuxtjs/i18n asks for the locale once
 * at boot (`i18n:beforeLocaleSwitch`, `initialSetup`) and loads only the one it is given, so setting it here means
 * a German phone downloads German and never English first, and the shell is drawn in German. `enforce: 'pre'`
 * registers the hook before the module's own plugins run; nothing waits on the network.
 */
export default defineNuxtPlugin({
  name: 'libellus:locale',
  enforce: 'pre',
  setup(nuxtApp) {
    nuxtApp.hook('i18n:beforeLocaleSwitch', (data) => {
      if (!data.initialSetup) return
      data.newLocale = resolveLocale(readChoice(window.localStorage), phoneLanguages())
    })
  },
})
