import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { NOTES_QUEUE_PREFIX } from '@/data/localData'
import { NOTES_QUEUE_PREFIX as QUEUE_PREFIX_OF_STORAGE, notesQueueKey } from '@/utils/notesStorage'

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

/** The lines of a file that are not comments (a comment may name what it explains): whole comment lines are left out, nothing is rewritten. */
const codeOf = (file: string) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join('\n')

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

describe('the notes store and its repository are not part of the entry', () => {
  const entry = [...reachable()]

  it('reaches neither the notes store nor the notes repository, nor the chat layer, by a static import', () => {
    const forbidden = /(?:stores\/notes(?![A-Za-z])|data\/notes(?![A-Za-z])|utils\/notes(?![A-Za-z])|realtime-client|@supabase\/realtime-js|@fabkho\/chat)/
    const offenders = entry.filter((file) => staticImports(readFileSync(file, 'utf8')).some((spec) => forbidden.test(spec) && !/realtimeStub/.test(spec)))
    expect(offenders.map((f) => f.slice(web.length))).toEqual([])
  })

  it('names the big store in no file of the entry', () => {
    const named = entry.filter((file) => /useNotesStore/.test(readFileSync(file, 'utf8')))
    expect(named.map((f) => f.slice(web.length))).toEqual([])
  })

  it('keeps the Notes routes and the store off the Realtime client: they read when opened, on return and on Refresh', () => {
    const files = [...filesIn(join(app, 'pages/notes')), ...filesIn(join(app, 'components/notes')), join(app, 'stores/notes.ts'), join(app, 'stores/notesSummary.ts'), join(app, 'data/notes.ts'), join(app, 'utils/notes.ts')]
    expect(files.length).toBeGreaterThan(8)
    for (const file of files) {
      const code = codeOf(file)
      expect(code, file.slice(web.length)).not.toMatch(/realtime-client|realtime-js|data\/buddyLive|createBuddyLive|stores\/buddyRead(?![A-Za-z])|\.channel\(/)
    }
  })

  it('keeps the Book page and its Notes parts free of the big store, the repository and the chat layer: they read the lines through the small store', () => {
    for (const file of ['pages/book/[key].vue', 'components/notes/BookSection.vue', 'components/notes/BookButton.vue', 'stores/notesSummary.ts', 'components/together/BookRow.vue']) {
      const specs = staticImports(readFileSync(join(app, file), 'utf8'))
      expect(specs.filter((spec) => /stores\/notes(?![A-Za-z])|data\/notes(?![A-Za-z])|utils\/notes(?![A-Za-z])|@fabkho\/chat|#layers\/chat/.test(spec)), file).toEqual([])
    }
  })

  it('loads the repository for the Book page’s lines by a dynamic import, the first time she opens a Book', () => {
    const small = readFileSync(join(app, 'stores/notesSummary.ts'), 'utf8')
    expect(small).toMatch(/import\('~\/data\/notes'\)/)
  })

  it('keeps the notes device keys under libellus. so signing out forgets them', () => {
    const storage = readFileSync(join(app, 'utils/notesStorage.ts'), 'utf8')
    expect(storage).toContain("NOTES_STORAGE_PREFIX = 'libellus.notes'")
    expect(staticImports(storage)).toEqual([])
    expect(NOTES_QUEUE_PREFIX).toBe(QUEUE_PREFIX_OF_STORAGE)
    expect(notesQueueKey('m').startsWith(NOTES_QUEUE_PREFIX)).toBe(true)
    const visibility = readFileSync(join(app, 'utils/noteVisibility.ts'), 'utf8')
    expect(visibility).toContain("'libellus.notes.visibility'")
  })
})

describe('what the routes’ validate pulls into the entry', () => {
  it('imports only the address helpers, which hold no chat layer and no store', () => {
    for (const page of ['pages/notes/[book]/index.vue', 'pages/notes/[book]/[chapter].vue']) {
      const source = readFileSync(join(app, page), 'utf8')
      expect(source).toMatch(/import \{[^}]*isBookId[^}]*\} from '~\/utils\/notesRoute'/)
      expect(source, page).not.toMatch(/import \{[^}]*\bisBookId\b[^}]*\} from '~\/utils\/notes'/)
    }
    expect(staticImports(readFileSync(join(app, 'utils/notesRoute.ts'), 'utf8'))).toEqual([])
    expect(staticImports(readFileSync(join(app, 'utils/notesSummary.ts'), 'utf8'))).toEqual([])
    expect(readFileSync(join(app, 'utils/notesRoute.ts'), 'utf8').length).toBeLessThan(1500)
  })
})
