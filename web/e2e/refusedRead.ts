/**
 * WebKit's uncaught error for a read it refused itself, and when such a refusal is the page going rather
 * than a read that failed (`noPageErrors` in e2e/fixtures.ts). WebKit's words are "Fetch API cannot load
 * <url> due to access control checks."; they read like CORS and are not: WebKit labels every request that
 * fails synchronously as an access-control error, and the one it refuses that way is a read the page still
 * had in flight when its document was on the way out (a navigation, a reload, the page closing). The app
 * catches those promises (a look that learns nothing is not a failure), and Playwright still reports each
 * as a `pageerror`, so nothing a member sees is broken and the flow did nothing wrong.
 *
 * Excused only as narrowly as that is true: the wording exactly, an address of this app itself (the build
 * e2e/serve.mjs serves, or the local stack it reads: 20 October 2026, run 39476741420, `latest.json` on
 * localhost:4327 and `/rest/v1/…` on 127.0.0.1:55321), and the error came with a navigation or a close of
 * that page, within `LEAVING_WINDOW_MS` after it. A read of another host (the recordings' Apple or a CDN:
 * the origin a CORS refusal really names) is never excused, and neither is anything that did not come with
 * the page going.
 *
 * Framework-free on purpose: `tests/refused-read.test.ts` proves both sides of it in Node.
 */

/** WebKit's refusal, verbatim: the whole line is these words around the address it refused. */
const REFUSED = /^Fetch API cannot load (\S+) due to access control checks\.$/

/**
 * How long after the page started going a refusal still explains it. WebKit refuses the reads in the
 * document's unload, when the navigation starts or the page closes; the refusal reaches Playwright a moment
 * later (sometimes after the next document committed). A read that fails this long after the page went is
 * not the page going and fails the flow.
 */
export const LEAVING_WINDOW_MS = 2_000

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
 * Whether `text` is WebKit refusing one of this app's own reads as the page left: `leftAt` is when that
 * page's last navigation started or it was closed (null for never), `at` when the error was reported.
 */
export function isRefusalOfTheLeavingPage(text: string, at: number, leftAt: number | null): boolean {
  const refused = refusedRead(text)
  if (!refused || !isLocalAddress(refused)) return false
  if (leftAt === null) return false
  const since = at - leftAt
  return since >= 0 && since <= LEAVING_WINDOW_MS
}
