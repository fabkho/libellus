import { assert } from '@std/assert'
import { sameSecret } from './secret.ts'

Deno.test('sameSecret: equal secrets match, anything else does not', async () => {
  assert(await sameSecret('s3cret', 's3cret'))
  assert(!(await sameSecret('', 's3cret')))
  assert(!(await sameSecret('s3cret ', 's3cret')))
  assert(!(await sameSecret('s3cre', 's3cret')))
  assert(!(await sameSecret('a', 'b')))
})
