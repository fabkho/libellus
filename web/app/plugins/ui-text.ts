import { uiTextOf } from '~/utils/uiText'

/**
 * Fills the shared UI base's own words (`ui.text`: a sheet's Cancel, the Offline button, a cover's "et al.")
 * from the messages, in the language that is on. The base never imports the app's copy and never calls
 * vue-i18n; it only reads the app config (its README, "Copy").
 *
 * It runs while the app starts, before the first screen exists, so no sheet opens on the base's English
 * defaults; `immediate` with a `sync` flush writes them now and again in the same tick a language is
 * switched (the Profile's Language row) or its messages arrive, before anything is drawn from them. Not a
 * `.client` plugin: the app is a SPA, and where the base is not extended this only sets words nobody reads.
 */
export default defineNuxtPlugin({
  name: 'libellus:ui-text',
  dependsOn: ['i18n:plugin'],
  setup(nuxtApp) {
    const { t } = nuxtApp.$i18n as { t: (key: string) => string }
    const text = computed(() => uiTextOf(t))
    watch(text, (words) => updateAppConfig({ ui: { text: words } }), { immediate: true, flush: 'sync' })
  },
})
