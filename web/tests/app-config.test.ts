import { describe, expect, it } from 'vitest'
import { parseAppConfig } from '@/utils/appConfig'

describe('app config', () => {
  it('accepts a URL and a key', () => {
    const parsed = parseAppConfig({ supabaseUrl: 'http://127.0.0.1:55321', supabaseAnonKey: 'anon' })
    expect(parsed).toEqual({
      ok: true,
      config: { supabaseUrl: 'http://127.0.0.1:55321', supabaseAnonKey: 'anon' },
    })
  })

  it('names the env var that is missing', () => {
    expect(parseAppConfig({ supabaseUrl: '', supabaseAnonKey: 'anon' })).toEqual({
      ok: false,
      problem: { kind: 'missing', key: 'NUXT_PUBLIC_SUPABASE_URL' },
    })
    expect(parseAppConfig({ supabaseUrl: 'http://127.0.0.1:55321' })).toEqual({
      ok: false,
      problem: { kind: 'missing', key: 'NUXT_PUBLIC_SUPABASE_ANON_KEY' },
    })
  })

  it('rejects something that is not a URL', () => {
    expect(parseAppConfig({ supabaseUrl: 'localhost', supabaseAnonKey: 'anon' })).toEqual({
      ok: false,
      problem: { kind: 'invalidUrl', value: 'localhost' },
    })
  })
})
