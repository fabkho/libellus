#!/usr/bin/env node
/**
 * Puts a Fontsource font into a playground direction's own folder, so a
 * direction brings its fonts without touching package.json (four directions
 * are built in parallel; a shared lockfile would conflict).
 *
 *   node scripts/proto-font.mjs <fontsource-id> <direction-folder> [--weights 400,600] [--italic]
 *
 *   node scripts/proto-font.mjs fraunces app/components/proto/directions/b --weights 400,600 --italic
 *
 * Writes <folder>/fonts/<id>-<weight>-<style>.woff2 (latin subset) and
 * <folder>/fonts/<id>.css with the @font-face rules. Import that CSS from the
 * direction's index.ts and use the family name it prints. Font ids are the
 * ones on fontsource.org (lower-case, dashes: `ibm-plex-serif`).
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    weights: { type: 'string', default: '400' },
    italic: { type: 'boolean', default: false },
  },
})

const [id, folder] = positionals
if (!id || !folder) {
  console.error('Usage: node scripts/proto-font.mjs <fontsource-id> <direction-folder> [--weights 400,600] [--italic]')
  process.exit(1)
}

const response = await fetch(`https://api.fontsource.org/v1/fonts/${id}`)
if (!response.ok) throw new Error(`Fontsource has no font "${id}" (${response.status})`)
const font = await response.json()

const subset = 'latin'
const styles = values.italic ? ['normal', 'italic'] : ['normal']
const weights = values.weights.split(',').map((w) => w.trim())
const out = join(folder, 'fonts')
await mkdir(out, { recursive: true })

const faces = []
for (const weight of weights) {
  for (const style of styles) {
    const url = font.variants?.[weight]?.[style]?.[subset]?.url?.woff2
    if (!url) {
      console.warn(`  skipped ${weight} ${style}: not in ${font.family}`)
      continue
    }
    const file = `${id}-${weight}-${style}.woff2`
    await writeFile(join(out, file), Buffer.from(await (await fetch(url)).arrayBuffer()))
    faces.push(
      [
        '@font-face {',
        `  font-family: '${font.family}';`,
        `  font-style: ${style};`,
        `  font-weight: ${weight};`,
        '  font-display: swap;',
        `  src: url('./${file}') format('woff2');`,
        `  unicode-range: ${font.unicodeRange[subset]};`,
        '}',
      ].join('\n'),
    )
  }
}

const header = `/* ${font.family} (${font.license}), latin subset, from Fontsource via scripts/proto-font.mjs. */\n`
await writeFile(join(out, `${id}.css`), `${header}\n${faces.join('\n\n')}\n`)
console.log(`${faces.length} faces → ${join(out, `${id}.css`)}`)
console.log(`import './fonts/${id}.css' in index.ts, then font-family: '${font.family}'`)
