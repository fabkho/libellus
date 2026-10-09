// EXPLAIN (ANALYZE, BUFFERS) of queries.sql as a seeded member, through RLS (role authenticated) or
// without it (role service_role, BYPASSRLS, same JWT claims so auth.uid() still answers).
//
//   node scripts/perf/explain.mjs --member 2 --role authenticated [--plans /tmp/plans] [--only home]
//
// Prints: name | execution ms (best of 5, warm) | planning ms | shared hits | reads. With --plans the
// full plan of the last run goes to <dir>/<role>/<name>.txt.
import { spawnSync } from 'node:child_process'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { memberId } from './jwt.mjs'

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []))
const container = args.container ?? 'supabase_db_libellus-perf'
const role = args.role ?? 'authenticated'
const member = memberId(Number(args.member ?? 2))
const here = dirname(fileURLToPath(import.meta.url))

function psql(sql) {
  const r = spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', maxBuffer: 1 << 28 })
  if (r.status) throw new Error(r.stderr || r.stdout)
  return r.stdout
}

// Something of hers to ask about.
const one = (sql) => psql(sql).trim().split('\n')[0]
const pick = {
  book: one(`select e.book_id from public.library_entries e join public.book_works bw on bw.book_id = e.book_id join public.work_series ws on ws.work_id = bw.work_id where e.member_id = '${member}' limit 1`) ||
        one(`select book_id from public.library_entries where member_id = '${member}' limit 1`),
}
pick.series = one(`select ws.series_id from public.book_works bw join public.work_series ws on ws.work_id = bw.work_id where bw.book_id = '${pick.book}' limit 1`) || one('select id from public.series limit 1')
pick.author = one(`select a.openlibrary_key from public.book_authors ba join public.authors a on a.id = ba.author_id where ba.book_id = '${pick.book}' limit 1`)

const text = readFileSync(join(here, 'queries.sql'), 'utf8')
const queries = text.split(/^-- name: /m).slice(1).map((b) => {
  const [name, ...rest] = b.split('\n')
  return { name: name.trim(), sql: rest.filter((l) => !l.startsWith('--')).join('\n').trim() }
})

const num = (s, re) => Number(s.match(re)?.[1] ?? NaN)
console.log(`member ${args.member ?? 2} role ${role} (rows picked: book ${pick.book?.slice(0, 8)} series ${pick.series?.slice(0, 8)} author ${pick.author})`)
console.log('name | exec ms | plan ms | buffers hit | read')
for (const q of queries) {
  if (args.only && !q.name.startsWith(args.only)) continue
  const mine = role === 'service_role'
  const expand = (t) => t
    .replace(/\/\*e:(\w+)\*\//g, (_, x) => (mine ? ` and ${x}.member_id = '${member}'` : ''))
    .replace(/\/\*en:([\w.]+)\*\//g, (_, x) => (mine ? ` and ${x} in (select id from public.library_entries where member_id = '${member}')` : ''))
    .replace(/\/\*sess:([\w.]+)\*\//g, (_, x) => (mine ? ` and ${x} in (select s.id from public.reading_sessions s join public.library_entries e on e.id = s.entry_id where e.member_id = '${member}')` : ''))
  const sql = expand(q.sql).replaceAll(":'book'", `'${pick.book}'`).replaceAll(":'series'", `'${pick.series}'`).replaceAll(":'author'", `'${pick.author}'`).replaceAll(":'m'", `'${member}'`)
  const runs = []
  let plan = ''
  for (let i = 0; i < 6; i++) {
    plan = psql(`begin;
select set_config('request.jwt.claims', '{"sub":"${member}","role":"${role}"}', true);
set local role ${role};
explain (analyze, buffers) ${sql};
rollback;`)
    runs.push({ exec: num(plan, /Execution Time: ([\d.]+) ms/), planning: num(plan, /Planning Time: ([\d.]+) ms/), hit: num(plan, /Buffers: shared hit=(\d+)/), read: num(plan, /Buffers: shared hit=\d+ read=(\d+)/) })
  }
  const best = runs.slice(1).sort((a, b) => a.exec - b.exec)[0]
  console.log(`${q.name} | ${best.exec.toFixed(2)} | ${best.planning.toFixed(2)} | ${best.hit} | ${Number.isNaN(best.read) ? 0 : best.read}`)
  if (args.plans) {
    const d = join(args.plans, role)
    mkdirSync(d, { recursive: true })
    writeFileSync(join(d, `${q.name}.txt`), plan)
  }
}
