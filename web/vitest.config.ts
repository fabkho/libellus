import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const resolve = (path: string) => fileURLToPath(new URL(path, import.meta.url))

// One tag per run, decided here because this file is evaluated once, in the
// process that also runs the global setup and spawns the workers: all of them
// see the same value (tests/support/stack.ts, runTag).
process.env.LIBELLUS_TEST_RUN ??= randomUUID().slice(0, 8)

// Data-layer suite against the real local Supabase stack (SPEC.md, Testing).
// Plain Node, no Nuxt runtime: the data layer is framework-free on purpose.
export default defineConfig({
  plugins: [
    {
      // The feed store reads and writes the device's copy only `import.meta.client` (the app is an SPA, so
      // always in the browser); in Node that flag is undefined. Only this store, so no other test changes.
      name: 'libellus-feed-store-is-client',
      transform: (code, id) => (id.endsWith('/app/stores/feed.ts') ? code.replaceAll('import.meta.client', 'true') : null),
    },
  ],
  resolve: {
    // `~` is Nuxt's alias for the same folder: the stores' own imports resolve in tests/social-store.test.ts.
    alias: { '@': resolve('./app'), '~': resolve('./app') },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    env: { LIBELLUS_TEST_RUN: process.env.LIBELLUS_TEST_RUN },
    globalSetup: ['./tests/support/global-setup.ts'],
    // Every test talks to one shared stack and one shared mailbox, and GoTrue
    // rate-limits sign-ins per IP. Running the files in sequence keeps the
    // suite well under those limits and the failures readable.
    fileParallelism: false,
    // Mail delivery and a handful of round trips per test; the default 5s is
    // tight on a cold stack.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
