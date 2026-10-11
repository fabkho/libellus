// Parity check of a translated message file against en.json (docs/i18n/README.md).
//
//   node scripts/i18n/verify.mjs [de.json] [en.json]      exit 1 on any error
//
// Errors (the app would break or show a raw key): a key missing, extra or empty; a `{placeholder}`,
// a plural separator `|`, a `@:link` or a `{'literal'}` that differs from the source.
// Warnings (a person should look): English left over, a label much longer than its source,
// a changed full stop, straight quotes, a "Sie" form, a symbol that went missing.
//
// The same checks serve the Vitest parity test (tests/i18n-parity.test.ts) and the dry-run sample.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Flatten a nested message file to { 'a.b.c': 'text' }. */
export function flatten(node, path = '') {
  if (typeof node === 'string') return { [path]: node }
  if (node === undefined || node === null) return {}
  if (typeof node !== 'object') return { [path]: String(node) }
  return Object.assign({}, ...Object.entries(node).map(([key, value]) => flatten(value, path ? `${path}.${key}` : key)))
}

const forms = text => text.split('|')
const sorted = list => [...list].sort()
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b))

/** `{name}` placeholders (not the `{'literal'}` form), in order of appearance. */
const placeholders = text => [...text.matchAll(/\{(?!')\s*([^{}'|]+?)\s*\}/g)].map(m => `{${m[1]}}`)
/** vue-i18n literal interpolation: `{'@'}`. */
const literals = text => [...text.matchAll(/\{'[^']*'\}/g)].map(m => m[0])
/** Linked messages: `@:key`, `@.lower:key`, `@:(key)`. */
const links = text => [...text.matchAll(/@(?:\.[a-z]+)?:(?:\([^)]+\)|[\w.-]+)/g)].map(m => m[0])

const ENGLISH_WORDS = new Set(['the', 'and', 'you', 'your', 'you\'re', 'to', 'of', 'is', 'are', 'not', 'for', 'with', 'this', 'that', 'was', 'were', 'has', 'have', 'it', 'in', 'on', 'or', 'we', 'will', 'can', 'could', 'please', 'try', 'again', 'back', 'nothing', 'yet', 'book', 'books', 'read', 'reading', 'finished', 'library', 'edition', 'collection', 'series', 'circle', 'invite', 'sign', 'up', 'out', 'new', 'add', 'saved', 'link', 'copy'])
// Words that are English on purpose or the same in both languages (the glossary keeps them).
const NAMES = new Set(['libellus', 'goodreads', 'hardcover', 'storygraph', 'librarything', 'apple', 'books', 'open', 'library', 'openlibrary', 'wikipedia', 'wiktionary', 'mymemory', 'supabase', 'regal', 'isbn', 'epub', 'epubs', 'csv', 'pdf', 'url', 'genres', 'covers', 'links', 'codes', 'e-mail', 'foliate', 'dnf'])
const bareWords = text => text.replace(/\{[^}]*\}/g, ' ').toLowerCase().match(/[a-zäöüß][a-zäöüß'-]*/g) ?? []
const SAME_OK = new Set(['link', 'copy', 'cover', 'genre', 'offline', 'code', 'import', 'export', 'hardcover', 'new', 'series', 'sign', 'in', 'on', 'up', 'out', 'will', 'was', 'back', 'add'])

/**
 * @param {Record<string, unknown>} en source messages (nested)
 * @param {Record<string, unknown>} de translated messages (nested)
 * @param {{ allowUntranslated?: string[], keys?: string[] }} [options]
 *   allowUntranslated: keys that may stay missing (an explicit allow-list, issue #257)
 *   keys: check only these keys (the dry-run sample); extra keys are then not reported
 * @returns {{ errors: { key: string, kind: string, detail: string }[], warnings: { key: string, kind: string, detail: string }[], stats: Record<string, number> }}
 */
export function verify(en, de, options = {}) {
  const source = flatten(en)
  const target = flatten(de)
  const allow = new Set(options.allowUntranslated ?? [])
  const only = options.keys ? new Set(options.keys) : null
  const errors = []
  const warnings = []
  const err = (key, kind, detail) => errors.push({ key, kind, detail })
  const warn = (key, kind, detail) => warnings.push({ key, kind, detail })

  const keys = only ? Object.keys(source).filter(k => only.has(k)) : Object.keys(source)
  let checked = 0
  const ratios = []

  for (const key of keys) {
    const s = source[key]
    const t = target[key]
    if (t === undefined || t.trim() === '') {
      if (!allow.has(key)) err(key, 'missing', t === undefined ? 'not in de.json' : 'empty value')
      continue
    }
    checked++

    // Plural forms: same number, same order; each form keeps its own placeholders.
    const sf = forms(s)
    const tf = forms(t)
    if (sf.length !== tf.length) {
      err(key, 'plural', `${sf.length} form(s) in English, ${tf.length} in German`)
    } else {
      sf.forEach((form, i) => {
        if (!same(placeholders(form), placeholders(tf[i]))) {
          err(key, 'placeholder', `form ${i + 1}: English has ${placeholders(form).join(' ') || 'none'}, German has ${placeholders(tf[i]).join(' ') || 'none'}`)
        }
      })
    }
    if (!same(links(s), links(t))) err(key, 'link', `English ${links(s).join(' ') || 'none'}, German ${links(t).join(' ') || 'none'}`)
    if (!same(literals(s), literals(t))) err(key, 'literal', `English ${literals(s).join(' ') || 'none'}, German ${literals(t).join(' ') || 'none'}`)
    if (/<\/?[a-z][^>]*>/i.test(t) && !/<\/?[a-z][^>]*>/i.test(s)) err(key, 'markup', 'HTML in the German that the English does not have')

    // Warnings: a person looks at these.
    if (t === s && /[A-Za-zÄÖÜäöüß]{4,}/.test(s.replace(/\{[^}]*\}/g, '')) && !bareWords(s).every(w => SAME_OK.has(w) || NAMES.has(w))) {
      warn(key, 'unchanged', 'identical to the English')
    } else {
      const words = t.replace(/\{[^}]*\}/g, ' ').replace(/@(?:\.[a-z]+)?:(?:\([^)]+\)|[\w.-]+)/g, ' ').toLowerCase().match(/[a-zäöüß']+/g) ?? []
      const english = words.filter(w => ENGLISH_WORDS.has(w) && !SAME_OK.has(w))
      if (english.length >= 2 || (words.length <= 3 && english.length >= 1 && !SAME_OK.has(english[0]))) warn(key, 'english', `looks English: ${[...new Set(english)].join(', ')}`)
    }
    const stripped = text => text.replace(/\s+$/, '')
    if (/\.$/.test(stripped(s)) !== /\.$/.test(stripped(t))) warn(key, 'full-stop', 'a final full stop was added or dropped')
    if (/^\s/.test(s) !== /^\s/.test(t) || /\s$/.test(s) !== /\s$/.test(t)) warn(key, 'whitespace', 'leading or trailing space differs (a glue string?)')
    const symbols = text => (text.match(/[·→←↑↓✓✕★☆⋯…–−%]/g) ?? []).sort().join('')
    if (symbols(s) !== symbols(t)) warn(key, 'symbols', `English has "${symbols(s)}", German has "${symbols(t)}"`)
    if (/[A-Za-zäöüß][:*_/](?:in|innen|r)\b|[a-zäöüß]\*(?:in|innen)|\b\w+[a-zäöüß]In(?:nen)?\b/.test(t)) warn(key, 'gender', 'gender sign (Freund:innen, Jede:r, …): reword or use the generic form')
    if (/"/.test(t)) warn(key, 'quotes', 'straight " quotes: use „…“')
    if (/(^|[\s(])'|'($|[\s).,])/.test(t.replace(/\{'[^']*'\}/g, ''))) warn(key, 'quotes', 'straight \' quotes: use ‚…‘ or „…“')
    // "Sie" is also "she/they" (Sie werden synchronisiert): only the polite forms are flagged (Ihnen, Ihre, "Wählen Sie").
    if (/\b(?:Ihnen|Ihre[mnrs]?|Ihr)\b/.test(t) || /(?:^|[.!?:]\s+)[A-ZÄÖÜ][a-zäöüß]+(?:en|ern|eln)\s+Sie\b/.test(t)) warn(key, 'sie', 'formal "Sie" form; the app says du')

    const bare = text => text.replace(/\{[^}]*\}/g, '').trim()
    if (bare(s).length >= 3) {
      const ratio = bare(t).length / bare(s).length
      ratios.push(ratio)
      if (bare(s).length <= 14 && ratio > 1.6 && bare(t).length > 14) warn(key, 'length', `label ${bare(s).length} → ${bare(t).length} characters (×${ratio.toFixed(2)})`)
      else if (ratio > 1.7 && bare(s).length > 14) warn(key, 'length', `${bare(s).length} → ${bare(t).length} characters (×${ratio.toFixed(2)})`)
    }
  }

  if (!only) {
    for (const key of Object.keys(target)) if (!(key in source)) err(key, 'extra', 'in de.json but not in en.json')
  }

  ratios.sort((a, b) => a - b)
  const pick = p => (ratios.length ? ratios[Math.min(ratios.length - 1, Math.floor(ratios.length * p))] : 0)
  return {
    errors,
    warnings,
    stats: {
      keys: keys.length,
      checked,
      errors: errors.length,
      warnings: warnings.length,
      medianRatio: Number(pick(0.5).toFixed(2)),
      p90Ratio: Number(pick(0.9).toFixed(2)),
      maxRatio: Number(pick(1).toFixed(2)),
    },
  }
}

const readJson = path => JSON.parse(readFileSync(path, 'utf8'))

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dePath = process.argv[2] ?? new URL('../../i18n/locales/de.json', import.meta.url)
  const enPath = process.argv[3] ?? new URL('../../i18n/locales/en.json', import.meta.url)
  let de
  try { de = readJson(dePath) } catch {
    console.error(`${String(dePath).replace("file://", "")} does not exist yet: run \`pnpm i18n:translate\` first.`)
    process.exit(1)
  }
  const result = verify(readJson(enPath), de)
  const show = (label, list) => {
    if (list.length) console.log(`\n${label} (${list.length})`)
    for (const { key, kind, detail } of list.slice(0, 200)) console.log(`  ${kind.padEnd(11)} ${key}: ${detail}`)
    if (list.length > 200) console.log(`  … and ${list.length - 200} more`)
  }
  show('ERRORS', result.errors)
  show('WARNINGS', result.warnings)
  console.log(`\n${JSON.stringify(result.stats)}`)
  process.exit(result.errors.length ? 1 : 0)
}
