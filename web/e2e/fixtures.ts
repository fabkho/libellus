import { expect, test as base, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { appleCover } from '../tests/support/apple'

/**
 * Where the flows may go: the app itself and the local stack, nothing else. A
 * request to any other host that no spec answered from the recordings
 * (e2e/support.ts, recordedApple) is refused and fails the test, so a flow can
 * never reach a live Apple, OpenLibrary or CDN, in CI or on a laptop.
 */
const isLocal = (url: URL) => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)

// The cover CDNs. A Catalogue that already holds Books (a developer's, the
// sign-in wall's covers) points at them; they answer the recorded stand-in.
const isCoverCdn = (url: URL) => /(^|\.)mzstatic\.com$|^covers\.openlibrary\.org$/.test(url.hostname)

/** The `goodreads-rating` edge function on the local stack (supabase/functions/goodreads-rating). */
export const GOODREADS_FUNCTION = '**/functions/v1/goodreads-rating'

/** An answer of that function, as `route.fulfill` takes it. */
export function goodreadsAnswer(body: unknown, status = 200) {
  return {
    status,
    contentType: 'application/json',
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
    },
    body: JSON.stringify(body),
  }
}

/**
 * Every control a member can reach carries a `data-testid` (web/AGENTS.md). The
 * page reports each one it ever showed without, from every screen and state
 * any flow visits; the test fails on the first of them. The dev playground
 * (/prototype) is not a screen and is skipped, nor is a book's page in the reader.
 */
const WATCH_CONTROLS = () => {
  const CONTROLS =
    'button, a[href], input:not([type=hidden]), textarea, select, summary, ' +
    '[role=button], [role=link], [role=tab], [role=slider], [role=switch], [role=checkbox], [role=radio], [role=menuitem], [role=option]'
  const seen = new WeakSet<Element>()
  const describe = (el: Element) => {
    const text = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40)
    return `${location.pathname}: <${el.tagName.toLowerCase()} class="${String(el.getAttribute('class') ?? '').slice(0, 60)}"> ${text}`
  }
  const scan = () => {
    if (location.pathname.startsWith('/prototype')) return
    // A book's own pages (the reader's blob: frames, #131) are the publisher's markup, not a screen of Libellus.
    if (location.protocol === 'blob:') return
    for (const el of document.querySelectorAll(CONTROLS)) {
      if (seen.has(el) || el.hasAttribute('data-testid')) continue
      if (el.closest('[aria-hidden=true], [hidden], [inert], .nuxt-devtools-frame')) continue
      // Regal's own controls (the shelf's row: its arrows and details over the page, #23; the Stack's and the
      // row's hidden Book list, whose buttons are Regal's `accessible-list`) are the layer's.
      if (el.closest('.regal-books-row, .row-card__details, .regal-book-list')) continue
      seen.add(el)
      ;(window as unknown as { __untaggedControl(d: string): void }).__untaggedControl(describe(el))
    }
  }
  let queued = false
  const queue = () => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      scan()
    })
  }
  new MutationObserver(queue).observe(document, { childList: true, subtree: true, attributes: true })
  queue()
}

/**
 * A tap never lands in a sheet that is still rising or sliding away (UiSheet
 * carries `data-moving` until its transition has ended). Playwright waits for
 * the target's box to hold still between two frames, but a starved CI runner
 * paints no frame between two looks: a control mid-rise then seems to stand
 * still, the tap goes where it was, and the sheet stays open (seen on Add and
 * Add manually). Every click waits for the sheets to be still first, as a
 * member's finger meets a sheet that has arrived. Other motion (a cover in
 * flight, the search morph) is not waited for: some flows tap into it on
 * purpose. Installed once per worker, on Playwright's own Locator.
 */
function tapsWaitForSheets(page: Page) {
  const locator = Object.getPrototypeOf(page.locator('body')) as Locator & { __waitsForSheets?: true }
  if (locator.__waitsForSheets) return
  const click = locator.click
  locator.click = async function (this: Locator, options) {
    await expect(this.page().locator('[role=dialog][data-moving]')).toHaveCount(0)
    return click.call(this, options)
  }
  locator.__waitsForSheets = true
}

/**
 * Errors a page may throw by design. Empty: an uncaught exception is a bug until a flow
 * proves it is the point of the flow. Every entry says why, so none is added to quiet a flow.
 */
const EXPECTED_PAGE_ERRORS: { match: RegExp; why: string }[] = []

export const test = base.extend<{ noLiveApis: void; everyControlHasATestId: void; stillSheets: void; noPageErrors: void }>({
  stillSheets: [
    async ({ page }, use) => {
      tapsWaitForSheets(page)
      await use()
    },
    { auto: true },
  ],
  noPageErrors: [
    async ({ context, browser }, use) => {
      // An uncaught exception of any page (`pageerror`: Playwright reports an uncaught throw and an
      // unhandled rejection there, not as a `console` error) fails the test at its end, with each
      // one's message and stack. A feed refresh once threw on every load and the suite passed (social v1).
      const thrown: string[] = []
      const watch = (ctx: BrowserContext) => {
        const onPage = (page: Page) =>
          page.on('pageerror', (error) => {
            const text = error.stack || `${error.name}: ${error.message}`
            if (EXPECTED_PAGE_ERRORS.some(({ match }) => match.test(text))) return
            thrown.push(`${page.url()}\n${text}`)
          })
        for (const page of ctx.pages()) onPage(page)
        ctx.on('page', onPage)
      }
      watch(context)
      // A flow that needs a second member makes her a context of her own (friends.spec.ts:
      // `browser.newContext`); every context made while the test runs is watched too.
      const newContext = browser.newContext
      browser.newContext = async function (this: typeof browser, ...args: Parameters<typeof newContext>) {
        const made = await newContext.apply(this, args)
        watch(made)
        return made
      } as typeof newContext
      try {
        await use()
      } finally {
        browser.newContext = newContext
      }
      expect(thrown, 'uncaught errors in a page').toEqual([])
    },
    { auto: true },
  ],
  noLiveApis: [
    async ({ context }, use) => {
      const reached: string[] = []
      // Page routes (the recordings) win over these context-wide ones.
      await context.route(
        (url) => /^https?:$/.test(url.protocol) && isCoverCdn(url),
        (route) =>
          route.fulfill({
            status: 200,
            contentType: 'image/jpeg',
            headers: { 'access-control-allow-origin': '*' },
            body: appleCover(),
          }),
      )
      // The Goodreads line (#69): the function is never reached, so no flow can
      // make it ask Goodreads. Unknown.
      await context.route(GOODREADS_FUNCTION, (route) => route.fulfill(goodreadsAnswer({ status: 'not_found' })))
      await context.route(
        (url) => /^https?:$/.test(url.protocol) && !isLocal(url) && !isCoverCdn(url),
        (route) => {
          reached.push(`${route.request().method()} ${route.request().url()}`)
          return route.abort('blockedbyclient')
        },
      )
      await use()
      expect(reached, 'requests to hosts no recording answers').toEqual([])
    },
    { auto: true },
  ],
  everyControlHasATestId: [
    async ({ context }, use) => {
      const untagged = new Set<string>()
      await context.exposeFunction('__untaggedControl', (description: string) => untagged.add(description))
      await context.addInitScript(`document.addEventListener('DOMContentLoaded', ${WATCH_CONTROLS.toString()})`)
      await use()
      expect([...untagged], 'controls without a data-testid').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
