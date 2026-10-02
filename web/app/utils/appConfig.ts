export type AppConfig = { supabaseUrl: string; supabaseAnonKey: string }

export type ConfigProblem = { kind: 'missing'; key: string } | { kind: 'invalidUrl'; value: string }

/**
 * Validates the public runtime config (NUXT_PUBLIC_* env vars, see .env.example),
 * so a missing value is named instead of surfacing as a failed request later.
 * A native port reads the same two values and reports them the same way.
 */
export function parseAppConfig(
  raw: { supabaseUrl?: unknown; supabaseAnonKey?: unknown },
): { ok: true; config: AppConfig } | { ok: false; problem: ConfigProblem } {
  const url = typeof raw.supabaseUrl === 'string' ? raw.supabaseUrl.trim() : ''
  const key = typeof raw.supabaseAnonKey === 'string' ? raw.supabaseAnonKey.trim() : ''
  if (!url) return { ok: false, problem: { kind: 'missing', key: 'NUXT_PUBLIC_SUPABASE_URL' } }
  if (!key) return { ok: false, problem: { kind: 'missing', key: 'NUXT_PUBLIC_SUPABASE_ANON_KEY' } }
  if (!URL.canParse(url) || !new URL(url).host) {
    return { ok: false, problem: { kind: 'invalidUrl', value: url } }
  }
  return { ok: true, config: { supabaseUrl: url, supabaseAnonKey: key } }
}
