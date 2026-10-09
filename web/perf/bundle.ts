/**
 * Perf harness: what the production build ships, from its files alone (no browser).
 *
 *   pnpm perf:bundle [dist]        default: web/.output/public (pnpm perf:build)
 *
 * Prints: the entry (the scripts and styles index.html loads or preloads) and what it costs raw / gzip
 * / brotli (the sizes a phone downloads: Pages serves brotli), the chunks prefetched on every
 * start, the largest chunks with what they contain (by library signature), the service worker's
 * precache (entries, raw and brotli bytes, by kind), fonts and images, and the message file.
 * `--json` prints the same as JSON.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'

const json = process.argv.includes('--json')
const root = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? new URL('../.output/public', import.meta.url).pathname

const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]))
const files = walk(root).map((p) => ({ path: relative(root, p), abs: p }))
const cache = new Map<string, { raw: number; gzip: number; br: number }>()
const size = (path: string) => {
  const hit = cache.get(path)
  if (hit) return hit
  const body = readFileSync(join(root, path))
  const s = { raw: body.length, gzip: gzipSync(body, { level: 9 }).length, br: brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length }
  cache.set(path, s)
  return s
}
const kb = (n: number) => (n / 1024).toFixed(1).padStart(7)
const sum = (paths: string[]) => paths.reduce((a, p) => ({ raw: a.raw + size(p).raw, gzip: a.gzip + size(p).gzip, br: a.br + size(p).br }), { raw: 0, gzip: 0, br: 0 })

const html = readFileSync(join(root, 'index.html'), 'utf8')
const refs = (rel: string) => [...html.matchAll(new RegExp(`<link[^>]*rel="${rel}"[^>]*href="([^"]+)"`, 'g'))].map((m) => m[1]!.replace(/^\//, ''))
const entryScript = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]!.replace(/^\//, ''))
const entryCss = refs('stylesheet')
const preload = refs('modulepreload')
const prefetch = refs('prefetch')
const entry = [...new Set([...entryScript, ...preload, ...entryCss])]

// What a chunk is made of, by strings that only that library has.
const SIGNATURES: [string, RegExp][] = [
  ['vue + @vue/runtime', /Vue warn|__VUE_OPTIONS_API__|createVNode/],
  ['vue-router', /createRouter|NavigationFailureType/],
  ['pinia', /defineStore|createPinia/],
  ['@supabase/supabase-js', /GoTrueClient|PostgrestClient|supabase-js/],
  ['@nuxtjs/i18n + intlify', /intlify|createI18n|@intlify/],
  ['nuxt runtime', /defineNuxtPlugin|useNuxtApp|nuxt-link|NuxtLink/],
  ['web-vitals', /onINP|web-vitals|LayoutShift/],
  ['dompurify', /DOMPurify|dompurify/],
  ['papaparse', /Papa Parse|papaparse/],
  ['fflate', /fflate|inflateSync|unzipSync/],
  ['zxing-wasm', /zxing|ReadResult|barcode/i],
  ['foliate / reader', /foliate|epub|EPUB|CFI/],
  ['thumbhash', /thumbhash|ThumbHash/i],
  ['workbox', /workbox/],
  ['three / tres (regal)', /THREE\.|TresCanvas|WebGLRenderer/],
]
const describe = (path: string) => {
  const text = readFileSync(join(root, path), 'utf8')
  return SIGNATURES.filter(([, re]) => re.test(text)).map(([n]) => n)
}

const assets = files.filter((f) => f.path.startsWith('_nuxt/') && /\.(js|css)$/.test(f.path))
const largest = assets
  .map((f) => ({ path: f.path, ...size(f.path), in: entry.includes(f.path) ? 'entry' : prefetch.includes(f.path) ? 'prefetch' : 'lazy', contains: f.path.endsWith('.js') ? describe(f.path) : [] }))
  .sort((a, b) => b.br - a.br)

// The service worker's precache list (workbox's generated manifest).
const sw = readFileSync(join(root, 'sw.js'), 'utf8')
const precache = [...sw.matchAll(/\{url:"([^"]+)",revision:(null|"[^"]*")\}/g)].map((m) => m[1]!)
const kind = (p: string) => (/\.html$/.test(p) ? 'html' : /\.js$/.test(p) ? 'js' : /\.css$/.test(p) ? 'css' : /\.woff2$/.test(p) ? 'font' : /\.(png|ico|svg)$/.test(p) ? 'icon' : 'other')
const byKind: Record<string, { n: number; raw: number; br: number }> = {}
for (const p of precache) {
  const f = p.replace(/\?.*$/, '')
  if (!files.some((x) => x.path === f)) continue
  const k = kind(f)
  byKind[k] ??= { n: 0, raw: 0, br: 0 }
  byKind[k]!.n++
  byKind[k]!.raw += size(f).raw
  byKind[k]!.br += /\.(png|ico|woff2)$/.test(f) ? size(f).raw : size(f).br
}
const precacheTotal = sum(precache.map((p) => p.replace(/\?.*$/, '')).filter((f) => files.some((x) => x.path === f)))

const result = {
  entry: { files: entry.length, ...sum(entry), list: entry.map((p) => ({ path: p, ...size(p), contains: p.endsWith('.js') ? describe(p) : [] })) },
  prefetched: { files: prefetch.length, ...sum(prefetch) },
  totalAssets: { files: assets.length, ...sum(assets.map((a) => a.path)) },
  largest: largest.slice(0, 20),
  precache: { entries: precache.length, ...precacheTotal, byKind },
  fonts: files.filter((f) => /\.woff2?$/.test(f.path)).map((f) => ({ path: f.path, bytes: size(f.path).raw })),
  html: files.filter((f) => f.path.endsWith('.html')).map((f) => ({ path: f.path, ...size(f.path) })),
  locale: (() => {
    const m = largest.find((l) => l.contains.includes('@nuxtjs/i18n + intlify') && l.raw > 40000)
    return m ?? null
  })(),
}

if (json) console.log(JSON.stringify(result, null, 1))
else {
  console.log(`## Entry (index.html: ${entryScript.length} script, ${entryCss.length} stylesheet, ${preload.length} modulepreload)`)
  console.log(`raw ${kb(result.entry.raw)} KB   gzip ${kb(result.entry.gzip)} KB   brotli ${kb(result.entry.br)} KB   (${entry.length} files)`)
  for (const e of result.entry.list.sort((a, b) => b.br - a.br)) console.log(`  ${kb(e.raw)} raw ${kb(e.br)} br  ${e.path}  ${e.contains.join(', ')}`)
  console.log(`\n## Prefetched on every start (<link rel=prefetch>): ${prefetch.length} files, raw ${kb(result.prefetched.raw)} KB, brotli ${kb(result.prefetched.br)} KB`)
  console.log(`## All JS and CSS in _nuxt/: ${assets.length} files, raw ${kb(result.totalAssets.raw)} KB, brotli ${kb(result.totalAssets.br)} KB`)
  console.log(`\n## Largest chunks (brotli)`)
  for (const l of result.largest) console.log(`  ${kb(l.raw)} raw ${kb(l.br)} br  [${l.in}] ${l.path}  ${l.contains.join(', ')}`)
  console.log(`\n## Service worker precache: ${result.precache.entries} entries, raw ${kb(result.precache.raw)} KB, as downloaded (brotli, fonts and icons raw) ${kb(Object.values(byKind).reduce((a, k) => a + k.br, 0))} KB`)
  for (const [k, v] of Object.entries(byKind)) console.log(`  ${k.padEnd(6)} ${String(v.n).padStart(4)} files  raw ${kb(v.raw)} KB  download ${kb(v.br)} KB`)
  console.log(`\n## Fonts: ${result.fonts.map((f) => `${f.path.split('/').pop()} ${(f.bytes / 1024).toFixed(1)} KB`).join(', ')}`)
  console.log(`## HTML: ${result.html.length} files, ${result.html.map((h) => h.raw).join(', ')} bytes each`)
  if (result.locale) console.log(`## Messages chunk: ${result.locale.path} raw ${kb(result.locale.raw)} KB brotli ${kb(result.locale.br)} KB [${result.locale.in}]`)
}
