/** What index.ts reads from the environment, as pure functions (config_test.ts). */
import { ALL_HOSTS, type HostName } from './plan.ts'

/** `openssl rand -hex 32` is 64 characters; a shorter secret makes the keys guessable. */
export const MIN_KEY_SECRET_LENGTH = 32

/**
 * `COVER_STORE_HOSTS`: the hosts that are stored. Unset or empty = all. A list with no known name (typos) would make
 * every Book `unsupported_url` without a word: it is warned about and the default list is used. Unknown names in a list
 * with known ones are warned about and dropped.
 */
export function parseHosts(value: string | null, warn: (message: string) => void): HostName[] {
  if (!value) return [...ALL_HOSTS]
  const names = value.split(',').map((name) => name.trim().toLowerCase()).filter(Boolean)
  const known = names.filter((name): name is HostName => (ALL_HOSTS as readonly string[]).includes(name))
  const unknown = names.filter((name) => !(ALL_HOSTS as readonly string[]).includes(name))
  if (unknown.length > 0) warn(`cover-store: COVER_STORE_HOSTS names no host called ${unknown.join(', ')} (known: ${ALL_HOSTS.join(', ')})`)
  if (known.length === 0) {
    warn('cover-store: COVER_STORE_HOSTS names no known host: every host is stored')
    return [...ALL_HOSTS]
  }
  return known
}

/** The names of the settings a run needs that are not set (or not usable). Names only, never values. */
export function missingSettings(settings: Record<string, string | null>): string[] {
  const missing = Object.entries(settings).filter(([, value]) => !value).map(([name]) => name)
  const secret = settings.COVER_KEY_SECRET
  if (secret && secret.length < MIN_KEY_SECRET_LENGTH && !missing.includes('COVER_KEY_SECRET')) {
    missing.push(`COVER_KEY_SECRET (at least ${MIN_KEY_SECRET_LENGTH} characters)`)
  }
  return missing
}
