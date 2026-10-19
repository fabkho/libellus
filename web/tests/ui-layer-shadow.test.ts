import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The app's own components, composables and utils keep winning over the shared UI base's of the same name
 * (ui.config.ts; the plan's risk "Duplicate resolution", docs/ui-layer-plan.md §6 in fabkho/trappist). Nuxt
 * decides, and it has got this wrong before (a layer's composable beat the project's in 4.4.0 and 4.4.2,
 * nuxt/nuxt#34838), so what it resolved is read back from the files it writes
 * (`.nuxt/imports.d.ts`, `.nuxt/components.d.ts`) after `UI_LAYER=… nuxt prepare` (the `postinstall` step,
 * run with the variable). Skipped where the base is not extended: there is nothing to shadow.
 */

const web = fileURLToPath(new URL('..', import.meta.url))
const layer = process.env.UI_LAYER ? resolve(process.env.UI_LAYER) : ''
const imports = join(web, '.nuxt/imports.d.ts')
const components = join(web, '.nuxt/components.d.ts')
const prepared = () => existsSync(imports) && existsSync(components) && readFileSync(imports, 'utf8').includes('useUiText')

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

describe.skipIf(!layer)('the shared UI base does not take over what the app has', () => {
  const app = [join(web, 'app/composables'), join(web, 'app/utils')]
  const base = [join(layer, 'composables'), join(layer, 'utils')]

  it('keeps every auto-import the app exports pointing at the app', (ctx) => {
    if (!prepared()) return ctx.skip()
    const shared = [...exported(base)].filter((name) => exported(app).has(name))
    expect(shared.length).toBeGreaterThan(0)
    // One name can be in several export lists; a name from the base's folder is a line whose path leaves `web/`.
    const fromBase = readFileSync(imports, 'utf8')
      .split('\n')
      .filter((line) => /\/(fabkho-ui|ui|@fabkho\/ui)\/(composables|utils)\//.test(line) || line.includes(layer))
    const taken = shared.filter((name) => fromBase.some((line) => new RegExp(`[{,\\s]${name.replace('$', '\\$')}[,\\s}]`).test(line.split(/ from /)[0] ?? '')))
    expect(taken).toEqual([])
  })

  it('keeps every Ui* component the app has pointing at the app', (ctx) => {
    if (!prepared()) return ctx.skip()
    const own = files(join(web, 'app/components/ui'), /\.vue$/).map((file) => `Ui${file.split('/').pop()!.replace('.vue', '')}`)
    const lines = readFileSync(components, 'utf8').split('\n')
    expect(own.length).toBeGreaterThan(20)
    for (const name of own) {
      const line = lines.find((l) => l.startsWith(`export const ${name}:`))
      expect(line, `${name} is registered`).toBeDefined()
      expect(line, `${name} comes from app/components/ui`).toContain('app/components/ui/')
    }
  })
})
