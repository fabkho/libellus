import { devices, type BrowserContextOptions, type Page } from '@playwright/test'
import { expect, test } from './fixtures'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { befriend, makeChapters, notesOf, sharedBook, shelveBook, writeNote } from '../tests/support/notes'
import { sql } from '../tests/support/stack'
import { NOTE_VOICE_BUCKET } from '../app/data/noteVoice'
import { finger, objectInBucket, runVoiceSweep, watchBucket } from './buddyVoice'
import { expectAccessible, goto, signedIn, untilStill } from './support'

/**
 * Voice notes, for her own private notes (docs/parity.md, *Notes, a chapter*), in Chromium with a fake microphone (`--use-fake-device-for-media-stream`, no prompt, a
 * generated tone: WebKit cannot fake one). Ida records in a chapter of the Notes and Anna, her friend, has the same chapter open: the microphone is there **only at Only me**, on the split send button
 * (at Friends or Everyone it is gone — the button shows Send — and back again); a recording is a private note of her own (a lock, the same words as her other private notes), stored in the private bucket
 * `note-voice`; after a reload nothing of the sound is asked of the bucket until she presses play (then one URL is signed, and the sound is fetched); Anna sees no note,
 * no count and no sound and asks the bucket for nothing; it can't be widened (the sheet shows Only me alone and says why; the database refuses too); deleting it leaves a
 * tombstone, queues the object, and once the sweep has run (the Edge Function's work) it is not in the bucket. Then a hold of the microphone, a send without a
 * connection that fails and is sent again by a tap, and the scan of the thread. The rules behind each step are pgTAP's (supabase/tests/notes_private_voice_test.sql) and
 * Vitest's (tests/notes-voice*.test.ts); this is the screens joined up.
 *
 * Tagged @full (docs/TESTING.md): it runs in the release run and on a pull request with the `full-e2e` label.
 */

test.use({
  browserName: 'chromium',
  colorScheme: 'dark',
  permissions: ['microphone'],
  actionTimeout: 15_000,
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
})

const options = (): BrowserContextOptions => ({
  ...devices['iPhone 15'],
  baseURL: test.info().project.use.baseURL,
  colorScheme: 'dark',
  reducedMotion: 'reduce',
  serviceWorkers: 'block',
  permissions: ['microphone'],
})

/** Opens the split send button's tab and chooses the audience (the tab keeps the field's focus; the menu closes on the choice). */
async function chooseLevel(page: Page, level: 'private' | 'friends' | 'public') {
  await page.getByTestId('notesThread.sendAs').click()
  await page.getByTestId(`notesThread.sendAs.${level}`).click()
  await expect(page.getByTestId('notesThread.sendAsMenu')).toHaveCount(0)
}

/** The audience the note will be sent with, as the button itself says it. */
async function expectLevel(page: Page, level: 'private' | 'friends' | 'public') {
  await expect(page.getByTestId('notesThread.sendAs')).toHaveAttribute('aria-label', `${en.uiText.chat.composer.sendAs}: ${en.notes.level[level]}`)
}

const MIC = 'notesThread.record'
const voices = (page: Page) => page.getByTestId('notesThread.voice')
const voiceRows = (authorId: string) =>
  sql<{ id: string; kind: string; visibility: string; voice_object: string | null; voice_mime: string | null; voice_duration_ms: number | null; deleted_at: string | null }>(
    `select id, kind, visibility, voice_object, voice_mime, voice_duration_ms, deleted_at from public.room_messages where author_id = $1 and (kind = 'voice' or voice_object is not null) order by created_at`,
    [authorId],
  )

async function named(member: { id: string }, name: string) {
  await sql(`update auth.users set raw_user_meta_data = raw_user_meta_data || jsonb_build_object('name', $2::text) where id = $1`, [member.id, name])
}

/** A recording of a bit over two seconds, sent with the panel's send button. */
async function record(page: Page) {
  await page.getByTestId(MIC).click()
  await expect(page.getByTestId('notesThread.recorder')).toBeVisible()
  await expect(page.getByTestId('notesThread.voiceTimer')).toHaveAttribute('data-ms', /^[2-9]\d{3}$/, { timeout: 10_000 })
  await page.getByTestId('notesThread.voiceSend').click()
  await expect(page.getByTestId('notesThread.recorder')).toHaveCount(0)
}

