import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { expect, type BrowserContextOptions, type ElementHandle, type Page } from '@playwright/test'
import { follows, joinRead, startRead } from '../tests/support/buddy'
import { signedIn } from './support'
import { VOICE_BUCKET } from '../app/data/buddyVoice'
import { buddyOf } from '../tests/support/buddy'
import type { TestMember } from '../tests/support/member'
import { serviceRoleKey, sql, stack } from '../tests/support/stack'
import { itemsOf, removeFromBuckets, sweep } from '../../supabase/functions/buddy-voice-sweep/sweep'

/**
 * Voice messages in the flows (e2e/buddy-voice.spec.ts, e2e/buddy-gestures.spec.ts): a two-second tone as the phones record it (AAC in mp4, opus in webm:
 * tests/fixtures/voice.m4a and voice.webm, made once with ffmpeg), a message sent the way her phone does it (stored, then posted), the sweep the Edge Function
 * runs (its own pure module against the real service role) and what a page asked the bucket for.
 */
export const VOICE_M4A = readFileSync(new URL('../tests/fixtures/voice.m4a', import.meta.url))
export const VOICE_WEBM = readFileSync(new URL('../tests/fixtures/voice.webm', import.meta.url))

/** The waveform the seeded message carries (a small hill). */
export const SEEDED_PEAKS = [10, 24, 40, 62, 90, 100, 88, 70, 55, 40, 30, 22, 16, 12, 9, 8]

/** `sender` sends a voice message into a Section's thread (the room's when `sectionId` is null) the way her phone does: stores the recording and posts it. */
export async function seedVoice(
  sender: TestMember,
  readId: string,
  sectionId: string | null,
  { type = 'audio/webm', replyTo = null }: { type?: 'audio/mp4' | 'audio/webm'; replyTo?: string | null } = {},
): Promise<{ id: string; path: string; clientId: string }> {
  const repo = buddyOf(sender)
  const clientId = crypto.randomUUID()
  const bytes = type === 'audio/mp4' ? VOICE_M4A : VOICE_WEBM
  const stored = await repo.uploadVoice(readId, sender.id, clientId, new Blob([new Uint8Array(bytes)], { type }), type)
  if (stored.error) throw new Error(`Seeding a recording failed: ${stored.error}`)
  const sent = await repo.sendVoice({ readId, sectionId, clientId, media: { mime: type, durationMs: 2_000, peaks: SEEDED_PEAKS }, replyTo })
  if (sent.error) throw new Error(`Seeding a voice message failed: ${sent.error}`)
  return { id: sent.data.id, path: stored.data, clientId }
}

/** The service role's sweep, as the Edge Function runs it (both voice buckets: a buddy read's and the private voice notes of Notes). */
export async function runVoiceSweep() {
  const service = createClient(stack.url, serviceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } })
  return sweep({
    batch: async (limit) => itemsOf((await service.rpc('voice_sweep_batch', { p_limit: limit })).data),
    remove: (items) => removeFromBuckets(items, async (bucket, paths) => await service.storage.from(bucket).remove(paths)),
    done: async (items) => void (await service.rpc('voice_sweep_done', { p_items: items })),
  })
}

/** Whether the object is in the bucket (past RLS). */
export async function objectInBucket(path: string, bucket: string = VOICE_BUCKET): Promise<boolean> {
  const [row] = await sql<{ n: string }>(`select count(*) as n from storage.objects where bucket_id = $1 and name = $2`, [bucket, path])
  return Number(row!.n) > 0
}

/**
 * What a page asks of the voice bucket from now on, as `<METHOD> <path>`: signing a URL and fetching the sound. A thread that only loads must show an empty list
 * (the sound is fetched when a member presses play, never before).
 */
export function watchBucket(page: Page, bucket: string = VOICE_BUCKET): string[] {
  const asked: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.includes(`/${bucket}/`) || url.pathname.endsWith(`/${bucket}`)) asked.push(`${request.method()} ${url.pathname}`)
  })
  return asked
}

