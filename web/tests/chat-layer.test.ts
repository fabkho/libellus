import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadNuxtConfig } from 'nuxt/kit'
import { describe, expect, it } from 'vitest'
import { chatLayer } from '../chat.config.ts'

/**
 * The shared chat layer (`@fabkho/chat`, chat.config.ts; the package's README says how it is used) is taken and wired, not
 * used yet. What this keeps: the alias `#layers/chat` reaches it, Nuxt registers it exactly once and under its own name, and
 * nothing of the app takes over a name it has or the other way round (the app's own composables and utils win, as with the UI
 * base: tests/ui-layer-shadow.test.ts, which reads back the files `nuxt prepare` writes). The package keeps its own rules
 * (no words, no app imports, no Realtime library) in its own tests; this is the app's side of the seam.
 */

const web = fileURLToPath(new URL('..', import.meta.url))
/** The layer: the installed package, or the checkout `CHAT_LAYER` names (chat.config.ts). */
const layer = process.env.CHAT_LAYER ? resolve(process.env.CHAT_LAYER) : join(web, 'node_modules/@fabkho/chat')
const imports = join(web, '.nuxt/imports.d.ts')
const prepared = () => existsSync(imports) && readFileSync(imports, 'utf8').includes('createSaveQueue')

const files = (dir: string, extension: RegExp): string[] =>
  existsSync(dir) ? readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile() && extension.test(e.name)).map((e) => join(e.parentPath, e.name)) : []

/** The names a folder of auto-imports exports (`export function|const|class|type|interface|enum name`, `export { a, b }`). */
const exported = (dirs: string[]) => {
  const names = new Set<string>()
  for (const file of dirs.flatMap((dir) => files(dir, /\.ts$/))) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/^export (?:async )?(?:function|const|let|class|interface|type|enum) ([\w$]+)/gm)) names.add(match[1]!)
    for (const match of source.matchAll(/^export \{([^}]+)\}/gm)) for (const name of match[1]!.split(',')) names.add(name.trim().split(/\s+as\s+/).pop()!)
  }
  return names
}

describe('the shared chat layer is wired', () => {
  it('is reached by `#layers/chat`, the alias vitest.config.ts maps as Nuxt does', async () => {
    const queue = await import('#layers/chat/app/utils/queue')
    expect(typeof queue.createSaveQueue).toBe('function')
    expect(existsSync(join(layer, 'app/composables/useThread.ts'))).toBe(true)
  })

  it('names itself `chat` (the alias comes from `$meta.name`) and is a package pinned to a tag', () => {
    expect(readFileSync(join(layer, 'nuxt.config.ts'), 'utf8')).toMatch(/\$meta:\s*\{\s*name:\s*'chat'\s*\}/)
    const pkg = JSON.parse(readFileSync(join(layer, 'package.json'), 'utf8')) as { name: string; peerDependencies: Record<string, string>; files: string[] }
    expect(pkg.name).toBe('@fabkho/chat')
    // `*`, not a range: a git-URL install of the base cannot satisfy one, and pnpm would not link it (the package's README).
    expect(pkg.peerDependencies['@fabkho/ui']).toBe('*')
    expect(pkg.files).toEqual(expect.arrayContaining(['app', 'nuxt.config.ts']))
    const mine = JSON.parse(readFileSync(join(web, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
    expect(mine.dependencies['@fabkho/chat'], 'a tag, never a branch').toMatch(/^github:fabkho\/chat#v\d+\.\d+\.\d+$/)
  })

  it('is one layer of the app, once, under that name', async () => {
    const config = await loadNuxtConfig({ cwd: web })
    // Regal's own lookup (regal.config.ts): c12 keeps `$meta.name` on the layer, as `meta` or in its config.
    const nameOf = (l: unknown) => {
      const layer = l as { meta?: { name?: string }; config: { $meta?: { name?: string } } }
      return layer.meta?.name ?? layer.config.$meta?.name
    }
    const named = config._layers.filter((l) => nameOf(l) === 'chat')
    expect(named).toHaveLength(1)
    // `chatLayer()` is the one place that says where it comes from.
    expect(chatLayer()).toBe(process.env.CHAT_LAYER || '@fabkho/chat')
    // Not the same folder under two layers either (a path and its link into pnpm's store).
    expect(new Set(config._layers.map((l) => l.cwd)).size).toBe(config._layers.length)
  })

  it('has no components or pages the app could be shadowing, only logic', () => {
    for (const folder of ['components', 'pages', 'layouts', 'plugins', 'middleware', 'stores']) expect(existsSync(join(layer, 'app', folder)), folder).toBe(false)
  })
})

describe('the chat layer does not take over what the app has', () => {
  const app = [join(web, 'app/composables'), join(web, 'app/utils')]
  const base = [join(layer, 'app/composables'), join(layer, 'app/utils'), join(layer, 'app/types')]

  it('keeps every auto-import the app exports pointing at the app', (ctx) => {
    if (!prepared()) return ctx.skip()
    const own = exported(app)
    const shared = [...exported(base)].filter((name) => own.has(name))
    // The line of `.nuxt/imports.d.ts` an export is on; one from the layer has the package's path in it.
    const fromLayer = readFileSync(imports, 'utf8')
      .split('\n')
      .filter((line) => /\/@fabkho\/chat\/app\//.test(line) || line.includes(layer))
    const taken = shared.filter((name) => fromLayer.some((line) => new RegExp(`[{,\\s]${name.replace('$', '\\$')}[,\\s}]`).test(line.split(/ from /)[0] ?? '')))
    expect(taken).toEqual([])
  })

  it('has no file at a path the app also has (the app\'s would win by name, the layer\'s would be dead)', () => {
    const rel = (dir: string, root: string) => files(dir, /\.ts$/).map((f) => f.slice(root.length))
    for (const folder of ['composables', 'utils']) {
      const mine = new Set(rel(join(web, 'app', folder), join(web, 'app', folder)))
      const theirs = rel(join(layer, 'app', folder), join(layer, 'app', folder))
      expect(theirs.filter((f) => mine.has(f)), `app/${folder}`).toEqual([])
    }
  })
})
