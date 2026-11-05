import type { BrowserContextOptions, Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { BUDDY_EMOJI } from '../app/data/buddyReads'
import { buddyOf, follows, joinRead, startRead } from '../tests/support/buddy'
import type { TestMember } from '../tests/support/member'
import { sql } from '../tests/support/stack'
import { longPress, seedVoice, watchBucket } from './buddyVoice'
import { expectAccessible, goto, signedIn, untilStill } from './support'

/**
 * The message gestures of a buddy read thread, in the real thread and on a phone (WebKit, a touch screen, Reduce Motion on), as Trappist's chat has them:
 * a **double tap** on another member's message puts ❤️ on it and the next takes it back (a double click does the same with a mouse); a **long press** (and a
 * right click, and the bubble's own React button, which is the single-tap way) opens the bar with the six reactions, one reaction a member and message (a
 * new one replaces hers, the same one again removes it); **Reply** from the bar and a **swipe** to the right answer a message, the quote stands over the
 * answer and a tap on it jumps to the original. All of it on a text message and on a voice message (a double tap on its card likes and does not play; on its
 * play button, where the first tap plays, the second inside the window likes and silences it). The reactions are the database's (one row a member and
 * message), the second member sees them live.
 *
 * Tagged @full (docs/TESTING.md): it runs in the release run and on a pull request with the `full-e2e` label.
 */

test.use({ colorScheme: 'dark' })

const six = [...BUDDY_EMOJI]
/** The first message with these words: an answer that quotes a message has them too, and comes after it. */
const bubble = (page: Page, text: string) => page.getByTestId('buddyThread.message').filter({ hasText: text }).first()
const reactionsOn = async (readId: string) =>
  (await sql<{ emoji: string }>(`select r.emoji from public.buddy_reactions r join public.buddy_messages m on m.id = r.message_id where m.buddy_read_id = $1 order by r.created_at`, [readId])).map((r) => r.emoji)

/** Two quick taps of a finger on `target` (inside the 300 ms the base counts a double tap in). */
async function doubleTap(page: Page, target: Locator) {
  const box = (await target.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.touchscreen.tap(x, y)
  await page.touchscreen.tap(x, y)
}

/** A swipe to the right over `target`, as a touch: down, a few moves, up (the pointer events of one finger). */
async function swipeRight(target: Locator, distance = 110) {
  const box = (await target.boundingBox())!
  const y = box.y + box.height / 2
  const x = box.x + 40
  const touch = { pointerType: 'touch', pointerId: 11, isPrimary: true, button: 0, bubbles: true }
  await target.dispatchEvent('pointerdown', { ...touch, clientX: x, clientY: y, buttons: 1 })
  for (const step of [0.15, 0.4, 0.7, 1]) await target.dispatchEvent('pointermove', { ...touch, clientX: x + distance * step, clientY: y, buttons: 1 })
  await target.dispatchEvent('pointerup', { ...touch, clientX: x + distance, clientY: y, buttons: 0 })
}

async function pair(page: Page, browser: import('@playwright/test').Browser) {
  const context = await browser.newContext(test.info().project.use as BrowserContextOptions)
  const ben = await context.newPage()
  const ida = await signedIn(page)
  const benMember = await signedIn(ben)
  await Promise.all([ida, benMember].map((member, i) => sql(`update auth.users set raw_user_meta_data = raw_user_meta_data || jsonb_build_object('name', $2::text) where id = $1`, [member.id, i ? 'Ben' : 'Ida'])))
  await follows(ida, benMember)
  const made = await startRead(ida, { title: 'The Gesture Flow', parts: 2, link: true })
  await joinRead(benMember, made.linkToken!)
  for (const member of [ida, benMember]) expect((await buddyOf(member).setHand(made.id, 1)).error).toBeNull()
  const [first] = (await buddyOf(ida).read(made.id)).data!.chapters
  return { context, ben, ida, benMember, made, section: first!.id, thread: `/together/${made.id}/${first!.id}` }
}

test('double tap, long press, right click and the React button, Reply and a swipe work in the real thread, on a text and a voice message @full', { tag: '@full' }, async ({ page: ida, browser }) => {
  test.setTimeout(240_000)
  const { context, ben, ida: idaMember, benMember, made, section, thread } = await pair(ida, browser)
  try {
    await goto(ben, thread)
    await expect(ben.getByTestId('buddyThread.screen')).toHaveAttribute('data-status', 'ready')
    await goto(ida, thread)
    await expect(ida.getByTestId('buddyThread.screen')).toHaveAttribute('data-status', 'ready')
    const asked = watchBucket(ida)

    // Ben writes; Ida reads it. The first message of the thread.
    await ben.getByTestId('buddyThread.input').fill('The ending undid me')
    await ben.getByTestId('buddyThread.send').click()
    const text = bubble(ida, 'The ending undid me')
    await expect(text).toBeVisible({ timeout: 15_000 })

    // A double tap (a touch, two quick taps) puts ❤️ on it, and live on Ben's side; a heart pops and is gone; no bar opens.
    await untilStill(ida)
    await doubleTap(ida, text.getByTestId('buddyThread.bubble'))
    await expect(text.getByTestId('buddyThread.reactions')).toHaveAttribute('data-emoji', '❤️')
    await expect(text.getByTestId('buddyThread.heartPop')).toHaveCount(0, { timeout: 5_000 })
    await expect(ida.getByTestId('buddyThread.reactionBar')).toHaveCount(0)
    await expect(bubble(ben, 'The ending undid me').getByTestId('buddyThread.reactions')).toHaveAttribute('data-emoji', '❤️', { timeout: 10_000 })
    await expect.poll(() => reactionsOn(made.id)).toEqual(['❤️'])
    // The next double tap takes it back.
    await ida.waitForTimeout(400)
    await doubleTap(ida, text.getByTestId('buddyThread.bubble'))
    await expect(text.getByTestId('buddyThread.reactions')).toHaveCount(0)
    await expect.poll(() => reactionsOn(made.id)).toEqual([])
    // A double click with a mouse is the same, and no word is selected by the second click.
    await text.getByTestId('buddyThread.bubble').dblclick()
    await expect(text.getByTestId('buddyThread.reactions')).toHaveAttribute('data-emoji', '❤️')
    expect(await ida.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('')
    await expect.poll(() => reactionsOn(made.id)).toEqual(['❤️'])
    await ida.waitForTimeout(400)
    await text.getByTestId('buddyThread.bubble').dblclick()
    await expect(text.getByTestId('buddyThread.reactions')).toHaveCount(0)
    await expect.poll(() => reactionsOn(made.id)).toEqual([])
    // A single tap does nothing.
    await text.getByTestId('buddyThread.bubble').click()
    await expect(text.getByTestId('buddyThread.reactions')).toHaveCount(0)
    await expect(ida.getByTestId('buddyThread.reactionBar')).toHaveCount(0)

    // A long press opens the bar with the six emoji (in the database's order) and Reply; one reaction a member and message: a new one replaces hers, the same again removes it.
    await untilStill(ida)
    await longPress(ida, text.getByTestId('buddyThread.bubble'))
    await expect(ida.getByTestId('buddyThread.reactionBar')).toBeVisible()
    await expect(ida.getByTestId('buddyThread.reactionPick')).toHaveCount(6)
    expect(await ida.getByTestId('buddyThread.reactionPick').evaluateAll((picks) => picks.map((pick) => pick.getAttribute('data-emoji')))).toEqual(six)
    await expect(ida.getByTestId('buddyThread.reactionReply')).toBeVisible()
    await ida.locator('[data-testid="buddyThread.reactionPick"][data-emoji="🔥"]').click()
    await expect(ida.getByTestId('buddyThread.reactionBar')).toHaveCount(0)
    await expect(text.getByTestId('buddyThread.reactions')).toHaveAttribute('data-emoji', '🔥')
    await expect.poll(() => reactionsOn(made.id)).toEqual(['🔥'])
    await untilStill(ida)
    await longPress(ida, text.getByTestId('buddyThread.bubble'))
    await expect(ida.getByTestId('buddyThread.reactionBar')).toBeVisible()
    await ida.locator('[data-testid="buddyThread.reactionPick"][data-emoji="📚"]').click()
    await expect(text.getByTestId('buddyThread.reactions')).toHaveAttribute('data-emoji', '📚')
    await expect.poll(() => reactionsOn(made.id)).toEqual(['📚'])
    await untilStill(ida)
    await longPress(ida, text.getByTestId('buddyThread.bubble'))
    await ida.locator('[data-testid="buddyThread.reactionPick"][data-emoji="📚"]').click()
    await expect(text.getByTestId('buddyThread.reactions')).toHaveCount(0)
    await expect.poll(() => reactionsOn(made.id)).toEqual([])

    // A right click opens the bar, and the bubble's own React button (focus and Enter: the single-tap way, which VoiceOver and a keyboard reach).
    await text.getByTestId('buddyThread.bubble').click({ button: 'right' })
    await expect(ida.getByTestId('buddyThread.reactionBar')).toBeVisible()
    await ida.keyboard.press('Escape')
    await expect(ida.getByTestId('buddyThread.reactionBar')).toHaveCount(0)
    await text.getByTestId('buddyThread.react').focus()
    await ida.keyboard.press('Enter')
    await expect(ida.getByTestId('buddyThread.reactionBar')).toBeVisible()
    await ida.locator('[data-testid="buddyThread.reactionPick"][data-emoji="😂"]').click()
    await expect(text.getByTestId('buddyThread.reactions')).toHaveAttribute('data-emoji', '😂')
    await expect(bubble(ben, 'The ending undid me').getByTestId('buddyThread.reactions')).toHaveAttribute('data-emoji', '😂', { timeout: 10_000 })
    // Both members, one reaction each on the same message: two rows.
    await untilStill(ben)
    await longPress(ben, bubble(ben, 'The ending undid me').getByTestId('buddyThread.bubble'))
    await ben.locator('[data-testid="buddyThread.reactionPick"][data-emoji="❤️"]').click()
    await expect.poll(() => reactionsOn(made.id)).toEqual(['😂', '❤️'])

    // Reply from the bar: the composer quotes the message, the answer carries the quote over it, and a tap on the quote jumps to the original and lights it.
    await untilStill(ida)
    await longPress(ida, text.getByTestId('buddyThread.bubble'))
    await ida.getByTestId('buddyThread.reactionReply').click()
    await expect(ida.getByTestId('buddyThread.quoteBar')).toBeVisible()
    await expect(ida.getByTestId('buddyThread.quoteBarName')).toHaveText('Ben')
    await expect(ida.getByTestId('buddyThread.quoteBarPreview')).toHaveText('The ending undid me')
    await ida.getByTestId('buddyThread.input').fill('Same, I had to put it down')
    await ida.getByTestId('buddyThread.send').click()
    const answer = bubble(ida, 'Same, I had to put it down')
    await expect(answer.getByTestId('buddyThread.quotePreview')).toHaveText('The ending undid me')
    await expect(answer.getByTestId('buddyThread.quoteName')).toHaveText('Ben')
    await expect(bubble(ben, 'Same, I had to put it down').getByTestId('buddyThread.quotePreview')).toHaveText('The ending undid me', { timeout: 10_000 })
    expect(await sql(`select 1 from public.buddy_messages a join public.buddy_messages b on b.id = a.reply_to where a.body = 'Same, I had to put it down' and b.body = 'The ending undid me'`)).toHaveLength(1)
    await answer.getByTestId('buddyThread.quote').click()
    await expect(text).toHaveAttribute('data-highlight', 'true')

    // A swipe to the right answers too (a short one does not).
    await untilStill(ida)
    await swipeRight(bubble(ida, 'The ending undid me').getByTestId('buddyThread.bubble'), 30)
    await expect(ida.getByTestId('buddyThread.quoteBar')).toHaveCount(0)
    await swipeRight(bubble(ida, 'The ending undid me').getByTestId('buddyThread.bubble'))
    await expect(ida.getByTestId('buddyThread.quoteBar')).toBeVisible()
    await expect(ida.getByTestId('buddyThread.quoteBarPreview')).toHaveText('The ending undid me')
    await ida.getByTestId('buddyThread.quoteCancel').click()
    await expect(ida.getByTestId('buddyThread.quoteBar')).toHaveCount(0)

    // The same on a voice message of Ben's: a double tap on the card likes and does not play, a long press, Reply and a swipe.
    const voiced = await seedVoice(benMember, made.id, section)
    const voice = ida.getByTestId('buddyThread.message').filter({ has: ida.getByTestId('buddyThread.voice') })
    await expect(voice).toHaveCount(1, { timeout: 15_000 })
    await expect(voice.getByTestId('buddyThread.voicePlay')).toBeEnabled()
    expect(asked).toEqual([])
    await untilStill(ida)
    await doubleTap(ida, voice.getByTestId('buddyThread.voiceWave'))
    await expect(voice.getByTestId('buddyThread.reactions')).toHaveAttribute('data-emoji', '❤️')
    await expect(voice.getByTestId('buddyThread.voice')).not.toHaveAttribute('data-playing', 'true')
    expect(asked).toEqual([])
    await expect.poll(() => reactionsOn(made.id)).toEqual(['😂', '❤️', '❤️'])
    await ida.waitForTimeout(400)
    await doubleTap(ida, voice.getByTestId('buddyThread.voiceWave'))
    await expect(voice.getByTestId('buddyThread.reactions')).toHaveCount(0)
    expect(asked).toEqual([])
    await expect.poll(() => reactionsOn(made.id)).toEqual(['😂', '❤️'])
    // On the play button the first tap plays (the URL is signed now) and the second inside the window likes and silences it.
    await ida.waitForTimeout(400)
    await doubleTap(ida, voice.getByTestId('buddyThread.voicePlay'))
    await expect(voice.getByTestId('buddyThread.reactions')).toHaveAttribute('data-emoji', '❤️', { timeout: 10_000 })
    await ida.waitForTimeout(1500)
    await expect(voice.getByTestId('buddyThread.voice')).not.toHaveAttribute('data-playing', 'true')
    await untilStill(ida)
    await longPress(ida, voice.getByTestId('buddyThread.voice'))
    await expect(ida.getByTestId('buddyThread.reactionBar')).toBeVisible()
    await expect(ida.getByTestId('buddyThread.reactionPick')).toHaveCount(6)
    await ida.getByTestId('buddyThread.reactionReply').click()
    await expect(ida.getByTestId('buddyThread.quoteBarPreview')).toHaveText(en.uiText.chat.reply.voice)
    await ida.getByTestId('buddyThread.quoteCancel').click()
    await swipeRight(voice.getByTestId('buddyThread.voice'))
    await expect(ida.getByTestId('buddyThread.quoteBarPreview')).toHaveText(en.uiText.chat.reply.voice)
    await ida.getByTestId('buddyThread.input').fill('Listen to that')
    await ida.getByTestId('buddyThread.send').click()
    await expect(bubble(ida, 'Listen to that').getByTestId('buddyThread.quotePreview')).toHaveText(en.uiText.chat.reply.voice)
    await bubble(ida, 'Listen to that').getByTestId('buddyThread.quote').click()
    await expect(voice).toHaveAttribute('data-highlight', 'true')
    expect(voiced.id).toBeTruthy()
    // A voice message of her own answers nothing she cannot see, and the thread is still sound for the scan.
    await expectAccessible(ida, 'a buddy read thread with reactions, a quote and a voice message')
    void idaMember
  } finally {
    await context.close()
  }
})
