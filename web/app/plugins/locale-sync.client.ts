import { localeOfTag } from '~/utils/locale'
import { useSessionStore } from '~/stores/session'

/**
 * Copies the app's language to the signed-in account (`user_metadata.locale`), so the mail that carries the
 * member's next sign-in code is written in it: Supabase Auth builds that mail from the account, and a
 * signed-out device has no way to tell it a language (data/auth.ts, `saveLocale`). Runs once a member is
 * signed in and again whenever the language changes (the Profile's Language row); a start with the account
 * already in step makes no request.
 */
export default defineNuxtPlugin((nuxtApp) => {
  const session = useSessionStore()
  const i18n = nuxtApp.$i18n as { locale: Ref<string> }
  watch(
    [() => session.status, () => i18n.locale.value],
    ([status, locale]) => {
      if (status === 'signedIn') void session.saveLocale(localeOfTag(locale) ?? 'en')
    },
    { immediate: true },
  )
})
