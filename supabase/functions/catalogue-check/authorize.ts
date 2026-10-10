/**
 * Who may call `catalogue-check`: the service-role key, or the shared secret CATALOGUE_CHECK_TOKEN
 * (what pg_cron's call sends). Compared in constant time (both secrets are always compared, over the
 * digests of equal length, so neither the length nor the first differing byte shows in the timing),
 * and the shared secret is not accepted at all unless it is at least 32 characters.
 */

export const MIN_TOKEN_LENGTH = 32

const encoder = new TextEncoder()

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

/** `given` equals `expected`, in time that does not depend on where they differ. */
export async function sameSecret(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([digest(given), digest(expected)])
  let difference = a.length ^ b.length
  for (let i = 0; i < a.length; i++) difference |= a[i]! ^ (b[i] ?? 0)
  return difference === 0
}

/** The shared secret if it is long enough to be one; null otherwise (then only the service-role key is accepted). */
export function usableToken(token: string | null | undefined): string | null {
  const trimmed = token?.trim() ?? ''
  return trimmed.length >= MIN_TOKEN_LENGTH ? trimmed : null
}

export function createAuthorize(serviceKey: string, checkToken: string | null): (request: Request) => Promise<boolean> {
  return async (request) => {
    const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
    if (!given) return false
    const [service, shared] = await Promise.all([
      sameSecret(given, serviceKey),
      checkToken === null ? Promise.resolve(false) : sameSecret(given, checkToken),
    ])
    return service || shared
  }
}
