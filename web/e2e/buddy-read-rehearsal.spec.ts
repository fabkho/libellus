import type { Locator } from '@playwright/test'
import { expect, test } from './fixtures'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { buddyOf, follows, joinRead, startRead } from '../tests/support/buddy'
import { signUpMember } from '../tests/support/member'
import { sql } from '../tests/support/stack'
import { goto, signedIn } from './support'

/**
 * What the launch rehearsal found (docs/parity.md, "Buddy read, a thread" and "Buddy read, the room", *after the rehearsal*), each in a browser:
 * a room of three, where two other members write one after the other, is not one run under the first one's name with the last one's face;
 * a member who is removed while the room or a thread is open is told it is not available, with no reload; entering a thread with the keyboard
 * puts the focus in it; and the link page loads on the flows' own static server (`/t/*` is a 500 there if `_headers`' `!` is not read).
 *
 * Tagged @full (docs/TESTING.md): it runs in the release run and on a pull request with the `full-e2e` label.
 */

test.use({ colorScheme: 'dark' })

const named = async (member: { id: string }, name: string) =>
  sql(`update auth.users set raw_user_meta_data = raw_user_meta_data || jsonb_build_object('name', $2::text) where id = $1`, [member.id, name])

/** The runs a thread draws, top to bottom: the name over the first message, the face beside the last, how many messages sit between. */
async function runsOf(messages: Locator) {
  return messages.evaluateAll((rows) => {
    const runs: { name: string | null; face: string | null; count: number }[] = []
    for (const row of rows) {
      const name = row.querySelector('[data-testid="buddyThread.sender"]')?.textContent?.trim() ?? null
      const face = row.querySelector('[data-testid="buddyThread.face"]')?.textContent?.trim() ?? null
      // A run starts at the row that carries the name (or the first row: hers carry none).
      if (name !== null || !runs.length) runs.push({ name, face: null, count: 0 })
      const run = runs.at(-1)!
      run.count++
      if (face !== null) run.face = face
    }
    return runs
  })
}

test('a room of three: two other members writing one after the other are two runs, each with its own name and its own face @full', { tag: '@full' }, async ({ page: hanna }) => {
  test.slow()
  const h = await signedIn(hanna)
  const [m, b] = [await signUpMember(), await signUpMember()]
  await named(h, 'Hanna')
  await named(m, 'Mara')
  await named(b, 'Bram')
  await follows(h, m)
  await follows(h, b)
  const made = await startRead(h, { title: 'Three Voices', parts: 2, link: true })
  await joinRead(m, made.linkToken!)
  await joinRead(b, made.linkToken!)
  const post = (who: typeof h, body: string) => buddyOf(who).post({ readId: made.id, sectionId: null, clientId: crypto.randomUUID(), body })
  // Bram twice, Mara twice, Bram once, Mara once: four runs by two people, none of them the viewer's.
  for (const [who, body] of [[b, 'Bram one'], [b, 'Bram two'], [m, 'Mara one'], [m, 'Mara two'], [b, 'Bram three'], [m, 'Mara three']] as const) {
    expect((await post(who, body)).error).toBeNull()
  }

  await goto(hanna, `/together/${made.id}/room`)
  await expect(hanna.getByTestId('buddyThread.bubble')).toHaveCount(6)
  const runs = await runsOf(hanna.getByTestId('buddyThread.message'))
  expect(runs.map((r) => [r.name, r.face, r.count])).toEqual([['Bram', 'B', 2], ['Mara', 'M', 2], ['Bram', 'B', 1], ['Mara', 'M', 1]])
  // What a screen reader hears says the same: the base speaks the author before the rest of a run (the first one has the name drawn).
  await expect(hanna.getByTestId('buddyThread.author')).toHaveText(['Bram:', 'Mara:'])

  // Hers (no name, no face) and Bram's, arriving live, which starts a run of its own: his name and his face. The runs above do not change.
  await hanna.getByTestId('buddyThread.input').fill('Hanna here')
  await hanna.getByTestId('buddyThread.send').click()
  await expect(hanna.getByTestId('buddyThread.bubble').filter({ hasText: 'Hanna here' })).toBeVisible()
  // Stored first, so Bram's is the later message whatever the queue's pace.
  await expect.poll(async () => (await buddyOf(h).messages(made.id, null)).data?.items.some((item) => item.body === 'Hanna here')).toBe(true)
  expect((await post(b, 'Bram four')).error).toBeNull()
  await expect(hanna.getByTestId('buddyThread.bubble').filter({ hasText: 'Bram four' })).toBeVisible()
  const after = await runsOf(hanna.getByTestId('buddyThread.message'))
  // (Hers is a row with no name and no face, so it counts with the run before it.)
  expect(after.slice(0, 4).map((r) => [r.name, r.face])).toEqual(runs.map((r) => [r.name, r.face]))
  expect(after).toHaveLength(5)
  expect(after.at(-1)).toMatchObject({ name: 'Bram', face: 'B' })
})

