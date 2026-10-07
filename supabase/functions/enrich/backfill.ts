/**
 * The one-off backfill (and any catch-up) from a terminal: queues every
 * Catalogue Book never enriched (`enrich_backfill`), drains the queue in this
 * process with the same code the function runs (no function server needed),
 * then reports coverage for one member's Library. Resumable: stop it any time,
 * run it again, it continues with what is left.
 *
 *   cd supabase/functions/enrich
 *   SUPABASE_URL=http://127.0.0.1:55321 SUPABASE_SERVICE_ROLE_KEY=<from supabase status> \
 *     deno run --allow-net --allow-env --allow-read=.,../../../web/app/data/enrich backfill.ts dev@libellus.local
 *
 * Live calls, politely spaced (http.ts): about five seconds a Book, more for
 * an author met the first time. `--no-queue` drains only what is queued;
 * `--report` only reports; `--remap` first applies the current genre mapping to
 * every Book an older one computed (no source asked).
 */
import { createClient } from '@supabase/supabase-js'
import { createHandler } from './handler.ts'
import { createHttp, userAgent } from './http.ts'
import { createSources } from './sources.ts'
import { createSupabaseStore } from './store.ts'

const url = Deno.env.get('SUPABASE_URL')
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
if (!url || !serviceKey) throw new Error('backfill needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
const args = Deno.args.filter((a) => !a.startsWith('--'))
const email = args[0] ?? null
const queue = !Deno.args.includes('--no-queue')
const reportOnly = Deno.args.includes('--report')
const remap = Deno.args.includes('--remap')

const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const store = createSupabaseStore(supabase)
const handler = createHandler({
  store,
  sources: createSources(
    createHttp({ fetch: (i, init) => fetch(i, init), userAgent: userAgent(Deno.env.get('LIBELLUS_SITE_URL'), Deno.env.get('ENRICH_CONTACT')) }),
    (Deno.env.get('ENRICH_LANGUAGES') ?? 'en,de').split(','),
  ),
  authorize: () => Promise.resolve('service'),
  budgetMs: 10 * 60 * 1000,
  log: (message) => console.error(message),
})

async function call(body: unknown) {
  const response = await handler(new Request('http://local/enrich', { method: 'POST', body: JSON.stringify(body) }))
  return await response.json()
}

if (remap) console.log('remapped', await call({ action: 'remap' }))
if (!reportOnly) {
  if (queue) console.log('queued', await call({ action: 'backfill' }))
  for (;;) {
    const status = await store.status()
    console.log('status', status)
    if (!status.due) break
    console.log('drained', await call({ action: 'drain' }))
  }
}

if (email) await report(email)

/** Coverage of one member's Library: series, genres, author pages. */
async function report(address: string) {
  const { data: users } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  const member = users?.users.find((u) => u.email === address)
  if (!member) throw new Error(`no member ${address}`)
  const { data: entries, error } = await supabase
    .from('library_entries')
    .select('book_id, books!inner(title, authors, owner_id)')
    .eq('member_id', member.id)
  if (error) throw new Error(error.message)
  const books = (entries ?? []).filter((e) => !(e.books as unknown as { owner_id: string | null }).owner_id)
  const ids = books.map((e) => e.book_id)
  const count = async (table: string, column = 'book_id') => {
    const { data } = await supabase.from(table).select(column).in(column, ids)
    return new Set((data ?? []).map((row) => (row as unknown as Record<string, string>)[column])).size
  }
  const { data: linked } = await supabase.from('book_authors').select('book_id, authors(fetched_at, photo_url, summaries, wikidata_id)').in('book_id', ids).eq('position', 1)
  const complete = (linked ?? []).filter((row) => {
    const a = row.authors as unknown as { fetched_at: string | null; photo_url: string | null; summaries: Record<string, unknown>; wikidata_id: string | null } | null
    return a?.fetched_at && a.photo_url && Object.keys(a.summaries ?? {}).length
  }).length
  const line = (label: string, n: number) => console.log(`${label.padEnd(36)} ${String(n).padStart(4)} / ${books.length}  (${Math.round((100 * n) / Math.max(1, books.length))} %)`)
  console.log(`\n${address}: ${books.length} Catalogue Books (${(entries ?? []).length - books.length} Manual books left out)`)
  line('enriched (work or genres found)', await countStatus(ids, 'enriched'))
  line('linked to a work', await count('book_works'))
  line('in a series', await count('book_series'))
  line('with genres', await count('book_genres'))
  line('first author linked', (linked ?? []).length)
  line('author page complete (photo + intro)', complete)
}

async function countStatus(ids: string[], status: string): Promise<number> {
  const { data } = await supabase.from('book_enrichment').select('book_id').in('book_id', ids).eq('status', status)
  return (data ?? []).length
}
