/**
 * The function's behaviour (issue #110) with the fixture Library and a fake
 * published file: the shared secret, the configuration, the file itself
 * (pinned in fixtures/expected.json, valid for Regal's validator), the art
 * carried over, and no file at all when the published one cannot be read.
 *
 *   cd supabase/functions/regal-export && deno task test
 */
import { assert, assertEquals, assertRejects } from '@std/assert'
import { validateLibraryFile } from '../../../web/app/data/export/regalLibraryFile.ts'
import {
  configFromEnv,
  createHandler,
  DEFAULT_CARRY_ART_URL,
  type ExportConfig,
  type HandlerDeps,
  loadPublished,
  PublishedUnavailable,
  sameSecret,
} from './handler.ts'
import { entryFromRow } from './library.ts'
import {
  config,
  entryRows,
  expectedFile,
  fixturePublished,
  NOW,
  OWNER_EMAIL,
  PUBLISHED_URL,
  publishedFetch,
  TOKEN,
} from './test_support.ts'

function setup(fields: Partial<HandlerDeps> & { config?: ExportConfig | { error: string } } = {}) {
  const logs: string[] = []
  const asked: string[] = []
  const handler = createHandler({
    config: config(),
    readLibrary: (email) => {
      asked.push(email)
      return Promise.resolve(entryRows().map(entryFromRow))
    },
    loadPublished: () => fixturePublished(),
    now: () => NOW,
    log: (line) => logs.push(line),
    ...fields,
  })
  return { handler, logs, asked }
}

const get = (query = '', token: string | null = TOKEN, method = 'GET') =>
  new Request(`http://localhost/functions/v1/regal-export${query}`, {
    method,
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
  })

// ------------------------------------------------------------------ the secret

Deno.test('refuses a request without the secret, or with a wrong one, before reading anything', async () => {
  const { handler, asked } = setup()
  for (const token of [null, '', 'nope', TOKEN.slice(0, -1), `${TOKEN}x`, TOKEN.toUpperCase()]) {
    const response = await handler(get('', token))
    assertEquals(response.status, 401, `token ${token}`)
    assertEquals(response.headers.get('www-authenticate'), 'Bearer')
    assertEquals(await response.json(), { error: 'unauthorized' })
  }
  assertEquals(asked, [])
})

Deno.test('takes the secret in any spelling of the Bearer scheme', async () => {
  const { handler } = setup()
  const request = new Request('http://localhost/functions/v1/regal-export', { headers: { authorization: `bearer   ${TOKEN}` } })
  assertEquals((await handler(request)).status, 200)
})

Deno.test('compares secrets by their whole value', async () => {
  assert(await sameSecret(TOKEN, TOKEN))
  assert(!(await sameSecret('', TOKEN)))
  assert(!(await sameSecret(TOKEN, `${TOKEN} `)))
  assert(!(await sameSecret('a', 'b')))
})

Deno.test('answers only GET and HEAD', async () => {
  const { handler } = setup()
  const response = await handler(get('', TOKEN, 'POST'))
  assertEquals(response.status, 405)
  assertEquals(response.headers.get('allow'), 'GET, HEAD')
  const head = await handler(get('', TOKEN, 'HEAD'))
  assertEquals(head.status, 200)
  assertEquals(head.headers.get('x-regal-books'), '3')
  assertEquals(await head.text(), '')
})

// ----------------------------------------------------------- the configuration

Deno.test('refuses every request while a secret is missing', async () => {
  const { handler, logs } = setup({ config: configFromEnv(() => undefined) })
  const response = await handler(get())
  assertEquals(response.status, 500)
  assertEquals(await response.json(), { error: 'not_configured' })
  assertEquals(logs, ['regal-export: not configured: REGAL_EXPORT_TOKEN and REGAL_OWNER_EMAIL not set'])
})

