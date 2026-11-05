import { devices, type BrowserContextOptions, type Page } from '@playwright/test'
import { expect, test } from './fixtures'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { buddyOf, follows, joinRead, startRead } from '../tests/support/buddy'
import type { TestMember } from '../tests/support/member'
import { sql } from '../tests/support/stack'
import { longPress, objectInBucket, runVoiceSweep, seedVoice, watchBucket, watchLive } from './buddyVoice'
import { expectAccessible, goto, signedIn, untilStill } from './support'

/**
 * Voice messages in a buddy read (docs/parity.md, "Buddy read, a thread"), in Chromium with a fake microphone (`--use-fake-device-for-media-stream`, no prompt,
 * a generated tone: WebKit cannot fake one). One journey, four members in a browser of their own: Ida (the host) records in a Section's thread and sends it;
 * Ben, who has the thread open, gets it **live**, and nothing of the sound is asked of the bucket until he presses play (then one URL is signed and the sound is
 * fetched); he answers it (the quote says "Voice message" and jumps back on a tap), double-taps it (a ❤️, and again takes it back) and long-presses it (the bar:
 * 🔥); Ida deletes one of Ben's as the host (a tombstone for everybody, the object queued, and gone from the bucket once the sweep has run); Bo, whom Ida blocked,
 * never sees hers and cannot fetch it; Cy, whose marker has not reached the Section, sees it veiled and asks the bucket for nothing until she says "Show anyway",
 * and then for nothing until she plays. Then the microphone refused, no microphone, and a send without a connection that fails and is sent again by a tap. The
 * rules behind each step are pgTAP's (supabase/tests/buddy_voice_test.sql) and Vitest's (tests/buddy-voice*.test.ts); this is the screens joined up.
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

/** The emoji on the messages of a read, as the database holds them. */
const reactionsOn = async (readId: string) =>
  (await sql<{ emoji: string }>(`select r.emoji from public.buddy_reactions r join public.buddy_messages m on m.id = r.message_id where m.buddy_read_id = $1 order by r.created_at`, [readId])).map((r) => r.emoji)

const voices = (page: Page) => page.getByTestId('buddyThread.voice')
const messageWithVoice = (page: Page, nth = 0) => page.getByTestId('buddyThread.message').filter({ has: voices(page) }).nth(nth)

async function name(member: TestMember, text: string) {
  await sql(`update auth.users set raw_user_meta_data = raw_user_meta_data || jsonb_build_object('name', $2::text) where id = $1`, [member.id, text])
}

