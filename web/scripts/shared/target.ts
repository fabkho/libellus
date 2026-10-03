/**
 * Which Supabase project an owner's script talks to, as the service role:
 * shared by the Fable import (`import-fable.ts`, writes) and the Regal export
 * (`export-regal.ts`, reads only).
 *
 *   local   the stack `supabase status` reports for this checkout, never
 *           anything else: an exported hosted URL must not turn a local run
 *           into a production one.
 *   hosted  $SUPABASE_URL + $SUPABASE_SERVICE_ROLE_KEY from the environment,
 *           and `--confirm-host` must repeat the URL's host.
 */
import { execFileSync } from 'node:child_process'

export type Target = { url: string; serviceKey: string; label: string }

export type TargetOptions = {
  /** `local` or `hosted`. */
  target: string | undefined
  /** `--confirm-host`: must name the hosted URL's host. */
  confirmHost: string | undefined
  /** The repo root, where `supabase status` finds this checkout's stack. */
  repoRoot: string
  /** What the script does there, for the confirm message: 'writes to', 'reads from'. */
  action: string
  fail: (message: string) => never
}

export function resolveTarget({ target, confirmHost, repoRoot, action, fail }: TargetOptions): Target {
  if (target === 'local') {
    let env: string
    try {
      env = execFileSync('supabase', ['status', '-o', 'env'], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch {
      return fail('no local stack answering: run `supabase start` in the repo root')
    }
    const value = (name: string) => env.match(new RegExp(`^${name}="?([^"\\n]+)"?$`, 'm'))?.[1]
    const url = value('API_URL')
    const serviceKey = value('SERVICE_ROLE_KEY')
    if (!url || !serviceKey) return fail('`supabase status` reported no API_URL or SERVICE_ROLE_KEY')
    if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url)) return fail(`the local stack's URL is not local: ${url}`)
    return { url, serviceKey, label: `local ${url}` }
  }
  if (target === 'hosted') {
    const url = process.env.SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !serviceKey) return fail('--target hosted needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY exported')
    const host = new URL(url).host
    if (confirmHost !== host) return fail(`--target hosted ${action} ${host}; repeat it with --confirm-host ${host}`)
    return { url, serviceKey, label: `hosted ${host}` }
  }
  return fail(`unknown --target "${target}" (local or hosted)`)
}
