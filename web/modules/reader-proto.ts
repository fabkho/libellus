import { fileURLToPath } from 'node:url'
import { defineNuxtModule, extendPages } from '@nuxt/kit'

/**
 * Design round #131 phase 2: the built-in reader's prototypes (app/proto/reader/).
 * Dev only: the route is added under `nuxt dev` and nowhere else, so no build
 * (generate, e2e, Pages) has it, its chunks, its fonts or its test books.
 * `/prototype/…` skips the sign-in guard in dev (middleware/auth.global.ts).
 */
export default defineNuxtModule({
  meta: { name: 'reader-proto' },
  setup(_options, nuxt) {
    if (!nuxt.options.dev) return
    const file = fileURLToPath(new URL('../app/proto/reader/Page.vue', import.meta.url))
    extendPages((pages) => {
      pages.push({ name: 'prototype-reader', path: '/prototype/reader', file })
    })
  },
})
