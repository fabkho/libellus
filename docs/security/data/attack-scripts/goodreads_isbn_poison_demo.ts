import { createHandler } from '../../../../supabase/functions/goodreads-rating/handler.ts'
// Goodreads stub: the review_counts endpoint does not know this ISBN (404 -> not_found); the title search knows "Dune" by Herbert.
const upstream: string[] = []
const goodreads = {
  reviewCounts: async (isbn: string) => { upstream.push('review_counts ' + isbn); return { status: 'not_found' as const } },
  autoComplete: async (q: string) => { upstream.push('auto_complete ' + q); return [{ bookId: '234225', title: 'Dune (Dune #1)', bookTitleBare: 'Dune', author: 'Frank Herbert', rating: 4.28, ratingsCount: 1200000 }] as any },
}
const store = new Map<string, any>()
const key = (k: any) => ('isbn13' in k ? 'isbn:' + k.isbn13 : 'title:' + k.titleKey)
const handler = createHandler({
  cache: { get: async (k) => store.get(key(k)) ?? null, put: async (k, a) => { store.set(key(k), a) } },
  goodreads: goodreads as any,
  authorize: async () => true,
})
// Attacker asks for ISBN 9780306406157 (a valid ISBN, e.g. an unrelated Book) but names Dune / Herbert.
const r = await handler(new Request('http://x/', { method: 'POST', body: JSON.stringify({ isbn13: '9780306406157', title: 'Dune', authors: ['Frank Herbert'] }) }))
console.log(r.status, await r.text())
console.log('cache keys now:', [...store.keys()], 'upstream:', upstream)
// A victim asking for that ISBN later (with its real title) is answered from the poisoned cache:
const r2 = await handler(new Request('http://x/', { method: 'POST', body: JSON.stringify({ isbn13: '9780306406157', title: 'Some Other Book', authors: ['Someone Else'] }) }))
console.log('victim gets:', r2.status, await r2.text())
