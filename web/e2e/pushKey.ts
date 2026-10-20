/**
 * A VAPID public key only the flows use (its private half was thrown away): the import page offers "Notify me
 * when it's done" in a build that has one, and hides the button in a build that does not (stores/importPush.ts).
 * Its own module, because the flows' build reads it too (e2e/build.ts) and that one wants no stack
 * (e2e/appEnv.ts asks the local one for its anon key).
 */
export const E2E_VAPID_PUBLIC_KEY = 'BLNU2HLFzBoPIM5lorRHGIBkthRYbR6nOlCx6wCKiMx-vhl-igE9WOuu907g0EaDBDAmRsAa0gvBr_un3DPnRkc'
