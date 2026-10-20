import { resolve } from 'node:path'
import type { NuxtConfig } from 'nuxt/schema'

/**
 * Where the shared UI base comes from (fabkho/ui, the `@fabkho/ui` dependency pinned to a tag in package.json; plan:
 * docs/ui-layer-plan.md in fabkho/trappist, §3). One form for every app: `extends: uiLayer()`;
 * `UI_LAYER=/path/to/ui` points the app at a local checkout instead (the same override as `REGAL_LAYER`; `#layers/ui`,
 * which main.css imports the stylesheet by, follows it).
 */
export const uiLayer = () => process.env.UI_LAYER || '@fabkho/ui'

/** A file of the base: in the checkout `UI_LAYER` names, or in the package (`node_modules/@fabkho/ui`). */
const inUiLayer = (path: string) => {
  const root = process.env.UI_LAYER && `${resolve(process.env.UI_LAYER)}/`
  return (root !== undefined && root !== '' && path.startsWith(root)) || path.includes('/node_modules/@fabkho/ui/')
}

/**
 * The base's plugins this app runs: one of each behaviour, never the app's and the base's side by side.
 *
 * - `touch-active` (press feedback on iPhone): the base's. It is the app's own plugin, word for word, so the app's
 *   copy went (wave 6a).
 * - `no-focus-zoom` (`maximum-scale=1` on iOS): held. Safari zooms in on a field set under 16 px; BetterReads' fields
 *   are 17 and 19 px (`text-callout`, `text-input`), so nothing here zooms, and the tag would only add what axe reads
 *   as a zoom limit (WCAG 1.4.4, `meta-viewport`). Bookretreats needs it for its 15 px composer: once BetterReads
 *   takes the base's composer, it comes back with it.
 * - `stranded-viewport` (iOS 26's viewport left panned or shrunk after the keyboard): held. Nothing reports
 *   the bug in BetterReads, and its own `float-bottom` (main.css, over the base's) does not read `--viewport-pan`: the tab bar would
 *   stay where it is while the base's sheets moved. It comes with the tab bar and the floating chrome (wave 6b on).
 */
const BASE_PLUGINS = ['touch-active']

const isBasePlugin = (src: string) => BASE_PLUGINS.some((name) => new RegExp(`/plugins/${name}\\.client\\.[jt]s$`).test(src))

/**
 * What the base brings that is not a component, and that Nuxt would otherwise switch on: its plugins, of which only
 * `BASE_PLUGINS` run. Its `router.options.ts` runs since wave 6a, with its `UiSheet`, `UiConfirm` and back dismissal:
 * the app's own `history` option went in the same change (app/router.options.ts), so the system Back is listened to
 * once.
 */
export const uiLayerHolds: NonNullable<NuxtConfig['hooks']> = {
  'app:resolve'(app) {
    app.plugins = app.plugins.filter((plugin) => !inUiLayer(plugin.src) || isBasePlugin(plugin.src))
  },
}