Deno.test('reads its configuration from the environment, with the daily chain’s defaults', () => {
  const env = (values: Record<string, string>) => (name: string) => values[name]
  assertEquals(configFromEnv(env({ REGAL_EXPORT_TOKEN: ` ${TOKEN} `, REGAL_OWNER_EMAIL: OWNER_EMAIL })), {
    token: TOKEN,
    ownerEmail: OWNER_EMAIL,
    ownerName: null,
    timeZone: 'Europe/Berlin',
    statuses: ['read'],
    carryArtUrl: DEFAULT_CARRY_ART_URL,
  })
  assertEquals(
    configFromEnv(env({
      REGAL_EXPORT_TOKEN: TOKEN,
      REGAL_OWNER_EMAIL: OWNER_EMAIL,
      REGAL_OWNER_NAME: 'Fabian',
      REGAL_TIME_ZONE: 'UTC',
      REGAL_STATUSES: 'read, dnf',
      REGAL_CARRY_ART_URL: 'none',
    })),
    { token: TOKEN, ownerEmail: OWNER_EMAIL, ownerName: 'Fabian', timeZone: 'UTC', statuses: ['read', 'dnf'], carryArtUrl: null },
  )
  const base = { REGAL_EXPORT_TOKEN: TOKEN, REGAL_OWNER_EMAIL: OWNER_EMAIL }
  assertEquals(configFromEnv(env({ ...base, REGAL_EXPORT_TOKEN: 'short' })), { error: 'REGAL_EXPORT_TOKEN is shorter than 32 characters' })
  assert('error' in configFromEnv(env({ ...base, REGAL_STATUSES: 'read,finished' })))
  assert('error' in configFromEnv(env({ ...base, REGAL_TIME_ZONE: 'Mars/Olympus' })))
})

// --------------------------------------------------------------------- the file

Deno.test('answers the owner’s Books read as a valid library file, with the published art carried over', async () => {
  const { handler, asked, logs } = setup()
  const response = await handler(get())
  assertEquals(response.status, 200)
  assertEquals(response.headers.get('content-type'), 'application/json; charset=utf-8')
  assertEquals(response.headers.get('cache-control'), 'no-store')
  assertEquals(response.headers.get('x-regal-books'), '3')
  assertEquals(response.headers.get('x-regal-art-carried'), '2')
  assertEquals(asked, [OWNER_EMAIL])

  const text = await response.text()
  const file = JSON.parse(text)
  assert(validateLibraryFile(file).ok)
  // Byte for byte what `pnpm export:regal` writes: two-space JSON and a newline.
  assertEquals(text, `${JSON.stringify(expectedFile(), null, 2)}\n`)
  assertEquals(logs, [
    `regal-export: entries 6, Books 3 (read), art carried for 2 from ${PUBLISHED_URL} (3 Books)`,
  ])
})

Deno.test('takes the member’s own page count, the last finished read and the owner’s calendar day', async () => {
  const file = await (await setup().handler(get())).json()
  const leftHand = file.books.find((book: { title: string }) => book.title === 'The Left Hand of Darkness')
  assertEquals(leftHand.pages, 512) // page_count_override, not the edition's 304
  assertEquals([leftHand.dateRead, leftHand.rating, leftHand.readCount], ['2024-02-28', 4.75, 2])
  assertEquals(leftHand.dateAdded, '2024-03-02') // 23:30 UTC is the next day in Berlin
})

Deno.test('carries art by ISBN-13 or by work, as absolute URLs against the published file', async () => {
  const file = await (await setup().handler(get())).json()
  const byTitle = (title: string) => file.books.find((book: { title: string }) => book.title === title)
  assertEquals(byTitle('Golden Son').assets.spine, 'https://books.example.test/v2/9780345539830/spine.webp')
  assertEquals(byTitle('Red Rising: Book One').assets.front, 'https://cdn.example.test/red-rising/front.webp')
  assertEquals(byTitle('The Left Hand of Darkness').assets.front, 'https://covers.example.test/left-hand.jpg')
})

