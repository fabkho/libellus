import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { UI_TEXT_KEYS, uiTextOf } from '../app/utils/uiText'

/**
 * The words the shared UI base says itself come from this app's messages (`ui.text`, filled by
 * plugins/ui-text.ts; the base's README, "Copy"). The base never imports the app's copy, so nothing
 * but this test notices a word it adds that the app does not translate.
 */

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

  // Only where the base is extended from a checkout (`UI_LAYER`, ui.config.ts): its `app.config.ts` is the list.
  it.skipIf(!process.env.UI_LAYER || !existsSync(join(process.env.UI_LAYER ?? '', 'app.config.ts')))('cover every word the base’s app config declares', () => {
    const config = readFileSync(join(process.env.UI_LAYER!, 'app.config.ts'), 'utf8')
    const block = /text:\s*\{([\s\S]*?)\n\s{4}\},/.exec(config)?.[1] ?? ''
    const declared = [...block.matchAll(/^\s*([A-Za-z]\w*):/gm)].map((match) => match[1]!)
    expect(declared.length).toBeGreaterThan(0)
    expect(Object.keys(UI_TEXT_KEYS).sort()).toEqual(declared.sort())
  })
})
