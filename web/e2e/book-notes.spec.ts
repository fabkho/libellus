import type { BrowserContextOptions, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import en from '../i18n/locales/en.json' with { type: 'json' }
import de from '../i18n/locales/de.json' with { type: 'json' }
import { LOCALE_KEY } from '../app/utils/locale'
import { befriend, makeChapters, notesOf, sharedBook, shelveBook, writeNote } from '../tests/support/notes'
import type { TestMember } from '../tests/support/member'
import { sql } from '../tests/support/stack'
import { expectAccessible, expectNoSideScroll, goto, signedIn, signedInAsOwner, untilStill } from './support'

/**
 * Notes on a Book (docs/plans/book-notes.md; docs/parity.md, *Notes page*, *Notes, a chapter*, *Notes, visibility*, *Owner inbox: remove a note*): the screens joined up, in a
 * browser a member. Ida and Anna follow each other, Mo is a member with no relation to either. The rules behind each step are pgTAP's (supabase/tests/book_notes_test.sql) and Vitest's
 * (tests/notes-db.test.ts); this is what a member sees of them: who sees which note, what a veiled chapter shows, the switch for Everyone, a report and the owner's removal, a block.
 *
 * Serial, in one worker: the switch for Everyone is the instance's (`private.notes_settings`), and the one flow that turns it off must not run beside the others.
 *
 * Tagged @full (docs/TESTING.md): they run in the release run and on a pull request with the `full-e2e` label.
 */

test.describe.configure({ mode: 'serial' })
test.use({ colorScheme: 'dark' })

const named = async (member: TestMember, name: string) => {
  await sql(`update auth.users set raw_user_meta_data = raw_user_meta_data || jsonb_build_object('name', $2::text) where id = $1`, [member.id, name])
}

/** One browser context a member (the session lives in its storage): Ida's is the test's page, each of the others gets her own, all closed with `close`. */
async function members(browser: import('@playwright/test').Browser, ida: Page, others: string[]) {
  const contexts = await Promise.all(others.map(() => browser.newContext(test.info().project.use as BrowserContextOptions)))
  const pages = await Promise.all(contexts.map((c) => c.newPage()))
  const idaMember = await signedIn(ida)
  const rest = []
  for (const p of pages) rest.push(await signedIn(p))
  await named(idaMember, 'Ida')
  await Promise.all(rest.map((m, i) => named(m, others[i]!)))
  return { context: { close: () => Promise.all(contexts.map((c) => c.close())) }, idaMember, pages, members: rest }
}

const switchOn = (on: boolean) => sql('update private.notes_settings set public_enabled = $1, updated_at = now()', [on])

const chapter = (n: number) => en.notes.chapter.replace('{n}', String(n))
const rowLabel = (n: number, count: number, tail: string) => `${chapter(n)}, ${count === 1 ? en.uiText.threadRow.commentsOne : en.uiText.threadRow.comments.replace('{count}', String(count))}, ${tail}`
const bubble = (page: Page, words: string) => page.getByTestId('notesThread.bubble').filter({ hasText: words })
const row = (page: Page, n: number | 'whole') => page.locator(`[data-testid="notes.chapter.row"][data-segment="${n}"]`)

/** Right click (the pointer's long press) on a bubble opens its bar; then one of the app's entries. */
async function bar(page: Page, words: string, action: 'visibility' | 'delete' | 'report' | 'block' | 'reply') {
  await untilStill(page)
  await bubble(page, words).click({ button: 'right' })
  await expect(page.getByTestId('notesThread.reactionBar')).toBeVisible()
  await page.getByTestId(action === 'reply' ? 'notesThread.reactionReply' : `notesThread.reactionAction.${action}`).click()
}

/** Opens the menu of the split send button and chooses who sees the note: Only me, Friends or Everyone (the tab keeps the field's focus; the menu closes on the choice). */
async function chooseLevel(page: Page, level: 'private' | 'friends' | 'public') {
  await page.getByTestId('notesThread.sendAs').click()
  await page.getByTestId(`notesThread.sendAs.${level}`).click()
  await expect(page.getByTestId('notesThread.sendAsMenu')).toHaveCount(0)
}

/** The audience is on the button itself, before anything is sent: the tab ("Send as: Everyone") and the send button ("Send · Everyone") name it. */
async function expectLevel(page: Page, level: 'private' | 'friends' | 'public', words: typeof en | typeof de = en) {
  // The tab is always there; the send button says the audience too, but at Only me with an empty field the microphone stands in its place (a voice note).
  await expect(page.getByTestId('notesThread.sendAs')).toHaveAttribute('aria-label', `${words.uiText.chat.composer.sendAs}: ${words.notes.level[level]}`)
  const send = page.getByTestId('notesThread.send')
  if (await send.count()) await expect(send).toHaveAttribute('aria-label', `${words.uiText.chat.composer.send} · ${words.notes.level[level]}`)
}

/** Writes a note and lets go of the field (the audience lives in the send button, so there is nothing that folds with the keyboard). */
async function write(page: Page, words: string) {
  await page.getByTestId('notesThread.input').fill(words)
  await page.getByTestId('notesThread.send').click()
  await expect(bubble(page, words)).toBeVisible()
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
}

// The migration ships Everyone off (production turns it on at release): the flows turn it on, the one about the pause turns it off, and the switch is put back as it was.
let switchWas = false
test.beforeAll(async () => {
  switchWas = (await sql<{ public_enabled: boolean }>('select public_enabled from private.notes_settings'))[0]!.public_enabled
  await switchOn(true)
})
test.afterAll(async () => {
  await switchOn(switchWas)
})

test('Ida makes the chapters and writes to her friends, Anna sees them veiled until Show anyway and answers @full', { tag: '@full' }, async ({ page: ida, browser }) => {
  test.slow()
  const { context, idaMember, pages, members: [annaMember] } = await members(browser, ida, ['Anna'])
  const [anna] = pages as [Page]
  try {
    await befriend(idaMember, annaMember!)
    const snapshot = sharedBook('The Notes Flow')
    const bookId = await shelveBook(idaMember, snapshot, 'reading')
    await shelveBook(annaMember!, snapshot, 'want_to_read')

    // 1 · Ida: a Book with no chapters asks how many; 43 makes 43 threads and the whole book.
    await goto(ida, `/book/${bookId}`)
    await expect(ida.getByTestId('book.notes')).toBeVisible()
    await expect(ida.getByTestId('book.notes.section')).toHaveCount(0)
    await ida.getByTestId('book.notes').click()
    await expect(ida).toHaveURL(new RegExp(`/notes/${bookId}$`))
    await expect(ida.getByTestId('notes.count.title')).toHaveText(en.notes.count.title)
    await expect(ida.getByTestId('notes.count.make')).toBeDisabled()
    await ida.getByTestId('notes.count.field').fill('43')
    await expect(ida.getByTestId('notes.count.make')).toHaveText(en.notes.count.make.split(' | ')[1]!.replace('{n}', '43'))
    await ida.getByTestId('notes.count.make').click()
    await expect(ida.getByTestId('notes.chapter.row')).toHaveCount(44)
    await expect(ida.getByTestId('notes.sub')).toContainText('43')

    // Her chapter: she reads the Book and has begun it (chapter 1); by hand she is on 5. The sheet is hers, nobody sees it.
    await expect(ida.getByTestId('notes.youreOn')).toHaveText(en.notes.page.youreOn.replace('{n}', '1'))
    await ida.getByTestId('notes.change').click()
    await ida.locator('[data-testid="notes.chapterSheet.chapter"][data-choice="c5"]').click()
    await expect(ida.getByTestId('notes.chapterSheet.status')).toContainText(en.notes.chapterSheet.saved.replace('{where}', chapter(5)))
    await ida.getByTestId('notes.chapterSheet.action').click()
    await expect(ida.getByTestId('notes.youreOn')).toHaveText(en.notes.page.youreOn.replace('{n}', '5'))

    // Chapter 5: no notes yet, Friends is the control's choice; her note is at Friends, no mark on it.
    await row(ida, 5).click()
    await expect(ida).toHaveURL(new RegExp(`/notes/${bookId}/5$`))
    await expect(ida.getByTestId('notes.thread.empty')).toHaveText(en.notes.thread.empty.replace('{n}', '5'))
    await expectLevel(ida, 'friends')
    await write(ida, 'Salt, then the pears, then the well')
    await expect(ida.getByTestId('notesThread.public')).toHaveCount(0)
    await expect(ida.getByTestId('notesThread.private')).toHaveCount(0)

    // 2 · Anna (Want to read, no chapter yet): her Book page says what her friend wrote, in numbers.
    await goto(anna, `/book/${bookId}`)
    await expect(anna.getByTestId('book.notes.friends')).toContainText('Ida')
    await expect(anna.getByTestId('book.notes.friends')).toContainText(en.notes.section.notes.split(' | ')[0]!.replace('{count}', '1'))
    await expect(anna.getByTestId('book.notes.friends')).toContainText(en.notes.section.chapter.replace('{n}', '5'))
    await expect(anna.getByTestId('book.notes.public')).toHaveCount(0)
    expect(await anna.content()).not.toContain('Salt, then the pears')

    // Her Notes page: chapter 5 is veiled, with its count and no words anywhere on the page.
    await anna.getByTestId('book.notes.friends').click()
    await expect(anna).toHaveURL(new RegExp(`/notes/${bookId}$`))
    await expect(anna.getByTestId('notes.chapter.row')).toHaveCount(44)
    await expect(row(anna, 5)).toHaveAttribute('data-veiled', 'true')
    await expect(row(anna, 5)).toHaveAttribute('aria-label', rowLabel(5, 1, en.uiText.threadRow.veiled))
    expect(await anna.content()).not.toContain('Salt, then the pears')
    // The address does not open it either: the quiet "hidden" screen, nothing read.
    await goto(anna, `/notes/${bookId}/5`)
    await expect(anna.getByTestId('notes.thread.veiled')).toBeVisible()
    expect(await anna.content()).not.toContain('Salt, then the pears')
    await anna.getByTestId('notes.thread.back').click()
    await expect(anna).toHaveURL(new RegExp(`/notes/${bookId}$`))

    // "Not yet" keeps it closed; "Show anyway" opens it, and she answers.
    await row(anna, 5).click()
    await expect(anna.getByTestId('notes.showAnyway')).toBeVisible()
    await anna.getByTestId('notes.showAnyway.cancel').click()
    await expect(row(anna, 5)).toHaveAttribute('data-veiled', 'true')
    await row(anna, 5).click()
    await anna.getByTestId('notes.showAnyway.confirm').click()
    await expect(anna).toHaveURL(new RegExp(`/notes/${bookId}/5$`))
    await expect(bubble(anna, 'Salt, then the pears')).toBeVisible()
    await bar(anna, 'Salt, then the pears', 'reply')
    await write(anna, 'Yes! Salt comes first')
    await expect(anna.getByTestId('notesThread.bubble').filter({ hasText: 'Yes! Salt comes first' }).getByTestId('notesThread.quote')).toBeVisible()

    // Ida reads it again (a Refresh: no live updates in Notes): Anna's answer is there.
    await ida.getByTestId('notes.thread.refresh').click()
    await expect(bubble(ida, 'Yes! Salt comes first')).toBeVisible()
  } finally {
    await context.close()
  }
})

test('Only me stays Ida’s, Everyone reaches a member she does not know, a quote of a note he cannot see says so, and narrowing takes it back @full', { tag: '@full' }, async ({ page: ida, browser }) => {
  test.slow()
  const { context, idaMember, pages, members: [annaMember, moMember] } = await members(browser, ida, ['Anna', 'Mo'])
  const [anna, mo] = pages as [Page, Page]
  try {
    await befriend(idaMember, annaMember!)
    const snapshot = sharedBook('The Levels Flow')
    const bookId = await shelveBook(idaMember, snapshot, 'reading')
    await shelveBook(annaMember!, snapshot, 'reading')
    const room = await makeChapters(idaMember, bookId, 10)
    const five = room.chapters.find((c) => c.position === 5)!.id
    await notesOf(idaMember).setChapter(room.id, 5)
    await notesOf(annaMember!).setChapter(room.id, 5)

    // 3 · An Only me note: a lock under it for Ida; Anna sees neither the note nor a count of it.
    await goto(ida, `/notes/${bookId}/5`)
    await chooseLevel(ida, 'private')
    await expectLevel(ida, 'private')
    await write(ida, 'Note to self: count the pears')
    await expect(ida.getByTestId('notesThread.private')).toBeVisible()
    await goto(anna, `/notes/${bookId}`)
    // An open row is named from its number: "5, Chapter 5, 0 comments", and nothing says a note is there.
    await expect(row(anna, 5)).toHaveAttribute('aria-label', `5, ${chapter(5)}, ${en.uiText.threadRow.comments.replace('{count}', '0')}`)
    await goto(anna, `/notes/${bookId}/5`)
    await expect(anna.getByTestId('notes.thread.empty')).toBeVisible()
    expect(await anna.content()).not.toContain('count the pears')

    // The button stays on what Ida chose last (the device remembers Only me), and Everyone is one note's: after it is sent the button is back.
    await expectLevel(ida, 'private')
    await chooseLevel(ida, 'public')
    await expectLevel(ida, 'public')
    await expect(ida.getByTestId('notes.level.notice')).toHaveText(en.notes.level.publicNotice)
    await write(ida, 'The orchard map is the recipe')
    await expectLevel(ida, 'private')
    await expect(ida.getByTestId('notes.level.notice')).toHaveCount(0)
    await expect(bubble(ida, 'The orchard map').getByTestId('notesThread.public')).toHaveCount(0)
    await expect(ida.getByTestId('notesThread.message').filter({ hasText: 'The orchard map' }).getByTestId('notesThread.public')).toBeVisible()
    // Friends again for the next ones.
    await chooseLevel(ida, 'friends')
    await writeNote(annaMember!, room, five, 'Anna writes for friends', 'friends')

    // 4 · Mo: no relation. The Book page shows a Public row, his Notes page chapter 5 veiled; Show anyway: Ida's public note with a globe, nothing else.
    await goto(mo, `/book/${bookId}`)
    await expect(mo.getByTestId('book.notes.public')).toContainText(en.notes.section.publicLine.replace('{notes}', en.notes.section.notes.split(' | ')[0]!.replace('{count}', '1')).replace('{members}', en.notes.section.members.split(' | ')[0]!.replace('{count}', '1')))
    await expect(mo.getByTestId('book.notes.friends')).toHaveCount(0)
    await mo.getByTestId('book.notes.public').click()
    await expect(row(mo, 5)).toHaveAttribute('data-veiled', 'true')
    await row(mo, 5).click()
    await mo.getByTestId('notes.showAnyway.confirm').click()
    await expect(bubble(mo, 'The orchard map is the recipe')).toBeVisible()
    await expect(mo.getByTestId('notesThread.message').filter({ hasText: 'The orchard map' }).getByTestId('notesThread.public')).toBeVisible()
    await expect(mo.getByTestId('notesThread.bubble')).toHaveCount(1)
    expect(await mo.content()).not.toContain('count the pears')
    expect(await mo.content()).not.toContain('Anna writes for friends')
    // He may read, he has no Book: the Notes page has no chapter chooser.
    await mo.getByTestId('notes.thread.back').click()
    await expect(mo.getByTestId('notes.change')).toHaveCount(0)

    // A reply of Ida’s to a public note of Anna’s that Mo has blocked: Mo sees the reply and "A note you can't see" where the quote is.
    const annaPublic = await writeNote(annaMember!, room, five, 'Anna says it to everyone', 'public')
    expect((await moMember!.client.rpc('block', { p_member: annaMember!.id })).error).toBeNull()
    await writeNote(idaMember, room, five, 'Ida answers Anna in public', 'public', annaPublic.id)
    await goto(mo, `/notes/${bookId}/5`)
    // The chapter stays open on his phone: he opened it anyway before.
    await expect(bubble(mo, 'Ida answers Anna in public')).toBeVisible()
    await expect(bubble(mo, 'Ida answers Anna in public').getByTestId('notesThread.quote')).toContainText(en.notes.thread.hiddenQuote)
    expect(await mo.content()).not.toContain('Anna says it to everyone')

    // 5 · Ida narrows her public note to Friends, from its action bar: Mo no longer sees it, nor the Public row.
    await ida.getByTestId('notes.thread.refresh').click()
    await bar(ida, 'The orchard map is the recipe', 'visibility')
    await ida.getByTestId('notes.visibilitySheet.friends').click()
    await expect(ida.getByTestId('notes.visibilitySheet')).toBeHidden()
    await mo.getByTestId('notes.thread.refresh').click()
    await expect(bubble(mo, 'The orchard map')).toHaveCount(0)
    // Her other public note (the answer) is still his to read; only the narrowed one is gone.
    await expect(bubble(mo, 'Ida answers Anna in public')).toBeVisible()
  } finally {
    await context.close()
  }
})

test('with Everyone paused the menu has two choices, a public note counts as Friends’ and the Public row is gone @full', { tag: '@full' }, async ({ page: ida, browser }) => {
  test.slow()
  const { context, idaMember, pages, members: [annaMember, moMember] } = await members(browser, ida, ['Anna', 'Mo'])
  const [anna, mo] = pages as [Page, Page]
  try {
    await befriend(idaMember, annaMember!)
    const snapshot = sharedBook('The Switch Flow')
    const bookId = await shelveBook(idaMember, snapshot, 'reading')
    await shelveBook(annaMember!, snapshot, 'reading')
    await shelveBook(moMember!, snapshot, 'reading')
    const room = await makeChapters(idaMember, bookId, 6)
    const two = room.chapters.find((c) => c.position === 2)!.id
    for (const m of [idaMember, annaMember!, moMember!]) await notesOf(m).setChapter(room.id, 3)
    await writeNote(idaMember, room, two, 'Said to everyone before the pause', 'public')

    // On: three segments, Mo sees the note and the Public row.
    await goto(ida, `/notes/${bookId}/2`)
    await ida.getByTestId('notesThread.sendAs').click()
    await expect(ida.locator('[data-testid^="notesThread.sendAs."]')).toHaveCount(3)
    await ida.keyboard.press('Escape')
    await goto(mo, `/book/${bookId}`)
    await expect(mo.getByTestId('book.notes.public')).toBeVisible()

    // The owner's switch goes off (the service role): Everyone leaves the control; her public note keeps its level but reads as a friends' note.
    await switchOn(false)
    await goto(ida, `/notes/${bookId}/2`)
    await expectLevel(ida, 'friends')
    await ida.getByTestId('notesThread.sendAs').click()
    await expect(ida.getByTestId('notesThread.sendAs.public')).toHaveCount(0)
    await expect(ida.getByTestId('notesThread.sendAs.private')).toBeVisible()
    await expect(ida.getByTestId('notesThread.sendAs.friends')).toBeVisible()
    await ida.keyboard.press('Escape')
    await expect(ida.getByTestId('notesThread.public')).toHaveCount(0)
    await bar(ida, 'Said to everyone before the pause', 'visibility')
    await expect(ida.getByTestId('notes.visibilitySheet.public')).toHaveCount(0)
    await ida.getByTestId('notes.visibilitySheet.action').click()
    // Friends still see it, a member with no relation does not, and the Public row is gone from his Book page.
    await goto(anna, `/notes/${bookId}/2`)
    await expect(bubble(anna, 'Said to everyone before the pause')).toBeVisible()
    await expect(anna.getByTestId('notesThread.public')).toHaveCount(0)
    await goto(mo, `/notes/${bookId}/2`)
    await expect(mo.getByTestId('notes.thread.empty')).toBeVisible()
    await goto(mo, `/book/${bookId}`)
    await expect(mo.getByTestId('book.notes.public')).toHaveCount(0)
  } finally {
    await switchOn(true)
    await context.close()
  }
})

test('Mo reports a public note, the owner removes it from the inbox and it reads “Removed by the moderator” for all; a block hides both sides @full', { tag: '@full' }, async ({ page: ida, browser }) => {
  test.slow()
  const { context, idaMember, pages, members: [moMember] } = await members(browser, ida, ['Mo'])
  const [mo] = pages as [Page]
  const ownerContext = await browser.newContext(test.info().project.use as BrowserContextOptions)
  try {
    const snapshot = sharedBook('The Moderation Flow')
    const bookId = await shelveBook(idaMember, snapshot, 'reading')
    await shelveBook(moMember!, snapshot, 'reading')
    const room = await makeChapters(idaMember, bookId, 4)
    const one = room.chapters.find((c) => c.position === 1)!.id
    await writeNote(idaMember, room, one, 'Something Mo reports', 'public')

    // 7 · Mo reports it from its action bar: one reason, a few words.
    await goto(mo, `/notes/${bookId}/1`)
    await expect(bubble(mo, 'Something Mo reports')).toBeVisible()
    await bar(mo, 'Something Mo reports', 'report')
    await expect(mo.getByTestId('notes.report')).toBeVisible()
    await mo.getByTestId('notes.report.reason.spam').click()
    await mo.getByTestId('notes.report.note').fill('It is an advertisement')
    await mo.getByTestId('notes.report.action').click()
    await expect(mo.getByTestId('notes.report.done')).toBeVisible()
    await mo.getByTestId('notes.report.close').click()

    // The owner's inbox: the report says the note's level and offers Remove note; removing needs a reason.
    const ownerPage = await ownerContext.newPage()
    await signedInAsOwner(ownerPage)
    await goto(ownerPage, '/profile/feedback')
    const report = ownerPage.getByTestId('feedback.item').filter({ hasText: 'Notes report: spam' }).filter({ hasText: 'It is an advertisement' })
    await expect(report).toBeVisible()
    await expect(report.getByTestId('feedback.noteLevel')).toContainText(en.notes.level.public)
    await report.getByTestId('feedback.removeNote').click()
    await ownerPage.getByTestId('feedback.removeNote.reason').fill('Advertising')
    await ownerPage.getByTestId('feedback.removeNote.confirm.confirm').click()
    await expect(report.getByTestId('feedback.noteRemoved')).toBeVisible()
    await expect(report.getByTestId('feedback.removeNote')).toHaveCount(0)

    // For everyone it is a tombstone now: no words, "Removed by the moderator".
    await goto(ida, `/notes/${bookId}/1`)
    await expect(ida.getByTestId('notesThread.removed')).toHaveText(en.notes.thread.moderated)
    await goto(mo, `/notes/${bookId}/1`)
    await expect(mo.getByTestId('notesThread.removed')).toHaveText(en.notes.thread.moderated)
    expect(await mo.content()).not.toContain('Something Mo reports')

    // 8 · A block, from a note: Mo blocks Ida; neither sees the other's notes any more.
    await writeNote(idaMember, room, one, 'Ida writes in public again', 'public')
    await writeNote(moMember!, room, one, 'Mo writes in public too', 'public')
    await goto(mo, `/notes/${bookId}/1`)
    await expect(bubble(mo, 'Ida writes in public again')).toBeVisible()
    await bar(mo, 'Ida writes in public again', 'block')
    await expect(mo.getByTestId('notes.thread.block')).toContainText('Ida')
    await mo.getByTestId('notes.thread.block.confirm').click()
    await expect(bubble(mo, 'Ida writes in public again')).toHaveCount(0)
    await expect(bubble(mo, 'Mo writes in public too')).toBeVisible()
    await goto(ida, `/notes/${bookId}/1`)
    await expect(bubble(ida, 'Mo writes in public too')).toHaveCount(0)
    await expect(bubble(ida, 'Ida writes in public again')).toBeVisible()
  } finally {
    await ownerContext.close()
    await context.close()
  }
})

test('the audience lives in the send button: it is there and unchanged while the field has the keyboard and after it lets go, each choice is posted as chosen, a reply is never wider than its note @full', { tag: '@full' }, async ({ page: ida, browser }) => {
  test.slow()
  const { context, idaMember, pages, members: [annaMember] } = await members(browser, ida, ['Anna'])
  const [anna] = pages as [Page]
  try {
    await befriend(idaMember, annaMember!)
    const snapshot = sharedBook('The Button Flow')
    const bookId = await shelveBook(idaMember, snapshot, 'reading')
    await shelveBook(annaMember!, snapshot, 'reading')
    const room = await makeChapters(idaMember, bookId, 6)
    const three = room.chapters.find((c) => c.position === 3)!.id
    for (const m of [idaMember, annaMember!]) await notesOf(m).setChapter(room.id, 4)
    await writeNote(annaMember!, room, three, 'Anna says it to friends', 'friends')
    const visibilityOf = async (words: string) => (await sql<{ visibility: string; spoiler: boolean }>('select visibility, spoiler from public.room_messages where body = $1', [words]))[0]

    await goto(ida, `/notes/${bookId}/3`)
    const tab = ida.getByTestId('notesThread.sendAs')
    const input = ida.getByTestId('notesThread.input')
    // The owner's bug: the control disappeared with the keyboard and stayed gone. It is in the button now: in the page at every moment (at rest, in the field, typing, after the field lets go), never folded, never hidden.
    const always = async (when: string) => {
      await expect(tab, when).toBeVisible()
      await expect(ida.getByTestId('notesThread.send'), when).toBeVisible()
      await expectLevel(ida, 'friends')
      await expect(ida.getByTestId('notesThread.actions'), when).toHaveCount(0)
    }
    await always('at rest')
    await input.focus()
    await always('with the field focused')
    await input.fill('Friends, by default')
    await always('while typing')
    await ida.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await always('after the field let go')
    await input.focus()
    await always('with the field focused again')

    // A tap on the tab opens the menu (APG menu button), three choices with what each means, Friends the chosen one; Escape closes it and the focus goes back to the tab.
    await tab.click()
    await expect(tab).toHaveAttribute('aria-expanded', 'true')
    const menu = ida.getByTestId('notesThread.sendAsMenu')
    await expect(menu).toHaveAttribute('role', 'menu')
    await expect(ida.locator('[data-testid^="notesThread.sendAs."]')).toHaveCount(3)
    await expect(ida.getByTestId('notesThread.sendAs.friends')).toHaveAttribute('aria-checked', 'true')
    await expect(ida.getByTestId('notesThread.sendAs.private')).toContainText(en.notes.level.privateHint)
    await expect(ida.getByTestId('notesThread.sendAs.public')).toContainText(en.notes.level.publicHint)
    await ida.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(tab).toBeFocused()

    // Each choice changes the button before anything is sent, and the note is posted as chosen (and never as a spoiler: that mark is gone).
    await chooseLevel(ida, 'private')
    await expectLevel(ida, 'private')
    await expect(ida.getByTestId('notesThread.sendAsWord')).toHaveText(en.notes.level.private)
    await write(ida, 'Only me, from the button')
    await chooseLevel(ida, 'friends')
    await expect(ida.getByTestId('notesThread.sendAsWord')).toHaveCount(0)
    await write(ida, 'Friends, from the button')
    await chooseLevel(ida, 'public')
    await expectLevel(ida, 'public')
    await expect(ida.getByTestId('notesThread.record')).toHaveCount(0)
    await expect(ida.getByTestId('notesThread.sendAsWord')).toHaveText(en.notes.level.public)
    await expect(ida.getByTestId('notes.level.notice')).toHaveCount(1)
    await write(ida, 'Everyone, from the button')
    await expect(ida.getByTestId('notes.level.notice')).toHaveCount(0)
    await expect.poll(() => visibilityOf('Only me, from the button')).toEqual({ visibility: 'private', spoiler: false })
    await expect.poll(() => visibilityOf('Friends, from the button')).toEqual({ visibility: 'friends', spoiler: false })
    await expect.poll(() => visibilityOf('Everyone, from the button')).toEqual({ visibility: 'public', spoiler: false })
    // The marks in the thread say the same: a lock under the Only me note, a globe by the Everyone one, nothing for Friends.
    await expect(ida.getByTestId('notesThread.message').filter({ hasText: 'Only me, from the button' }).getByTestId('notesThread.private')).toBeVisible()
    await expect(ida.getByTestId('notesThread.message').filter({ hasText: 'Everyone, from the button' }).getByTestId('notesThread.public')).toBeVisible()
    await expect(ida.getByTestId('notesThread.message').filter({ hasText: 'Friends, from the button' }).locator('[data-testid="notesThread.public"], [data-testid="notesThread.private"]')).toHaveCount(0)

    // Answering Anna's Friends note: Everyone is in the menu but off, and says why; the button is on Friends; the note is posted at Friends.
    await bar(ida, 'Anna says it to friends', 'reply')
    await expect(ida.getByTestId('notesThread.quoteBar')).toBeVisible()
    await expectLevel(ida, 'friends')
    await tab.click()
    await expect(ida.getByTestId('notesThread.sendAs.public')).toHaveAttribute('aria-disabled', 'true')
    await expect(ida.getByTestId('notesThread.sendAs.public')).toContainText(en.notes.level.heldBack)
    await ida.getByTestId('notesThread.sendAs.public').click({ force: true })
    await expect(ida.getByTestId('notesThread.sendAsMenu')).toBeVisible()
    await ida.keyboard.press('Escape')
    await expectLevel(ida, 'friends')
    await write(ida, 'An answer, no wider than hers')
    await expect.poll(() => visibilityOf('An answer, no wider than hers')).toMatchObject({ visibility: 'friends' })

    // Anna sees the Friends notes and not the Only me one; a flagged-as-spoiler message of the old days is a normal bubble.
    await goto(anna, `/notes/${bookId}/3`)
    await expect(bubble(anna, 'Friends, from the button')).toBeVisible()
    await expect(bubble(anna, 'Everyone, from the button')).toBeVisible()
    expect(await anna.content()).not.toContain('Only me, from the button')
    await sql(`update public.room_messages set spoiler = true where body = 'Friends, from the button'`)
    await goto(anna, `/notes/${bookId}/3`)
    await expect(bubble(anna, 'Friends, from the button')).toBeVisible()
    await expect(anna.getByTestId('notesThread.veil')).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('the Notes page and a chapter pass axe in the dark room, and in German at 360 px nothing overflows @full', { tag: '@full' }, async ({ page: ida, browser }) => {
  test.slow()
  const { context, idaMember, pages, members: [annaMember] } = await members(browser, ida, ['Anna'])
  const [anna] = pages as [Page]
  try {
    await befriend(idaMember, annaMember!)
    const snapshot = sharedBook('The Scan Flow')
    const bookId = await shelveBook(idaMember, snapshot, 'reading')
    await shelveBook(annaMember!, snapshot, 'reading')
    const room = await makeChapters(idaMember, bookId, 43)
    const five = room.chapters.find((c) => c.position === 5)!.id
    await notesOf(idaMember).setChapter(room.id, 5)
    await writeNote(annaMember!, room, five, 'Anna’s note for friends', 'friends')
    await writeNote(annaMember!, room, five, 'Anna’s note for everyone, a longer one that has to wrap over more than one line on a small phone', 'public')
    await writeNote(idaMember, room, five, 'Mine alone', 'private')

    await goto(ida, `/book/${bookId}`)
    await expect(ida.getByTestId('book.notes.section')).toBeVisible()
    await expectAccessible(ida, 'the Book page with its Notes section')
    await goto(ida, `/notes/${bookId}`)
    await expect(ida.getByTestId('notes.chapter.row')).toHaveCount(44)
    await expectAccessible(ida, 'the Notes page')
    await goto(ida, `/notes/${bookId}/5`)
    await expect(bubble(ida, 'Anna’s note for friends')).toBeVisible()
    await expectAccessible(ida, 'a chapter of the Notes')
    await chooseLevel(ida, 'public')
    await expect(ida.getByTestId('notes.level.notice')).toBeVisible()
    await expectAccessible(ida, 'a chapter with Everyone chosen')

    // German at 360 px: the split send button (Nur ich · Freunde · Alle), the rows and the notice do not run out of the screen.
    await ida.addInitScript((key) => localStorage.setItem(key, 'de'), LOCALE_KEY)
    await ida.setViewportSize({ width: 360, height: 740 })
    await goto(ida, `/notes/${bookId}`)
    await expect(ida.getByTestId('notes.change')).toHaveText(de.notes.page.change)
    await expectNoSideScroll(ida, 'the Notes page in German')
    await goto(ida, `/notes/${bookId}/5`)
    await expectLevel(ida, 'friends', de)
    await expectNoSideScroll(ida, 'a chapter in German')
    await chooseLevel(ida, 'public')
    await expectLevel(ida, 'public', de)
    await expect(ida.getByTestId('notes.level.notice')).toHaveText(de.notes.level.publicNotice)
    await expectNoSideScroll(ida, 'a chapter in German with Everyone chosen')
    const box = await ida.getByTestId('notesThread.split').boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(360)

    // Anna wrote the notes herself, and Ida's is hers alone: nothing to say on Anna's Book page (her own notes are never counted there).
    await goto(anna, `/book/${bookId}`)
    await expect(anna.getByTestId('book.notes')).toBeVisible()
    await expect(anna.getByTestId('book.notes.section')).toHaveCount(0)
  } finally {
    await context.close()
  }
})
