import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
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

describe('the base’s words', () => {
  for (const locale of ['en', 'de']) {
    it(`come out of every message in ${locale}`, () => {
      const messages = read(locale)
      const words = uiTextOf((key) => String(lookup(messages, key) ?? `MISSING ${key}`))
      expect(Object.values(words).filter((word) => word === '' || word.startsWith('MISSING'))).toEqual([])
      expect(Object.keys(words).sort()).toEqual(Object.keys(UI_TEXT_KEYS).sort())
    })
  }

  it('are spoken in German when the language is German', () => {
    const en = uiTextOf((key) => String(lookup(read('en'), key)))
    const de = uiTextOf((key) => String(lookup(read('de'), key)))
    expect(de.cancel).not.toBe(en.cancel)
  })

  // The base's `app.config.ts` is the list (the installed package, or the checkout `UI_LAYER` names: ui.config.ts).
  it('cover every word the base’s app config declares', () => {
    const config = readFileSync(join(layer, 'app.config.ts'), 'utf8')
    const block = /text:\s*\{([\s\S]*?)\n\s{4}\},/.exec(config)?.[1] ?? ''
    const declared = [...block.matchAll(/^\s*([A-Za-z]\w*):/gm)].map((match) => match[1]!)
    expect(declared.length).toBeGreaterThan(0)
    expect(Object.keys(UI_TEXT_KEYS).sort()).toEqual(declared.sort())
  })
})
