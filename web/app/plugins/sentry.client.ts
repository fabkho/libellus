import { sentryDsn, sentryEnvironment } from '~/utils/sentryConfig'

/**
 * Errors and performance to Sentry (README „Sentry“). **Off without a DSN**: `NUXT_PUBLIC_SENTRY_DSN`
 * empty (or not an EU DSN, `sentryDsn`) means this plugin does nothing: no request, no SDK download (the SDK
 * sits in a chunk that is only imported below). With one, the app starts first and Sentry loads behind it, so
 * it never delays the first screen; an error in the first moments of the start can be missed.
 */
export default defineNuxtPlugin({
  name: 'sentry',
  setup(nuxtApp) {
    const dsn = sentryDsn(useRuntimeConfig().public.sentryDsn)
    if (!dsn) return
    const release = useAppConfig().release.version
    void import('~/utils/sentryInit')
      .then(({ startSentry }) =>
        startSentry(nuxtApp, { dsn, release, environment: sentryEnvironment(location.hostname, import.meta.dev) }),
      )
      .catch(() => undefined) // a blocked or missing chunk must never become an error of its own
  },
})
