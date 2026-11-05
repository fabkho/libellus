import { devices, type BrowserContextOptions, type Page } from '@playwright/test'
import { expect, test } from './fixtures'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { finger, MIC, pair, rows, watchBucket, watchLive } from './buddyVoice'
import { goto } from './support'

/**
 * Hold to record, as the base's composer has it since @fabkho/ui 0.11 (docs/parity.md, "Buddy read, a thread"): HOLD the microphone and the recording starts, LET GO and it is sent;
 * slide UP (70 px) and it is LOCKED (it goes on without the finger, and waits for Send); slide LEFT (90 px) and let go and it is thrown away; a tap (under 300 ms) is
 * the tap-to-record panel it always was; a hold under 700 ms is too short and thrown away; Enter on the microphone records hands-free. The send is the one path of
 * a text and a tap-recorded message (upload, then the queue): every flow here counts the rows and the requests to the voice bucket.
 *
 * The finger is `PointerEvent`s of a touch pointer (id 7, as the base's own stories drive it: a mouse pointer id has no capture in Chromium), dispatched on the microphone
 * the way the browser delivers them, followed by the `click` a browser sends after a touch (the component swallows it). Chromium has the fake microphone
 * (`--use-fake-device-for-media-stream`); WebKit cannot fake one, and on the Linux runner it has no `MediaRecorder` at all, so the base does not draw the microphone there: this gesture is Chromium's.
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

test('hold and let go sends one message, live for the other; slide up locks and waits for Send; slide left cancels with nothing stored or sent; a tap is the panel; too short is thrown away @full', { tag: '@full' }, async ({ page: ida, browser }) => {
  test.setTimeout(240_000)
  const { context, ben, made, room } = await pair(ida, browser, {
    ...devices['iPhone 15'],
    baseURL: test.info().project.use.baseURL,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    permissions: ['microphone'],
  })
  try {
    const benLive = watchLive(ben)
    await goto(ben, room)
    await expect(ben.getByTestId('buddyThread.screen')).toHaveAttribute('data-status', 'ready')
    await expect.poll(benLive.joined, { timeout: 15_000 }).toBe(true)
    await goto(ida, room)
    await expect(ida.getByTestId('buddyThread.screen')).toHaveAttribute('data-status', 'ready')
    const asked = watchBucket(ida)
    const voices = (page: Page) => page.getByTestId('buddyThread.voice')
    const announce = ida.getByTestId('buddyThread.voiceAnnounce')

    // The microphone says what it does, and the styles that keep the touch for the gesture are on it: no scrolling, selection or callout, and no context menu.
    const mic = ida.getByTestId(MIC)
    await expect(mic).toHaveAccessibleName(en.uiText.chat.voice.record)
    await expect(mic).toHaveAccessibleDescription(en.uiText.chat.voice.recordHint)
    expect(en.uiText.chat.voice.recordHint).toContain('slide left to cancel')
    expect(await mic.evaluate((el) => ({ touch: getComputedStyle(el).touchAction, select: getComputedStyle(el).userSelect }))).toEqual({ touch: 'none', select: 'none' })
    expect(await mic.evaluate((el) => !el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))).toBe(true)

    // SLIDE LEFT and let go: thrown away. The panel never shows, nothing is stored, nothing is asked of the voice bucket, no message.
    let f = await finger(ida)
    await f.down()
    await expect(ida.getByTestId('buddyThread.recorder')).toHaveAttribute('data-hold', 'true')
    await expect(ida.getByTestId('buddyThread.holdDot')).toBeVisible()
    await expect(ida.getByTestId('buddyThread.holdHint')).toHaveText(en.uiText.chat.voice.slideToCancel)
    await expect(ida.getByTestId('buddyThread.holdLock')).toBeVisible()
    await expect(ida.getByTestId('buddyThread.voiceTimer')).not.toHaveText('0:00', { timeout: 5_000 })
    await ida.waitForTimeout(900)
    await f.move(-45, -3)
    await f.move(-120, -5)
    await f.up(-120, -5)
    await expect(ida.getByTestId('buddyThread.recorder')).toHaveCount(0)
    await expect(announce).toHaveText(en.uiText.chat.voice.discarded)
    await ida.waitForTimeout(1500)
    expect(await rows(made.id)).toHaveLength(0)
    expect(asked).toEqual([])
    expect(await ida.getByTestId('buddyThread.message').count()).toBe(0)
    await expect(ida.getByTestId('buddyThread.quoteBar')).toHaveCount(0)

    // A hold under 700 ms is too short: thrown away and told, nothing sent.
    f = await finger(ida)
    await f.down()
    await expect(ida.getByTestId('buddyThread.recorder')).toHaveAttribute('data-hold', 'true')
    await ida.waitForTimeout(450)
    await f.up()
    await expect(ida.getByTestId('buddyThread.recorder')).toHaveCount(0)
    await expect(announce).toHaveText(en.uiText.chat.voice.tooShort)
    await ida.waitForTimeout(1000)
    expect(await rows(made.id)).toHaveLength(0)
    expect(asked).toEqual([])

    // A short TAP (under 300 ms) is the panel as it always was: ✕, the bars, the timer, Send; nothing sent until Send, and ✕ throws it away.
    f = await finger(ida)
    await f.down()
    await ida.waitForTimeout(80)
    await f.up()
    await expect(ida.getByTestId('buddyThread.recorder')).toBeVisible()
    await expect(ida.getByTestId('buddyThread.recorder')).not.toHaveAttribute('data-hold', 'true')
    await expect(ida.getByTestId('buddyThread.voiceCancel')).toBeVisible()
    await expect(ida.getByTestId('buddyThread.voiceSend')).toBeVisible()
    await expect(ida.getByTestId('buddyThread.voiceTimer')).not.toHaveText('0:00', { timeout: 5_000 })
    await ida.waitForTimeout(1200)
    expect(await rows(made.id)).toHaveLength(0)
    await ida.getByTestId('buddyThread.voiceCancel').click()
    await expect(ida.getByTestId('buddyThread.recorder')).toHaveCount(0)
    expect(await rows(made.id)).toHaveLength(0)
    expect(asked).toEqual([])

    // Enter on the microphone records hands-free, as a tap does.
    await ida.getByTestId(MIC).focus()
    await ida.keyboard.press('Enter')
    await expect(ida.getByTestId('buddyThread.recorder')).toBeVisible()
    await expect(ida.getByTestId('buddyThread.recorder')).not.toHaveAttribute('data-hold', 'true')
    await ida.getByTestId('buddyThread.voiceCancel').click()
    await expect(ida.getByTestId('buddyThread.recorder')).toHaveCount(0)

    // HOLD for a second and a bit and LET GO: it is sent, once. The swallowed click after the touch sends nothing more.
    f = await finger(ida)
    await f.down()
    await expect(ida.getByTestId('buddyThread.recorder')).toHaveAttribute('data-hold', 'true')
    await expect(ida.getByTestId('buddyThread.voiceTimer')).toHaveAttribute('data-ms', /^[1-9]\d{3}$/, { timeout: 10_000 })
    await ida.waitForTimeout(1200)
    await f.up()
    await expect(ida.getByTestId('buddyThread.recorder')).toHaveCount(0)
    await expect(voices(ida)).toHaveCount(1)
    // The other member has it live, with a length and a waveform: the same message a tap-recorded one is.
    await expect(voices(ben)).toHaveCount(1, { timeout: 20_000 })
    await expect(ben.getByTestId('buddyThread.voicePlay')).toBeEnabled({ timeout: 10_000 })
    await ida.waitForTimeout(2000)
    const [sent] = await rows(made.id)
    expect(await rows(made.id)).toHaveLength(1)
    expect(sent!.ms).toBeGreaterThanOrEqual(1_500)
    expect(sent!.ms).toBeLessThan(9_000)
    await expect(voices(ida)).toHaveCount(1)
    expect(asked.filter((a) => a.startsWith('POST '))).toHaveLength(1)

    // SLIDE UP: locked. The finger lets go and the recording goes on, the panel (✕, Send) has taken the place, nothing is sent until Send; then it is, once.
    f = await finger(ida)
    await f.down()
    await expect(ida.getByTestId('buddyThread.recorder')).toHaveAttribute('data-hold', 'true')
    await expect(ida.getByTestId('buddyThread.voiceTimer')).not.toHaveText('0:00', { timeout: 5_000 })
    await ida.waitForTimeout(700)
    await f.move(-2, -35)
    await f.move(-3, -80)
    await f.up(-3, -80)
    await expect(announce).toHaveText(en.uiText.chat.voice.locked)
    await expect(ida.getByTestId('buddyThread.recorder')).toBeVisible()
    await expect(ida.getByTestId('buddyThread.recorder')).not.toHaveAttribute('data-hold', 'true')
    await expect(ida.getByTestId('buddyThread.voiceSend')).toBeVisible()
    await expect(ida.getByTestId('buddyThread.voiceCancel')).toBeVisible()
    const at = Number(await ida.getByTestId('buddyThread.voiceTimer').getAttribute('data-ms'))
    await ida.waitForTimeout(1500)
    expect(Number(await ida.getByTestId('buddyThread.voiceTimer').getAttribute('data-ms'))).toBeGreaterThan(at + 800)
    await ida.waitForTimeout(500)
    expect(await rows(made.id)).toHaveLength(1)
    expect(await ida.getByTestId('buddyThread.message').count()).toBe(1)
    await expect(ida.getByTestId('buddyThread.quoteBar')).toHaveCount(0)
    await ida.getByTestId('buddyThread.voiceSend').click()
    await expect(ida.getByTestId('buddyThread.recorder')).toHaveCount(0)
    await expect(voices(ida)).toHaveCount(2)
    await expect(voices(ben)).toHaveCount(2, { timeout: 20_000 })
    await ida.waitForTimeout(1500)
    const stored = await rows(made.id)
    expect(stored).toHaveLength(2)
    expect(stored.map((r) => r.ms).sort((a, b) => a - b)[1]).toBeGreaterThanOrEqual(3_000)
    expect(asked.filter((a) => a.startsWith('POST '))).toHaveLength(2)
  } finally {
    await context.close()
  }
})

test('a hold with the microphone refused says so plainly, leaves nothing running and starts no answer @full', { tag: '@full' }, async ({ page: ida, browser }) => {
  test.setTimeout(120_000)
  const { context, made, room } = await pair(ida, browser, {
    ...devices['iPhone 15'],
    baseURL: test.info().project.use.baseURL,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    permissions: ['microphone'],
  })
  try {
    await goto(ida, room)
    await expect(ida.getByTestId('buddyThread.screen')).toHaveAttribute('data-status', 'ready')
    await ida.evaluate(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
    })
    const asked = watchBucket(ida)
    // A slide up on the microphone, which would lock a recording: the microphone is refused, so it is told, and nothing started, locked or answered.
    const f = await finger(ida)
    await f.down()
    await f.move(-3, -90)
    await f.up(-3, -90)
    await expect(ida.getByTestId('buddyThread.mediaError')).toHaveText(en.uiText.chat.voice.problems.denied)
    await expect(ida.getByTestId('buddyThread.recorder')).toHaveCount(0)
    await expect(ida.getByTestId('buddyThread.quoteBar')).toHaveCount(0)
    await expect(ida.getByTestId(MIC)).toBeVisible()
    expect(await rows(made.id)).toHaveLength(0)
    expect(asked).toEqual([])
  } finally {
    await context.close()
  }
})
