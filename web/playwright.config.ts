import { defineConfig, devices } from '@playwright/test'

// Its own port, away from the dev server (3020) and the other projects on this
// machine, and never reused: a run that found something else listening would
// otherwise test that app instead. A taken port fails loudly at startup.
const PORT = 4327

// User flows on a phone-sized viewport. Together with docs/parity.md these are
// the behavioural reference for any native port (SPEC.md, Testing).
export default defineConfig({
  testDir: './e2e',
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
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
