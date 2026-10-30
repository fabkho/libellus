/**
 * The object key of a stored cover: the first 128 bits, hex (32 characters, `books.cover_key`), of
 * `HMAC-SHA256(COVER_KEY_SECRET, "v1:" + the bytes of the LARGEST variant)` (docs/plans/owned-covers.md, §2).
 *
 *  - content, not Book: Books that share artwork (a lent cover) share one stored image;
 *  - an HMAC, not a plain hash: nobody can hash a public cover and ask whether a member holds that book; the key is
 *    found only in members' payloads. Rotating the secret is a runbook step (it is irreversible);
 *  - `v1:` in the input: another format or other widths later are a `v2` with new keys, so a cached `v1` address never
 *    gets other bytes;
 *  - only the largest variant: the smaller ones are fetched after the key is known and never change it.
 */
const encoder = new TextEncoder()

export async function coverKey(secret: string, largest: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const prefix = encoder.encode('v1:')
  const message = new Uint8Array(prefix.length + largest.length)
  message.set(prefix)
  message.set(largest, prefix.length)
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, message))
  return Array.from(mac.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