test('Ida records a voice message in a Section thread; Ben gets it live and plays it (signed on play), answers it, likes it and reacts; the host deletes one; a blocked member and a veiled Section hear nothing @full', { tag: '@full' }, async ({ page: ida, browser }) => {
  // Four members, a recording, a live channel, a sweep and two scans: longer than a usual flow.
  test.setTimeout(240_000)
  const contexts = await Promise.all([browser.newContext(options()), browser.newContext(options()), browser.newContext(options())])
  try {
    const [ben, cy, bo] = await Promise.all(contexts.map((context) => context.newPage()))
    const idaMember = await signedIn(ida)
    const [benMember, cyMember, boMember] = await Promise.all([signedIn(ben!), signedIn(cy!), signedIn(bo!)])
    await Promise.all([name(idaMember, 'Ida'), name(benMember, 'Ben'), name(cyMember, 'Cy'), name(boMember, 'Bo')])

    // The read: Ida hosts three Sections and has read through the first, as have Ben and Bo; Cy has not begun, so Section 1 is veiled for her.
    for (const member of [benMember, cyMember, boMember]) await follows(idaMember, member)
    const made = await startRead(idaMember, { title: 'The Voice Flow', parts: 3, link: true })
    for (const member of [benMember, cyMember, boMember]) await joinRead(member, made.linkToken!)
    for (const member of [idaMember, benMember, boMember]) expect((await buddyOf(member).setHand(made.id, 1)).error).toBeNull()
    const [first] = (await buddyOf(idaMember).read(made.id)).data!.chapters
    const thread = `/together/${made.id}/${first!.id}`
    // Ida blocked Bo: his thread is hers to read no more (she sees nothing of him, he nothing of her).
    expect((await idaMember.client.rpc('block', { p_member: boMember.id })).error).toBeNull()

    // Ben's, Cy's and Bo's pages first: Ben's thread is open when Ida sends, so what comes, comes live; each page tells what it asks of the voice bucket.
    const benAsked = watchBucket(ben!)
    const cyAsked = watchBucket(cy!)
    const boAsked = watchBucket(bo!)
    const benLive = watchLive(ben!)
    await goto(ben!, thread)
    await expect(ben!.getByTestId('buddyThread.screen')).toHaveAttribute('data-status', 'ready')
    await expect.poll(benLive.joined, { timeout: 15_000 }).toBe(true)
    await goto(bo!, thread)
    await expect(bo!.getByTestId('buddyThread.screen')).toHaveAttribute('data-status', 'ready')
    await goto(cy!, thread)
    await expect(cy!.getByTestId('together.thread.veiled')).toBeVisible()

    // What Ida's page sends to the bucket: the sound as a part of the bare type ("audio/webm", never "audio/webm;codecs=opus"), which is what Storage keeps.
    const idaUploads: string[] = []
    ida.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname.includes('/object/buddy-voice/')) idaUploads.push(request.postDataBuffer()?.toString('latin1') ?? '')
    })

    // Ida's thread: the microphone stands where send is while the field is empty; with a word in the field, send again.
    await goto(ida, thread)
    await expect(ida.getByTestId('buddyThread.screen')).toHaveAttribute('data-status', 'ready')
    await expect(ida.getByTestId('buddyThread.record')).toBeVisible()
    await expect(ida.getByTestId('buddyThread.record')).toHaveAccessibleName(en.uiText.chat.voice.record)
    await expect(ida.getByTestId('buddyThread.send')).toHaveCount(0)
    await ida.getByTestId('buddyThread.input').fill('Moment …')
    await expect(ida.getByTestId('buddyThread.send')).toBeVisible()
    await expect(ida.getByTestId('buddyThread.record')).toHaveCount(0)
    await ida.getByTestId('buddyThread.input').fill('')

    // A tap starts: the capsule is the recording bar, the field and the Spoiler chip give way, the timer runs; ✕ throws it away and nothing is stored.
    await ida.getByTestId('buddyThread.record').click()
    await expect(ida.getByTestId('buddyThread.recorder')).toBeVisible()
    await expect(ida.getByTestId('buddyThread.input')).toHaveCount(0)
    await expect(ida.getByTestId('buddyThread.recordingStatus')).toContainText(en.uiText.chat.voice.recording)
    await expect(ida.getByTestId('buddyThread.voiceTimer')).not.toHaveText('0:00', { timeout: 5_000 })
    await ida.getByTestId('buddyThread.voiceCancel').click()
    await expect(ida.getByTestId('buddyThread.recorder')).toHaveCount(0)
    await expect(ida.getByTestId('buddyThread.input')).toBeVisible()
    expect(await sql(`select 1 from public.buddy_messages where buddy_read_id = $1 and kind = 'voice'`, [made.id])).toHaveLength(0)

    // A slip of the finger is no message: said above the thread, nothing stored.
    await ida.getByTestId('buddyThread.record').click()
    await expect(ida.getByTestId('buddyThread.recorder')).toBeVisible()
    await ida.getByTestId('buddyThread.voiceSend').click()
    await expect(ida.getByTestId('buddyThread.mediaError')).toHaveText(en.buddyRead.error.voice_short)
    expect(await sql(`select 1 from public.buddy_messages where buddy_read_id = $1 and kind = 'voice'`, [made.id])).toHaveLength(0)

    // A real one: two seconds and a bit, then send. Her bubble at once, playable from her own copy.
    await ida.getByTestId('buddyThread.record').click()
    await expect(ida.getByTestId('buddyThread.voiceTimer')).toHaveAttribute('data-ms', /^[2-9]\d{3}$/, { timeout: 10_000 })
    await ida.getByTestId('buddyThread.voiceSend').click()
    await expect(ida.getByTestId('buddyThread.recorder')).toHaveCount(0)
    await expect(voices(ida)).toHaveCount(1)
    await expect(ida.getByTestId('buddyThread.voicePlay')).toBeEnabled()

    // For Ben it arrives live, with its length and waveform, and nothing of it has been asked of the bucket.
    await expect(voices(ben!)).toHaveCount(1, { timeout: 20_000 })
    await expect(ben!.getByTestId('buddyThread.voicePlay')).toBeEnabled({ timeout: 10_000 })
    await expect(ben!.getByTestId('buddyThread.voiceTime')).toHaveText(/^0:0[2-8]$/)
    expect(await ben!.getByTestId('buddyThread.voiceWave').locator('span').count()).toBeGreaterThan(5)
    await expect(ben!.getByTestId('buddyThread.announce')).toBeAttached()
    expect(benAsked).toEqual([])
    // Not for Bo (Ida blocked him: he sees nothing of her, no bubble and no request) and not for Cy (the Section is veiled).
    await expect(voices(bo!)).toHaveCount(0)
    await expect(cy!.getByTestId('together.thread.veiled')).toBeVisible()
    expect(boAsked).toEqual([])
    expect(cyAsked).toEqual([])

    // What is stored: a voice message in that Section with a length and a waveform, its object in the private bucket, nothing in the row that is a URL.
    const [row] = await sql<{ id: string; section_id: string; voice_mime: string; voice_duration_ms: number; peaks: number; body: string }>(
      `select id, section_id, voice_mime, voice_duration_ms, cardinality(voice_peaks) as peaks, body from public.buddy_messages where buddy_read_id = $1 and kind = 'voice'`,
      [made.id],
    )
    expect(row).toMatchObject({ section_id: first!.id, body: '' })
    expect(['audio/mp4', 'audio/webm']).toContain(row!.voice_mime)
    expect(row!.voice_duration_ms).toBeGreaterThanOrEqual(2_000)
    expect(row!.voice_duration_ms).toBeLessThan(8_000)
    expect(row!.peaks).toBeGreaterThan(5)
    const path = `${made.id}/${idaMember.id}/`
    expect(await sql(`select 1 from storage.objects where bucket_id = 'buddy-voice' and name like $1 and (metadata ->> 'mimetype') = $2`, [`${path}%`, row!.voice_mime])).toHaveLength(1)
    // One upload, its part typed with the bare type, and not cached by a browser.
    expect(idaUploads).toHaveLength(1)
    expect(idaUploads[0]).toMatch(new RegExp(`content-type: ${row!.voice_mime}\\r\\n`, 'i'))
    expect(idaUploads[0]).not.toMatch(/codecs/i)
    const [stored] = await sql<{ mimetype: string; cache: string }>(`select metadata ->> 'mimetype' as mimetype, metadata ->> 'cacheControl' as cache from storage.objects where bucket_id = 'buddy-voice' and name like $1`, [`${path}%`])
    expect(stored).toEqual({ mimetype: row!.voice_mime, cache: 'max-age=0' })

    // Ben presses play: that is when the URL is signed and the sound is fetched, once; the button turns to pause and the bar moves.
    await ben!.getByTestId('buddyThread.voicePlay').click()
    await expect(voices(ben!)).toHaveAttribute('data-playing', 'true', { timeout: 10_000 })
    expect(benAsked.some((asked) => asked.startsWith('POST ') && asked.includes('/object/sign/buddy-voice/'))).toBe(true)
    await expect.poll(() => benAsked.some((asked) => asked.startsWith('GET ') && asked.includes('/object/sign/buddy-voice/'))).toBe(true)
    await expect(ben!.getByTestId('buddyThread.voiceWave')).not.toHaveAttribute('data-played', '0', { timeout: 5_000 })
    // It plays to its end and is back at the start.
    await expect(voices(ben!)).not.toHaveAttribute('data-playing', 'true', { timeout: 15_000 })
    // Played again: the URL signed a moment ago is used, not another one.
    const signs = () => benAsked.filter((asked) => asked.startsWith('POST ')).length
    const before = signs()
    await ben!.getByTestId('buddyThread.voicePlay').click()
    await expect(voices(ben!)).toHaveAttribute('data-playing', 'true', { timeout: 10_000 })
    expect(signs()).toBe(before)
    // (Two presses inside 300 ms are a double tap: a pause is a tap later.)
    await ben!.waitForTimeout(500)
    await ben!.getByTestId('buddyThread.voicePlay').click()
    await expect(voices(ben!)).not.toHaveAttribute('data-playing', 'true')

    // Two presses on the play button within the window are a double tap: a ❤️, not a sound (and the first one's sound stops).
    await ben!.waitForTimeout(400)
    await ben!.getByTestId('buddyThread.voicePlay').dblclick()
    await expect(messageWithVoice(ben!).getByTestId('buddyThread.reactions')).toHaveAttribute('data-emoji', '❤️', { timeout: 10_000 })
    await expect(voices(ben!)).not.toHaveAttribute('data-playing', 'true')
    // A double tap on the card takes it back (the second like is the first one's undo).
    await expect.poll(() => reactionsOn(made.id), { timeout: 10_000 }).toEqual(['❤️'])
    await ben!.waitForTimeout(400)
    await ben!.getByTestId('buddyThread.voiceWave').dblclick()
    await expect(messageWithVoice(ben!).getByTestId('buddyThread.reactions')).toHaveCount(0)
    await expect.poll(() => reactionsOn(made.id), { timeout: 10_000 }).toEqual([])
    await expect(messageWithVoice(ben!).getByTestId('buddyThread.heartPop')).toHaveCount(0, { timeout: 5_000 })
    await expect(voices(ben!)).not.toHaveAttribute('data-playing', 'true')

    // A long press opens the bar with the six reactions; a pick is hers alone (🔥), and for Ida it arrives live.
    await untilStill(ben!)
    await longPress(ben!, voices(ben!))
    await expect(ben!.getByTestId('buddyThread.reactionBar')).toBeVisible()
    await expect(ben!.getByTestId('buddyThread.reactionPick')).toHaveCount(6)
    await ben!.locator('[data-testid="buddyThread.reactionPick"][data-emoji="🔥"]').click()
    await expect(messageWithVoice(ben!).getByTestId('buddyThread.reactions')).toHaveAttribute('data-emoji', '🔥')
    await expect(messageWithVoice(ida).getByTestId('buddyThread.reactions')).toHaveAttribute('data-emoji', '🔥', { timeout: 10_000 })

    // Ben answers the voice message from the bar's Reply: the composer quotes it as "Voice message", the answer carries the quote, and a tap on it jumps back.
    await untilStill(ben!)
    await longPress(ben!, voices(ben!))
    await ben!.getByTestId('buddyThread.reactionReply').click()
    await expect(ben!.getByTestId('buddyThread.quoteBarPreview')).toHaveText(en.uiText.chat.reply.voice)
    await ben!.getByTestId('buddyThread.input').fill('Lovely, what a voice')
    await ben!.getByTestId('buddyThread.send').click()
    const answer = ben!.getByTestId('buddyThread.message').filter({ hasText: 'Lovely, what a voice' })
    await expect(answer.getByTestId('buddyThread.quotePreview')).toHaveText(en.uiText.chat.reply.voice)
    await expect(answer.getByTestId('buddyThread.quoteName')).toHaveText('Ida')
    await expect(ida.getByTestId('buddyThread.message').filter({ hasText: 'Lovely, what a voice' }).getByTestId('buddyThread.quotePreview')).toHaveText(en.uiText.chat.reply.voice, { timeout: 10_000 })
    await answer.getByTestId('buddyThread.quote').click()
    await expect(messageWithVoice(ben!)).toHaveAttribute('data-highlight', 'true')

    // Ben sends one of his own (a message of a member, the way her phone does it); the host, Ida, deletes it from the bar: a tombstone for both of them.
    const bens = await seedVoice(benMember, made.id, first!.id)
    await expect(voices(ida)).toHaveCount(2, { timeout: 15_000 })
    expect(await objectInBucket(bens.path)).toBe(true)
    await untilStill(ida)
    await longPress(ida, messageWithVoice(ida, 1).getByTestId('buddyThread.voice'))
    await ida.getByTestId('buddyThread.reactionAction.delete').click()
    await expect(ida.getByTestId('together.thread.delete')).toBeVisible()
    await expect(ida.getByTestId('together.thread.delete.text')).toContainText(en.together.thread.deleteTextVoiceHost.slice(0, 40))
    await ida.getByTestId('together.thread.delete.confirm').click()
    await expect(ida.getByTestId('buddyThread.removed')).toHaveText(en.together.thread.removed)
    await expect(ben!.getByTestId('buddyThread.removed')).toHaveText(en.together.thread.removed, { timeout: 10_000 })
    await expect(voices(ben!)).toHaveCount(1)
    // The row keeps nothing of the sound, its object is queued, and once the sweep has run (the Edge Function's work) it is not in the bucket.
    const [gone] = await sql<{ voice_mime: string | null; voice_duration_ms: number | null; deleted: boolean }>(
      `select voice_mime, voice_duration_ms, deleted_at is not null as deleted from public.buddy_messages where id = $1`,
      [bens.id],
    )
    expect(gone).toEqual({ voice_mime: null, voice_duration_ms: null, deleted: true })
    expect(await sql(`select 1 from private.buddy_voice_trash where path = $1`, [bens.path])).toHaveLength(1)
    await runVoiceSweep()
    expect(await objectInBucket(bens.path)).toBe(false)
    expect(await sql(`select 1 from private.buddy_voice_trash where path = $1`, [bens.path])).toHaveLength(0)
    // Hers is still there, and still plays for Ben.
    expect(await objectInBucket(`${path}${(await sql<{ client_id: string }>(`select client_id from public.buddy_messages where id = $1`, [row!.id]))[0]!.client_id}.${row!.voice_mime === 'audio/mp4' ? 'm4a' : 'webm'}`)).toBe(true)

    // A voice message marked Spoiler is a veiled bubble with no play button until Ben taps it: nothing of it is signed or fetched before.
    const spoiled = await seedVoice(idaMember, made.id, first!.id, { spoiler: true })
    await expect(ben!.getByTestId('buddyThread.veil')).toHaveCount(1, { timeout: 15_000 })
    await expect(voices(ben!)).toHaveCount(1)
    const askedBefore = benAsked.length
    await ben!.getByTestId('buddyThread.veil').click()
    await expect(voices(ben!)).toHaveCount(2)
    await expect(ben!.getByTestId('buddyThread.veil')).toHaveCount(0)
    expect(benAsked.length).toBe(askedBefore)
    expect(await objectInBucket(spoiled.path)).toBe(true)

    // Bo, blocked with Ida, saw none of her voice messages and asked the bucket for nothing: Ben's answer is there for him, its quote says only that what it
    // answered is gone (it is hers, which he is not shown: not that it was a voice message) and there is no voice bubble anywhere.
    await expect(voices(bo!)).toHaveCount(0)
    const answerForBo = bo!.getByTestId('buddyThread.message').filter({ hasText: 'Lovely, what a voice' })
    await expect(answerForBo).toHaveCount(1)
    await expect(answerForBo.getByTestId('buddyThread.quotePreview')).toHaveText(en.uiText.chat.reply.deleted)
    expect(boAsked).toEqual([])
    // And cannot fetch it by name either (the bucket's policy, not the page's).
    const hers = (await sql<{ client_id: string }>(`select client_id from public.buddy_messages where id = $1`, [row!.id]))[0]!.client_id
    const ext = row!.voice_mime === 'audio/mp4' ? 'm4a' : 'webm'
    expect((await buddyOf(boMember).voiceUrl(`${made.id}/${idaMember.id}/${hers}.${ext}`)).error).toBeTruthy()

    // Cy, whose marker has not reached Section 1: the quiet screen, nothing asked of the bucket; "Show anyway" opens the thread and shows the voice message,
    // and still nothing is asked until she presses play.
    expect(cyAsked).toEqual([])
    await cy!.getByTestId('together.thread.showAnyway').click()
    await cy!.getByTestId('together.showAnyway.confirm').click()
    await expect(cy!.getByTestId('buddyThread.screen')).toHaveAttribute('data-status', 'ready')
    await expect(voices(cy!)).toHaveCount(1)
    await expect(cy!.getByTestId('buddyThread.voicePlay').first()).toBeEnabled()
    expect(cyAsked).toEqual([])
    await cy!.getByTestId('buddyThread.voicePlay').first().click()
    await expect(voices(cy!)).toHaveAttribute('data-playing', 'true', { timeout: 10_000 })
    expect(cyAsked.some((asked) => asked.includes('/object/sign/buddy-voice/'))).toBe(true)

    // The scan, in the dark room: the thread with its voice bubbles, then a recording in progress.
    await expectAccessible(ben!, 'a buddy read thread with a voice message')
    await ida.getByTestId('buddyThread.record').click()
    await expect(ida.getByTestId('buddyThread.recorder')).toBeVisible()
    await expectAccessible(ida, 'a buddy read thread while recording')
    await ida.getByTestId('buddyThread.voiceCancel').click()
  } finally {
    await Promise.all(contexts.map((context) => context.close()))
  }
})