test('removed while the room or a thread is open: "not available" at once, with no reload, and the way Home @full', { tag: '@full' }, async ({ page: mara }) => {
  test.slow()
  const mm = await signedIn(mara)
  const h = await signUpMember()
  await named(mm, 'Mara')
  await named(h, 'Hanna')
  await follows(h, mm)
  for (const where of ['room', 'thread'] as const) {
    // A read of its own each round: a member who was removed is not let in again by the same link.
    const made = await startRead(h, { title: `Removed Soon ${where}`, parts: 2, link: true })
    await joinRead(mm, made.linkToken!)
    await goto(mara, where === 'room' ? `/together/${made.id}` : `/together/${made.id}/room`)
    await expect(where === 'room' ? mara.getByTestId('together.title') : mara.getByTestId('together.thread.title')).toBeVisible()
    // Hanna removes her; the page hears it live, with no reload. A few seconds are all it takes.
    expect((await buddyOf(h).remove(made.id, mm.id)).error).toBeNull()
    const missing = mara.getByTestId(where === 'room' ? 'together.missing' : 'together.thread.missing')
    await expect(missing).toBeVisible({ timeout: 15_000 })
    await expect(missing).toContainText(en.together.missingTitle)
    await expect(mara.getByTestId(where === 'room' ? 'together.missingHome' : 'together.thread.missingHome')).toBeVisible()
    // Not a skeleton any more.
    await expect(mara.locator('[aria-busy="true"]')).toHaveCount(0)
  }
})

test('entering a thread with the keyboard puts the focus in it; the link page loads on the static server, and does not send a referrer @full', { tag: '@full' }, async ({ page: mara }) => {
  const mm = await signedIn(mara)
  const h = await signUpMember()
  await follows(h, mm)
  const made = await startRead(h, { title: 'Keyboard Way', parts: 2, link: true })
  await joinRead(mm, made.linkToken!)

  await goto(mara, `/together/${made.id}`)
  await expect(mara.getByTestId('together.title')).toBeVisible()
  // The room's own heading has the focus once it is drawn.
  await expect(mara.getByTestId('together.title')).toBeFocused()
  await mara.getByTestId('together.room.row').focus()
  await mara.keyboard.press('Enter')
  await expect(mara).toHaveURL(new RegExp(`/together/${made.id}/room$`))
  await expect(mara.getByTestId('together.thread.title')).toBeFocused()

  // /t/<token> is a page, not a 500: Pages is the reference, and the flows' server reads `_headers` the same way (`! Referrer-Policy`).
  const answer = await mara.goto(`/t/${made.linkToken}`)
  expect(answer?.status()).toBe(200)
  expect(answer?.headers()['referrer-policy']).toBe('no-referrer')
  await expect(mara.getByTestId('buddyLink')).toBeVisible()
  await mara.goto('/')
  expect((await mara.goto('/privacy'))?.headers()['referrer-policy']).not.toBe('no-referrer')
})
