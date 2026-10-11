/**
 * The function's only way out: `fetch` that reaches the two source hosts and nothing else. The
 * addresses are built from the database's keys (checked by check.ts), so a bad key cannot send the
 * function elsewhere; this is the second lock. Redirects are followed by hand (Open Library answers
 * `/isbn/<isbn>.json` with one to the edition) and each hop is held to the same rule: https, an
 * allowed host, no credentials, no port, at most three hops.
 */
import type { FetchLike } from '../enrich/http.ts'

export const ALLOWED_HOSTS: readonly string[] = ['itunes.apple.com', 'openlibrary.org']
const MAX_HOPS = 3

export class HostNotAllowed extends Error {
  constructor(readonly url: string) {
    super(`host_not_allowed ${url.slice(0, 120)}`)
  }
}

export function allowed(url: string, hosts: readonly string[] = ALLOWED_HOSTS): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port && hosts.includes(parsed.hostname)
}

export function safeFetch(inner: FetchLike, hosts: readonly string[] = ALLOWED_HOSTS): FetchLike {
  return async (url, init) => {
    let target = url
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      if (!allowed(target, hosts)) throw new HostNotAllowed(target)
      const response = await inner(target, { ...init, redirect: 'manual' })
      const location = response.headers.get('location')
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel()
        target = new URL(location, target).href
        continue
      }
      return response
    }
    throw new HostNotAllowed(`${target} (too many redirects)`)
  }
}
