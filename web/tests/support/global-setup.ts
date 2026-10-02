import { runEmailPattern, sql, stack, TEST_DOMAIN } from './stack'

/**
 * Removes what this run created and nothing else, so a second run against the
 * same stack keeps its fixtures. Rows hang off auth.users and cascade with it
 * once the library tables exist.
 */
async function sweepRun() {
  await sql('delete from auth.users where email like $1', [runEmailPattern()])
}

/**
 * A run that crashed never reached its teardown. Its leftovers are cleared once
 * they are a day old, which no run still in progress can be.
 */
async function sweepAbandonedRuns() {
  await sql(
    `delete from auth.users where email like $1 and created_at < now() - interval '1 day'`,
    [`%@${TEST_DOMAIN}`],
  )
}

export async function setup() {
  const health = await fetch(`${stack.url}/rest/v1/`, {
    headers: { apikey: stack.anonKey },
  }).catch(() => null)
  if (!health?.ok) {
    throw new Error(
      `No Supabase stack answering at ${stack.url}. Run \`supabase start\` in the repo root.`,
    )
  }
  await sweepAbandonedRuns()
}

export async function teardown() {
  await sweepRun()
}
