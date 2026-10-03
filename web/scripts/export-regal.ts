/**
 * The Regal export (issue #22): one member's Library as a Regal library file
 * (version 2), the input of Regal assets and of Regal, the owner's 3D
 * bookshelf (fabkho.dev/books). Read only: it never writes to the target.
 *
 *   pnpm export:regal --email <member> --out <file> [options]
 *
 * Options:
 *   --email <address>     the member whose Library to export (must exist)
 *   --out <file>          the library file to write; relative to where the
 *                         command was started. Real data stays out of git: inside
 *                         this repo only under `.data/` (ignored)
 *   --target local|hosted local (default): the stack `supabase status` reports.
 *                         hosted: $SUPABASE_URL + $SUPABASE_SERVICE_ROLE_KEY,
 *                         and --confirm-host <host> must name the URL's host
 *   --carry-art <url|file> the library file Regal shows now (the daily chain:
 *                         https://books.fabkho.dev/v2/library.json): Books it has
 *                         keep its art (front, Spine, back, colours) instead of
 *                         the Libellus Cover (app/data/export/carryArt.ts)
 *   --statuses <list>     Reading statuses to export, comma-separated, from
 *                         read, dnf, currently-reading, to-read. Default:
 *                         read,dnf,currently-reading (Finished and Currently
 *                         reading; Want to read stays out of the portfolio)
 *   --owner <name>        `owner` of the file, as Regal shows it ("Fabian")
 *   --time-zone <zone>    the zone `dateAdded` is a day in (default: this machine's)
 *   --generated-at <iso>  `generatedAt` (default: now), for reproducible output
 *
 * The file is validated (app/data/export/regalLibraryFile.ts, Regal's
 * validator) before it is written and not written when invalid. When only
 * `generatedAt` would change, the file is left as it is. Mapping:
 * app/data/export/regal.ts. Then, in a Regal checkout:
 *
 *   pnpm regal-assets --in <file> --no-ai --no-model --publish v2
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import { carryArt } from '../app/data/export/carryArt'
import { readMemberLibrary } from '../app/data/export/memberLibrary'
import { exportRegalLibrary } from '../app/data/export/regal'
import {
  formatLibraryFileErrors,
  parseLibraryFile,
  validateLibraryFile,
  type KnownReadingStatus,
  type RegalLibraryFile,
} from '../app/data/export/regalLibraryFile'
import { findMemberId } from './fable/write'
import { resolveTarget } from './shared/target'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const startedIn = process.env.INIT_CWD ?? process.cwd()
const STATUSES: KnownReadingStatus[] = ['read', 'dnf', 'currently-reading', 'to-read']
const DEFAULT_STATUSES: KnownReadingStatus[] = ['read', 'dnf', 'currently-reading']

const { values: args } = parseArgs({
  options: {
    'email': { type: 'string' },
    'out': { type: 'string' },
    'target': { type: 'string', default: 'local' },
    'confirm-host': { type: 'string' },
    'carry-art': { type: 'string' },
    'statuses': { type: 'string', default: DEFAULT_STATUSES.join(',') },
    'owner': { type: 'string' },
    'time-zone': { type: 'string', default: Intl.DateTimeFormat().resolvedOptions().timeZone },
    'generated-at': { type: 'string' },
    'help': { type: 'boolean', short: 'h', default: false },
  },
})

function fail(message: string): never {
  console.error(`export-regal: ${message}`)
  process.exit(1)
}

if (args.help) {
  const source = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  console.log(source.slice(source.indexOf('/**') + 3, source.indexOf('*/')).replace(/^ \* ?/gm, ''))
  process.exit(0)
}

function outPath(): string {
  if (!args.out) fail('--out is required (the library file to write)')
  const path = resolve(startedIn, args.out)
  const inRepo = relative(repoRoot, path)
  if (!inRepo.startsWith('..') && !isAbsolute(inRepo) && !inRepo.startsWith(`.data${sep}`)) {
    fail(`${path} is inside the repo: real data goes under .data/ (ignored) or outside it`)
  }
  return path
}

function statuses(): KnownReadingStatus[] {
  const list = args.statuses!.split(',').map((status) => status.trim()).filter(Boolean)
  const unknown = list.filter((status) => !STATUSES.includes(status as KnownReadingStatus))
  if (unknown.length || !list.length) fail(`unknown --statuses "${args.statuses}" (from ${STATUSES.join(', ')})`)
  return list as KnownReadingStatus[]
}

/** The file an earlier run wrote, null when there is none or it is not JSON. */
function readPrevious(path: string): RegalLibraryFile | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as RegalLibraryFile
  } catch {
    return null
  }
}

