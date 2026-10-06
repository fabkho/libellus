// usage: node cdp.mjs <port> [urlSubstring] '<js expression>'   (evaluates with a user gesture, awaits promises, prints JSON)
import { chromium } from 'playwright-core'
const [port, match, expr] = process.argv.length === 5 ? process.argv.slice(2) : [process.argv[2], '', process.argv[3]]
const browser = await chromium.connectOverCDP(`http://localhost:${port}`)
const pages = browser.contexts().flatMap((c) => c.pages())
let page
for (const p of pages) { if (!p.url().includes(match)) continue; const v = await p.evaluate(() => document.visibilityState).catch(() => 'x'); if (v === 'visible') { page = p; break } }
page ??= pages.find((p) => p.url().includes(match)) ?? pages[0]
if (!page) { console.log('NO PAGE', pages.length); process.exit(1) }
const cdp = await page.context().newCDPSession(page)
const r = await cdp.send('Runtime.evaluate', { expression: expr, userGesture: true, awaitPromise: true, returnByValue: true, timeout: 120000 })
console.log(JSON.stringify(r.exceptionDetails ? { exception: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text } : r.result.value, null, 1))
console.error('page:', page.url())
await browser.close().catch(() => {})