test('a microphone that is switched off, one that is not there, and a send without a connection are told plainly and nothing is lost', async ({ page: ida }) => {
  const idaMember = await signedIn(ida)
  const made = await startRead(idaMember, { title: 'The Voice Refusals', parts: 2, link: false })
  await goto(ida, `/together/${made.id}/room`)
  await expect(ida.getByTestId('buddyThread.screen')).toHaveAttribute('data-status', 'ready')

  // Switched off for the app: told what to do, nothing starts.
  await ida.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
  })
  await ida.getByTestId('buddyThread.record').click()
  await expect(ida.getByTestId('buddyThread.mediaError')).toHaveText(en.uiText.chat.voice.problems.denied)
  await expect(ida.getByTestId('buddyThread.recorder')).toHaveCount(0)

  // No microphone at all.
  await ida.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('none'), { name: 'NotFoundError' }))
  })
  await ida.getByTestId('buddyThread.record').click()
  await expect(ida.getByTestId('buddyThread.mediaError')).toHaveText(en.uiText.chat.voice.problems.none)
  await expect(ida.getByTestId('buddyThread.recorder')).toHaveCount(0)

  // A fresh page (the microphone works again): record, and send without a connection. The upload fails, the bubble reads failed and waits for a tap.
  await goto(ida, `/together/${made.id}/room`)
  await expect(ida.getByTestId('buddyThread.screen')).toHaveAttribute('data-status', 'ready')
  await ida.getByTestId('buddyThread.record').click()
  await expect(ida.getByTestId('buddyThread.voiceTimer')).toHaveAttribute('data-ms', /^[2-9]\d{3}$/, { timeout: 10_000 })
  await ida.context().setOffline(true)
  await ida.getByTestId('buddyThread.voiceSend').click()
  await expect(voices(ida)).toHaveCount(1)
  await expect(ida.getByTestId('buddyThread.failed')).toHaveText(new RegExp(en.buddyRead.error.offline.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  expect(await sql(`select 1 from public.buddy_messages where buddy_read_id = $1 and kind = 'voice'`, [made.id])).toHaveLength(0)
  // Her own copy still plays while it waits.
  await expect(ida.getByTestId('buddyThread.voicePlay')).toBeEnabled()

  // Back: a tap on "Try again" stores it and posts it, once.
  await ida.context().setOffline(false)
  await ida.getByTestId('buddyThread.retry').click()
  await expect.poll(async () => (await sql(`select 1 from public.buddy_messages where buddy_read_id = $1 and kind = 'voice'`, [made.id])).length, { timeout: 20_000 }).toBe(1)
  await expect(ida.getByTestId('buddyThread.failed')).toHaveCount(0)
  await expect(voices(ida)).toHaveCount(1)

  // And "Delete" gives a failed one up: nothing stays on the screen and nothing is stored.
  await ida.getByTestId('buddyThread.record').click()
  await expect(ida.getByTestId('buddyThread.voiceTimer')).toHaveAttribute('data-ms', /^[2-9]\d{3}$/, { timeout: 10_000 })
  await ida.context().setOffline(true)
  await ida.getByTestId('buddyThread.voiceSend').click()
  await expect(ida.getByTestId('buddyThread.failed')).toBeVisible()
  await ida.getByTestId('buddyThread.discard').click()
  await expect(voices(ida)).toHaveCount(1)
  await ida.context().setOffline(false)
  expect(await sql(`select 1 from public.buddy_messages where buddy_read_id = $1 and kind = 'voice'`, [made.id])).toHaveLength(1)
})