/** The file without `generatedAt`, to tell whether anything else changed. */
const withoutStamp = (file: unknown) => JSON.stringify({ ...(file as object), generatedAt: null })

const isUrl = (value: string) => /^https?:\/\//i.test(value)

/**
 * The published library file, and how its image references read from the
 * exported file: from a URL, as absolute URLs; from a local file, as paths
 * relative to the exported file (Regal assets reads a local input's
 * references from its folder).
 */
async function published(source: string, out: string): Promise<{ file: RegalLibraryFile; resolveRef: (ref: string) => string | null; label: string }> {
  let text: string
  let resolveRef: (ref: string) => string | null
  if (isUrl(source)) {
    const response = await fetch(source, { headers: { 'cache-control': 'no-cache' } })
    if (!response.ok) fail(`--carry-art ${source}: HTTP ${response.status}`)
    text = await response.text()
    const base = response.url || source
    resolveRef = (ref) => new URL(ref, base).href
  } else {
    const path = resolve(startedIn, source)
    if (!existsSync(path)) fail(`--carry-art file not found: ${path}`)
    text = readFileSync(path, 'utf8')
    resolveRef = (ref) => {
      if (isUrl(ref)) return ref
      if (ref.startsWith('//')) return `https:${ref}`
      if (ref.startsWith('/')) return null
      const local = resolve(dirname(path), decodeURI(ref))
      return relative(dirname(out), local).split(sep).map(encodeURIComponent).join('/')
    }
  }
  const parsed = parseLibraryFile(text)
  if (!parsed.ok) fail(`--carry-art ${source} is not a valid Regal library file:\n  ${formatLibraryFileErrors(parsed.errors).join('\n  ')}`)
  return { file: parsed.library, resolveRef, label: source }
}

function count(values: string[]): string {
  const counts: Record<string, number> = {}
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return Object.entries(counts).map(([key, value]) => `${key} ${value}`).join(', ') || '—'
}

async function main() {
  if (!args.email) fail('--email is required (the member whose Library to export)')
  const out = outPath()
  const only = statuses()
  const { url, serviceKey, label } = resolveTarget({
    target: args.target,
    confirmHost: args['confirm-host'],
    repoRoot,
    action: 'reads from',
    fail,
  })
  const art = args['carry-art'] ? await published(args['carry-art'], out) : null
  const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const memberId = await findMemberId(client, args.email)
  if (!memberId) fail(`no member with the address ${args.email} on ${label}`)

  console.log(`Regal export from ${label} for ${args.email}`)
  const entries = await readMemberLibrary(client, memberId)
  let file = exportRegalLibrary(entries, {
    generatedAt: args['generated-at'] ?? new Date().toISOString(),
    owner: args.owner,
    timeZone: args['time-zone'],
    statuses: only,
  })
  console.log(`  entries ${entries.length}, Books ${file.books.length} (${only.join(', ')})`)

  if (art) {
    const carried = carryArt(file, art.file, art.resolveRef)
    file = carried.file
    console.log(`  art from ${art.label} (${art.file.books.length} Books): carried for ${carried.carried.length} (${count(carried.carried.map((item) => `by ${item.by}`))}), ${carried.unmatched.length} keep the Libellus Cover`)
    for (const book of carried.unmatched) console.log(`    no published art: ${book.title} — ${book.authors[0] ?? '?'} [${book.isbn13 ?? 'no ISBN-13'}]`)
  }

  const result = validateLibraryFile(file)
  if (!result.ok) fail(`the export does not validate:\n  ${formatLibraryFileErrors(result.errors).join('\n  ')}`)

  const books = file.books
  const has = (test: (book: (typeof books)[number]) => unknown) => books.filter(test).length
  console.log(`  status: ${count(books.map((book) => book.status))}`)
  console.log(`  finished reads ${books.reduce((total, book) => total + (book.readCount ?? 0), 0)}, rated ${has((b) => b.rating)}, reviewed ${has((b) => b.review)}`)
  console.log(`  ISBN-13 ${has((b) => b.isbn13)}, pages ${has((b) => b.pages)}, description ${has((b) => b.description)}`)
  console.log(`  front ${has((b) => b.assets?.front)}, Spine ${has((b) => b.assets?.spine)}, back ${has((b) => b.assets?.back)}, palette ${has((b) => b.assets?.palette)}`)

  const previous = readPrevious(out)
  if (previous && withoutStamp(previous) === withoutStamp(file)) {
    console.log(`Unchanged: ${out} (generatedAt ${previous.generatedAt})`)
    return
  }
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`)
  console.log(`Wrote ${out}`)
}

main().catch((error: unknown) => fail(error instanceof Error ? (error.stack ?? error.message) : String(error)))
