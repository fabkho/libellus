import { describe, expect, it } from 'vitest'
import { GLASS_KEY, applyGlass, parseGlass, readGlass, writeGlass } from '@/utils/glass'

/**
 * The owner's Glass setting (utils/glass.ts): the design's glass until she picks
 * another level, kept on this device, put on the page as `data-glass`.
 */
function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial))
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  }
}

function fakeDocument() {
  const attributes = new Map<string, string>()
  return {
    attributes,
    documentElement: {
      setAttribute: (name: string, value: string) => void attributes.set(name, value),
      removeAttribute: (name: string) => void attributes.delete(name),
    },
  }
}

describe('glass level', () => {
  it('is the design’s glass unless a known level is stored', () => {
    expect(parseGlass(null)).toBe('strong')
    expect(parseGlass('blurry')).toBe('strong')
    expect(parseGlass('strong')).toBe('strong')
    expect(parseGlass('medium')).toBe('medium')
    expect(parseGlass('off')).toBe('off')
  })

  it('reads the first version’s names as their new levels', () => {
    expect(parseGlass('full')).toBe('strong')
    expect(parseGlass('light')).toBe('medium')
    expect(readGlass(memoryStorage({ [GLASS_KEY]: 'light' }))).toBe('medium')
  })

  it('reads back what was written, under a key sign-out keeps', () => {
    const storage = memoryStorage()
    expect(readGlass(storage)).toBe('strong')
    writeGlass(storage, 'off')
    expect(storage.items.get(GLASS_KEY)).toBe('off')
    expect(readGlass(storage)).toBe('off')
    expect(GLASS_KEY.startsWith('libellus.')).toBe(false)
  })

  it('survives storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(readGlass(broken)).toBe('strong')
    expect(() => writeGlass(broken, 'medium')).not.toThrow()
  })

  it('marks the page only for a level that is not the design’s', () => {
    const doc = fakeDocument()
    applyGlass(doc, 'medium')
    expect(doc.attributes.get('data-glass')).toBe('medium')
    applyGlass(doc, 'off')
    expect(doc.attributes.get('data-glass')).toBe('off')
    applyGlass(doc, 'strong')
    expect(doc.attributes.has('data-glass')).toBe(false)
  })
})
