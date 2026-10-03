import { expect, test as base } from '@playwright/test'
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

/**
 * Every control a member can reach carries a `data-testid` (web/AGENTS.md). The
 * page reports each one it ever showed without, from every screen and state
 * any flow visits; the test fails on the first of them. The dev playground
 * (/prototype) is not a screen and is skipped.
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
    for (const el of document.querySelectorAll(CONTROLS)) {
      if (seen.has(el) || el.hasAttribute('data-testid')) continue
      if (el.closest('[aria-hidden=true], [hidden], [inert], .nuxt-devtools-frame')) continue
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

export const test = base.extend<{ noLiveApis: void; everyControlHasATestId: void }>({
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
