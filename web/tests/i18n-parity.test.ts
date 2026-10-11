import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { verify } from '../scripts/i18n/verify.mjs'

/**
 * Parity of the German messages with the English ones (issue #257, docs/i18n/README.md).
 *
 * A de.json that lacks a key en.json has, has one it does not, or differs in a `{placeholder}`, a plural
 * `|`, a linked `@:key` or a `{'literal'}` fails here: the app would show a raw key or break while
 * formatting. The checks are `scripts/i18n/verify.mjs`, the same ones `pnpm i18n:translate` ends with.
 *
 * Warnings (English left over, a long label, a gender sign) do not fail: they are for the person reading
 * the diff (`pnpm i18n:verify` lists them).
 */

/**
 * Keys de.json may lack for now, named one by one: a new feature's strings land in en.json first and
 * `pnpm i18n:translate` brings them over. Empty is the goal; remove an entry when its key is translated.
 */
const ALLOW_UNTRANSLATED: string[] = []

const read = (name: string) => JSON.parse(readFileSync(new URL(`../i18n/locales/${name}.json`, import.meta.url), 'utf8')) as Record<string, unknown>

describe('the parity check itself', () => {
  const en = { a: { label: 'Save', many: '{count} book | {count} books', link: 'Move to @:a.label', at: "you{'@'}example.com" } }
  const good = { a: { label: 'Speichern', many: '{count} Buch | {count} Bücher', link: 'Zu @:a.label', at: "du{'@'}beispiel.de" } }
  const kinds = (de: Record<string, unknown>) => verify(en, de).errors.map(e => e.kind)

  it('passes a faithful translation', () => expect(kinds(good)).toEqual([]))
  it('fails a missing key', () => expect(kinds({ a: { ...good.a, label: undefined } })).toContain('missing'))
  it('fails an empty value', () => expect(kinds({ a: { ...good.a, label: '' } })).toContain('missing'))
  it('fails an extra key', () => expect(kinds({ a: { ...good.a, more: 'Mehr' } })).toContain('extra'))
  it('fails a renamed placeholder', () => expect(kinds({ a: { ...good.a, many: '{anzahl} Buch | {count} Bücher' } })).toContain('placeholder'))
  it('fails a placeholder dropped from one plural form', () => expect(kinds({ a: { ...good.a, many: 'Ein Buch | {count} Bücher' } })).toContain('placeholder'))
  it('fails a lost plural form', () => expect(kinds({ a: { ...good.a, many: '{count} Bücher' } })).toContain('plural'))
  it('fails a changed link', () => expect(kinds({ a: { ...good.a, link: 'Zu @:a.other' } })).toContain('link'))
  it('fails a dropped literal', () => expect(kinds({ a: { ...good.a, at: 'du@beispiel.de' } })).toContain('literal'))
  it('lets an allow-listed key stay missing', () => {
    expect(verify(en, { a: { ...good.a, label: undefined } }, { allowUntranslated: ['a.label'] }).errors).toEqual([])
  })
})

describe.skipIf(!existsSync(new URL('../i18n/locales/de.json', import.meta.url)))('de.json against en.json', () => {
  it('has every key, no extra, and the same placeholders, plurals and links', () => {
    const { errors } = verify(read('en'), read('de'), { allowUntranslated: ALLOW_UNTRANSLATED })
    expect(errors.map(e => `${e.kind} ${e.key}: ${e.detail}`)).toEqual([])
  })
})
