#!/usr/bin/env node
// Writes supabase/schema-snapshot/: the CURRENT definitions of the database, one file per object.
//
//   pnpm schema:snapshot                     local stack -> supabase/schema-snapshot/
//   node run.mjs --out <dir>                 local stack -> <dir>
//   node run.mjs --linked --out <dir>        the linked project (read-only catalog query through
//                                            `supabase db query --linked`) -> <dir>; the release
//                                            job's drift check compares it with the committed one
//
// The query is snapshot.sql (next to this file). Which local database: the container of the
// project_id in $SUPABASE_WORKDIR/supabase/config.toml (CI sets SUPABASE_WORKDIR; default: this
// repo), or $SNAPSHOT_DB_CONTAINER. `docker exec`, so no psql on the host is needed.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../..')
const sqlFile = join(here, 'snapshot.sql')

const args = process.argv.slice(2)
const linked = args.includes('--linked')
const outIdx = args.indexOf('--out')
const out = resolve(outIdx >= 0 ? args[outIdx + 1] : join(repo, 'supabase/schema-snapshot'))

function fail(msg) {
  console.error(`schema-snapshot: ${msg}`)
  process.exit(1)
}

function container() {
  if (process.env.SNAPSHOT_DB_CONTAINER) return process.env.SNAPSHOT_DB_CONTAINER
  const workdir = process.env.SUPABASE_WORKDIR ? resolve(process.env.SUPABASE_WORKDIR) : repo
  const config = join(workdir, 'supabase/config.toml')
  if (!existsSync(config)) fail(`${config} not found; set SUPABASE_WORKDIR or SNAPSHOT_DB_CONTAINER`)
  const id = /^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync(config, 'utf8'))?.[1]
  if (!id) fail(`no project_id in ${config}`)
  return `supabase_db_${id}`
}

const maxBuffer = 256 * 1024 * 1024
let raw
try {
  if (linked) {
    raw = execFileSync('supabase', ['db', 'query', '--linked', '-o', 'json', '-f', sqlFile], { encoding: 'utf8', maxBuffer })
  } else {
    raw = execFileSync('docker', ['exec', '-i', container(), 'psql', '-U', 'postgres', '-At', '-q', '-v', 'ON_ERROR_STOP=1'], {
      input: readFileSync(sqlFile), encoding: 'utf8', maxBuffer, stdio: ['pipe', 'pipe', 'inherit'],
    })
  }
} catch (e) {
  fail(`the query failed (${linked ? 'linked project' : 'is the local stack up and migrated? `supabase start`'}): ${e.message.split('\n')[0]}`)
}

// The local run prints the json array; the linked run wraps it (rows, a column, a string):
// look for the array of {path, content} wherever it sits.
function findFiles(v) {
  if (typeof v === 'string') {
    const t = v.trim()
    if (!t.startsWith('[') && !t.startsWith('{')) return null
    try { return findFiles(JSON.parse(t)) } catch { return null }
  }
  if (Array.isArray(v)) {
    if (v.length && v.every((x) => x && typeof x.path === 'string' && typeof x.content === 'string')) return v
    for (const x of v) { const f = findFiles(x); if (f) return f }
    return null
  }
  if (v && typeof v === 'object') {
    for (const x of Object.values(v)) { const f = findFiles(x); if (f) return f }
  }
  return null
}

const files = findFiles(raw)
if (!files || files.length < 10) fail('the query returned no snapshot (empty database, or an unexpected answer)')

// Wipe what an earlier run wrote (keep the README), then write.
mkdirSync(out, { recursive: true })
for (const entry of readdirSync(out)) if (entry !== 'README.md') rmSync(join(out, entry), { recursive: true, force: true })
for (const { path, content } of files) {
  if (path.includes('..') || path.startsWith('/')) fail(`unsafe path ${path}`)
  const target = join(out, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}
console.log(`schema-snapshot: ${files.length} files in ${out}`)
