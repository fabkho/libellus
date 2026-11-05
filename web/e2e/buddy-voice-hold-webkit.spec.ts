import type { BrowserContextOptions } from '@playwright/test'
import { expect, test } from './fixtures'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { finger, MIC, pair, rows, watchBucket } from './buddyVoice'
import { goto } from './support'

/**
 * The microphone of the thread's composer in WebKit, as the flows run (an iPhone, a touch screen, Reduce Motion): it cannot fake a microphone, so this is what
 * needs none: the styles that keep the iPhone's callout, selection and scrolling off the hold (`touch-action`, `user-select`, `-webkit-touch-callout`, no context
 * menu), and a hold with the microphone refused (told plainly, nothing running, nothing asked of the bucket, no answer started by the slide). The gestures with a
 * microphone are e2e/buddy-voice-hold.spec.ts (Chromium).
 *
 * Tagged @full (docs/TESTING.md): it runs in the release run and on a pull request with the `full-e2e` label.
 */

test.describe('without one (WebKit, as the flows run)', () => {
  test.use({ colorScheme: 'dark' })

  test('the touch is the gesture\'s: no scrolling, selection, callout or context menu on the microphone; a hold with the microphone refused says so and leaves nothing running @full', { tag: '@full' }, async ({ page: ida, browser }) => {
    test.setTimeout(120_000)
    const { context, made, room } = await pair(ida, browser, test.info().project.use as BrowserContextOptions)
    try {
      await goto(ida, room)
      await expect(ida.getByTestId('buddyThread.screen')).toHaveAttribute('data-status', 'ready')
      const mic = ida.getByTestId(MIC)
      const style = await mic.evaluate((el) => {
        const s = getComputedStyle(el)
        // `-webkit-touch-callout` is the iPhone's long-press callout: only WebKit on a touch device knows it (desktop WebKit does not report it).
        const known = CSS.supports('-webkit-touch-callout', 'none')
        return { touch: s.touchAction, select: s.getPropertyValue('-webkit-user-select') || s.userSelect, callout: known ? s.getPropertyValue('-webkit-touch-callout') : 'none' }
      })
      expect(style).toEqual({ touch: 'none', select: 'none', callout: 'none' })
      expect(await mic.evaluate((el) => !el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))).toBe(true)
      // Nothing above the composer takes the finger: the thread is not asked to answer a message or to scroll by a slide on the microphone.
      await ida.evaluate(() => {
        navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
      })
      const asked = watchBucket(ida)
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
})
