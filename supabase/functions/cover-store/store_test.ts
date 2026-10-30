import { assertEquals, assertRejects } from '@std/assert'
import { createGcStore, createStore } from './store.ts'

function rpcOf(answers: Record<string, unknown>) {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const rpc = (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args })
    const answer = answers[name]
    return Promise.resolve(answer instanceof Error ? { data: null, error: { message: answer.message } } : { data: answer ?? null, error: null })
  }
  return { rpc, calls }
}

Deno.test('the store calls the migration\'s functions with their parameter names', async () => {
  const claimed = [{ book_id: 'b1', source_url: 'https://x', attempts: 0, needs_thumbhash: true, needs_colours: true }]
  const { rpc, calls } = rpcOf({ cover_store_claim: claimed, cover_store_reserve: true, cover_store_done: true, cover_store_failed: true, cover_store_release: true, cover_store_kick: 'sent' })
  const store = createStore(rpc)
  assertEquals(await store.claim('fn:1', 8), claimed)
  assertEquals(await store.reserve('k'.repeat(32)), true)
  assertEquals(await store.done({ book: 'b1', sourceUrl: 'https://x', key: 'k', widths: [120, 600], bytes: 99, contentType: 'image/webp' }), true)
  assertEquals(await store.failed('b1', 'fn:1', 'gone'), true)
  assertEquals(await store.release('b1', 'fn:1'), true)
  assertEquals(await store.kick(), 'sent')
  assertEquals(calls, [
    { name: 'cover_store_claim', args: { p_runner: 'fn:1', p_limit: 8 } },
    { name: 'cover_store_reserve', args: { p_key: 'k'.repeat(32) } },
    {
      name: 'cover_store_done',
      args: {
        p_book: 'b1', p_source_url: 'https://x', p_key: 'k', p_widths: [120, 600], p_bytes: 99, p_content_type: 'image/webp',
        p_thumbhash: null, p_dominant: null, p_secondary: null,
      },
    },
    { name: 'cover_store_failed', args: { p_book: 'b1', p_runner: 'fn:1', p_reason: 'gone' } },
    { name: 'cover_store_release', args: { p_book: 'b1', p_runner: 'fn:1' } },
    { name: 'cover_store_kick', args: { p_now: true } },
  ])
})

Deno.test('an empty claim is an empty list, a false answer is false, a database error rejects', async () => {
  const store = createStore(rpcOf({ cover_store_claim: null, cover_store_reserve: false, cover_store_done: null, cover_store_failed: new Error('reason_invalid') }).rpc)
  assertEquals(await store.claim('fn:1', 8), [])
  assertEquals(await store.reserve('k'), false)
  assertEquals(await store.done({ book: 'b', sourceUrl: 'u', key: 'k', widths: [1], bytes: 1, contentType: 'image/jpeg' }), false)
  await assertRejects(() => store.failed('b', 'fn:1', 'gone'), Error, 'cover_store_failed: reason_invalid')
})

Deno.test('the GC store calls cover_gc_* with their parameter names; an empty claim is an empty list', async () => {
  const claimed = [{ key: 'k'.repeat(32), widths: [120, 600] }, { key: 'j'.repeat(32), widths: null }]
  const { rpc, calls } = rpcOf({ cover_gc_claim: claimed, cover_gc_done: 2, cover_gc_failed: 1 })
  const store = createGcStore(rpc)
  assertEquals(await store.claim(100), claimed)
  assertEquals(await store.done(['a', 'b']), 2)
  assertEquals(await store.failed(['c']), 1)
  assertEquals(calls, [
    { name: 'cover_gc_claim', args: { p_limit: 100 } },
    { name: 'cover_gc_done', args: { p_keys: ['a', 'b'] } },
    { name: 'cover_gc_failed', args: { p_keys: ['c'] } },
  ])
  assertEquals(await createGcStore(rpcOf({ cover_gc_claim: null }).rpc).claim(100), [])
  await assertRejects(() => createGcStore(rpcOf({ cover_gc_claim: new Error('boom') }).rpc).claim(100), Error, 'cover_gc_claim: boom')
})
