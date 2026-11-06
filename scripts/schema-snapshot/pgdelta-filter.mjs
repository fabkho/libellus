#!/usr/bin/env node
// Reads the output of `supabase db diff --linked --use-pg-delta` on stdin (pg-delta answers a JSON
// object {"diff": "<sql>", ...}; plain SQL is accepted too), drops the statements about objects that
// are meant to exist only in production, and prints what is left. The release job's drift check
// (release.yml) treats an empty output as "no difference".
//
// IGNORED_ROLES: cluster roles an operator creates in production by hand because they carry a
// secret or a platform setting and so cannot be a migration (a migration is also run on every local
// and CI stack, where the role would be pointless). Each one needs a line saying why. Keep the list
// short: everything not on it still warns, which is the point of the check.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const IGNORED_ROLES = [
  // The read-only login role for the nightly dump (member of pg_read_all_data, BYPASSRLS,
  // default_transaction_read_only = on). Created in the dashboard SQL editor with its own password;
  // the password is the reason it is not a migration (docs/OPERATIONS.md, "Backups").
  'libellus_backup',
]

export function statementsOf(input) {
  let sql = input
  try {
    const parsed = JSON.parse(input)
    if (parsed && typeof parsed === 'object') sql = typeof parsed.diff === 'string' ? parsed.diff : ''
  } catch { /* plain SQL */ }
  return sql.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean)
}

// A statement is ignored when it creates, alters, drops or comments on an ignored ROLE, or grants
// or revokes a role membership for one.
export function isIgnored(statement, roles = IGNORED_ROLES) {
  return roles.some((role) => {
    const name = `"?${role.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"?`
    return new RegExp(`^(CREATE|ALTER|DROP|COMMENT ON) ROLE ${name}(\\s|;|$)`, 'i').test(statement)
      || new RegExp(`^(GRANT|REVOKE)\\b[^;]*\\b(TO|FROM) ${name}(\\s|;|$)`, 'i').test(statement)
  })
}

export function remaining(input, roles = IGNORED_ROLES) {
  return statementsOf(input).filter((s) => !isIgnored(s, roles))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const left = remaining(readFileSync(0, 'utf8'))
  if (left.length) process.stdout.write(left.join('\n\n') + '\n')
}
