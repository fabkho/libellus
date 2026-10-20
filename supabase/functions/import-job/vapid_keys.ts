/**
 * Makes a VAPID key pair for the import's Web Push (README.md, "Web Push"):
 *
 *   deno run vapid_keys.ts
 *
 * Prints the two base64url strings: the public key is `VAPID_PUBLIC_KEY` (and `NUXT_PUBLIC_VAPID_PUBLIC_KEY` of the app's build),
 * the private one `VAPID_PRIVATE_KEY` (a secret of the function, never in git). A new pair makes every subscription of the old one
 * useless: the push service refuses a key it did not subscribe (the members would have to say "Notify me" again).
 */
import { generateVapidKeys } from './webpush.ts'

const { publicKey, privateKey } = await generateVapidKeys()
console.log(`VAPID_PUBLIC_KEY=${publicKey}`)
console.log(`VAPID_PRIVATE_KEY=${privateKey}`)
