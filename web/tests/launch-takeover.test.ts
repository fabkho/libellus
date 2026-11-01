import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LAUNCH_TAKEOVER_MOTION, launchTakeover } from '@/utils/launchTakeover'

/**
 * The launch takeover (docs/plans/new-logo.md, B; docs/MOTION.md, "Launch takeover"): only a cold start of
 * the installed app shows the first-paint frame and lets it leave on its own motion; a browser tab keeps the
 * plain background it always had, and Reduce Motion turns the swell into a crossfade.
 */
const file = (path: string) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8')

describe('the launch takeover’s decision', () => {
  it('swells on a cold start of the installed app', () => {
    expect(launchTakeover({ frame: true, standalone: true, reducedMotion: false })).toBe('swell')
  })

  it('crossfades there with Reduce Motion (no swell)', () => {
    expect(launchTakeover({ frame: true, standalone: true, reducedMotion: true })).toBe('crossfade')
  })

  it('does nothing in a browser tab, whatever else is true', () => {
    expect(launchTakeover({ frame: true, standalone: false, reducedMotion: false })).toBe('none')
    expect(launchTakeover({ frame: true, standalone: false, reducedMotion: true })).toBe('none')
  })

  it('does nothing without the frame: the SPA’s own navigations never load one', () => {
    expect(launchTakeover({ frame: false, standalone: true, reducedMotion: false })).toBe('none')
    expect(launchTakeover({ frame: false, standalone: true, reducedMotion: true })).toBe('none')
  })
})

describe('the launch takeover’s tokens', () => {
  const tokens = file('app/assets/css/tokens.generated.css')

  it('names durations and curves that exist in the token source', () => {
    for (const { duration, easing } of Object.values(LAUNCH_TAKEOVER_MOTION)) {
      expect(tokens).toContain(`--duration-${duration}:`)
      expect(tokens).toContain(`--ease-${easing}:`)
    }
  })

  it('runs the swell on `wave`, as MOTION.md says', () => {
    const css = file('app/assets/css/main.css')
    expect(css).toContain('animation: launch-swell var(--duration-wave) var(--ease-wave)')
  })
})

/**
 * The frame is static HTML with the mark inlined (nothing is fetched for the first paint), and its numbers
 * are the launch screen's, measured on the emulator (main.css, "The launch takeover"): the template's width
 * and the stylesheet's canvas are the same number, written in two files.
 */
describe('the first-paint frame', () => {
  const template = file('app/spa-loading-template.html')
  const css = file('app/assets/css/main.css')

  it('draws the mark alone, at the size the stylesheet uses', () => {
    const width = /class="launch-frame-mark"[^>]*width="(\d+)"/.exec(template)?.[1]
    expect(width).toBe('128')
    expect(css).toContain(`--launch-frame-icon: ${width}px;`)
  })

  it('inlines a PNG with an alpha channel: no plum tile, no fetch', () => {
    const inline = /src="data:image\/png;base64,([A-Za-z0-9+/=]+)"/.exec(template)?.[1]
    expect(inline).toBeTruthy()
    const png = Buffer.from(inline!, 'base64')
    // PNG signature, then IHDR: colour type 6 is truecolour with alpha.
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(png.subarray(12, 16).toString()).toBe('IHDR')
    expect(png.readUInt8(25)).toBe(6)
  })

  it('is shown in the installed app only', () => {
    expect(css).toContain('@media (display-mode: standalone)')
    expect(/\.launch-frame \{[\s\S]*?display: none;/.test(css)).toBe(true)
  })

  it('shows once, and the plugin takes it away', () => {
    expect(template).not.toContain('<script')
    expect(file('app/plugins/launch-takeover.client.ts')).toContain("nuxtApp.hook('app:mounted'")
  })
})