/** Right click (the pointer's long press) on a bubble opens its bar; then one of the app's entries. */
async function bar(page: Page, target: ReturnType<Page['locator']>, action: 'visibility' | 'delete') {
  await untilStill(page)
  await target.click({ button: 'right' })
  await expect(page.getByTestId('notesThread.reactionBar')).toBeVisible()
  await page.getByTestId(`notesThread.reactionAction.${action}`).click()
}

test('Ida records a private voice note: the microphone is there only at Only me; it plays after a reload, signed on play; her friend sees nothing; it can’t be widened; deleting removes the object @full', { tag: '@full' }, async ({ page: ida, browser }) => {
  test.setTimeout(240_000)
  const context = await browser.newContext(options())
  try {
    const anna = await context.newPage()
    const idaMember = await signedIn(ida)
    const annaMember = await signedIn(anna)
    await Promise.all([named(idaMember, 'Ida'), named(annaMember, 'Anna')])
    await befriend(idaMember, annaMember)
    const snapshot = sharedBook('The Voice Notes Flow')
    const bookId = await shelveBook(idaMember, snapshot, 'reading')
    await shelveBook(annaMember, snapshot, 'reading')
    const room = await makeChapters(idaMember, bookId, 5)
    const first = room.chapters.find((c) => c.position === 1)!
    const thread = `/notes/${bookId}/1`
    // Something of Ida's that Anna may see, so a thread with a note in it is told from an empty one.
    await writeNote(idaMember, room, first.id, 'A note for friends, in words', 'friends')

    const annaAsked = watchBucket(anna, NOTE_VOICE_BUCKET)
    await goto(anna, thread)
    await expect(anna.getByTestId('notesThread.screen')).toHaveAttribute('data-status', 'ready')
    await expect(anna.getByTestId('notesThread.bubble').filter({ hasText: 'A note for friends, in words' })).toBeVisible()

    // Ida: at Friends (the device's start) there is no microphone; at Only me there is; at Friends again it is gone.
    const idaAsked = watchBucket(ida, NOTE_VOICE_BUCKET)
    await goto(ida, thread)
    await expect(ida.getByTestId('notesThread.screen')).toHaveAttribute('data-status', 'ready')
    await expectLevel(ida, 'friends')
    await expect(ida.getByTestId(MIC)).toHaveCount(0)
    await chooseLevel(ida, 'private')
    await expectLevel(ida, 'private')
    await expect(ida.getByTestId(MIC)).toBeVisible()
    await expect(ida.getByTestId(MIC)).toHaveAccessibleName(en.uiText.chat.voice.record)
    // (Everyone is not on offer in this flow: the owner's switch is off here. book-notes.spec.ts asserts that Everyone has no microphone either.)
    await chooseLevel(ida, 'friends')
    await expect(ida.getByTestId(MIC)).toHaveCount(0)
    await chooseLevel(ida, 'private')
    await expect(ida.getByTestId(MIC)).toBeVisible()

    // A tap starts the recording: the button's tab is away while it runs (the audience cannot change under it); ✕ throws it away and nothing is stored.
    await ida.getByTestId(MIC).click()
    await expect(ida.getByTestId('notesThread.recorder')).toBeVisible()
    await expect(ida.getByTestId('notesThread.sendAs')).toHaveCount(0)
    await expect(ida.getByTestId('notesThread.voiceTimer')).not.toHaveText('0:00', { timeout: 5_000 })
    await ida.getByTestId('notesThread.voiceCancel').click()
    await expect(ida.getByTestId('notesThread.recorder')).toHaveCount(0)
    expect(await voiceRows(idaMember.id)).toHaveLength(0)
    // A slip of the finger is no note: said above the thread, nothing stored.
    await ida.getByTestId(MIC).click()
    await expect(ida.getByTestId('notesThread.recorder')).toBeVisible()
    await ida.getByTestId('notesThread.voiceSend').click()
    await expect(ida.getByTestId('notesThread.mediaError')).toHaveText(en.notes.error.voice_short)
    expect(await voiceRows(idaMember.id)).toHaveLength(0)

    // A real one. Her bubble at once, playable from her own copy, with the lock of her private notes.
    await record(ida)
    await expect(voices(ida)).toHaveCount(1)
    await expect(ida.getByTestId('notesThread.voicePlay')).toBeEnabled()
    await expect(ida.getByTestId('notesThread.private')).toHaveText(en.notes.level.private)
    await expect(ida.getByTestId('notesThread.voiceTime')).toHaveText(/^0:0[2-8]$/)
    await expect.poll(async () => (await voiceRows(idaMember.id)).length, { timeout: 20_000 }).toBe(1)
    const [stored] = await voiceRows(idaMember.id)
    // What the browser records in: audio/mp4 (Chrome 126+) or audio/webm; the object is named after her, the room and the send.
    expect(stored).toMatchObject({ kind: 'voice', visibility: 'private', deleted_at: null })
    expect(['audio/mp4', 'audio/webm']).toContain(stored!.voice_mime)
    expect(stored!.voice_object).toMatch(new RegExp(`^${idaMember.id}/${room.id}/[0-9a-f-]{36}\\.(m4a|webm)$`))
    expect(stored!.voice_duration_ms).toBeGreaterThan(1_900)
    expect(await objectInBucket(stored!.voice_object!, NOTE_VOICE_BUCKET)).toBe(true)
    // The audience is back to what it was: the recording did not change it, and the note it made is Only me.
    await expectLevel(ida, 'private')

    // After a reload nothing of the sound is asked of the bucket: the thread shows the bubble, its length and waveform, and the play button is on.
    const reloaded = watchBucket(ida, NOTE_VOICE_BUCKET)
    await goto(ida, thread)
    await expect(ida.getByTestId('notesThread.screen')).toHaveAttribute('data-status', 'ready')
    await expect(voices(ida)).toHaveCount(1)
    await expect(ida.getByTestId('notesThread.private')).toHaveText(en.notes.level.private)
    await expect(ida.getByTestId('notesThread.voicePlay')).toBeEnabled()
    await expect(ida.getByTestId('notesThread.voiceTime')).toHaveText(/^0:0[2-8]$/)
    expect(await ida.getByTestId('notesThread.voiceWave').locator('span').count()).toBeGreaterThan(5)
    await ida.waitForTimeout(1_000)
    expect(reloaded).toEqual([])
    // Her press asks for a URL of five minutes, once, and the sound plays.
    await ida.getByTestId('notesThread.voicePlay').click()
    await expect(voices(ida)).toHaveAttribute('data-playing', 'true', { timeout: 10_000 })
    expect(reloaded.filter((asked) => asked.startsWith('POST') && asked.includes('/object/sign/note-voice/'))).toHaveLength(1)
    expect(reloaded.some((asked) => asked.startsWith('GET') && asked.includes('/object/sign/note-voice/'))).toBe(true)
    await ida.getByTestId('notesThread.voicePlay').click()
    await expect(voices(ida)).not.toHaveAttribute('data-playing', 'true')

    // Anna: no voice note, no new note at all, no count of it, and nothing asked of the voice bucket; she cannot sign a URL for it either (the bucket's policy).
    await annaMember.client.auth.getSession()
    await anna.getByTestId('notes.thread.refresh').click()
    await anna.waitForTimeout(1_000)
    await expect(voices(anna)).toHaveCount(0)
    await expect(anna.getByTestId('notesThread.bubble')).toHaveCount(1)
    await expect(anna.getByTestId('notesThread.private')).toHaveCount(0)
    const annaPage = (await notesOf(annaMember).page(bookId)).data!.room!.chapters.find((c) => c.id === first.id)!
    expect(annaPage.count).toBe(1)
    expect((await notesOf(annaMember).voiceUrl(stored!.voice_object!)).error).toBeTruthy()
    expect((await notesOf(annaMember).setVisibility(stored!.id, 'friends')).error).toBe('not_found')
    await goto(anna, `/notes/${bookId}`)
    await expect(anna.getByTestId('notes.chapter.row').first()).toBeVisible()
    expect(annaAsked).toEqual([])

    // Widening: the sheet shows Only me alone and says why; the database refuses all the same.
    await goto(ida, thread)
    await expect(voices(ida)).toHaveCount(1)
    await bar(ida, voices(ida).first(), 'visibility')
    await expect(ida.getByTestId('notes.visibilitySheet')).toBeVisible()
    await expect(ida.getByTestId('notes.visibilitySheet.private')).toHaveAttribute('aria-checked', 'true')
    await expect(ida.getByTestId('notes.visibilitySheet.friends')).toHaveCount(0)
    await expect(ida.getByTestId('notes.visibilitySheet.public')).toHaveCount(0)
    await expect(ida.getByTestId('notes.visibilitySheet.voiceOnly')).toHaveText(en.notes.visibilitySheet.voiceOnly)
    await ida.getByTestId('notes.visibilitySheet.action').click()
    await expect(ida.getByTestId('notes.visibilitySheet')).toBeHidden()
    expect((await notesOf(idaMember).setVisibility(stored!.id, 'friends')).error).toBe('voice_private_only')
    expect((await voiceRows(idaMember.id))[0]!.visibility).toBe('private')

    // The scan: the thread with her voice note, then a recording in progress.
    await expectAccessible(ida, 'a chapter of the Notes with a private voice note')
    await ida.getByTestId(MIC).click()
    await expect(ida.getByTestId('notesThread.recorder')).toBeVisible()
    await expectAccessible(ida, 'a chapter of the Notes while recording')
    await ida.getByTestId('notesThread.voiceCancel').click()

    // Delete: a tombstone, the row keeps nothing of the sound, the object is queued and, once the sweep has run, gone from the bucket.
    await bar(ida, voices(ida).first(), 'delete')
    await expect(ida.getByTestId('notes.thread.delete')).toBeVisible()
    await ida.getByTestId('notes.thread.delete.confirm').click()
    await expect(ida.getByTestId('notesThread.removed')).toHaveText(en.notes.thread.removed)
    await expect(voices(ida)).toHaveCount(0)
    const [gone] = await voiceRows(idaMember.id)
    expect(gone).toMatchObject({ voice_object: null, voice_mime: null, voice_duration_ms: null })
    expect(gone!.deleted_at).not.toBeNull()
    expect(await sql(`select 1 from private.buddy_voice_trash where bucket = 'note-voice' and path = $1`, [stored!.voice_object])).toHaveLength(1)
    expect(await objectInBucket(stored!.voice_object!, NOTE_VOICE_BUCKET)).toBe(true)
    await runVoiceSweep()
    expect(await objectInBucket(stored!.voice_object!, NOTE_VOICE_BUCKET)).toBe(false)
    expect(await sql(`select 1 from private.buddy_voice_trash where bucket = 'note-voice' and path = $1`, [stored!.voice_object])).toHaveLength(0)
    expect(idaAsked.length).toBeGreaterThan(0)
  } finally {
    await context.close()
  }
})

