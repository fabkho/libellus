import { describe, expect, it } from 'vitest'
import { parseDuration } from '../app/utils/motion'

/**
 * Motion tokens read back from the stylesheet (utils/motion.ts). The tokens
 * are written in milliseconds, but the production build minifies every time
 * to its shortest form (`250ms` → `.25s`), so both units must read the same.
 */
describe('parseDuration', () => {
  it('reads milliseconds, as the dev server serves the tokens', () => {
    expect(parseDuration('250ms')).toBe(250)
    expect(parseDuration(' 340ms ')).toBe(340)
  })

  it('reads seconds, as the production build ships them', () => {
    expect(parseDuration('.25s')).toBe(250)
    expect(parseDuration('0.2s')).toBe(200)
    expect(parseDuration('1.1s')).toBe(1100)
    expect(parseDuration('.1S')).toBe(100)
  })

  it('reads anything else as no time', () => {
    expect(parseDuration('')).toBe(0)
    expect(parseDuration('250')).toBe(0)
    expect(parseDuration('fast')).toBe(0)
  })
})
