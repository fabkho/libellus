// The app the flows run on: `nuxt generate` with the flows' configuration (as e2e/appEnv.ts), into
// .output-e2e/public, beside the real build. playwright.config.ts runs it before every run unless
// LIBELLUS_E2E_PREBUILT=1 (CI builds it in a step of its own, while the stack starts). The stack's
// address and key are stand-ins that e2e/serve.mjs replaces, so no stack needs to be up.
//
//   pnpm e2e:build
import { execFileSync } from 'node:child_process'
import { SHELF_LIBRARY_SRC, SHELF_OWNER_ID } from './shelfOwner'

/**
 * Stand-ins the flows' build is made with for the stack's address and anon key: e2e/serve.mjs puts
 * the stack's own into every page it serves (the runtime configuration Nuxt writes into the HTML),
 * so the build needs nothing of the stack and can be made while it starts.
 */
const STACK_STAND_INS = {
  NUXT_PUBLIC_SUPABASE_URL: 'http://libellus-e2e-stack.invalid',
  NUXT_PUBLIC_SUPABASE_ANON_KEY: 'libellus-e2e-anon-key',
}

const env = {
  LIBELLUS_E2E: '1',
  ...STACK_STAND_INS,
  NUXT_PUBLIC_SHELF_OWNER_ID: SHELF_OWNER_ID,
  NUXT_PUBLIC_REGAL_LIBRARY_SRC: SHELF_LIBRARY_SRC,
}
console.log("Building the flows' app")
execFileSync('./node_modules/.bin/nuxt', ['generate'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, ...env },
  stdio: process.env.CI ? 'inherit' : ['ignore', 'ignore', 'inherit'],
})
