import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The client ships without vue-i18n's message compiler (`nuxt.config.ts`, `i18n.bundle`, #perf): every
 * message is compiled when the app is built, so the device only formats. This runs what the build
 * runs, on the app's own `i18n/locales/en.json`: the messages compiled by the same generator the
 * module's Vite plugin calls (`@intlify/bundle-utils`, JIT, production), then formatted by vue-i18n.
 * Plural, named, literal and linked messages must render from what the generator left, and nothing
 * may be left as a string the device would have to compile (a call such as
 * `t(key, 'default text {x}')` is such a string; the app makes none). Node's build of vue-i18n
 * still carries a compiler (the browser's, with `i18n.bundle.dropMessageCompiler`, does not), so the
 * test shows what the device is given and that it formats it, not the absence of the compiler:
 * that one is the bundle's size (`pnpm perf:bundle`).
 *
 * Both packages are found where `@nuxtjs/i18n` finds them, so the test uses the copies the build does.
 */

const require = createRequire(import.meta.url)
const moduleDir = dirname(realpathSync(require.resolve('@nuxtjs/i18n/package.json')))
const fromModule = createRequire(join(moduleDir, 'package.json'))
const fromPlugin = createRequire(fromModule.resolve('@intlify/unplugin-vue-i18n/package.json'))

type Generate = (source: string, options: Record<string, unknown>) => { code: string }
const { generateJSON } = fromPlugin('@intlify/bundle-utils') as { generateJSON: Generate }
const { createI18n } = (await import(pathToFileURL(fromModule.resolve('vue-i18n/dist/vue-i18n.runtime.node.mjs')).href)) as typeof import('vue-i18n')

/** A message file as the build leaves it: precompiled (no source strings the runtime would have to compile). */
function precompile(messages: unknown): Record<string, unknown> {
  const { code } = generateJSON(JSON.stringify(messages), { type: 'plain', env: 'production', jit: true, strictMessage: true, escapeHtml: false, exportESM: true, filename: 'en.json' })
  return new Function(code.replace(/^\s*export default /m, 'return '))() as Record<string, unknown>
}

const en = JSON.parse(readFileSync(new URL('../i18n/locales/en.json', import.meta.url), 'utf8')) as Record<string, unknown>

function flatten(node: unknown, path = ''): Record<string, string> {
  if (typeof node === 'string') return { [path]: node }
  return Object.entries(node as Record<string, unknown>).reduce((all, [key, value]) => ({ ...all, ...flatten(value, path ? `${path}.${key}` : key) }), {})
}
const strings = flatten(en)

function i18nOf(messages: unknown) {
  return createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', missingWarn: false, fallbackWarn: false, warnHtmlMessage: false, messages: { en: messages as never } })
}
const app = i18nOf(precompile(en)).global

describe('the app’s messages, compiled at build and formatted on the device', () => {
  it('leaves no message as a string: all of them are compiled (functions or AST nodes)', () => {
    const left: string[] = []
    const walk = (node: unknown, path: string) => {
      if (typeof node === 'string') left.push(path)
      else if (node && typeof node === 'object' && !('type' in node) && !('b' in node)) for (const [key, value] of Object.entries(node)) walk(value, path ? `${path}.${key}` : key)
    }
    walk(precompile(en), '')
    expect(left).toEqual([])
  })

  it('a plural message picks its form by count', () => {
    // "Nothing new added | One book added | {count} books added"
    expect(app.t('import.doneTitle', { count: 0 }, 0)).toBe('Nothing new added')
    expect(app.t('import.doneTitle', { count: 1 }, 1)).toBe('One book added')
    expect(app.t('import.doneTitle', { count: 7 }, 7)).toBe('7 books added')
    expect(app.t('ownerErrors.members', { count: 1 }, 1)).toBe('1 member')
    expect(app.t('ownerErrors.members', { count: 12 }, 12)).toBe('12 members')
  })

  it('a plural message with a name in it fills both', () => {
    // "{month}: no books | {month}: {count} book | {month}: {count} books"
    expect(app.t('profile.year.monthLabel', { month: 'March', count: 0 }, 0)).toBe('March: no books')
    expect(app.t('profile.year.monthLabel', { month: 'March', count: 1 }, 1)).toBe('March: 1 book')
    expect(app.t('profile.year.monthLabel', { month: 'March', count: 3 }, 3)).toBe('March: 3 books')
  })

  it('named placeholders are filled', () => {
    expect(app.t('common.dayMonthYear', { day: 4, month: 'Oct', year: 2026 })).toBe('4 Oct 2026')
    expect(app.t('rating.label', { value: 3.5 })).toBe('3.5 of 5 stars')
  })

  it('a literal in braces comes out as written (the @ of an address)', () => {
    expect(app.t('signIn.emailPlaceholder')).toBe('you@example.com')
  })

  it('a linked message takes the text of the one it names', () => {
    // No message of the app links another today (the next test says so); the syntax must keep working.
    const linked = i18nOf(precompile({ brand: 'Libellus', tagline: '@:brand keeps your books', upper: '@.upper:brand' })).global
    expect(linked.t('tagline')).toBe('Libellus keeps your books')
    expect(linked.t('upper')).toBe('LIBELLUS')
  })

  it('a key built at runtime resolves like any other (the app’s dynamic-key sites)', () => {
    // library.vue: t(`library.segment.${status}`); ManualSheet / OwnEditionSheet: te(`manual.error.${code}`) ? … : t(`library.error.${code}`);
    // FilterSheet: te(`genre.${value}`) ? … : value. Keys are looked up in compiled messages: no string is compiled here.
    for (const status of ['want_to_read', 'reading', 'finished']) expect(app.t(`library.segment.${status}`)).toBe(strings[`library.segment.${status}`])
    for (const code of ['book_invalid', 'isbn_invalid']) {
      expect(app.te(`manual.error.${code}`)).toBe(true)
      expect(app.t(`manual.error.${code}`)).toBe(strings[`manual.error.${code}`])
    }
    expect(app.te('manual.error.no_such_code')).toBe(false)
  })

  it('knows its keys (`te`), and a missing key answers with the key', () => {
    expect(app.te('import.doneTitle')).toBe(true)
    expect(app.te('genre.nothing-like-this')).toBe(false)
    expect(app.t('genre.nothing-like-this')).toBe('genre.nothing-like-this')
  })

  it('every one of the app’s messages compiles and renders (a count and a word for every name)', () => {
    const failed: string[] = []
    for (const [key, source] of Object.entries(strings)) {
      const names = Object.fromEntries([...source.matchAll(/\{(\w+)\}/g)].map((match) => [match[1], match[1] === 'count' ? 2 : 'x']))
      const text = app.t(key, names, 2)
      if (typeof text !== 'string' || text === key || text === '' || /\{\w+\}/.test(text)) failed.push(`${key}: ${String(text)}`)
    }
    expect(failed).toEqual([])
    expect(Object.keys(strings).length).toBeGreaterThan(1000)
  })

  it('no message uses what a compiler would be needed for beyond the above (linked, modifiers, HTML)', () => {
    const odd = Object.entries(strings).filter(([, source]) => /@[.:]|<[a-z/]/i.test(source.replace("{'@'}", '')))
    expect(odd).toEqual([])
  })
})
