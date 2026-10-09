/**
 * Asks the `goodreads-rating` function about every Book in one member's
 * Library, one after another, and reports what Goodreads knew: found by ISBN,
 * found by title (also for a Book without an ISBN), not found, nothing to ask with. Fills the cache the way the
 * book page would, Book by Book; the function keeps its own one-a-second limit.
 *
 *   SUPABASE_URL=http://127.0.0.1:55321 SUPABASE_SERVICE_ROLE_KEY=… \
 *     deno run --allow-net --allow-env warm_library.ts dev@libellus.local
 *
 * (from supabase/functions/goodreads-rating, with the function served:
 * `supabase functions serve goodreads-rating`). The keys come from
 * `supabase status`; never from a dotenv file.
 */
import { createClient } from '@supabase/supabase-js'

const email = Deno.args[0]
const url = Deno.env.get('SUPABASE_URL')
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
if (!email || !url || !key) {
  console.error('usage: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… deno run --allow-net --allow-env warm_library.ts <email>')
  Deno.exit(2)
}

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

async function memberId(address: string): Promise<string> {
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    const user = data.users.find((u) => u.email === address)
    if (user) return user.id
    if (data.users.length < 1000) throw new Error(`No member ${address}`)
  }
}

/** ISBN-10 → ISBN-13 (978 prefix, new check digit). */
function isbn10To13(isbn10: string): string {
  const body = `978${isbn10.slice(0, 9)}`
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0)
  return `${body}${(10 - (sum % 10)) % 10}`
}

type BookRow = { title: string; authors: string[]; isbn13: string | null; isbn10: string | null }
const { data: entries, error } = await supabase
  .from('library_entries')
  .select('book:books!inner(title, authors, isbn13, isbn10)')
  .eq('member_id', await memberId(email))
  .returns<{ book: BookRow }[]>()
if (error) throw error

const tally = { isbn: 0, title: 0, notFound: 0, noIsbn: 0, failed: 0 }
const lines: string[] = []
/** The Books without a rating, listed again at the end. */
const missing: string[] = []
for (const [index, { book }] of entries.entries()) {
  const isbn13 = book.isbn13 ?? (book.isbn10 ? isbn10To13(book.isbn10) : null)
  const label = `${String(index + 1).padStart(3)} ${book.title} — ${book.authors.join(', ')}`
  if (!isbn13 && !book.authors.length) {
    tally.noIsbn++
    lines.push(`${label}: no ISBN and no author`)
    missing.push(lines.at(-1)!)
    continue
  }
  const started = performance.now()
  const response = await fetch(`${url}/functions/v1/goodreads-rating`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ...(isbn13 ? { isbn13 } : {}), title: book.title, authors: book.authors }),
  })
  const body = await response.json()
  const ms = Math.round(performance.now() - started)
  if (response.ok && body.status === 'found') {
    tally[body.matchedBy === 'title' ? 'title' : 'isbn']++
    lines.push(`${label}: ${body.rating} ★ · ${body.ratingsCount} ratings · ${body.reviewsCount ?? '–'} reviews (by ${body.matchedBy}, ${ms} ms)`)
  } else if (response.ok) {
    tally.notFound++
    lines.push(`${label}: not found (${ms} ms)`)
    missing.push(lines.at(-1)!)
  } else {
    tally.failed++
    lines.push(`${label}: ${response.status} ${body.error} (${ms} ms)`)
    missing.push(lines.at(-1)!)
  }
  console.log(lines.at(-1))
}

console.log(`\n${entries.length} Books: ${tally.isbn} found by ISBN, ${tally.title} by title, ${tally.notFound} not found, ${tally.noIsbn} without an ISBN or an author, ${tally.failed} failed`)
for (const line of missing) console.log(line)
