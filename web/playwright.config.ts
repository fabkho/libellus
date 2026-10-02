import { randomUUID } from 'node:crypto'
import { defineConfig, devices } from '@playwright/test'
import { stack } from './tests/support/stack'

// Tags every address the flows invent, so the global teardown removes only what
// this run created (tests/support/stack.ts, RUN_TAG). Set before the workers
// start, so they inherit it.
process.env.LIBELLUS_TEST_RUN ??= `e2e${randomUUID().slice(0, 5)}`

// Its own port, away from the dev server (3020) and the other projects on this
// machine, and never reused: a run that found something else listening would
// otherwise test that app instead. A taken port fails loudly at startup.
// LIBELLUS_E2E_PORT moves it when two checkouts run their flows side by side.
const PORT = Number(process.env.LIBELLUS_E2E_PORT ?? 4327)

// User flows on a phone-sized viewport. Together with docs/parity.md these are
// the behavioural reference for any native port (SPEC.md, Testing).
export default defineConfig({
  testDir: './e2e',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['iPhone 15'],
    // WebKit is closest to Safari on iPhone, where Libellus is mostly used.
    browserName: 'webkit',
  },
  webServer: {
    // nuxt itself, not `pnpm dev`: stopping pnpm leaves nuxt running in its own
    // process group, holding the port, and the run never exits.
    command: `./node_modules/.bin/nuxt dev --port ${PORT}`,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    url: `http://localhost:${PORT}`,
    // The app talks to whichever stack this checkout started; the anon key is
    // asked of `supabase status`, never read from a file.
    env: {
      LIBELLUS_E2E: '1',
      NUXT_PUBLIC_SUPABASE_URL: stack.url,
      NUXT_PUBLIC_SUPABASE_ANON_KEY: stack.anonKey,
    },
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
