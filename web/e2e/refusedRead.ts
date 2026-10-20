/**
 * WebKit's uncaught error for a read it refused itself, and which refusals are this app's own
 * (`noPageErrors` in e2e/fixtures.ts). WebKit's words are "Fetch API cannot load <url> due to access
 * control checks."; they read like CORS and are not: WebKit labels every request that fails
 * synchronously as an access-control error, and the ones it refuses that way in these flows are the
 * app's own reads — a read the page still had in flight when its document went (a navigation, a
 * reload, the page closing), and the reads the flow itself cut off (the offline flows'
 * `context.setOffline`, a `route.abort`). The app catches those promises (a look that learns nothing
 * is not a failure), and Playwright still reports each as a `pageerror`, so nothing a member sees is
 * broken and the flow did nothing wrong.
 *
 * Excused only as narrowly as that is true: the wording exactly, and an address of this app itself —
 * the origin the build `e2e/serve.mjs` serves and the local stack it reads (20 October 2026: run
 * 39476741420, `latest.json` on localhost:4327 and the Library's own reads on 127.0.0.1:55321; run
 * 39480808919, `/auth/v1/health`, `/rest/v1/library_entries`, `import_jobs`, `accounts` and
 * `reading_sessions`). Those two origins never have a real CORS failure in these flows: the app's own
 * files are same-origin, and the stack answers every read with `access-control-allow-origin`. A read
 * of another host (the recordings' Apple or a CDN: the origin a CORS refusal really names) is never
 * excused, nor is any other wording.
 *
 * When it happens is not part of the decision. WebKit refuses these reads at a navigation, at a
 * reload, at a close, at an offline toggle and at a route's `abort`, and the two-second window around
 * a navigation or a close that this replaces (`isRefusalOfTheLeavingPage`) did not cover the refusals
 * of run 39480808919: that run failed on them, with the window in place.
 *
 * Framework-free on purpose: `tests/refused-read.test.ts` proves both sides of it in Node.
 */

/** WebKit's refusal, verbatim: the whole line is these words around the address it refused. */
const REFUSED = /^Fetch API cannot load (\S+) due to access control checks\.$/

/**
 * The address WebKit refused in `text`, or null when it is not that refusal at all. `text` is a page error's
 * message, or its stack: WebKit's error arrives with the wording split oddly in two (Playwright keeps the
 * driver's `name: message` split, so `name` is "Fetch API cannot load http" and `message` starts with
 * "//localhost…"), and only the stack's first line holds it whole. Only the first line is read, so a thrown
 * error's own "Error: …" line and any later line of a stack can never be taken for it.
 */
export function refusedRead(text: string): URL | null {
  const address = REFUSED.exec(text.split('\n', 1)[0] ?? '')?.[1]
  if (!address) return null
  try {
    return new URL(address)
  } catch {
    return null
  }
}

/** The app the flows run on and the local stack it reads, and nothing else: never another host, in CI or on a laptop. */
export const isLocalAddress = (url: URL) => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)

/**
 * Whether `text` is WebKit refusing a read of this app's own: the wording exactly, and an address whose origin
 * is one of `own` — the app the flows are served (`baseURL`) and the stack it reads (`stack.url`, e2e/fixtures.ts).
 * Every other host and every other message is a failure the flow must report.
 */
export function isOwnRefusal(text: string, own: readonly string[]): boolean {
  const refused = refusedRead(text)
  return refused !== null && own.includes(refused.origin)
}
