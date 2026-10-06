// usage: node heap.mjs <port> <path-substring>: JS heap before / after reading one EPUB's metadata (CDP Runtime.getHeapUsage, GC forced before)
import { chromium } from 'playwright-core'
const [port, pattern, reader = 'metaZipJs'] = process.argv.slice(2)
const browser = await chromium.connectOverCDP(`http://localhost:${port}`)
const pages = browser.contexts().flatMap((c) => c.pages())
let page
for (const p of pages) if ((await p.evaluate(() => document.visibilityState).catch(() => 'x')) === 'visible') { page = p; break }
page ??= pages[0]
const cdp = await page.context().newCDPSession(page)
const ev = async (expression) => (await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value
await ev('(async()=>{ if(!spike.lastScan) await spike.scan(); return 1 })()')
const heap = async () => (await cdp.send('Runtime.getHeapUsage')).usedSize
await cdp.send('HeapProfiler.collectGarbage')
const before = await heap()
const peak = await ev(`(async()=>{ const item = spike.lastScan.find(f=>f.path.includes(${JSON.stringify(pattern)})); const file = await item.handle.getFile(); const m = await spike[${JSON.stringify(reader)}](file); return JSON.stringify({size:file.size, title:m.title}) })()`)
const afterNoGc = await heap()
await cdp.send('HeapProfiler.collectGarbage')
const afterGc = await heap()
// fflate (whole file in memory) for contrast
await cdp.send('HeapProfiler.collectGarbage')
const b2 = await heap()
await ev(`(async()=>{ const item = spike.lastScan.find(f=>f.path.includes(${JSON.stringify(pattern)})); const file = await item.handle.getFile(); const bytes = new Uint8Array(await file.arrayBuffer()); window.__hold = bytes; await spike.metaFflate(file); })()`)
const ffNoGc = await heap()
await ev('window.__hold = null')
console.log(JSON.stringify({ pattern, peak, zipjs: { beforeKB: Math.round(before/1024), afterNoGcKB: Math.round(afterNoGc/1024), deltaNoGcKB: Math.round((afterNoGc-before)/1024), retainedAfterGcKB: Math.round((afterGc-before)/1024) }, fflate: { deltaNoGcKB: Math.round((ffNoGc-b2)/1024) } }))
await browser.close().catch(() => {})
