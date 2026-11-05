import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * What the nightly backup leaves the rows out of (`NO_DATA`, scripts/backup-db.sh). Google Books' answer cache may be kept a
 * day at most (its terms) and holds search words members typed; the backup is kept 35 days, so its rows must never be in it.
 */
describe('the backup leaves some tables without data', () => {
  const script = readFileSync(new URL('../../scripts/backup-db.sh', import.meta.url), 'utf8')
  const list = /^NO_DATA=\(\n([\s\S]*?)^\)/m.exec(script)?.[1] ?? ''
  const tables = list.split(/\s+/).filter(Boolean)

  it('has the list', () => {
    expect(tables).toContain('auth.sessions')
  })

  it('names the Google Books cache, so the dump takes its schema and none of its rows', () => {
    expect(tables).toContain('public.google_books_cache')
  })

  it('is handed to pg_dump as --exclude-table-data, one per table', () => {
    expect(script).toMatch(/for t in "\$\{NO_DATA\[@\]\}"; do dump_args\+=\(--exclude-table-data="\$t"\); done/)
  })
})
