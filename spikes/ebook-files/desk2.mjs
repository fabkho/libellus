// desktop Chromium (Chrome for Testing 153, headless): same page; folder = OPFS directory handle stand-in
import { chromium } from 'playwright-core'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
page.on('console', (m) => process.stderr.write(`console: ${m.text()}\n`))
await page.goto('http://localhost:3126/')
await page.waitForTimeout(800)
const names = ['gutenberg-1399-anna-karenina.epub', 'gutenberg-2600-war-and-peace.epub', 'gutenberg-2701-moby-dick.epub', 'gutenberg-345-dracula.epub', 'gutenberg-4300-ulysses.epub']
const out = {}
page.on('crash', () => console.error('CRASH'))
page.on('pageerror', (e) => console.error('pageerror', e.message))
const step = async (name, fn) => { try { out[name] = await fn() } catch (e) { out[name] = { error: e.message.slice(0, 300) }; console.error(name, 'failed', e.message.slice(0,200)) } }
await step('env', () => page.evaluate(() => spike.env()))
await step('fill', () => page.evaluate((n) => spike.useOpfsFolder(n, 9), names))
await step('compare', () => page.evaluate(() => spike.compareScans(5)))
await step('read', () => page.evaluate(async () => { const f = await spike.scan(); const item = f.find((x) => x.path.includes('2600')); const t = performance.now(); const file = await item.handle.getFile(); const b = new Uint8Array(await file.arrayBuffer()); return { size: b.length, ms: performance.now() - t } }))
await step('bench', () => page.evaluate(() => spike.bench(15)))
await step('opfs', () => page.evaluate(() => spike.opfs()))
console.log(JSON.stringify(out, null, 1))
await browser.close()
