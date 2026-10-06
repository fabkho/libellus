import { chromium } from 'playwright-core'
const browser = await chromium.connectOverCDP(`http://localhost:${process.argv[2]}`)
const pages = browser.contexts().flatMap((c) => c.pages())
let page
for (const p of pages) if ((await p.evaluate(() => document.visibilityState).catch(() => 'x')) === 'visible') { page = p; break }
page ??= pages[0]
const cdp = await page.context().newCDPSession(page)
const m = await cdp.send('Page.getAppManifest')
console.log(JSON.stringify({ url: m.url, errors: m.errors, share_target: JSON.parse(m.data).share_target, installability: (await cdp.send('Page.getInstallabilityErrors')).installabilityErrors }, null, 1))
await browser.close().catch(() => {})
