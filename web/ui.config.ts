import { resolve } from 'node:path'
import type { NuxtConfig } from 'nuxt/schema'

/**
 * Where the shared UI base comes from (fabkho/ui, the `@fabkho/ui` dependency pinned to a tag in package.json; plan:
 * docs/ui-layer-plan.md in fabkho/trappist, §3). One form for every app: `extends: uiLayer()`;
 * `UI_LAYER=/path/to/ui` points the app at a local checkout instead (the same override as `REGAL_LAYER`; `#ui`,
 * which main.css imports the stylesheet by, follows it).
 */
export const uiLayer = () => process.env.UI_LAYER || '@fabkho/ui'

/** A file of the base: in the checkout `UI_LAYER` names, or in the package (`node_modules/@fabkho/ui`). */
const inUiLayer = (path: string) => {
  const root = process.env.UI_LAYER && `${resolve(process.env.UI_LAYER)}/`
  return (root !== undefined && root !== '' && path.startsWith(root)) || path.includes('/node_modules/@fabkho/ui/')
}

/**
 * What the base brings that is not a component, and that Nuxt would otherwise switch on now: its plugins and
 * its `router.options.ts`. Nothing switches yet (until wave 6a of the plan), so both are held back here. The app's own
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
