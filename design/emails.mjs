// Generates the email templates from design/emails/ and design/tokens.json.
// Run: pnpm emails         (from design/) rewrites the templates
//      pnpm emails:check   fails when a committed template differs from what the tokens and the
//                          shell produce (CI runs it next to tokens:check)
//
// Same idea as build.mjs: the colours in a mail are never typed by hand. They come from tokens.json
// through emails/shell.mjs, and the output is committed because Supabase reads it from a path
// (supabase/config.toml) and the hosted dashboard gets it pasted (docs/SELF_HOSTING.md, step 1.3).
// A new email: a file in emails/ that exports `output` and `build(kit)`, then list it below.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createKit } from './emails/shell.mjs'
import * as magicLink from './emails/magic_link.mjs'

const EMAILS = [magicLink]

const here = (path) => fileURLToPath(new URL(path, import.meta.url))
const check = process.argv.includes('--check')
const tokens = JSON.parse(readFileSync(here('tokens.json'), 'utf8'))

// Gmail clips a message at ~102 KB; a template this small should stay in the low kilobytes.
const MAX_BYTES = 20_000

/** What every mail must hold, whatever its content: the things clients and screen readers rely on. */
function lint(email, html) {
  const problems = []
  if (!/<html lang="[a-z-]+"/.test(html)) problems.push('no lang on <html>')
  if (!/<title>[^<]+<\/title>/.test(html)) problems.push('no <title>')
  if (!html.includes('<meta name="color-scheme" content="light dark">')) problems.push('no color-scheme meta')
  if (!html.includes('@media (prefers-color-scheme:dark)')) problems.push('no dark block')
  // Nothing is fetched: a mail that needs the network to make sense is a tracking pixel waiting to happen.
  if (/<(img|link|script|iframe)\b|url\(|@import|\bsrc=/i.test(html)) problems.push('loads something (img, link, script, url())')
  const links = (html.match(/https?:\/\/[^\s"')<]+/g) ?? []).filter((url) => !/^http:\/\/www\.w3\.org\//.test(url))
  if (links.length && !email.allowLinks) problems.push(`has links (${links.join(', ')}); a mail that is meant to link says \`export const allowLinks = true\``)
  for (const text of email.requires ?? []) if (!html.includes(text)) problems.push(`is missing ${text}`)
  for (const text of email.forbids ?? []) if (html.includes(text)) problems.push(`must not contain ${text}`)
  if (problems.length) throw new Error(`${email.output}: ${problems.join('; ')}.`)
}

let stale = 0
for (const email of EMAILS) {
  const html = email.build(createKit(tokens))
  lint(email, html)
  const bytes = Buffer.byteLength(html)
  if (bytes > MAX_BYTES) throw new Error(`${email.output} is ${bytes} bytes; keep a mail under ${MAX_BYTES}.`)
  const path = here(`../${email.output}`)
  if (check) {
    let committed = ''
    try {
      committed = readFileSync(path, 'utf8')
    } catch {}
    if (committed !== html) {
      console.error(`✗ ${email.output} does not match design/emails/ and tokens.json`)
      stale++
    }
  } else {
    writeFileSync(path, html)
    console.log(`✓ ${email.output} (${bytes} bytes)`)
  }
}
if (stale) {
  console.error('Generated email templates are never edited by hand. Run `pnpm emails` in design/ and commit the result.')
  process.exit(1)
}
if (check) console.log('✓ email templates match tokens.json')
