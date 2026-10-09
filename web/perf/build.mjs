// The production build for the perf harness: `nuxt generate` (the static site in .output/public)
// with the cache headers Nitro's `cloudflare-pages-static` preset appends to `_headers` on Pages
// (docs/HOSTING.md). The preset itself is not used: its build reuses the previous build's
// runtime configuration and ignores a changed NUXT_PUBLIC_* variable.
//
//   pnpm perf:build        (the API address and the anon key of the throwaway stack are filled in: perf/env.ts)
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { APP_SUPABASE_URL, env } from './env.ts'

const web = fileURLToPath(new URL('..', import.meta.url))
execFileSync('./node_modules/.bin/nuxt', ['generate'], { cwd: web, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, NUXT_PUBLIC_SUPABASE_URL: process.env.NUXT_PUBLIC_SUPABASE_URL ?? APP_SUPABASE_URL, NUXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NUXT_PUBLIC_SUPABASE_ANON_KEY ?? env.anonKey } })
const headers = `${web}.output/public/_headers`
if (!readFileSync(headers, 'utf8').includes('max-age=31536000, immutable'))
  appendFileSync(
    headers,
    `
/_nuxt/builds/meta/*
  cache-control: public, max-age=31536000, immutable
/_nuxt/builds/*
  cache-control: public, max-age=1, immutable
/_nuxt/*
  cache-control: public, max-age=31536000, immutable
`,
  )
console.log(`built ${web}.output/public`)