Deno.test('exports other statuses when asked, and refuses unknown ones', async () => {
  const { handler } = setup()
  const file = await (await handler(get('?statuses=read,dnf,currently-reading,to-read'))).json()
  assertEquals(file.books.map((book: { status: string }) => book.status).sort(), ['currently-reading', 'dnf', 'read', 'read', 'read', 'to-read'])
  const parable = file.books.find((book: { title: string }) => book.title === 'Parable of the Sower')
  assertEquals(parable.pages, 99)
  const bad = await handler(get('?statuses=read,finished'))
  assertEquals(bad.status, 400)
  assertEquals((await bad.json()).error, 'statuses_invalid')
})

Deno.test('leaves the owner out of the file when no name is configured, and carries nothing without a published file', async () => {
  const { handler } = setup({
    config: config({ ownerName: null, carryArtUrl: null }),
    loadPublished: () => Promise.reject(new Error('not asked')),
  })
  const response = await handler(get())
  assertEquals(response.status, 200)
  assertEquals(response.headers.get('x-regal-art-carried'), '0')
  const file = await response.json()
  assertEquals('owner' in file, false)
  assertEquals(file.books.find((book: { title: string }) => book.title === 'Golden Son').assets, {
    front: 'https://covers.example.test/golden-son.jpg',
  })
})

// ---------------------------------------------------------------- failures

Deno.test('sends no file when the published one cannot be read, so the art is never dropped', async () => {
  const { handler, asked, logs } = setup({
    loadPublished: (url) => loadPublished(url, publishedFetch('gateway timeout', 504)),
  })
  const response = await handler(get())
  assertEquals(response.status, 502)
  assertEquals(await response.json(), { error: 'published_unavailable' })
  assertEquals(asked, [])
  assertEquals(logs, [`regal-export: published file unavailable: ${PUBLISHED_URL}: HTTP 504`])
})

Deno.test('says so when the owner is not a member', async () => {
  const { handler } = setup({ readLibrary: () => Promise.resolve(null) })
  const response = await handler(get())
  assertEquals(response.status, 500)
  assertEquals(await response.json(), { error: 'owner_not_found' })
})

Deno.test('says so when reading the Library fails, without its details', async () => {
  const { handler, logs } = setup({ readLibrary: () => Promise.reject(new Error('Reading the Library: connection refused')) })
  const response = await handler(get())
  assertEquals(response.status, 500)
  assertEquals(await response.json(), { error: 'export_failed' })
  assert(logs[0]!.includes('connection refused'))
})

Deno.test('refuses a file that does not validate', async () => {
  const rows = entryRows()
  rows[1]!.book.title = '   '
  const { handler } = setup({ readLibrary: () => Promise.resolve(rows.map(entryFromRow)) })
  const response = await handler(get())
  assertEquals(response.status, 500)
  assertEquals((await response.json()).error, 'export_invalid')
})

// --------------------------------------------------------- the published file

Deno.test('reads the published file and resolves its references against where it came from', async () => {
  const published = await fixturePublished()
  assertEquals(published.file.books.length, 3)
  assertEquals(published.resolveRef('a/front.webp'), 'https://books.example.test/v2/a/front.webp')
  assertEquals(published.resolveRef('/root.webp'), 'https://books.example.test/root.webp')
  assertEquals(published.resolveRef('https://cdn.example.test/x.webp'), 'https://cdn.example.test/x.webp')
})

Deno.test('takes neither a missing nor an invalid published file', async () => {
  await assertRejects(() => loadPublished('https://elsewhere.example.test/library.json', publishedFetch()), PublishedUnavailable, 'HTTP 404')
  await assertRejects(() => loadPublished(PUBLISHED_URL, publishedFetch('{"version":1}')), PublishedUnavailable, 'not a valid Regal library file')
  await assertRejects(() => loadPublished(PUBLISHED_URL, publishedFetch('<html>')), PublishedUnavailable, 'not a valid Regal library file')
  await assertRejects(
    () => loadPublished(PUBLISHED_URL, () => Promise.reject(new TypeError('dns error'))),
    PublishedUnavailable,
    'dns error',
  )
})
