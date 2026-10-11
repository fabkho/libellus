import { execFileSync } from 'node:child_process'

/**
 * Where the perf harness finds its stack, build and ports. Every value has a default for the
 * throwaway stack the README sets up (own project id, ports 55671-55679); a different one
 * is set through PERF_* variables. Keys come from `supabase status` of the stack in PERF_STACK_DIR
 * (default /tmp/libellus-perf-stack), never from a file.
 */
const stackPort = process.env.PERF_STACK_PORT ?? '55671'
let known: { anon: string; service: string } | null = null
/** Never written down in the repo: the local stack's keys are asked of the stack, as tests/support/stack.ts does. */
function keys() {
  if (known) return known
  if (process.env.PERF_ANON_KEY && process.env.PERF_SERVICE_KEY) return (known = { anon: process.env.PERF_ANON_KEY, service: process.env.PERF_SERVICE_KEY })
  const dir = process.env.PERF_STACK_DIR ?? '/tmp/libellus-perf-stack'
  const status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/^[^{]*/, '')) as Record<string, string>
  return (known = { anon: status.ANON_KEY!, service: status.SERVICE_ROLE_KEY! })
}
export const env = {
  supabaseUrl: process.env.PERF_SUPABASE_URL ?? `http://127.0.0.1:${stackPort}`,
  dbUrl: process.env.PERF_DB_URL ?? `postgresql://postgres:postgres@127.0.0.1:${Number(stackPort) + 1}/postgres`,
  /** The stack's anon and service keys: PERF_ANON_KEY / PERF_SERVICE_KEY, else `supabase status` run in PERF_STACK_DIR. */
  get anonKey() {
    return keys().anon
  },
  get serviceKey() {
    return keys().service
  },
  /** The static site, served like Pages (perf/serve.mjs). */
  appPort: Number(process.env.PERF_APP_PORT ?? 3101),
  /** The cover CDN stand-in: the same server answers for the host `is1-ssl.mzstatic.com` (mapped to 127.0.0.1 in Chromium). */
  coverPort: Number(process.env.PERF_APP_PORT ?? 3101),
}
/** The API as the browser addresses it: a hosted-Supabase look-alike host that perf/serve.mjs proxies to `supabaseUrl` (with compression). The build is made with it. */
export const APP_SUPABASE_URL = 'https://perf.supabase.co'
export const MEMBER_EMAIL = 'perf@libellus.local'
export const MEMBER_ID = 'de000000-0000-4000-8000-0000000000f1'
/** Chromium talks to the server over TLS (HTTP/2, like Pages), WebKit over plain HTTP (see perf/serve.mjs). */
export const appUrl = (engine: 'chromium' | 'webkit') => `${engine === 'webkit' ? 'http' : 'https'}://localhost:${env.appPort}`
export const APP_URL = appUrl('chromium')
