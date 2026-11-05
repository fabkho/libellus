import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LEGAL_DOCUMENTS } from '@/legal'
import { LEGAL_LANGS } from '@/legal/types'

/**
 * betterreads.de is the main address; libellus.fabkho.dev is an alias that stays (docs/HOSTING.md, "Addresses"). This keeps the
 * old address from creeping back into what a member or a visitor reads, and into the files that name the address of the
 * site: a file may hold it only if it is listed here with the reason. Plain text search over the files, nothing clever
 * (no comment stripping): a mention in a comment is a mention, so it is listed too.
 *
 * Not scanned: the tests (fixtures), `docs/perf`, `docs/security`, `docs/plans` and `docs/proposals` (dated measurements and plans,
 * history), the migrations, CHANGELOG.md (history), and `books.fabkho.dev` / `privacy@fabkho.dev`, which are the owner's other
 * addresses and are not this one.
 */
const OLD = 'libellus.fabkho.dev'

const web = fileURLToPath(new URL('..', import.meta.url))
const repo = join(web, '..')

/** Files that may name the old address, and why. */
const ALLOWED: Record<string, string> = {
  'web/app/utils/siteOrigin.ts': 'the list of aliases: the one place that knows the old host (and the comments that say why)',
  'web/app/legal/imprint.ts': 'one sentence per language: the same app can still be reached at the old address',
  'web/public/_headers': 'a comment on the noindex rule: the old address is an alias that stays',
  'docs/HOSTING.md': '"Addresses": the alias, what it keeps and why; the zone and rule notes for it',
  'docs/ANDROID.md': 'the app is opened from betterreads.de only; says the alias serves the same app and the assetlinks file',
  'docs/legal-checklist.md': 'the owner check on the imprint: it says the old address still reaches the same app, drop it with the alias',
  'docs/SETUP.md': 'step 1.3: the owner\'s instance keeps the old address in Supabase\'s Redirect URLs',
  'docs/parity.md': 'a header check dated 2026-10-14, read on the address that was live then',
  'SPEC.md': 'the hosting row: the alias and the Pages host',
  'SECURITY.md': 'the "do not test against" line names both addresses',
}

const TEXT = /\.(ts|js|mjs|vue|json|md|txt|html|css|yml|yaml|toml|webmanifest)$/
const SKIP_DIRS = new Set(['node_modules', '.git', '.nuxt', '.output', 'dist', '_nuxt', 'foliate-js'])

function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : walk(join(dir, entry.name))
    return entry.isFile() && (TEXT.test(entry.name) || entry.name === '_headers') ? [join(dir, entry.name)] : []
  })
}

/** The top level of a folder only (the docs folder: its sub-folders hold history). */
const topLevel = (dir: string) =>
  readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile() && TEXT.test(entry.name)).map((entry) => join(dir, entry.name))

const scanned = (): string[] => [
  ...walk(join(web, 'app')),
  ...walk(join(web, 'i18n')),
  ...walk(join(web, 'public')),
  ...walk(join(web, 'functions')),
  ...walk(join(web, 'e2e')),
  ...walk(join(repo, 'supabase', 'templates')),
  ...walk(join(repo, '.github')),
  ...walk(join(repo, 'design')),
  ...topLevel(repo),
  ...topLevel(join(repo, 'docs')),
]

const inRepo = (file: string) => relative(repo, file).split(sep).join('/')

describe('the old address', () => {
  it('is named only where it is meant to be', () => {
    const files = scanned()
    expect(files.length).toBeGreaterThan(100)
    const found = files.filter((file) => readFileSync(file, 'utf8').toLowerCase().includes(OLD)).map(inRepo).sort()
    const unexpected = found.filter((file) => !(file in ALLOWED))
    expect(unexpected, `name betterreads.de instead, or list the file in ALLOWED with the reason`).toEqual([])
  })

  it('is not listed for a file that no longer names it', () => {
    const files = new Set(scanned().filter((file) => readFileSync(file, 'utf8').toLowerCase().includes(OLD)).map(inRepo))
    for (const file of Object.keys(ALLOWED)) expect(files.has(file), `${file} no longer names ${OLD}: drop it from ALLOWED`).toBe(true)
  })

  it('is not in the privacy notice, and the imprint names the main address first', () => {
    const privacy = JSON.stringify(LEGAL_DOCUMENTS.privacy)
    expect(privacy.toLowerCase()).not.toContain(OLD)
    const about = (lang: 'en' | 'de') => {
      const section = LEGAL_DOCUMENTS.imprint[lang].sections.find((s) => s.id === 'about')!
      return section.blocks.map((block) => ('p' in block ? block.p : '')).join(' ')
    }
    for (const lang of LEGAL_LANGS) {
      const text = about(lang)
      expect(text, lang).toContain('betterreads.de')
      expect(text.indexOf('betterreads.de'), lang).toBeLessThan(text.indexOf(OLD))
    }
  })

  it('does not reach the places that tell the instance where it lives', () => {
    for (const file of ['.github/workflows/release.yml', 'web/public/.well-known/security.txt']) {
      const text = readFileSync(join(repo, file), 'utf8')
      expect(text, file).toContain('https://betterreads.de')
      expect(text.toLowerCase(), file).not.toContain(OLD)
    }
  })
})
