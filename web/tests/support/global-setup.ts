import { stack, sweepAbandonedRuns, sweepRun } from './stack'

export async function setup() {
  const health = await fetch(`${stack.url}/rest/v1/`, {
    headers: { apikey: stack.anonKey },
  }).catch(() => null)
  if (!health?.ok) {
    throw new Error(
      `No Supabase stack answering at ${stack.url}. Run \`supabase start\` in the repo root.`,
    )
  }
  // A run that crashed never reached its teardown; its leftovers go once they
  // are a day old (tests/support/stack.ts).
  await sweepAbandonedRuns()
}

/** Removes what this run created and nothing else, so a second run against the same stack keeps its fixtures. */
export async function teardown() {
  await sweepRun()
}
