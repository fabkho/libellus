import { describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs next to the CI scripts
import { isIgnored, remaining } from '../../scripts/schema-snapshot/pgdelta-filter.mjs'

// The release job's drift check filters the pg-delta diff through this: the backup role (created by
// hand in production, with a password) is expected, anything else is drift.
const backupRole = `CREATE ROLE "libellus_backup" WITH NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB LOGIN NOREPLICATION BYPASSRLS;\n\nALTER ROLE "libellus_backup" SET "default_transaction_read_only" TO 'on';\n`

describe('pg-delta drift filter', () => {
  it('drops the backup role, from pg-delta JSON or plain SQL', () => {
    expect(remaining(JSON.stringify({ diff: backupRole, files: [] }))).toEqual([])
    expect(remaining(backupRole)).toEqual([])
    expect(remaining('')).toEqual([])
    expect(isIgnored('GRANT "pg_read_all_data" TO "libellus_backup" WITH INHERIT TRUE;')).toBe(true)
  })

  it('keeps real drift', () => {
    const drift = 'CREATE POLICY "x" ON "public"."books" FOR SELECT USING (true);'
    expect(remaining(JSON.stringify({ diff: `${backupRole}\n${drift}` }))).toEqual([drift])
    expect(remaining('CREATE ROLE "someone_else" LOGIN;')).toHaveLength(1)
    expect(remaining('CREATE ROLE "libellus_backup_2" LOGIN;')).toHaveLength(1)
    expect(remaining('GRANT SELECT ON "public"."books" TO "libellus_backup_x";')).toHaveLength(1)
  })
})
