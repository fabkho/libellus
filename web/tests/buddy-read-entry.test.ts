import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The buddy read's store and its live module stay out of the entry (docs/plans/buddy-read-shared.md W2: "not imported from the entry"; the
 * build-time proof is entry-guard.config.ts, which fails a production build when a chunk the entry loads statically holds the real Realtime
 * client). This is the quick one, on the sources: from what the entry is made of (the app, the error page, the plugins, the middleware, the
 * layouts, the shell) along static imports, no file reaches `stores/buddyRead.ts`, `data/buddyLive.ts` or the real client, and the one file that
 * loads the live module does it with a dynamic `import()`, so a page that does not use buddy reads makes no Realtime request.
 */

const web = fileURLToPath(new URL('..', import.meta.url))
const app = join(web, 'app')

const filesIn = (dir: string): string[] =>
  existsSync(dir) ? readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? filesIn(join(dir, name)) : [join(dir, name)])) : []

/** The code of a file without its comments (a comment may name what it explains). */
const codeOf = (file: string) => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** What a file imports statically (`import … from 'x'`, `import 'x'`, `export … from 'x'`); `import type` is erased, `import('x')` is not static. */
function staticImports(source: string): string[] {
  const found: string[] = []
  for (const match of source.matchAll(/^\s*(?:import|export)\s+(type\s+)?(?:[^'"()]*?\sfrom\s+)?['"]([^'"]+)['"]/gm)) if (!match[1]) found.push(match[2]!)
  return found
}

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith('.') ? resolve(dirname(from), spec) : /^(?:~|@)\//.test(spec) ? join(app, spec.slice(2)) : /^~~\//.test(spec) ? join(web, spec.slice(3)) : null
  if (!base) return null
  for (const candidate of [base, `${base}.ts`, `${base}.vue`, `${base}.js`, join(base, 'index.ts')]) if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  return null
}

/** Everything the entry reaches by static imports, from its roots. */
function reachable(): Set<string> {
  const roots = [join(app, 'app.vue'), join(app, 'error.vue'), join(app, 'router.options.ts'), ...['plugins', 'middleware', 'layouts', 'components/shell'].flatMap((d) => filesIn(join(app, d)))].filter(existsSync)
  const seen = new Set<string>()
  const walk = (file: string) => {
    if (seen.has(file)) return
    seen.add(file)
    for (const spec of staticImports(readFileSync(file, 'utf8'))) {
      const next = resolveImport(file, spec)
      if (next) walk(next)
    }
  }
  roots.forEach(walk)
  return seen
}

describe('the buddy read store and the live module are not part of the entry', () => {
  const entry = [...reachable()]

  it('reads the entry as something real: the app, a plugin, the session store', () => {
    expect(entry.length).toBeGreaterThan(20)
    expect(entry.some((f) => f.endsWith('app/app.vue'))).toBe(true)
    expect(entry.some((f) => f.endsWith('stores/session.ts'))).toBe(true)
  })

  it('reaches neither of them, nor the real Realtime client, by a static import', () => {
    const forbidden = /(?:stores\/buddyRead|data\/buddyLive|data\/buddyReads|realtime-client|@supabase\/realtime-js|@fabkho\/chat)/
    const offenders = entry.filter((file) => staticImports(readFileSync(file, 'utf8')).some((spec) => forbidden.test(spec) && !/realtimeStub/.test(spec)))
    expect(offenders.map((f) => f.slice(web.length))).toEqual([])
  })

  it('names neither in the entry’s sources (the store is auto-registered by Pinia, not auto-imported: a page imports it)', () => {
    const named = entry.filter((file) => /useBuddyReadStore|createBuddyLive/.test(readFileSync(file, 'utf8')))
    expect(named.map((f) => f.slice(web.length))).toEqual([])
  })

  it('loads the live module and the real client only through a dynamic import, in one place each', () => {
    const store = readFileSync(join(app, 'stores/buddyRead.ts'), 'utf8')
    expect(staticImports(store).filter((spec) => /buddyLive|realtime-client/.test(spec))).toEqual([])
    expect(store).toMatch(/import\('~\/data\/buddyLive'\)/)
    expect(store).toMatch(/import\('#realtime-client'\)/)
    const live = readFileSync(join(app, 'data/buddyLive.ts'), 'utf8')
    expect(staticImports(live).filter((spec) => /realtime-client|realtime-js|phoenix/.test(spec))).toEqual([])
    // Nobody else in the app imports the real client.
    const others = filesIn(app).filter((f) => /\.(ts|vue)$/.test(f) && /import\(\s*['"]#realtime-client['"]/.test(codeOf(f)))
    expect(others.map((f) => f.slice(app.length + 1)).sort()).toEqual(['stores/buddyRead.ts', 'stores/import.ts'])
  })
})
