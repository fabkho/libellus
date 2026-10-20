import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { layerOverrides } from '@fabkho/ui/testing/overrides.mjs'

/**
 * Nuxt gives this app's own files priority over the shared UI base's (ui.config.ts): `app/components/ui/Cover.vue`
 * would be `UiCover`, and the base's copy never loaded. That is wanted only for a file that does something the base
 * cannot, and the base is told what it would need (no fork); any other component, composable or util of the app that has the
 * name of one of the base's fails this test. The base logs the same list in dev (`[@fabkho/ui] UiCover is overridden
 * by the app …`). Add a file here only on purpose, and remove it when the app's copy goes. Since fabkho/ui v0.6.0 the
 * list is empty: the app's `Cover`, `Ambient`, motion, cover tilt, keyboard, haptics, hide-on-scroll, swipe-down and
 * arrival copies are gone, and `utils/cover.ts` keeps only the sources (the base's `ui.cover` takes them from the app
 * config).
 */
const INTENDED: string[] = []

describe('what the app replaces of the shared UI base', () => {
  it('is the intended list and nothing else', () => {
    // The installed package by default; `UI_LAYER=/path/to/ui` checks a local checkout instead.
    const found = layerOverrides({ app: fileURLToPath(new URL('../app', import.meta.url)), layer: process.env.UI_LAYER })
    expect([...new Set(found.map((o) => o.outer))].sort()).toEqual([...INTENDED].sort())
  })
})
