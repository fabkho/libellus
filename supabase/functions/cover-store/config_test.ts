import { assertEquals } from '@std/assert'
import { missingSettings, parseHosts } from './config.ts'
import { ALL_HOSTS } from './plan.ts'

Deno.test('COVER_STORE_HOSTS: unset is all; names are trimmed and lower-cased; one line drops a host', () => {
  const warned: string[] = []
  const warn = (message: string) => warned.push(message)
  assertEquals(parseHosts(null, warn), [...ALL_HOSTS])
  assertEquals(parseHosts('', warn), [...ALL_HOSTS])
  assertEquals(parseHosts(' Apple , openlibrary,regal', warn), ['apple', 'openlibrary', 'regal'])
  assertEquals(warned, [])
})

Deno.test('COVER_STORE_HOSTS with no known name (typos) warns and falls back to every host, not to none', () => {
  const warned: string[] = []
  assertEquals(parseHosts('aple,open-library', (m) => warned.push(m)), [...ALL_HOSTS])
  assertEquals(warned.length, 2)
  assertEquals(warned[0]!.includes('aple, open-library'), true)
})

Deno.test('COVER_STORE_HOSTS with one typo among known names warns and keeps the known', () => {
  const warned: string[] = []
  assertEquals(parseHosts('apple,goodread', (m) => warned.push(m)), ['apple'])
  assertEquals(warned.length, 1)
})

Deno.test('settings: unset ones are named; a COVER_KEY_SECRET under 32 characters is not usable', () => {
  const all = { COVER_KEY_SECRET: 'k'.repeat(32), OPENLIBRARY_CONTACT: 'a@b.c', R2_COVERS_ACCOUNT_ID: 'a' }
  assertEquals(missingSettings(all), [])
  assertEquals(missingSettings({ ...all, R2_COVERS_ACCOUNT_ID: null }), ['R2_COVERS_ACCOUNT_ID'])
  assertEquals(missingSettings({ ...all, COVER_KEY_SECRET: null }), ['COVER_KEY_SECRET'])
  assertEquals(missingSettings({ ...all, COVER_KEY_SECRET: 'k'.repeat(31) }), ['COVER_KEY_SECRET (at least 32 characters)'])
})
