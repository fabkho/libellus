/**
 * Who is calling an edge function that both members and the service role call (`goodreads-rating`,
 * `dnb-lookup`, `openlibrary`; `verify_jwt` is off for each, supabase/config.toml): the service role,
 * a signed-in member, or nobody it serves.
 *
 * The service role is whoever presents the function's own `SUPABASE_SERVICE_ROLE_KEY`, on EITHER header:
 *
 *   - `apikey`: where Supabase's platform keeps a secret key (`sb_secret_…`, the format production's
 *     `SUPABASE_SERVICE_ROLE_KEY` has). supabase-js sends its key on `apikey` and, signed out, on
 *     `Authorization: Bearer` too, but the platform's gateway swaps a `Bearer sb_…` for a JWT it mints
 *     (`sb_api_key_compatibility: minted` in the edge logs) before the function sees it. So in
 *     production the key never arrives on `Authorization`: checked there only, the `import-job`'s asks
 *     were all refused with 401 (2026-10-20, the first real import: every `dnb-lookup` and every
 *     `goodreads-rating` ask).
 *   - `Authorization: Bearer`: the legacy JWT key, which the gateway passes through unchanged, and the
 *     local CLI stack (no gateway minting).
 *
 * Both are compared in constant time against the key. Anything else on `Authorization` is taken for a
 * member's access token and asked of Auth (`member`).
 */

export type Caller = { member: string | null }

const encoder = new TextEncoder()

/**
 * Whether the presented secret is the expected one, in time that does not depend on where they
 * differ: both are hashed first (equal lengths), then every byte is compared.
 */
export async function sameSecret(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all(
    [given, expected].map(async (text) => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)))),
  )
  let difference = 0
  for (let index = 0; index < a!.length; index++) difference |= a![index]! ^ b![index]!
  return difference === 0
}

/** The bearer token of `Authorization`, or null. */
export function bearerToken(request: Request): string | null {
  return request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() || null
}

/** Whether the request carries the service-role key, on `apikey` or as the bearer token. */
export async function presentsServiceKey(request: Request, serviceKey: string): Promise<boolean> {
  const presented = [request.headers.get('apikey')?.trim() || null, bearerToken(request)].filter((value): value is string => !!value)
  const matches = await Promise.all(presented.map((value) => sameSecret(value, serviceKey)))
  return matches.some(Boolean)
}

/**
 * The function's `authorize`: `{ member: null }` for the service role, `{ member: id }` for a signed-in
 * member (`member` answers the id of an access token's user, or null), null for anybody else.
 */
export function createCallerCheck(deps: {
  serviceKey: string
  member: (token: string) => Promise<string | null>
}): (request: Request) => Promise<Caller | null> {
  return async (request) => {
    if (await presentsServiceKey(request, deps.serviceKey)) return { member: null }
    const token = bearerToken(request)
    if (!token) return null
    const member = await deps.member(token)
    return member ? { member } : null
  }
}
