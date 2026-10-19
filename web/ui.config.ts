import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NuxtConfig } from 'nuxt/schema'
import type { Plugin } from 'vite'

/**
 * Where the shared UI base comes from (fabkho/ui; plan: docs/ui-layer-plan.md in fabkho/trappist, §3).
 * One form for every app: `extends: uiLayer()`; `UI_LAYER=/path/to/ui` points the app at a local checkout
 * (the same override as `REGAL_LAYER`).
 */
export const uiLayer = () => process.env.UI_LAYER || '@fabkho/ui'

/**
 * TEMPORARY, until `@fabkho/ui` is a dependency (the follow-up that pins `github:fabkho/ui#v0.1.0` deletes this
 * and `extends` takes `uiLayer()` straight): the base is extended only where `UI_LAYER` names a checkout, so a
 * build or a test run without it (CI, Cloudflare Pages) is the app as it was, with no base in it.
 */
export const uiLayers = (): string[] => (process.env.UI_LAYER ? [uiLayer()] : [])

/** A file of the base: in the checkout `UI_LAYER` names, or in the package (`node_modules/@fabkho/ui`). */
const inUiLayer = (path: string) => {
  const root = process.env.UI_LAYER && `${resolve(process.env.UI_LAYER)}/`
  return (root !== undefined && root !== '' && path.startsWith(root)) || path.includes('/node_modules/@fabkho/ui/')
}

/**
 * What the base brings that is not a component, and that Nuxt would otherwise switch on now: its plugins and
 * its `router.options.ts`. Nothing switches yet (wave 3 of the plan), so both are held back here. The app's own
 * `touch-active` plugin and `history` option do the same work; the base's `no-focus-zoom` (`maximum-scale=1`
 * on iOS) and `stranded-viewport` (the keyboard's leftovers) would change what members get. Each is put back,
 * deliberately, in the wave that needs it: the router option and the history key with `Sheet` and `Confirm`
 * (wave 6a), the plugins one by one.
 */
export const uiLayerHolds: NonNullable<NuxtConfig['hooks']> = {
  'app:resolve'(app) {
    app.plugins = app.plugins.filter((plugin) => !inUiLayer(plugin.src))
  },
  'pages:routerOptions'(context) {
    context.files = context.files.filter((file) => !inUiLayer(file.path))
  },
}

/**
 * TEMPORARY, with `uiLayers()`: the base's `#ui` alias (its nuxt.config.ts) is what main.css imports its
 * stylesheet by. Where the base is not extended, `#ui` names a folder with an empty stylesheet instead.
 */
export const uiLayerAlias = (): Record<string, string> =>
  process.env.UI_LAYER ? {} : { '#ui': fileURLToPath(new URL('./ui-stub/', import.meta.url)) }

/**
 * TEMPORARY, with `uiLayers()`: Tailwind v4 reads the files of the app (the folder it runs in) and no more, so
 * the classes of the base's components are only generated where it is told to read them (`@source`). A path
 * in a stylesheet cannot follow `UI_LAYER`, so this adds the line to main.css while the base is extended from
 * a checkout. Once the base is `node_modules/@fabkho/ui` the line is written in main.css, or comes with the
 * base's `ui.css`, and this goes.
 */
export const uiLayerSource = (): Plugin => ({
  name: 'libellus:ui-layer-source',
  enforce: 'pre',
  transform(code, id) {
    if (!process.env.UI_LAYER || !/\/assets\/css\/main\.css$/.test(id.split('?')[0]!)) return null
    return `${code}\n@source ${JSON.stringify(resolve(process.env.UI_LAYER, 'components'))};\n`
  },
})
