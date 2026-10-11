/** The members perf/shelf-seed.ts makes and perf/shelf.ts signs in as (synthetic, a throwaway local stack only). */
export const SHELF_MEMBERS = {
  forty: { id: 'de000000-0000-4000-8000-0000000005f0', email: 'shelf40@libellus.local', books: 40 },
  thousand: { id: 'de000000-0000-4000-8000-0000000005f1', email: 'shelf1000@libellus.local', books: 1000 },
  empty: { id: 'de000000-0000-4000-8000-0000000005f2', email: 'shelf0@libellus.local', books: 0 },
} as const
