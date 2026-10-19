import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'

/**
 * The shared UI base reads only what this app's tokens define, imports nothing from the app, and names no
 * raw curve (the base's README, "Using the base", step 6). The base's own files, wherever they are: the
 * installed package, or the checkout `UI_LAYER` names for the run that reads them. A token the base starts
 * to read arrives with a bump of its tag and fails here until `design/tokens.json` has it.
 *
 * With `UI_LAYER` the contract is the checkout's own `testing/contract.mjs`: it knows the base's local custom
 * properties (`--voice-corner`, `--composer-inset`, …, declared in the component that uses them), which the
 * pinned tag's copy does not. Without it, the pinned package's contract checks the pinned package.
 */
it('the base reads only what this app defines', async () => {
  const tokensCss = readFileSync(new URL('../app/assets/css/tokens.generated.css', import.meta.url), 'utf8')
  const contract = process.env.UI_LAYER
    ? await import(/* @vite-ignore */ pathToFileURL(resolve(process.env.UI_LAYER, 'testing/contract.mjs')).href)
    : await import('@fabkho/ui/testing/contract.mjs')
  const found = contract.layerContract({ tokensCss, ...(process.env.UI_LAYER && { root: `${resolve(process.env.UI_LAYER)}/` }) })
  expect(found).toEqual({ importsFromApp: [], missingVariables: [], missingCloths: [], rawCurves: [] })
})
