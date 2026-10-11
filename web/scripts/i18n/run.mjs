// German translation of BetterReads with the-i18n-kit (docs/i18n/README.md).
//
//   pnpm i18n:translate              translate every key de.json lacks (new keys only; existing ones stay)
//   pnpm i18n:translate -- --keys a.b,c.d          only these keys
//   pnpm i18n:translate -- --dry-run               list what would be translated, call nothing
//   pnpm i18n:translate -- --overwrite-stale       also redo keys whose English changed since
//   pnpm i18n:verify                 parity of de.json against en.json (also the Vitest parity test)
//   pnpm i18n:status                 coverage, as the kit counts it
//
// The model reads GEMINI_API_KEY from the environment. Nothing here prints, stores or passes it on the command line.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verify } from './verify.mjs'

/** The kit, pinned: a new release is adopted on purpose (check its changelog, run the sample, bump). */
export const KIT = '@the-i18n-kit/cli@8.3.0'
/** Best of the models compared on the sample at a cost of cents per full run (docs/i18n/german-sample.md). Override with I18N_MODEL or --model. */
export const DEFAULT_MODEL = 'gemini-3.8-flash'

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)

function option(args, name) {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? undefined : args[i + 1]
}
const flag = (args, name) => args.includes(`--${name}`)

/** Put `de` into the key order of `en` (the kit writes keys alphabetically) and indent like en.json. */
export function reorder(en, de) {
  const out = {}
  for (const key of Object.keys(en)) {
    if (!(key in de)) continue
    out[key] = isObject(en[key]) && isObject(de[key]) ? reorder(en[key], de[key]) : de[key]
  }
  for (const key of Object.keys(de)) if (!(key in out)) out[key] = de[key]
  return out
}

/** Run the kit's CLI and parse its JSON result. Its log lines go to stderr; the result is the whole of stdout. */
function kit(projectDir, args) {
  const run = spawnSync('npx', ['--yes', KIT, ...args, '--projectDir', projectDir], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1' },
  })
  const warnings = (run.stderr ?? '').split('\n').filter(l => /WARN|ERR|error/i.test(l) && !l.includes('No .i18n-mcp.json'))
  for (const line of warnings) console.error(line)
  let result
  try { result = JSON.parse(run.stdout) } catch { result = undefined }
  if (!result) {
    console.error(run.stdout || run.stderr)
    throw new Error(`the-i18n-cli ${args[0]} did not return JSON (exit ${run.status})`)
  }
  return { result, status: run.status }
}

/** Translate what `de.json` lacks in `projectDir` (default: web/), then put the file in order and check it. */
export function translate(projectDir, args) {
  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY is not set. Export it in your shell (never in a file in the repo) and run again.')
    process.exit(2)
  }
  const localesDir = join(projectDir, 'i18n', 'locales')
  const enPath = join(localesDir, 'en.json')
  const dePath = join(localesDir, 'de.json')
  // The kit finds a target file only if it exists; for a locale without one it reports keys as translated and
  // writes nothing (the-i18n-cli 8.3.0, generic adapter). An empty object is all it needs.
  if (!existsSync(dePath) && !flag(args, 'dry-run')) writeFileSync(dePath, '{}\n')

  const model = option(args, 'model') ?? process.env.I18N_MODEL ?? DEFAULT_MODEL
  const kitArgs = ['translate', '--targetLocales', 'de', '--provider', 'google', '--model', model, '--failOnFailed']
  const keys = option(args, 'keys')
  if (keys) kitArgs.push('--keys', keys)
  const batch = option(args, 'batch-size')
  if (batch) kitArgs.push('--batchSize', batch)
  const baseUrl = option(args, 'base-url')
  if (baseUrl) kitArgs.push('--baseUrl', baseUrl)
  if (flag(args, 'dry-run')) kitArgs.push('--dryRun')
  if (flag(args, 'overwrite-stale')) kitArgs.push('--overwriteStale')

  const { result, status } = kit(projectDir, kitArgs)
  const de = result.layers?.default?.results?.de ?? {}
  console.log(`model ${model}: ${de.translated?.length ?? 0} translated, ${de.failed?.length ?? 0} failed, ${de.skipped?.length ?? 0} skipped, ${de.stale?.length ?? 0} stale, ${de.wouldTranslate?.length ?? 0} would translate`)
  for (const f of de.failed ?? []) console.log(`  failed ${f.key ?? f}: ${f.reason ?? ''}`)
  for (const k of de.stale ?? []) console.log(`  stale  ${k.key ?? k}: the English changed since this was translated; kept as it is (--overwrite-stale redoes it)`)
  if (flag(args, 'dry-run')) {
    for (const key of de.wouldTranslate ?? []) console.log(`  ${key}`)
    return { result, ok: status === 0, failed: de.failed ?? [] }
  }

  const en = JSON.parse(readFileSync(enPath, 'utf8'))
  const written = JSON.parse(readFileSync(dePath, 'utf8'))
  writeFileSync(dePath, `${JSON.stringify(reorder(en, written), null, 2)}\n`)

  const check = verify(en, JSON.parse(readFileSync(dePath, 'utf8')), { keys: keys?.split(',') })
  for (const w of check.warnings.slice(0, 60)) console.log(`  warn  ${w.kind.padEnd(10)} ${w.key}: ${w.detail}`)
  for (const e of check.errors.slice(0, 60)) console.log(`  ERROR ${e.kind.padEnd(10)} ${e.key}: ${e.detail}`)
  console.log(JSON.stringify(check.stats))
  return { result, ok: status === 0 && check.errors.length === 0, failed: de.failed ?? [] }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command = 'help', ...args] = process.argv.slice(2)
  if (command === 'translate') {
    const { ok } = translate(web, args)
    process.exit(ok ? 0 : 1)
  } else if (command === 'status') {
    const { result } = kit(web, ['status'])
    console.log(JSON.stringify(result.summary ?? result, null, 2))
  } else if (command === 'verify') {
    const verifyPath = join(dirname(fileURLToPath(import.meta.url)), 'verify.mjs')
    const run = spawnSync(process.execPath, [verifyPath, ...args], { stdio: 'inherit' })
    process.exit(run.status ?? 1)
  } else {
    console.log('usage: node scripts/i18n/run.mjs translate [--model m] [--keys a,b] [--dry-run] [--overwrite-stale] | verify | status')
    process.exit(command === 'help' ? 0 : 1)
  }
}
