import type { BrowserContextOptions, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { BUDDY_READS_KEY } from '../app/utils/buddyReadsSwitch'
import { buddyOf, follows, joinRead, startRead } from '../tests/support/buddy'
import { sql } from '../tests/support/stack'
import { expectAccessible, goto, signedIn, untilStill } from './support'

/**
 * Buddy reads (docs/plans/buddy-read-shared.md, W4), the one flow: two members, each in a browser of her own. Ida starts a read of a Book
 * in her Library (through the RPCs: the setup screens are W3's, and this flow is about the room), Anna joins by its link (the same).
 * Ida's room shows the Book, the track and the Sections; Anna opens the room's thread, Ida writes in it from her own screen and it arrives
 * live for Anna with no reload. Ida opens her own Section by hand ("Where are you?") and writes in Section 2: for Anna that Section is
 * veiled: its row says it is hidden and gives a count, never its title, and its words are nowhere on the page, not even when she opens the
 * address, until she says "Show anyway"; then it opens, says she is reading ahead, and her own Section has not moved. Ida deletes her
 * comment: for Anna it reads "Message removed". The rules behind each step are pgTAP's (supabase/tests/buddy_*) and Vitest's
 * (tests/buddy-*.test.ts); this is the screens joined up. The accessibility scan is axe's in the dark room (the design's own), over the
 * thread and the room.
 *
 * Tagged @full (docs/TESTING.md): it runs in the release run and on a pull request with the `full-e2e` label.
 */

test.use({ colorScheme: 'dark' })

/** Buddy reads are her own switch (Profile → Account), off until she turns it on: a member who did writes it on the device. */
async function switchedOn(page: Page) {
  await page.addInitScript((key) => localStorage.setItem(key, 'on'), BUDDY_READS_KEY)
}

test('Ida starts a buddy read, Anna joins, a message arrives live, a Section stays veiled until Show anyway, a deleted comment is removed @full', { tag: '@full' }, async ({ page: ida, browser }) => {
  // Two members, a live channel, a veil and a scan: longer than a usual flow.
  test.slow()
  const context = await browser.newContext(test.info().project.use as BrowserContextOptions)
  try {
    const anna = await context.newPage()
    await switchedOn(ida)
    await switchedOn(anna)
    const idaMember = await signedIn(ida)
    const annaMember = await signedIn(anna)
    for (const [member, name] of [[idaMember, 'Ida'], [annaMember, 'Anna']] as const) {
      await sql(`update auth.users set raw_user_meta_data = raw_user_meta_data || jsonb_build_object('name', $2::text) where id = $1`, [member.id, name])
    }

    // The read, through the RPCs: Ida follows nobody, Anna follows nobody, the link is on.
    await follows(idaMember, annaMember)
    const made = await startRead(idaMember, { title: 'The Buddy Flow', parts: 3, link: true })
    await joinRead(annaMember, made.linkToken!)
    const sections = (await buddyOf(idaMember).read(made.id)).data!.chapters
    const second = sections.find((c) => c.position === 2)!

    // Anna's room first: its thread is open when Ida writes, so what arrives, arrives live.
    await goto(anna, `/together/${made.id}`)
    await expect(anna.getByTestId('together.title')).toContainText('The Buddy Flow')
    await expect(anna.getByTestId('together.with')).toContainText('Ida')
    await anna.getByTestId('together.room.row').click()
    await expect(anna).toHaveURL(new RegExp(`/together/${made.id}/room$`))
    await expect(anna.getByTestId('together.thread.empty')).toBeVisible()

    // Ida's room: the Book, the track (her Library entry is linked and just begun: Section 1; Anna's has none: not set), the rows.
    await goto(ida, `/together/${made.id}`)
    await expect(ida.getByTestId('together.title')).toContainText('The Buddy Flow')
    await expect(ida.getByTestId('together.track')).toBeVisible()
    await expect(ida.getByTestId('together.track.you')).toHaveText(en.together.track.you.replace('{n}', '1').replace('{total}', '3'))
    await expect(ida.getByTestId('together.room.row')).toHaveCount(1)
    // The room, three Sections and the whole book; none of them is open to Ida yet: her marker has read through none, and a Section opens when she is through it.
    await expect(ida.getByTestId('together.section.row')).toHaveCount(4)
    await ida.getByTestId('together.room.row').click()
    await expect(ida.getByTestId('together.thread.empty')).toBeVisible()

    // Ida writes in the room: her bubble at once, and for Anna live, with no reload.
    await ida.getByTestId('buddyThread.input').fill('Welcome to the read, everybody')
    await ida.getByTestId('buddyThread.send').click()
    await expect(ida.getByTestId('buddyThread.bubble').filter({ hasText: 'Welcome to the read, everybody' })).toBeVisible()
    await expect(anna.getByTestId('buddyThread.bubble').filter({ hasText: 'Welcome to the read, everybody' })).toBeVisible()
    await expect(anna.getByTestId('buddyThread.announce')).toContainText('Welcome to the read, everybody')

    // Ida: "Where are you?": Section 3 (she has read through two), from the room's own sheet. Anna's room follows live.
    await ida.getByTestId('together.thread.back').click()
    await expect(ida.getByTestId('together.track.marker')).toBeVisible()
    await ida.getByTestId('together.track.marker').click()
    await expect(ida.getByTestId('together.marker')).toBeVisible()
    await ida.getByTestId('together.marker.section').nth(2).click()
    await expect(ida.getByTestId('together.marker.status')).toContainText(en.together.marker.saved.replace('{where}', en.together.marker.section.replace('{n}', '3')))
    await ida.getByTestId('together.marker.action').click()
    await expect(ida.getByTestId('together.marker')).toBeHidden()
    await expect(ida.getByTestId('together.track.you')).toHaveText(en.together.track.you.replace('{n}', '3').replace('{total}', '3'))

    // Section 2 is open to Ida now: she writes in it.
    const secondRow = ida.getByTestId('together.section.row').nth(1)
    await expect(secondRow).not.toHaveAttribute('data-veiled')
    await secondRow.click()
    await expect(ida).toHaveURL(new RegExp(`/together/${made.id}/${second.id}$`))
    await ida.getByTestId('buddyThread.input').fill('Chapter two changes everything')
    await ida.getByTestId('buddyThread.send').click()
    const mine = ida.getByTestId('buddyThread.bubble').filter({ hasText: 'Chapter two changes everything' })
    await expect(mine).toBeVisible()

    // Anna's room: Section 2 is veiled: its number, that it is hidden and one comment, never its title or its words.
    await anna.getByTestId('together.thread.back').click()
    await expect(anna.getByTestId('together.title')).toBeVisible()
    const veiledRow = anna.getByTestId('together.section.row').nth(1)
    await expect(veiledRow).toHaveAttribute('data-veiled', 'true')
    await expect(veiledRow).toHaveAttribute('aria-label', `${en.together.sectionLabel.replace('{n}', '2')}, ${en.uiText.threadRow.commentsOne}, ${en.uiText.threadRow.veiled}`)
    await expect(anna.getByTestId('together.section.title').nth(1)).toHaveText('')
    expect(await anna.content()).not.toContain('Chapter two changes everything')
    // Ida's face is on her Section's row for Anna? She is in Section 3: Section 3 is veiled for Anna, so no one is shown on it.
    await expect(anna.getByTestId('together.section.row').nth(2)).toHaveAttribute('data-veiled', 'true')
    // The address does not open it either: the quiet "hidden" screen, nothing read.
    await goto(anna, `/together/${made.id}/${second.id}`)
    await expect(anna.getByTestId('together.thread.veiled')).toBeVisible()
    expect(await anna.content()).not.toContain('Chapter two changes everything')
    await anna.getByTestId('together.thread.back').click()
    await expect(anna).toHaveURL(new RegExp(`/together/${made.id}$`))

    // "Not yet" keeps it closed; "Show anyway" opens it, and says she is reading ahead.
    await anna.getByTestId('together.section.row').nth(1).click()
    await expect(anna.getByTestId('together.showAnyway')).toBeVisible()
    await anna.getByTestId('together.showAnyway.cancel').click()
    await expect(anna.getByTestId('together.showAnyway')).toBeHidden()
    await expect(anna.getByTestId('together.section.row').nth(1)).toHaveAttribute('data-veiled', 'true')
    await anna.getByTestId('together.section.row').nth(1).click()
    await anna.getByTestId('together.showAnyway.confirm').click()
    await expect(anna).toHaveURL(new RegExp(`/together/${made.id}/${second.id}$`))
    await expect(anna.getByTestId('buddyThread.bubble').filter({ hasText: 'Chapter two changes everything' })).toBeVisible()
    await expect(anna.getByTestId('together.thread.ahead')).toBeVisible()
    // Her own Section did not move.
    await anna.getByTestId('together.thread.back').click()
    await expect(anna.getByTestId('together.track.you')).toHaveText(en.together.track.youNotSet)
    await expect(anna.getByTestId('together.section.row').nth(1)).not.toHaveAttribute('data-veiled')

    // The scan, in the dark room: Anna's room, then the open thread.
    await expectAccessible(anna, 'the buddy read room')
    await anna.getByTestId('together.section.row').nth(1).click()
    await expect(anna.getByTestId('buddyThread.bubble').filter({ hasText: 'Chapter two changes everything' })).toBeVisible()
    await expectAccessible(anna, 'a buddy read thread')

    // Ida deletes her comment from the bubble's reaction bar: a tombstone for her and, live, for Anna.
    await untilStill(ida)
    await ida.getByTestId('buddyThread.react').first().focus()
    await ida.keyboard.press('Enter')
    await ida.getByTestId('buddyThread.reactionAction.delete').click()
    await expect(ida.getByTestId('together.thread.delete')).toBeVisible()
    await ida.getByTestId('together.thread.delete.confirm').click()
    await expect(ida.getByTestId('buddyThread.removed')).toHaveText(en.together.thread.removed)
    await expect(anna.getByTestId('buddyThread.removed')).toHaveText(en.together.thread.removed)
    await expect(anna.getByText('Chapter two changes everything')).toHaveCount(0)
  } finally {
    await context.close()
  }
})