/** A finger held on `target` long enough for the reaction bar (450 ms), as a touch: the pointer events of a touch pointer. */
export async function longPress(page: Page, target: ReturnType<Page['locator']>, hold = 650) {
  // A finger leaves nothing behind it. The desktop pointer of the test does: where it picked a reaction it hovers over the bubble the bar was on, and the
  // `pointerleave` the browser sends once the bar is gone would end the press (UiBubble) mid-hold. Out of the way first, and the events delivered.
  await page.mouse.move(1, 1)
  await page.waitForTimeout(150)
  const box = (await target.boundingBox())!
  const point = { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, pointerType: 'touch', pointerId: 7, isPrimary: true, button: 0, buttons: 1, bubbles: true }
  await target.dispatchEvent('pointerdown', point)
  await page.waitForTimeout(hold)
  await target.dispatchEvent('pointerup', { ...point, buttons: 0 })
}

/**
 * Whether the page's private channel (`realtime:member:<id>`) has joined: what is sent before that reaches the page only by the store's own read (a
 * resync every 25 s), so a flow that waits for a live arrival waits for this first. Call it before the page opens.
 */
export function watchLive(page: Page): { joined: () => boolean } {
  let joined = false
  page.on('websocket', (socket) => {
    socket.on('framereceived', ({ payload }) => {
      const text = typeof payload === 'string' ? payload : payload.toString()
      if (text.includes('phx_reply') && text.includes('realtime:member:') && text.includes('"status":"ok"')) joined = true
    })
  })
  return { joined: () => joined }
}

// ------------------------------------------------------------------ hold to record (e2e/buddy-voice-hold*.spec.ts)

export const MIC = 'buddyThread.record'

export type Finger = { down(): Promise<void>; move(dx: number, dy: number): Promise<void>; up(dx?: number, dy?: number): Promise<void> }

/** One finger on the microphone: the pointer events of a touch pointer on its own element, which they keep after the panel has taken the button's place. */
export async function finger(page: Page, mic: string = MIC): Promise<Finger> {
  const button = (await page.getByTestId(mic).elementHandle()) as ElementHandle<HTMLElement>
  const box = (await page.getByTestId(mic).boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  const fire = (type: 'pointerdown' | 'pointermove' | 'pointerup', dx: number, dy: number) =>
    button.evaluate(
      (el, [kind, px, py]) =>
        void el.dispatchEvent(new PointerEvent(kind as string, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: px as number, clientY: py as number, button: 0 })),
      [type, x + dx, y + dy] as const,
    )
  return {
    down: () => fire('pointerdown', 0, 0),
    move: (dx, dy) => fire('pointermove', dx, dy),
    // What a browser does after a touch: the pointer goes up, then the click.
    up: async (dx = 0, dy = 0) => {
      await fire('pointerup', dx, dy)
      await button.evaluate((el) => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })))
    },
  }
}

export const rows = (readId: string) => sql<{ id: string; ms: number }>(`select id, voice_duration_ms as ms from public.buddy_messages where buddy_read_id = $1 and kind = 'voice'`, [readId])

export async function pair(page: Page, browser: import('@playwright/test').Browser, options: BrowserContextOptions) {
  const context = await browser.newContext(options)
  const ben = await context.newPage()
  const ida = await signedIn(page)
  const benMember: TestMember = await signedIn(ben)
  await Promise.all([ida, benMember].map((m, i) => sql(`update auth.users set raw_user_meta_data = raw_user_meta_data || jsonb_build_object('name', $2::text) where id = $1`, [m.id, i ? 'Ben' : 'Ida'])))
  await follows(ida, benMember)
  const made = await startRead(ida, { title: 'The Hold Flow', parts: 2, link: true })
  await joinRead(benMember, made.linkToken!)
  expect((await buddyOf(ida).read(made.id)).error).toBeNull()
  return { context, ben, ida, made, room: `/together/${made.id}/room` }
}

