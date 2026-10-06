import { describe, expect, it } from 'vitest'
import { FEW_ENTRIES, IMPORT_HINT_KEY, importOffer, readImportHint, writeImportHint } from '@/utils/importHint'

/**
 * Home's offer of the import: whole on an empty Library, smaller over a few entries,
 * never after an import or (for the small one) a dismissal; the device remembers per member.
 */
function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial))
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  }
}

describe('importOffer', () => {
  it('offers the import whole to a member with nothing in her Library', () => {
    expect(importOffer(0, null)).toBe('full')
  })

  it('offers the smaller card over a few entries, up to FEW_ENTRIES', () => {
    expect(FEW_ENTRIES).toBe(3)
    expect(importOffer(1, null)).toBe('small')
    expect(importOffer(3, null)).toBe('small')
    expect(importOffer(4, null)).toBe('none')
    expect(importOffer(120, null)).toBe('none')
  })

  it('never offers it after an import, whatever the Library holds', () => {
    for (const count of [0, 1, 3, 4]) expect(importOffer(count, 'imported')).toBe('none')
  })

  it('does not bring the smaller card back after a dismissal, but the empty Library still gets the whole one', () => {
    expect(importOffer(2, 'dismissed')).toBe('none')
    expect(importOffer(0, 'dismissed')).toBe('full')
  })
})

describe('the device memory', () => {
  it('remembers per member, outside the keys sign-out clears', () => {
    expect(IMPORT_HINT_KEY.startsWith('libellus.')).toBe(false)
    const storage = memoryStorage()
    writeImportHint(storage, 'ida', 'dismissed')
    writeImportHint(storage, 'mira', 'imported')
    expect(readImportHint(storage, 'ida')).toBe('dismissed')
    expect(readImportHint(storage, 'mira')).toBe('imported')
    expect(readImportHint(storage, 'lea')).toBeNull()
  })

  it('keeps an import: a later dismissal does not take it back', () => {
    const storage = memoryStorage()
    writeImportHint(storage, 'ida', 'imported')
    writeImportHint(storage, 'ida', 'dismissed')
    expect(readImportHint(storage, 'ida')).toBe('imported')
  })

  it('reads nothing from anything unreadable and survives storage that refuses', () => {
    for (const raw of ['', 'not json', '[]', '"x"', '{"ida":"maybe"}', 'null']) {
      expect(readImportHint(memoryStorage({ [IMPORT_HINT_KEY]: raw }), 'ida')).toBeNull()
    }
    const refusing = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    expect(readImportHint(refusing, 'ida')).toBeNull()
    expect(() => writeImportHint(refusing, 'ida', 'dismissed')).not.toThrow()
  })
})
