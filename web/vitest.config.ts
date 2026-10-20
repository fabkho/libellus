import { randomUUID } from 'node:crypto'
import { resolve as pathResolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { REALTIME_CLIENT } from './realtime.config.ts'

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
      // The feed, likes, library, friendsTab and session stores read and write the device's copy only `import.meta.client` (the app is an
      // SPA, so always in the browser); in Node that flag is undefined. Only these stores, so no other test changes.
      name: 'libellus-stores-are-client',
      transform: (code, id) => (/\/app\/stores\/(feed|likes|library|friendsTab|session)\.ts$/.test(id) ? code.replaceAll('import.meta.client', 'true') : null),
    },
  ],
  resolve: {
    // `~` is Nuxt's alias for the same folder: the stores' own imports resolve in tests/social-store.test.ts.
    alias: {
      '@': resolve('./app'),
      '~': resolve('./app'),
      // The shared UI base, as Nuxt aliases it (`#layers/ui`, its layer's name; plain Node does not know it): the checkout `UI_LAYER` names, or the package.
      '#layers/ui': process.env.UI_LAYER ? pathResolve(process.env.UI_LAYER) : resolve('./node_modules/@fabkho/ui'),
      // As in nuxt.config.ts: the suite exercises the client the app ships.
      '@supabase/realtime-js': resolve('./app/data/realtimeStub.ts'),
      // The real client, for the one place that loads it (realtime.config.ts).
      '#realtime-client': REALTIME_CLIENT,
    },
  },
  test: {
    // Node loads supabase-js from node_modules as it is, past the alias above: inlined, its import of Realtime resolves to the stub.
    server: { deps: { inline: [/@supabase\/supabase-js/] } },
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
