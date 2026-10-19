import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { UI_TEXT_KEYS, uiTextOf } from '../app/utils/uiText'

/**
 * The words the shared UI base says itself come from this app's messages (`ui.text`, filled by
 * plugins/ui-text.ts; the base's README, "Copy"). The base never imports the app's copy, so nothing
 * but this test notices a word it adds that the app does not translate.
 */

/** The base: the installed package, or the checkout `UI_LAYER` names. */
const layer = process.env.UI_LAYER ? resolve(process.env.UI_LAYER) : fileURLToPath(new URL('../node_modules/@fabkho/ui', import.meta.url))

const read = (name: string) => JSON.parse(readFileSync(new URL(`../i18n/locales/${name}.json`, import.meta.url), 'utf8')) as Record<string, unknown>
const lookup = (messages: Record<string, unknown>, key: string) =>
  key.split('.').reduce<unknown>((at, part) => (typeof at === 'object' && at !== null ? (at as Record<string, unknown>)[part] : undefined), messages)

/** The leaves of a nested word object, dotted: `chat.reply.you`. */
const leavesOf = (words: Record<string, unknown>, prefix = ''): Array<[string, unknown]> =>
  Object.entries(words).flatMap(([key, value]) =>
    typeof value === 'object' && value !== null ? leavesOf(value as Record<string, unknown>, `${prefix}${key}.`) : [[`${prefix}${key}`, value]],
  )

/** The base's `ui.text` as it declares it, evaluated from its `app.config.ts` (types stripped, `defineAppConfig` is identity). */
const declaredWords = (): string[] => {
  const source = readFileSync(join(layer, 'app.config.ts'), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const mod = { exports: {} as { default?: { ui: { text: Record<string, unknown> } } } }
  new Function('module', 'exports', 'defineAppConfig', js)(mod, mod.exports, (config: unknown) => config)
  return leavesOf(mod.exports.default!.ui.text).map(([path]) => path)
}

describe('the base’s words', () => {
  for (const locale of ['en', 'de']) {
    it(`come out of every message in ${locale}`, () => {
      const messages = read(locale)
      const words = uiTextOf((key) => String(lookup(messages, key) ?? `MISSING ${key}`))
      const values = leavesOf(words).map(([, value]) => String(value))
      expect(values.filter((word) => word === '' || word.startsWith('MISSING'))).toEqual([])
      expect(leavesOf(words).map(([path]) => path).sort()).toEqual(Object.keys(UI_TEXT_KEYS).sort())
    })
  }

  it('are spoken in German when the language is German', () => {
    const en = uiTextOf((key) => String(lookup(read('en'), key)))
    const de = uiTextOf((key) => String(lookup(read('de'), key)))
    expect(de.cancel).not.toBe(en.cancel)
    expect(de.chat.reply).not.toEqual(en.chat.reply)
  })

  // The base's `app.config.ts` is the list (the installed package, or the checkout `UI_LAYER` names). Every word
  // it declares has a line here. The chat's words are checked the same way once the base declares them (`chat.*`
  // arrived with the chat, after the pinned tag): until then the pinned base has none to check.
  it('cover every word the base’s app config declares', () => {
    const declared = declaredWords()
    expect(declared.length).toBeGreaterThan(0)
    const keys = Object.keys(UI_TEXT_KEYS)
    expect(declared.filter((path) => !keys.includes(path))).toEqual([])
    const declaredChat = declared.filter((path) => path.startsWith('chat.'))
    if (declaredChat.length > 0) expect(keys.filter((path) => path.startsWith('chat.')).sort()).toEqual(declaredChat.sort())
  })
})