test('hold the microphone to record: let go sends one private voice note, slide left throws it away; and it is not offered at Friends, with an answer, or to a note that is not hers @full', { tag: '@full' }, async ({ page: ida }) => {
  test.setTimeout(120_000)
  const idaMember = await signedIn(ida)
  const bookId = await shelveBook(idaMember, sharedBook('The Voice Hold Flow'), 'reading')
  const room = await makeChapters(idaMember, bookId, 3)
  const first = room.chapters.find((c) => c.position === 1)!
  const mine = await writeNote(idaMember, room, first.id, 'A private thought of mine', 'private')
  await writeNote(idaMember, room, first.id, 'A friends note of mine', 'friends')
  await goto(ida, `/notes/${bookId}/1`)
  await expect(ida.getByTestId('notesThread.screen')).toHaveAttribute('data-status', 'ready')
  await chooseLevel(ida, 'private')
  const mic = ida.getByTestId(MIC)
  await expect(mic).toBeVisible()
  await expect(mic).toHaveAccessibleDescription(en.uiText.chat.voice.recordHint)
  expect(await mic.evaluate((el) => ({ touch: getComputedStyle(el).touchAction, select: getComputedStyle(el).userSelect }))).toEqual({ touch: 'none', select: 'none' })

  // SLIDE LEFT and let go: thrown away, nothing stored.
  let f = await finger(ida, MIC)
  await f.down()
  await expect(ida.getByTestId('notesThread.recorder')).toHaveAttribute('data-hold', 'true')
  await expect(ida.getByTestId('notesThread.holdHint')).toHaveText(en.uiText.chat.voice.slideToCancel)
  await ida.waitForTimeout(900)
  await f.move(-45, -3)
  await f.move(-120, -5)
  await f.up(-120, -5)
  await expect(ida.getByTestId('notesThread.recorder')).toHaveCount(0)
  await ida.waitForTimeout(1_000)
  expect(await voiceRows(idaMember.id)).toHaveLength(0)

  // HOLD and LET GO: one private voice note.
  f = await finger(ida, MIC)
  await f.down()
  await expect(ida.getByTestId('notesThread.recorder')).toHaveAttribute('data-hold', 'true')
  await expect(ida.getByTestId('notesThread.voiceTimer')).toHaveAttribute('data-ms', /^[2-9]\d{3}$/, { timeout: 10_000 })
  await f.up()
  await expect.poll(async () => (await voiceRows(idaMember.id)).length, { timeout: 20_000 }).toBe(1)
  expect((await voiceRows(idaMember.id))[0]).toMatchObject({ visibility: 'private', kind: 'voice' })
  await expect(voices(ida)).toHaveCount(1)

  // An answer to her own private note may be spoken; to her friends note, the microphone is not offered (the database takes a voice answer to her own private note only).
  await untilStill(ida)
  await ida.getByTestId('notesThread.bubble').filter({ hasText: 'A private thought of mine' }).click({ button: 'right' })
  await ida.getByTestId('notesThread.reactionReply').click()
  await expect(ida.getByTestId(MIC)).toBeVisible()
  await ida.getByTestId('notesThread.quoteCancel').click()
  await untilStill(ida)
  await ida.getByTestId('notesThread.bubble').filter({ hasText: 'A friends note of mine' }).click({ button: 'right' })
  await ida.getByTestId('notesThread.reactionReply').click()
  await expect(ida.getByTestId(MIC)).toHaveCount(0)
  await ida.getByTestId('notesThread.quoteCancel').click()
  await expect(ida.getByTestId(MIC)).toBeVisible()
  expect(mine.id).toBeTruthy()
})

