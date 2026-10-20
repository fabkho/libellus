import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { layerOverrides } from '@fabkho/ui/testing/overrides.mjs'

/**
 * Nuxt gives this app's own files priority over the shared UI base's (ui.config.ts): `app/components/ui/Cover.vue`
 * is `UiCover`, and the base's copy is never loaded. That is wanted for the files below, the app's own copies that
 * the waves of the switch (docs/ui-layer-plan.md §5) have not deleted yet, and a bug for a forgotten one: any other
 * component, composable or util of the app that has the name of one of the base's fails this test. The base logs the
 * same list in dev (`[@fabkho/ui] UiCover is overridden by the app …`). Add a file here only on purpose, and remove
 * it when the app's copy goes.
 */
const INTENDED = [
  'components/ui/Ambient.vue',
  'components/ui/Cover.vue',
  'composables/useArrival.ts',
  'composables/useHideOnScroll.ts',
  'composables/useKeyboardInset.ts',
  'composables/useSwipeDown.ts',
  'utils/cover.ts',
  'utils/coverTilt.ts',
  'utils/haptics.ts',
  'utils/hideOnScroll.ts',
  'utils/keyboard.ts',
  'utils/motion.ts',
]

describe('what the app replaces of the shared UI base', () => {
  it('is the intended list and nothing else', () => {
    // The installed package by default; `UI_LAYER=/path/to/ui` checks a local checkout instead.
    const found = layerOverrides({ app: fileURLToPath(new URL('../app', import.meta.url)), layer: process.env.UI_LAYER })
    expect([...new Set(found.map((o) => o.outer))].sort()).toEqual([...INTENDED].sort())
  })
})
