import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The tab bar stands still through the Profile's transition (docs/MOTION.md, Push to the Profile):
 * `view-transition-name: tab-bar` while one runs, the new snapshot alone and at once. That snapshot is
 * a bitmap of the element's border box, and Chromium paints a `backdrop-filter` into it as that whole
 * box — the blurred page behind, square in the four corners the capsule's own radius leaves empty —
 * where WebKit paints none into it. So the group (the only one of the four pseudo-elements that clips
 * what is under the capsule: the snapshots clip neither, measured on Chrome) carries the capsule's
 * shape, from its own radius token, and a taller bar or another radius follows it.
 */
const css = readFileSync(new URL('../app/assets/css/main.css', import.meta.url), 'utf8')
const tokens = readFileSync(new URL('../app/assets/css/tokens.generated.css', import.meta.url), 'utf8')

/** The declarations of every rule for `selector` (the last one wins, as in the sheet). */
function declarations(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rules = [...css.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, 'g'))]
  expect(rules.length, `no rule for ${selector}`).toBeGreaterThan(0)
  return Object.fromEntries(
    rules
      .flatMap((rule) => rule[1].split(';'))
      .map((line) => line.split(':'))
      .filter(([property, value]) => property?.trim() && value?.trim())
      .map(([property, ...value]) => [property.trim(), value.join(':').trim()]),
  )
}

describe('the tab bar through a View Transition', () => {
  it('is clipped to the capsule, which the blurred page behind would otherwise square off', () => {
    expect(declarations('::view-transition-group(tab-bar)')['clip-path']).toBe('inset(0 round var(--radius-pill))')
  })

  it('clips with the design’s own pill radius, not a number of its own', () => {
    expect(tokens).toMatch(/^\s*--radius-pill:\s*\d+px;/m)
    // The capsule's class is `rounded-pill`: the clip and the bar are the same shape by construction.
    expect(readFileSync(new URL('../app/components/shell/TabBar.vue', import.meta.url), 'utf8')).toContain('rounded-pill')
  })

  it('does not move: the new snapshot stands alone, at once', () => {
    expect(declarations('::view-transition-old(tab-bar)')['display']).toBe('none')
    expect(declarations('::view-transition-new(tab-bar)')['animation']).toBe('none')
  })
})
