import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { layerContract } from '@fabkho/ui/testing/contract.mjs'

/**
 * The shared UI base reads only what this app's tokens define, imports nothing from the app, and names no
 * raw curve (the base's README, "Using the base", step 6). The base's own files, wherever they are: the
 * installed package, or the checkout `UI_LAYER` names for the run that reads them. A token the base starts
 * to read arrives with a bump of its tag and fails here until `design/tokens.json` has it.
 */
it('the base reads only what this app defines', () => {
  const tokensCss = readFileSync(new URL('../app/assets/css/tokens.generated.css', import.meta.url), 'utf8')
  const found = layerContract({ tokensCss, ...(process.env.UI_LAYER && { root: `${resolve(process.env.UI_LAYER)}/` }) })
  expect(found).toEqual({ importsFromApp: [], missingVariables: [], missingCloths: [], rawCurves: [] })
})
