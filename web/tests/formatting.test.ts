import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { dateParts, parseDay } from '@/utils/dates'
import { dateFormat, numberFormat } from '@/utils/intl'
import { relativeTime } from '@/utils/relativeTime'

/**
 * Dates, numbers, plurals and relative times follow the app's language (issue #257): Intl does the words and
 * the digits, the message files do the order and the punctuation around them. The formats are the ones the app
 * builds (composables/useFigures.ts, useDays.ts, utils/dates.ts, relativeTime.ts); the messages are the shipped ones.
 */
const read = (name: string) => JSON.parse(readFileSync(new URL(`../i18n/locales/${name}.json`, import.meta.url), 'utf8')) as Record<string, unknown>
// vue-i18n is found where `@nuxtjs/i18n` finds it (as tests/i18n-runtime-only.test.ts does); Node's full build compiles the plain messages.
const moduleDir = dirname(realpathSync(createRequire(import.meta.url).resolve('@nuxtjs/i18n/package.json')))
const { createI18n } = (await import(pathToFileURL(createRequire(join(moduleDir, 'package.json')).resolve('vue-i18n/dist/vue-i18n.node.mjs')).href)) as typeof import('vue-i18n')
const i18n = createI18n({ legacy: false, locale: 'de', fallbackLocale: 'en', missingWarn: false, fallbackWarn: false, messages: { en: read('en') as never, de: read('de') as never } }).global
const t = (locale: 'en' | 'de', key: string, args: Record<string, unknown> = {}, plural?: number) => {
  i18n.locale.value = locale
  return plural === undefined ? i18n.t(key, args) : i18n.t(key, args, plural)
}

const OCT_12 = parseDay('2026-10-12') // a Monday

describe('dates', () => {
  it('name the month and the weekday in the language', () => {
    expect(dateFormat('en', { month: 'long' }).format(OCT_12)).toBe('October')
    expect(dateFormat('de', { month: 'long' }).format(OCT_12)).toBe('Oktober')
    expect(dateFormat('en', { weekday: 'long' }).format(OCT_12)).toBe('Monday')
    expect(dateFormat('de', { weekday: 'long' }).format(OCT_12)).toBe('Montag')
    expect(dateFormat('de', { month: 'long', year: 'numeric' }).format(OCT_12)).toBe('Oktober 2026')
    expect(dateFormat('de', { weekday: 'narrow' }).format(OCT_12)).toBe('M')
  })

  it('give the header’s eyebrow its parts, and the message puts them in order: "Montag · 12. Okt."', () => {
    const parts = dateParts(OCT_12, 'de')
    expect(parts.weekday).toBe('Montag')
    expect(t('de', 'home.today', parts)).toBe(`Montag · 12. ${parts.month}`)
    expect(t('en', 'home.today', dateParts(OCT_12, 'en'))).toBe('Monday · 12 Oct')
  })

  it('read "12. Oktober 2026" in German and "12 October 2026" in English', () => {
    const month = (locale: string) => dateFormat(locale, { month: 'long' }).format(OCT_12)
    expect(t('de', 'common.dayMonthYear', { day: 12, month: month('de'), year: 2026 })).toBe('12. Oktober 2026')
    expect(t('en', 'common.dayMonthYear', { day: 12, month: month('en'), year: 2026 })).toBe('12 October 2026')
    expect(t('de', 'common.dayMonth', { day: 12, month: month('de') })).toBe('12. Oktober')
  })

  it('format a whole date the way the shelf and the waitlist do', () => {
    expect(dateFormat('de', { day: 'numeric', month: 'long', year: 'numeric' }).format(OCT_12)).toBe('12. Oktober 2026')
    // 'en' is English as Intl knows it (US order); the app's own dates that need an order go through the messages above.
    expect(dateFormat('en', { day: 'numeric', month: 'long', year: 'numeric' }).format(OCT_12)).toBe('October 12, 2026')
  })
})

describe('numbers', () => {
  it('take the decimal comma in German and the point in English (a rating of 4.5)', () => {
    const rating = (locale: string, value: number) => numberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)
    expect(rating('en', 4.5)).toBe('4.5')
    expect(rating('de', 4.5)).toBe('4,5')
    expect(rating('de', 4)).toBe('4,0')
    expect(t('de', 'rating.label', { value: rating('de', 3.5) })).toBe('3,5 von 5 Sternen')
    expect(t('en', 'rating.label', { value: rating('en', 3.5) })).toBe('3.5 of 5 stars')
  })

  it('group thousands with a point in German and a comma in English', () => {
    expect(numberFormat('de').format(12345)).toBe('12.345')
    expect(numberFormat('en').format(12345)).toBe('12,345')
  })

  it('write a percent with the sign each language uses (the message adds none: `{percent}` carries it)', () => {
    const percent = (locale: string) => numberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(0.4)
    expect(percent('en')).toBe('40%')
    expect(percent('de').replace(/\s/g, ' ')).toBe('40 %')
    expect(t('de', 'genre.stats.row', { genre: 'Krimi', percent: '40 %', count: 2 }, 2)).not.toContain('% %')
  })

  it('compact a big figure in the language', () => {
    expect(numberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(12_400)).toBe('12.4K')
    expect(numberFormat('de', { notation: 'compact', maximumFractionDigits: 1 }).format(12_400)).toBe('12.400')
    expect(numberFormat('de', { notation: 'compact', maximumFractionDigits: 1 }).format(2_500_000)).toMatch(/^2,5/)
  })
})

describe('relative times', () => {
  const NOW = Date.UTC(2026, 9, 12, 12, 0, 0)
  const ago = (ms: number) => new Date(NOW - ms)
  it('say "yesterday" and "5 minutes ago" in the language', () => {
    expect(relativeTime(ago(5 * 60_000), NOW, 'en')).toBe('5 minutes ago')
    expect(relativeTime(ago(5 * 60_000), NOW, 'de')).toBe('vor 5 Minuten')
    expect(relativeTime(ago(24 * 3_600_000), NOW, 'en')).toBe('yesterday')
    expect(relativeTime(ago(24 * 3_600_000), NOW, 'de')).toBe('gestern')
    expect(relativeTime(ago(3 * 24 * 3_600_000), NOW, 'de')).toBe('vor 3 Tagen')
  })
})

describe('plurals (the message files, not Intl)', () => {
  it('pick one or many in both languages', () => {
    expect(t('en', 'shelf.count', { count: 1 }, 1)).toBe('1 book')
    expect(t('en', 'shelf.count', { count: 3 }, 3)).toBe('3 books')
    expect(t('de', 'shelf.count', { count: 1 }, 1)).toBe('1 Buch')
    expect(t('de', 'shelf.count', { count: 3 }, 3)).toBe('3 Bücher')
  })

  it('pick the three forms of a message that has "none", "one" and "many"', () => {
    expect(t('de', 'import.doneTitle', { count: 0 }, 0)).toBe('Nichts Neues hinzugefügt')
    expect(t('de', 'import.doneTitle', { count: 1 }, 1)).toMatch(/^Ein Buch/)
    expect(t('de', 'import.doneTitle', { count: 7 }, 7)).toBe('7 Bücher hinzugefügt')
  })
})
