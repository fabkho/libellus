import { computed, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  APP_LOCALES,
  LOCALE_KEY,
  detectLocale,
  localeOfTag,
  parseLocale,
  phoneLanguages,
  readChoice,
  resolveLocale,
  searchLanguages,
  writeChoice,
} from '@/utils/locale'
import { storefrontsFor } from '@/data/apple'

/**
 * The app's language (issue #257, utils/locale.ts): the phone's until she chooses, her choice after, English
 * for anything the app does not speak, and safe where there is no window.
 */
function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial))
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  }
}

describe('the phone’s language', () => {
  it('is German for de, de-DE, de-AT and de-CH, in any case', () => {
    for (const tag of ['de', 'de-DE', 'de-AT', 'de-CH', 'DE-de', 'de_DE']) expect(detectLocale([tag])).toBe('de')
  })

  it('is English for en, en-GB and en-US', () => {
    for (const tag of ['en', 'en-GB', 'en-US']) expect(detectLocale([tag])).toBe('en')
  })

  it('is English for a language the app does not speak', () => {
    for (const tag of ['fr', 'fr-FR', 'es-419', 'zh-Hans-CN', 'nl', '']) expect(detectLocale([tag])).toBe('en')
  })

  it('is English for no list at all', () => {
    expect(detectLocale([])).toBe('en')
    expect(detectLocale(null)).toBe('en')
    expect(detectLocale(undefined)).toBe('en')
  })

  it('takes the first listed language the app speaks, skipping the ones it does not', () => {
    expect(detectLocale(['fr-FR', 'de-DE', 'en'])).toBe('de')
    expect(detectLocale(['en-GB', 'de'])).toBe('en')
    expect(detectLocale(['fr', 'es', 'en-US'])).toBe('en')
  })

  it('reads a tag’s language, nothing else of it', () => {
    expect(localeOfTag('de-AT')).toBe('de')
    expect(localeOfTag(' EN-gb ')).toBe('en')
    expect(localeOfTag('deu')).toBeNull()
    expect(localeOfTag(undefined)).toBeNull()
  })
})

describe('her choice', () => {
  it('beats the phone, either way', () => {
    expect(resolveLocale('en', ['de-DE'])).toBe('en')
    expect(resolveLocale('de', ['en-US'])).toBe('de')
    expect(resolveLocale('de', [])).toBe('de')
  })

  it('leaves the phone in charge until she has made one', () => {
    expect(resolveLocale(null, ['de-AT'])).toBe('de')
    expect(resolveLocale(null, ['en-GB'])).toBe('en')
  })

  it('is stored under a key outside `libellus.`, which signing out clears, and read back', () => {
    expect(LOCALE_KEY.startsWith('libellus.')).toBe(false)
    const storage = memoryStorage()
    expect(readChoice(storage)).toBeNull()
    writeChoice(storage, 'de')
    expect(storage.items.get(LOCALE_KEY)).toBe('de')
    expect(readChoice(storage)).toBe('de')
  })

  it('knows only the two languages; anything else stored is no choice', () => {
    expect(parseLocale('en')).toBe('en')
    expect(parseLocale('de')).toBe('de')
    for (const raw of ['fr', 'de-DE', '', 'null', null, undefined]) expect(parseLocale(raw)).toBeNull()
    expect(readChoice(memoryStorage({ [LOCALE_KEY]: 'klingon' }))).toBeNull()
  })

  it('survives a storage that throws (private mode) and a missing one', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    expect(readChoice(broken)).toBeNull()
    expect(() => writeChoice(broken, 'de')).not.toThrow()
    expect(readChoice(null)).toBeNull()
    expect(() => writeChoice(undefined, 'de')).not.toThrow()
  })

  it('names each language in its own language', () => {
    expect(APP_LOCALES).toEqual([
      { code: 'en', name: 'English' },
      { code: 'de', name: 'Deutsch' },
    ])
  })
})

describe('where there is no window (a server render, Node)', () => {
  it('has no phone languages, so the language is English', () => {
    // Node 24 has a `navigator`; take it away, as a server render without one.
    vi.stubGlobal('navigator', undefined)
    expect(phoneLanguages()).toEqual([])
    expect(resolveLocale(null, phoneLanguages())).toBe('en')
    vi.unstubAllGlobals()
  })

  it('reads the browser’s list, else its one language', () => {
    vi.stubGlobal('navigator', { languages: ['de-AT', 'en'], language: 'de-AT' })
    expect(phoneLanguages()).toEqual(['de-AT', 'en'])
    vi.stubGlobal('navigator', { languages: [], language: 'fr' })
    expect(phoneLanguages()).toEqual(['fr'])
    vi.unstubAllGlobals()
  })
})

describe('the languages a search asks in', () => {
  it('put the app’s first, then the phone’s others', () => {
    expect(searchLanguages('de', ['en-US', 'de-DE', 'fr'])).toEqual(['de', 'en-US', 'de-DE', 'fr'])
    expect(searchLanguages('en', ['EN', 'de'])).toEqual(['en', 'de'])
  })

  it('make Apple ask the German storefront first for a German app on an English phone, and not the other way round', () => {
    expect(storefrontsFor(searchLanguages('de', ['en-US']))).toEqual(['de', 'us'])
    expect(storefrontsFor(searchLanguages('en', ['de-DE']))).toEqual(['us', 'gb'])
    expect(storefrontsFor(searchLanguages('en', ['en-US']))).toEqual(['us', 'gb'])
  })
})

describe('the language store (what a tap on the Profile row does)', () => {
  const storage = memoryStorage()
  let current = ref('en')
  const setLocale = vi.fn(async (code: string) => void (current.value = code))

  beforeEach(() => {
    storage.items.clear()
    current = ref('en')
    setLocale.mockClear()
    vi.stubGlobal('window', { localStorage: storage })
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('useNuxtApp', () => ({ $i18n: { locale: current, setLocale } }))
    setActivePinia(createPinia())
  })
  afterEach(() => vi.unstubAllGlobals())

  async function store() {
    const { useLocaleStore } = await import('@/stores/locale')
    return useLocaleStore()
  }

  it('shows what the app speaks and has no choice yet', async () => {
    current.value = 'de'
    const locale = await store()
    expect(locale.current).toBe('de')
    expect(locale.choice).toBeNull()
  })

  it('switches at once and keeps the choice on the device', async () => {
    const locale = await store()
    await locale.choose('de')
    expect(setLocale).toHaveBeenCalledWith('de')
    expect(locale.current).toBe('de')
    expect(locale.choice).toBe('de')
    expect(storage.items.get(LOCALE_KEY)).toBe('de')
  })

  it('keeps a choice that equals what shows (English on an English phone): it still wins later', async () => {
    const locale = await store()
    await locale.choose('en')
    expect(setLocale).not.toHaveBeenCalled()
    expect(storage.items.get(LOCALE_KEY)).toBe('en')
  })

  it('reads a stored choice when it is made again, and ignores a language it does not know', async () => {
    storage.items.set(LOCALE_KEY, 'de')
    expect((await store()).choice).toBe('de')
    setActivePinia(createPinia())
    const locale = await store()
    await locale.choose('fr' as never)
    expect(setLocale).not.toHaveBeenCalled()
  })
})
