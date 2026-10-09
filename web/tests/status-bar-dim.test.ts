import { describe, expect, it } from 'vitest'
import { blendOver, createStatusBarDim, parseColor } from '../app/utils/statusBarDim'

// The scrim tokens (tokens.generated.css) and the surfaces under them.
const LIGHT_SCRIM = 'rgb(26 20 14 / 0.38)'
const DARK_SCRIM = 'rgb(0 0 0 / 0.5)'
const LIGHT = '#f4f0e9'
const DARK = '#0e0c0a'

function fakeTags(...contents: string[]) {
  const tags = contents.map((content) => {
    const attributes = new Map([['content', content]])
    return {
      getAttribute: (name: string) => attributes.get(name) ?? null,
      setAttribute: (name: string, value: string) => void attributes.set(name, value),
    }
  })
  return { tags, contents: () => tags.map((t) => t.getAttribute('content')), querySelectorAll: () => tags }
}

describe('colours', () => {
  it('reads hex, comma and space rgb, with alpha as a number, a percentage or after a slash', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(parseColor('#f4f0e9')).toEqual({ r: 244, g: 240, b: 233, a: 1 })
    expect(parseColor('rgb(26 20 14 / 0.38)')).toEqual({ r: 26, g: 20, b: 14, a: 0.38 })
    expect(parseColor('rgba(0, 0, 0, 50%)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 })
    expect(parseColor('rgb(10,20,30)')).toEqual({ r: 10, g: 20, b: 30, a: 1 })
    expect(parseColor('  RGB(0 0 0 / .5) ')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 })
  })
  it('knows what it cannot read', () => {
    expect(parseColor('')).toBeNull()
    expect(parseColor('red')).toBeNull()
    expect(parseColor('color-mix(in srgb, red, blue)')).toBeNull()
    expect(parseColor('rgb(1 2)')).toBeNull()
  })
  it('lays the scrim over the page colour', () => {
    expect(blendOver(DARK_SCRIM, '#ffffff')).toBe('#808080')
    expect(blendOver(DARK_SCRIM, DARK)).toBe('#070605')
    // 244 * 0.62 + 26 * 0.38 = 161.1; 240 * 0.62 + 20 * 0.38 = 156.4; 233 * 0.62 + 14 * 0.38 = 149.8
    expect(blendOver(LIGHT_SCRIM, LIGHT)).toBe('#a19c96')
  })
  it('refuses what it cannot blend', () => {
    expect(blendOver('nonsense', LIGHT)).toBeNull()
    expect(blendOver(LIGHT_SCRIM, 'nonsense')).toBeNull()
    expect(blendOver(LIGHT_SCRIM, 'rgb(0 0 0 / 0.5)')).toBeNull()
  })
})

describe('the status bar under a scrim', () => {
  it('takes the dimmed colour while a layer is open and gives the original back', () => {
    const doc = fakeTags(LIGHT, DARK)
    const dim = createStatusBarDim(doc, () => LIGHT_SCRIM)
    const release = dim.acquire()
    expect(doc.contents()).toEqual([blendOver(LIGHT_SCRIM, LIGHT), blendOver(LIGHT_SCRIM, DARK)])
    expect(doc.contents()).not.toContain(LIGHT)
    release()
    expect(doc.contents()).toEqual([LIGHT, DARK])
    expect(dim.depth).toBe(0)
  })

  it('is counted: stacked layers dim once more each, and only the last release restores', () => {
    const doc = fakeTags(LIGHT)
    const dim = createStatusBarDim(doc, () => LIGHT_SCRIM)
    const sheet = dim.acquire()
    const once = doc.contents()[0]
    const confirm = dim.acquire()
    const twice = doc.contents()[0]
    expect(twice).toBe(blendOver(LIGHT_SCRIM, blendOver(LIGHT_SCRIM, LIGHT)!))
    expect(twice).not.toBe(once)
    expect(dim.depth).toBe(2)

    confirm()
    expect(doc.contents()).toEqual([once]) // the sheet alone again
    sheet()
    expect(doc.contents()).toEqual([LIGHT])
  })

  it('lets the layers close in either order', () => {
    const doc = fakeTags(DARK)
    const dim = createStatusBarDim(doc, () => DARK_SCRIM)
    const first = dim.acquire()
    const second = dim.acquire()
    first()
    expect(doc.contents()).toEqual([blendOver(DARK_SCRIM, DARK)])
    second()
    expect(doc.contents()).toEqual([DARK])
  })

  it('counts a release once', () => {
    const doc = fakeTags(LIGHT)
    const dim = createStatusBarDim(doc, () => LIGHT_SCRIM)
    const outer = dim.acquire()
    const inner = dim.acquire()
    inner()
    inner()
    expect(dim.depth).toBe(1)
    expect(doc.contents()).not.toEqual([LIGHT])
    outer()
    expect(doc.contents()).toEqual([LIGHT])
  })

  it('starts from what the tags show now, and again after a restore', () => {
    const doc = fakeTags(LIGHT)
    const dim = createStatusBarDim(doc, () => LIGHT_SCRIM)
    dim.acquire()()
    doc.tags[0]!.setAttribute('content', DARK) // the member switched theme in between
    const release = dim.acquire()
    expect(doc.contents()).toEqual([blendOver(LIGHT_SCRIM, DARK)])
    release()
    expect(doc.contents()).toEqual([DARK])
  })

  it('leaves a tag alone that someone else repainted while the layer was open', () => {
    const doc = fakeTags(LIGHT, DARK)
    const dim = createStatusBarDim(doc, () => LIGHT_SCRIM)
    const release = dim.acquire()
    doc.tags[1]!.setAttribute('content', '#123456')
    release()
    expect(doc.contents()).toEqual([LIGHT, '#123456'])
  })

  it('changes nothing when the scrim or the tag is not a colour it can read', () => {
    const doc = fakeTags('', 'not-a-colour')
    const dim = createStatusBarDim(doc, () => LIGHT_SCRIM)
    dim.acquire()()
    expect(doc.contents()).toEqual(['', 'not-a-colour'])

    const plain = fakeTags(LIGHT)
    const noScrim = createStatusBarDim(plain, () => '')
    const release = noScrim.acquire()
    expect(plain.contents()).toEqual([LIGHT])
    release()
    expect(plain.contents()).toEqual([LIGHT])
  })

  it('does nothing on a page with no theme-color tag', () => {
    const doc = fakeTags()
    const dim = createStatusBarDim(doc, () => LIGHT_SCRIM)
    expect(() => dim.acquire()()).not.toThrow()
  })
})
