import { describeError, isChunkError, type ErrorKind } from '~/data/errorLog'
import { reportError, useErrorLog } from '~/composables/useErrorLog'

/**
 * Catches the errors nobody else does and hands them to the error log
 * (composables/useErrorLog.ts, data/errorLog.ts):
 *
 *   window `error`              an exception nothing caught
 *   window `unhandledrejection` a promise that failed and nobody asked
 *   Nuxt's `vue:error`          an error in a component (setup, render, a hook,
 *                               a watcher): Nuxt's root catches every error of
 *                               the app's tree there, the same errors Vue's
 *                               `app.config.errorHandler` gets, which Nuxt keeps
 *                               for itself while the app starts
 *   Nuxt's `app:error`          an error while the app starts (a plugin)
 *   Nuxt's `app:chunkError`     a chunk of the build that could not be loaded
 *                               (a deploy replaced it): Nuxt reloads the page on
 *                               the next navigation; the report waits on the
 *                               device and goes after the reload
 *
 * Any error whose message says a chunk could not be loaded is a `chunk`, however
 * it arrived. One error reaching two of these (a component's error Vue also
 * rethrows in development) is reported once. The outbox, the shelf and the Web
 * Vitals report on their own (stores/sync.ts, stores/shelf.ts, components/shelf,
 * plugins/vitals.client.ts).
 *
 * The line is sent a moment after a report, when the connection comes back,
 * when the app goes to the background and after a start. Nothing here throws:
 * an error inside the error log is dropped, never reported (no loops).
 *
 * Development: `window.__libellusErrors.trigger(kind)` makes an error of each kind
 * on purpose (a real one where it can), to see it printed or, with sending on,
 * arrive in the stack's `private.client_errors`.
 */
export default defineNuxtPlugin({
  name: 'error-log',
  enforce: 'pre',
  setup(nuxtApp) {
    try {
      useErrorLog()
    } catch {
      return
    }

    const seen = new WeakSet<object>()
    let inside = false
    function take(kind: ErrorKind, error: unknown, extra?: { stack?: string | null; source?: string | null }) {
      if (inside) return
      inside = true
      try {
        if (error && typeof error === 'object') {
          if (seen.has(error)) return
          seen.add(error)
        }
        reportError(isChunkError(describeError(error).message) ? 'chunk' : kind, error, extra)
      } catch {
        // Never an error of its own.
      } finally {
        inside = false
      }
    }

    // Not in the capture phase: a picture or a script that failed to load is no exception.
    window.addEventListener('error', (event) => {
      take('error', event.error ?? event.message, {
        source: event.filename || null,
        ...(event.error ? {} : { stack: event.filename ? `at ${event.filename}:${event.lineno}:${event.colno}` : null }),
      })
    })
    window.addEventListener('unhandledrejection', (event) => take('unhandledrejection', event.reason))

    nuxtApp.hook('vue:error', (error, instance, info) => {
      const name = (instance?.$options as { name?: string; __name?: string } | undefined)
      const component = name?.name ?? name?.__name
      const where = [info, component && `in <${component}>`].filter(Boolean).join(' ')
      const stack = describeError(error).stack
      take('vue', error, where ? { stack: [`(${where})`, stack].filter(Boolean).join('\n') } : undefined)
    })
    nuxtApp.hook('app:error', (error) => take('vue', error))
    nuxtApp.hook('app:chunkError', ({ error }) => take('chunk', error))

    const flush = () => void useErrorLog().flush()
    window.addEventListener('online', flush)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush()
    })
    // What waited from before (the reload after a missing chunk, a start offline).
    nuxtApp.hook('app:mounted', flush)

    // The dev server's triggers, and the Playwright flows' build's (e2e/error-log.spec.ts).
    if (import.meta.dev || __LIBELLUS_E2E__) {
      const trigger = (kind: ErrorKind): string => {
        const tag = `Dev trigger: ${kind} ${Math.random().toString(36).slice(2, 8)}`
        if (kind === 'error') {
          setTimeout(() => {
            throw new Error(tag)
          })
        } else if (kind === 'unhandledrejection') {
          void Promise.reject(new Error(tag))
        } else if (kind === 'vue') {
          void nuxtApp.callHook('vue:error', new Error(tag), null, 'dev trigger')
        } else if (kind === 'chunk') {
          // A chunk that is not there, as after a deploy: the browser's own failure, handed on the way
          // Vite's loader does it in a build (`vite:preloadError`, which Nuxt turns into `app:chunkError`).
          import(/* @vite-ignore */ `/_nuxt/missing-${Date.now()}.js`).catch((error: unknown) => {
            window.dispatchEvent(Object.assign(new Event('vite:preloadError', { cancelable: true }), { payload: error }))
          })
        } else {
          reportError(kind, new Error(tag))
        }
        return tag
      }
      ;(window as unknown as { __libellusErrors: unknown }).__libellusErrors = { trigger, flush: () => useErrorLog().flush(), pending: () => useErrorLog().pending() }
    }
  },
})
