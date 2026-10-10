/**
 * Perf harness: what the Library's device copy costs on the main thread, measured in the page of
 * the production build at 1x, 4x and 6x CPU (CDP throttling): reading `libellus.library` from
 * localStorage, `JSON.parse`, `JSON.stringify` and the write back (data/deviceLibrary.ts does all
 * four: the read at boot, the write after every load), plus parsing the three `library_entries`
 * answers the way supabase-js does (Response.text → JSON.parse).
 *
 *   pnpm perf:probe
 *
 * Output: a table of medians over 15 repeats; raw numbers in .data/perf/probe.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { launch, memberSession, newContext, PROFILES } from './browser'
import { appUrl } from './env'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const browser = await launch(PROFILES.chromium!)
const context = await newContext(browser, PROFILES.chromium!, await memberSession())
const page = await context.newPage()
const cdp = await context.newCDPSession(page)
await page.goto(`${appUrl('chromium')}/`)
await page.getByTestId('home.title').waitFor()
await sleep(4000)

const result: Record<string, Record<string, number>> = {}
for (const rate of [1, 4, 6]) {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate })
  result[`${rate}x`] = await page.evaluate(async () => {
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!
    const time = (f: () => void) => {
      const t = performance.now()
      f()
      return performance.now() - t
    }
    const key = 'libellus.library'
    const text = localStorage.getItem(key)!
    const reads: number[] = []
    const parses: number[] = []
    const stringifies: number[] = []
    const writes: number[] = []
    let value: unknown
    for (let i = 0; i < 15; i++) {
      reads.push(time(() => void localStorage.getItem(key)))
      parses.push(time(() => (value = JSON.parse(text))))
      let out = ''
      stringifies.push(time(() => (out = JSON.stringify(value))))
      writes.push(time(() => localStorage.setItem(key, out)))
    }
    return { copyKb: Math.round(text.length / 1024), readMs: median(reads), parseMs: median(parses), stringifyMs: median(stringifies), writeMs: median(writes) }
  })
}
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
mkdirSync(new URL('../../.data/perf', import.meta.url).pathname, { recursive: true })
writeFileSync(new URL('../../.data/perf/probe.json', import.meta.url), JSON.stringify(result, null, 2))
console.log('| CPU | copy KB | getItem ms | JSON.parse ms | JSON.stringify ms | setItem ms |\n| --- | ---: | ---: | ---: | ---: | ---: |')
for (const [rate, r] of Object.entries(result)) console.log(`| ${rate} | ${r.copyKb} | ${r.readMs!.toFixed(1)} | ${r.parseMs!.toFixed(1)} | ${r.stringifyMs!.toFixed(1)} | ${r.writeMs!.toFixed(1)} |`)
await browser.close()
