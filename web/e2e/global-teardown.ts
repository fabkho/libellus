import { runEmailPattern, sql } from '../tests/support/stack'

// Removes the members this run signed up and nothing else (the dev member, other
// runs' fixtures). Their accounts go with them.
export default async function globalTeardown() {
  await sql('delete from auth.users where email like $1', [runEmailPattern()])
}
