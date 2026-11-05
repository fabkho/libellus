import { describe, expect, it } from 'vitest'
import { findRealtimeInEntry } from '../entry-guard.config.ts'

/** The entry guard's walk (entry-guard.config.ts), on a bundle as Rollup hands it to `generateBundle`. */
const chunk = (fileName: string, over: Record<string, unknown> = {}) => ({ type: 'chunk', fileName, name: fileName.replace(/\..*$/, ''), isEntry: false, imports: [], modules: {}, ...over })
const bundle = (...chunks: ReturnType<typeof chunk>[]) => Object.fromEntries(chunks.map((c) => [c.fileName, c]))
const REAL = '/app/node_modules/.pnpm/@supabase+realtime-js@2.118.0/node_modules/@supabase/realtime-js/dist/module/index.js'

describe('the entry guard', () => {
  it('lets the stub through', () => {
    expect(findRealtimeInEntry(bundle(chunk('entry.js', { isEntry: true, modules: { '/app/web/app/data/realtimeStub.ts': {} } })))).toBeNull()
  })

  it('lets the real client through when only a dynamic import reaches it', () => {
    expect(findRealtimeInEntry(bundle(chunk('entry.js', { isEntry: true, dynamicImports: ['realtime.js'] }), chunk('realtime.js', { modules: { [REAL]: {} } })))).toBeNull()
  })

  it('fails on the real client inside the entry, and on one reached through static imports', () => {
    expect(findRealtimeInEntry(bundle(chunk('entry.js', { isEntry: true, modules: { [REAL]: {} } })))?.path).toEqual(['entry.js'])
    const nested = bundle(chunk('entry.js', { isEntry: true, imports: ['a.js'] }), chunk('a.js', { imports: ['realtime.js'] }), chunk('realtime.js', { modules: { [REAL]: {} } }))
    expect(findRealtimeInEntry(nested)?.path).toEqual(['entry.js', 'a.js', 'realtime.js'])
  })

  it('fails on the `realtime` chunk even when it is imported statically and holds nothing recognisable', () => {
    expect(findRealtimeInEntry(bundle(chunk('entry.js', { isEntry: true, imports: ['realtime.js'] }), chunk('realtime.js', { name: 'realtime' })))?.path).toEqual(['entry.js', 'realtime.js'])
  })
})
