import { randomUUID } from 'node:crypto'
import { availableParallelism } from 'node:os'
import { defineConfig, devices } from '@playwright/test'
import { appEnv } from './e2e/appEnv'

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
// In CI (.github/workflows/e2e.yml, called by ci.yml and release.yml) every run starts on an empty
// database. Workers follow the runner's cores: the public repository's
// ubuntu-latest has four, which hold three workers next to the stack; on two
// cores three workers starved WebKit (taps waited on frames that came too late,
// #151), so two there. E2E_WORKERS overrides either. A failed test is retried
// once (locally it fails at once, so a flake is seen), and the first failure
// leaves a trace and a screenshot. The job runs in shards (`--shard=i/N`, N set
// in ci.yml, release.yml and docs/TESTING.md: every shard boots its own stack), each writing
// a blob report that the workflow merges into one HTML report when a shard failed.
const CI = Boolean(process.env.CI)
const DEV = Boolean(process.env.LIBELLUS_E2E_DEV)
const CI_WORKERS = Number(process.env.E2E_WORKERS) || (availableParallelism() >= 4 ? 3 : 2)

// Measurements (e2e/perf, tagged @perf) run only by hand, with LIBELLUS_E2E_PERF=1: they take
// minutes, drive Chromium with the CPU slowed, and assert nothing a pull request should wait on.
const PERF = Boolean(process.env.LIBELLUS_E2E_PERF)

export default defineConfig({
  testDir: './e2e',
  testIgnore: PERF ? [] : ['**/perf/**'],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  // Sharding splits by test rather than by file (a few files hold a third of the flows, so
  // by file the slowest shard ran twice as long as the fastest); every flow makes its own
  // member, so none depends on its neighbours.
  fullyParallel: CI,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? CI_WORKERS : undefined,
  timeout: CI ? 60_000 : 30_000,
  // A run that hangs is ended here, by the run itself, and not by the job: the job's
  // 30-minute `timeout-minutes` kills it with no blob report, so a hang cost 30 billed
  // minutes and left nothing to look at (shard 2 of run 37752557924, 8 October 2026).
  // A shard runs about 4 minutes of flows, but `E2E_SHARDS=1` (docs/TESTING.md) puts
  // the whole core suite in one job: about 16 minutes of flows, 18 with a retried test.
  // Twenty-five stays clear of that and of the job's 30, and still bounds a hang.
  globalTimeout: CI ? 25 * 60_000 : 0,
  expect: { timeout: CI ? 10_000 : 5_000 },
  reporter: CI ? [['list'], ['github'], ['blob']] : 'list',
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // No video: it is written for every test while it runs, and the trace says more.
    video: 'off',
    baseURL: `http://localhost:${PORT}`,
    ...devices['iPhone 15'],
    // WebKit is closest to Safari on iPhone, where Libellus is mostly used.
    browserName: 'webkit',
    // Reduce Motion, as a member who turned it on: sheets, morphs and fades are cut to their end
    // (docs/MOTION.md), so a flow waits for none of them, and Reduce Motion gets the coverage of
    // every flow. A spec about motion or what is drawn on the way opts back in with
    // `test.use({ reducedMotion: 'no-preference' })`.
    reducedMotion: 'reduce',
    // An installed app's service worker answers from its precache; here every flow talks to the
    // server, so what it reads is what the build serves. A spec about the worker allows it.
    serviceWorkers: 'block',
  },
  webServer: {
    // The app as it ships (docs/HOSTING.md): `nuxt generate` with the flows' configuration
    // (e2e/build.ts, skipped with LIBELLUS_E2E_PREBUILT=1 when CI built it already), served the
    // way Cloudflare Pages serves it (e2e/serve.mjs: `_headers`, the SPA fallback, the Pages
    // Functions). LIBELLUS_E2E_DEV=1 runs the flows on `nuxt dev` instead, to debug one with the
    // dev server's source maps and reloads; nuxt itself then, not `pnpm dev`: stopping pnpm
    // leaves nuxt running in its own process group, holding the port, and the run never exits.
    command: DEV
      ? `./node_modules/.bin/nuxt dev --port ${PORT}`
      : `${process.env.LIBELLUS_E2E_PREBUILT ? '' : './node_modules/.bin/tsx e2e/build.ts && '}node e2e/serve.mjs ${PORT}`,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    url: `http://localhost:${PORT}`,
    env: appEnv(),
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
