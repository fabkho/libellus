/**
 * Whether and how Sentry runs (plugins/sentry.client.ts). Pure rules, no SDK: the plugin reads the DSN from the
 * public runtime config (`NUXT_PUBLIC_SENTRY_DSN`) and loads Sentry only if `sentryDsn` accepts it.
 */

/** The only host family that may receive events: Sentry's EU ingest (data region Frankfurt). */
const EU_INGEST = /\.ingest\.de\.sentry\.io$/

/**
 * The DSN to use, or '' (Sentry off: no code loaded, no request). Empty, malformed and non-EU DSNs all mean off:
 * the Datenschutzerklärung promises the EU region, so a US DSN pasted by mistake must not start sending.
 */
export function sentryDsn(raw: unknown): string {
  const dsn = typeof raw === 'string' ? raw.trim() : ''
  if (!dsn || !URL.canParse(dsn)) return ''
  const url = new URL(dsn)
  if (url.protocol !== 'https:' || !url.username || !EU_INGEST.test(url.hostname)) return ''
  return dsn
}

export type SentryEnvironment = 'production' | 'preview' | 'dev'

/** production: the live address; preview: any other Cloudflare Pages build; dev: local (`nuxt dev`, preview server). */
export function sentryEnvironment(hostname: string, dev: boolean): SentryEnvironment {
  if (dev || hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.local')) return 'dev'
  if (hostname.endsWith('.pages.dev')) return 'preview'
  return 'production'
}

/** Performance sampling: about one session in ten. */
export const TRACES_SAMPLE_RATE = 0.1

/** Noise that says nothing about the app: browser quirks and extensions. */
export const IGNORED_ERRORS = [
  'ResizeObserver loop limit exceeded',
  'ResizeObserver loop completed with undelivered notifications.',
  'Non-Error promise rejection captured',
]
export const DENIED_URLS = [/^chrome-extension:\/\//i, /^moz-extension:\/\//i, /^safari-(web-)?extension:\/\//i]
