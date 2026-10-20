import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { uiLayerHolds } from '../ui.config'

/**
 * iOS 26 can leave the visual viewport panned once the keyboard has gone, and everything fixed at the bottom then
 * stands that far up the screen. The base's `stranded-viewport` plugin measures it and sets `--viewport-pan` on the
 * root; what the member sees put right is whatever reads the variable (fabkho/ui README, "What an app needs for
 * `stranded-viewport`"): the base's tab bar, palette and sheets do (`float-bottom`, `screen-bottom`), and BetterReads'
 * own fixed chrome has to as well. The plugin only runs on WebKit on an iPhone, so no browser flow here can see it;
 * this keeps the bottom chrome to the rule.
 */
const APP = fileURLToPath(new URL('../app', import.meta.url))

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) return sources(path)
    return /\.(vue|css)$/.test(entry.name) && !/tokens\.generated/.test(entry.name) ? [path] : []
  })

/** Not chrome: the reader's page area, inside its own layer, whose insets the reader measures itself (Reader.vue, `insets`). */
const EXEMPT = ['components/reader/Reader.vue: bottom: var(--safe-area-bottom)']

describe("the bottom chrome follows iOS's stranded viewport", () => {
  it("runs the base's stranded-viewport plugin", () => {
    const base = '/node_modules/@fabkho/ui/app/plugins'
    const app = { plugins: [{ src: `${base}/stranded-viewport.client.ts` }, { src: `${base}/no-focus-zoom.client.ts` }, { src: '/app/plugins/ui-text.ts' }] }
    ;(uiLayerHolds['app:resolve'] as (app: unknown) => void)(app)
    expect(app.plugins.map((plugin) => plugin.src.split('/').pop())).toEqual(['stranded-viewport.client.ts', 'ui-text.ts'])
  })

  it('has no fixed bottom chrome that ignores `--viewport-pan`', () => {
    const ignoring: string[] = []
    for (const file of sources(APP)) {
      const name = file.slice(APP.length + 1)
      const text = readFileSync(file, 'utf8')
      // A `bottom:` standing on the screen's bottom (the floating chrome's offset, the home indicator's inset).
      for (const match of text.matchAll(/(?<![-\w])bottom:\s*([^;\n]*);/g)) {
        if (/--(float-bottom|safe-area-bottom)/.test(match[1]!) && !match[1]!.includes('--viewport-pan')) ignoring.push(`${name}: bottom: ${match[1]}`)
      }
      // A bar fixed to the screen's bottom edge is `screen-bottom` (the base's), not `bottom-0`.
      for (const match of text.matchAll(/class="[^"]*\bfixed\b[^"]*\bbottom-0\b[^"]*"/g)) ignoring.push(`${name}: ${match[0]}`)
      // The app has no `float-bottom` of its own: the base's reads the pan.
      if (/@utility (float-bottom|screen-bottom)/.test(text)) ignoring.push(`${name}: its own float-bottom or screen-bottom`)
    }
    expect(ignoring.filter((line) => !EXEMPT.includes(line))).toEqual([])
  })
})