test('a send without a connection is told plainly, waits for a tap and is stored once; Delete gives it up @full', { tag: '@full' }, async ({ page: ida }) => {
  test.setTimeout(120_000)
  const idaMember = await signedIn(ida)
  const bookId = await shelveBook(idaMember, sharedBook('The Voice Offline Flow'), 'reading')
  await makeChapters(idaMember, bookId, 3)
  await goto(ida, `/notes/${bookId}/1`)
  await expect(ida.getByTestId('notesThread.screen')).toHaveAttribute('data-status', 'ready')
  await chooseLevel(ida, 'private')

  await ida.getByTestId(MIC).click()
  await expect(ida.getByTestId('notesThread.voiceTimer')).toHaveAttribute('data-ms', /^[2-9]\d{3}$/, { timeout: 10_000 })
  await ida.context().setOffline(true)
  await ida.getByTestId('notesThread.voiceSend').click()
  await expect(voices(ida)).toHaveCount(1)
  await expect(ida.getByTestId('notesThread.failed')).toContainText(en.notes.error.offline)
  expect(await voiceRows(idaMember.id)).toHaveLength(0)
  // Her own copy still plays while it waits.
  await expect(ida.getByTestId('notesThread.voicePlay')).toBeEnabled()
  // Back: a tap on "Try again" stores it and posts it, once.
  await ida.context().setOffline(false)
  await ida.getByTestId('notesThread.retry').click()
  await expect.poll(async () => (await voiceRows(idaMember.id)).length, { timeout: 20_000 }).toBe(1)
  await expect(ida.getByTestId('notesThread.failed')).toHaveCount(0)
  await expect(voices(ida)).toHaveCount(1)

  // "Delete" gives a failed one up: nothing stays on the screen and nothing is stored.
  await ida.getByTestId(MIC).click()
  await expect(ida.getByTestId('notesThread.voiceTimer')).toHaveAttribute('data-ms', /^[2-9]\d{3}$/, { timeout: 10_000 })
  await ida.context().setOffline(true)
  await ida.getByTestId('notesThread.voiceSend').click()
  await expect(ida.getByTestId('notesThread.failed')).toBeVisible()
  await ida.getByTestId('notesThread.discard').click()
  await expect(voices(ida)).toHaveCount(1)
  await ida.context().setOffline(false)
  expect(await voiceRows(idaMember.id)).toHaveLength(1)
})
