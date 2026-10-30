import { assert, assertEquals, assertRejects } from '@std/assert'
import { COVERS_BUCKET, createR2, OBJECT_CACHE_CONTROL, R2Error } from './r2.ts'
import { fakeS3, fixture } from './test_support.ts'

const options = { accountId: 'acct123', accessKeyId: 'AKIAFAKE', secretAccessKey: 'fake-secret-value' }

Deno.test('a PUT is signed (SigV4, region auto) into the covers bucket at c/<key>/<width>, with the type and the immutable cache header', async () => {
  const s3 = fakeS3()
  const seen: Request[] = []
  const r2 = createR2({ ...options, fetch: (request) => (seen.push(request.clone()), s3.fetch(request)) })
  const key = 'a'.repeat(32)
  const bytes = fixture('apple-120x180.webp')
  await r2.put(key, 114, bytes, 'image/webp')

  assertEquals(seen[0]!.method, 'PUT')
  assertEquals(seen[0]!.url, `https://acct123.r2.cloudflarestorage.com/${COVERS_BUCKET}/c/${key}/114`)
  assertEquals(seen[0]!.headers.get('content-type'), 'image/webp')
  assertEquals(seen[0]!.headers.get('cache-control'), OBJECT_CACHE_CONTROL)
  assert(/^AWS4-HMAC-SHA256 Credential=AKIAFAKE\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=[^,]+, Signature=[0-9a-f]{64}$/.test(seen[0]!.headers.get('authorization')!))
  assert(!seen[0]!.headers.get('authorization')!.includes('fake-secret-value'))
  assertEquals(s3.objects.get(`c/${key}/114`)?.bytes, bytes)
  assertEquals(s3.objects.get(`c/${key}/114`)?.contentType, 'image/webp')
})

Deno.test('a PUT that fails is an R2Error with the status only (the answer\'s body, which can carry details, is dropped)', async () => {
  const s3 = fakeS3({ fail: () => 503 })
  const r2 = createR2({ ...options, fetch: s3.fetch })
  const error = await assertRejects(() => r2.put('b'.repeat(32), 300, fixture('ol-M.jpg'), 'image/jpeg'), R2Error)
  assertEquals(error.status, 503)
  assert(!error.message.includes('secret detail'))
  const down = createR2({ ...options, fetch: () => Promise.reject(new TypeError('connection refused to acct123')) })
  const offline = await assertRejects(() => down.put('c'.repeat(32), 300, fixture('ol-M.jpg'), 'image/jpeg'), R2Error)
  assertEquals(offline.status, null)
  assert(!offline.message.includes('acct123'))
})

Deno.test('the endpoint can be another one (the local stack\'s stand-in); the bucket and path stay', async () => {
  const seen: string[] = []
  const r2 = createR2({ ...options, endpoint: 'http://host.docker.internal:3101/', fetch: (request) => (seen.push(request.url), Promise.resolve(new Response(null))) })
  await r2.put('d'.repeat(32), 120, fixture('ol-S.jpg'), 'image/jpeg')
  assertEquals(seen, [`http://host.docker.internal:3101/${COVERS_BUCKET}/c/${'d'.repeat(32)}/120`])
})

Deno.test('a PUT that never answers fails after its timeout, and the run\'s signal ends it sooner', async () => {
  const never = (request: Request) => new Promise<Response>((_, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason)))
  const slow = createR2({ ...options, fetch: never, timeoutMs: 30 })
  const error = await assertRejects(() => slow.put('e'.repeat(32), 120, fixture('ol-S.jpg'), 'image/jpeg'), R2Error)
  assertEquals(error.status, null)

  const run = new AbortController()
  const long = createR2({ ...options, fetch: never, timeoutMs: 60_000 })
  const pending = assertRejects(() => long.put('f'.repeat(32), 120, fixture('ol-S.jpg'), 'image/jpeg', { signal: run.signal }), R2Error)
  await new Promise((resolve) => setTimeout(resolve, 20)) // the PUT is out
  run.abort()
  await pending
})

Deno.test('a DELETE is signed and removes c/<key>/<width>; an object that is not there is deleted too (204)', async () => {
  const s3 = fakeS3()
  const seen: Request[] = []
  const r2 = createR2({ ...options, fetch: (request) => (seen.push(request.clone()), s3.fetch(request)) })
  const key = 'a'.repeat(32)
  await r2.put(key, 114, fixture('apple-120x180.webp'), 'image/webp')
  await r2.delete(key, 114)
  assertEquals(seen[1]!.method, 'DELETE')
  assertEquals(seen[1]!.url, `https://acct123.r2.cloudflarestorage.com/${COVERS_BUCKET}/c/${key}/114`)
  assert(/^AWS4-HMAC-SHA256 Credential=AKIAFAKE\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=[^,]+, Signature=[0-9a-f]{64}$/.test(seen[1]!.headers.get('authorization')!))
  assertEquals([...s3.objects.keys()], [])
  await r2.delete(key, 114) // not there any more
  assertEquals(s3.deletes, [`c/${key}/114`, `c/${key}/114`])
})

Deno.test('a DELETE that fails is an R2Error with the status and no detail; a 404 is not taken for "deleted" (a wrong bucket answers it too)', async () => {
  for (const code of [403, 404, 500, 503]) {
    const r2 = createR2({ ...options, fetch: fakeS3({ failDelete: () => code }).fetch })
    const error = await assertRejects(() => r2.delete('a'.repeat(32), 114), R2Error)
    assertEquals([error.status, error.message], [code, `delete answered ${code}`])
  }
  const unreachable = createR2({ ...options, fetch: () => Promise.reject(new TypeError('connection to acct123.r2.cloudflarestorage.com refused')) })
  const error = await assertRejects(() => unreachable.delete('a'.repeat(32), 114), R2Error)
  assertEquals([error.status, error.message], [null, 'delete failed: TypeError'])
})

Deno.test('a DELETE that never answers fails after its timeout, and the run\'s signal ends it sooner', async () => {
  const never = (request: Request) => new Promise<Response>((_, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason)))
  const slow = createR2({ ...options, fetch: never, deleteTimeoutMs: 30 })
  const error = await assertRejects(() => slow.delete('e'.repeat(32), 120), R2Error)
  assertEquals(error.status, null)

  const run = new AbortController()
  const long = createR2({ ...options, fetch: never, deleteTimeoutMs: 60_000 })
  const pending = assertRejects(() => long.delete('f'.repeat(32), 120, { signal: run.signal }), R2Error)
  await new Promise((resolve) => setTimeout(resolve, 20))
  run.abort()
  await pending
})

Deno.test('a LIST by prefix answers the widths under c/<key>/ and nothing of another key', async () => {
  const s3 = fakeS3()
  const r2 = createR2({ ...options, fetch: s3.fetch })
  const key = 'a'.repeat(32)
  const other = 'b'.repeat(32)
  for (const width of [568, 114, 227]) await r2.put(key, width, fixture('apple-120x180.webp'), 'image/webp')
  await r2.put(other, 120, fixture('apple-120x180.webp'), 'image/webp')
  assertEquals(await r2.list(key), [114, 227, 568])
  assertEquals(await r2.list('c'.repeat(32)), [])
  assertEquals(s3.lists, [`c/${key}/`, `c/${'c'.repeat(32)}/`])
  const failing = createR2({ ...options, fetch: fakeS3({ failList: () => 500 }).fetch })
  const error = await assertRejects(() => failing.list(key), R2Error)
  assertEquals([error.status, error.message], [500, 'list answered 500'])
})
