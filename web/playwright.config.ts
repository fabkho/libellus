import { randomUUID } from 'node:crypto'
import { defineConfig, devices } from '@playwright/test'
import { stack } from './tests/support/stack'
import { SHELF_LIBRARY_SRC, SHELF_OWNER_ID } from './e2e/shelfOwner'

// Tags every address the flows invent, so the global teardown removes only what
// this run created (tests/support/stack.ts, runTag). Set before the workers
// start, so they inherit it.
process.env.LIBELLUS_TEST_RUN ??= `e2e${randomUUID().slice(0, 5)}`

// Its own port, away from the dev server (3020) and the other projects on this
// machine, and never reused: a run that found something else listening would
// otherwise test that app instead. A taken port fails loudly at startup.
// LIBELLUS_E2E_PORT moves it when two checkouts run their flows side by side.
const PORT = Number(process.env.LIBELLUS_E2E_PORT ?? 4327)

// User flows on a phone-sized viewport. Together with docs/parity.md these are
// the behavioural reference for any native port (SPEC.md, Testing).
//
// In CI (the e2e job in .github/workflows/ci.yml) every run starts on an empty
// database and the dev server compiles on demand, so the run is made patient
// rather than parallel: two workers fit the runner's two cores next to the
// stack (three starved them: taps waited on frames that came too late), a failed test is retried once (locally it fails at once, so a flake is
// seen), and the first failure leaves a trace and a screenshot. The job runs in
// shards (`--shard=i/N`, N set in ci.yml and docs/TESTING.md: every shard boots
// its own stack, so more shards buy wall time with minutes), each writing a blob
// report that the workflow merges into one HTML report when a shard failed.
const CI = Boolean(process.env.CI)

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  // Sharding splits by test rather than by file (a few files hold a third of the flows, so
  // by file the slowest shard ran twice as long as the fastest); every flow makes its own
  // member, so none depends on its neighbours.
  fullyParallel: CI,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  timeout: CI ? 60_000 : 30_000,
  expect: { timeout: CI ? 10_000 : 5_000 },
  reporter: CI ? [['list'], ['github'], ['blob']] : 'list',
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
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
      // Your shelf (#23) is one member's: the flows' owner, made with this id (e2e/shelf.spec.ts).
      NUXT_PUBLIC_SHELF_OWNER_ID: SHELF_OWNER_ID,
      // The library file Regal shows, in a build with it (LIBELLUS_REGAL=1): the address e2e/shelf.spec.ts answers.
      NUXT_PUBLIC_REGAL_LIBRARY_SRC: SHELF_LIBRARY_SRC,
    },
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
