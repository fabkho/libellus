/**
 * Whether the presented secret is the expected one, in time that does not
 * depend on where they differ: both are hashed first (equal lengths), then
 * every byte is compared. The same check as regal-export's `sameSecret`
 * (each function is deployed on its own, so each carries its copy).
 */
export async function sameSecret(given: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const [a, b] = await Promise.all(
    [given, expected].map(async (text) => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)))),
  )
  let difference = 0
  for (let index = 0; index < a!.length; index++) difference |= a![index]! ^ b![index]!
  return difference === 0
}
