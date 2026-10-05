import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  THEME_KEY,
  applyPreference,
  nextPreference,
  parsePreference,
  readPreference,
  resolveTheme,
  themeBootScript,
  themeColorFor,
  writePreference,
  type ThemePreference,
} from '@/utils/theme'

/**
 * The theme rule (issue #1 story 70, docs/DESIGN.md Themes): follow the device
 * until the first tap, which stores the opposite of what is showing; flip after.
 */
const COLORS = { light: '#f4f0e9', dark: '#0e0c0a' }

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial))
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  }
}

/** <html> and the two theme-color tags of the static page. */
function fakeDocument() {
  const html = new Map<string, string>()
  const tag = (media: string, content: string) => {
    const attributes = new Map([
      ['media', media],
      ['content', content],
    ])
    return {
      attributes,
      getAttribute: (name: string) => attributes.get(name) ?? null,
      setAttribute: (name: string, value: string) => void attributes.set(name, value),
    }
  }
  const tags = [tag('(prefers-color-scheme: light)', COLORS.light), tag('(prefers-color-scheme: dark)', COLORS.dark)]
  return {
    html,
    contents: () => tags.map((t) => t.attributes.get('content')),
    documentElement: {
      setAttribute: (name: string, value: string) => void html.set(name, value),
      removeAttribute: (name: string) => void html.delete(name),
    },
    querySelectorAll: () => tags,
  }
}

describe('what is showing', () => {
  it.each([
    [null, false, 'light'],
    [null, true, 'dark'],
    ['light', true, 'light'],
    ['dark', false, 'dark'],
  ] as const)('preference %s on a %s-dark device shows %s', (preference, deviceIsDark, shown) => {
    expect(resolveTheme(preference, deviceIsDark)).toBe(shown)
  })

  it('reads anything but light or dark as no preference', () => {
    expect(parsePreference('dark')).toBe('dark')
    expect(parsePreference('light')).toBe('light')
    expect(parsePreference('system')).toBeNull()
    expect(parsePreference('')).toBeNull()
    expect(parsePreference(null)).toBeNull()
  })
})

describe('the switch', () => {
  it('stores the opposite of what is showing on the first tap', () => {
    expect(nextPreference(null, true)).toBe('light') // a dark phone
    expect(nextPreference(null, false)).toBe('dark') // a light phone
  })

  it('flips on every later tap, whatever the device does', () => {
    let preference: ThemePreference = nextPreference(null, true)
    const seen = [preference]
    for (let tap = 0; tap < 3; tap++) {
      preference = nextPreference(preference, tap % 2 === 0)
      seen.push(preference)
    }
    expect(seen).toEqual(['light', 'dark', 'light', 'dark'])
  })

  it('persists the choice on the device and reads it back', () => {
    const storage = memoryStorage()
    expect(readPreference(storage)).toBeNull()
    writePreference(storage, 'dark')
    expect(storage.items.get(THEME_KEY)).toBe('dark')
    expect(readPreference(storage)).toBe('dark')
  })

  it('keeps working when storage refuses', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(readPreference(broken)).toBeNull()
    expect(() => writePreference(broken, 'light')).not.toThrow()
  })

  it('is kept when signing out clears the libellus. keys', () => {
    expect(THEME_KEY.startsWith('libellus.')).toBe(false)
  })
})

describe('putting it on the page', () => {
  it('a chosen theme sets data-theme and paints both theme-color tags', () => {
    const doc = fakeDocument()
    applyPreference(doc, 'dark', COLORS)
    expect(doc.html.get('data-theme')).toBe('dark')
    expect(doc.contents()).toEqual([COLORS.dark, COLORS.dark])

    applyPreference(doc, 'light', COLORS)
    expect(doc.html.get('data-theme')).toBe('light')
    expect(doc.contents()).toEqual([COLORS.light, COLORS.light])
  })

  it('no preference leaves it to the device', () => {
    const doc = fakeDocument()
    applyPreference(doc, 'dark', COLORS)
    applyPreference(doc, null, COLORS)
    expect(doc.html.has('data-theme')).toBe(false)
    expect(doc.contents()).toEqual([COLORS.light, COLORS.dark])
  })
})

describe('the boot script, before the first paint', () => {
  const boot = (stored: Record<string, string>) => {
    const doc = fakeDocument()
    runInNewContext(themeBootScript(COLORS), { localStorage: memoryStorage(stored), document: doc })
    return doc
  }

  it('puts a stored theme on the page', () => {
    const doc = boot({ [THEME_KEY]: 'dark' })
    expect(doc.html.get('data-theme')).toBe('dark')
    expect(doc.contents()).toEqual([COLORS.dark, COLORS.dark])
  })

  it('leaves the page to the device without one, or with junk', () => {
    for (const stored of [{}, { [THEME_KEY]: 'sepia' }]) {
      const doc = boot(stored)
      expect(doc.html.has('data-theme')).toBe(false)
      expect(doc.contents()).toEqual([COLORS.light, COLORS.dark])
    }
  })

  it('never throws, even without storage', () => {
    expect(() => runInNewContext(themeBootScript(COLORS), { document: fakeDocument() })).not.toThrow()
  })
})

describe('the theme-color tags', () => {
  it('each answers its own appearance until a theme is chosen, then both take it', () => {
    expect(themeColorFor(null, 'light', COLORS)).toBe(COLORS.light)
    expect(themeColorFor(null, 'dark', COLORS)).toBe(COLORS.dark)
    expect(themeColorFor('dark', 'light', COLORS)).toBe(COLORS.dark)
    expect(themeColorFor('light', 'dark', COLORS)).toBe(COLORS.light)
  })
})
