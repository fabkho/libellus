import { sweepRun } from '../tests/support/stack'

// Removes the members this run signed up and nothing else (the dev member, other
// runs' fixtures). Their accounts and Library entries go with them. The Books
// the flows added stay in the Catalogue: they are real Apple Books (from the
// recorded responses), exactly what a member adding them would leave there.
export default async function globalTeardown() {
  await sweepRun()
}
