import type { BrowserContextOptions } from '@playwright/test'
import { expect, test } from './fixtures'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { createLibrary } from '../app/data/library'
import { createManualBooks } from '../app/data/manualBooks'
import { buddyOf, catalogueEdition, follows, joinRead, sectionsOf, shelve, startRead } from '../tests/support/buddy'
import { signUpMember } from '../tests/support/member'
import { runTitle, sql } from '../tests/support/stack'
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

test('Ida starts a buddy read, Anna joins, a message arrives live, a Section stays veiled until Show anyway, a deleted comment is removed @full', { tag: '@full' }, async ({ page: ida, browser }) => {
  // Two members, a live channel, a veil and a scan: longer than a usual flow.
  test.slow()
  const context = await browser.newContext(test.info().project.use as BrowserContextOptions)
  try {
    const anna = await context.newPage()
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

/**
 * The entry points: buddy reads are for every member, so a Book page offers *Read together* in its action area whatever state the Book is in. A Book that is not in her
 * Library: the action, the setup sheet that says plainly that starting adds it to Currently reading, and nothing added when she cancels; started, the room exists, the
 * Book is Currently reading and the Book page now says "Open the buddy read". Then Home: the ⋯ of a Currently reading card, the card "Reading together" with what is
 * new, and an invitation above it.
 */
test('a Section has no Spoiler chip, and a comment flagged Spoiler in the old days is a normal bubble with its words @full', { tag: '@full' }, async ({ page: ida }) => {
  const idaMember = await signedIn(ida)
  const anna = await signUpMember()
  await sql(`update auth.users set raw_user_meta_data = raw_user_meta_data || jsonb_build_object('name', $2::text) where id = $1`, [anna.id, 'Anna'])
  await follows(idaMember, anna)
  const made = await startRead(idaMember, { title: 'The Marks Flow', parts: 3, link: true })
  await joinRead(anna, made.linkToken!)
  const first = (await buddyOf(idaMember).read(made.id)).data!.chapters.find((c) => c.position === 1)!
  const said = await buddyOf(anna).post({ readId: made.id, sectionId: first.id, clientId: crypto.randomUUID(), body: 'The twist is in the well' })
  expect(said.error).toBeNull()
  // The mark is gone from the app; the database column is not, and a handful of old messages carry it.
  await sql(`update public.buddy_messages set spoiler = true where id = $1`, [said.data!.id])

  // Section 1 is not open to Ida yet (her marker has read through none): "Show anyway" opens it. Its composer is the field and send (the microphone while it is empty), and nothing else.
  await goto(ida, `/together/${made.id}/${first.id}`)
  await ida.getByTestId('together.thread.showAnyway').click()
  await ida.getByTestId('together.showAnyway.confirm').click()
  await expect(ida.getByTestId('buddyThread.screen')).toHaveAttribute('data-status', 'ready')
  const flagged = ida.getByTestId('buddyThread.bubble').filter({ hasText: 'The twist is in the well' })
  await expect(flagged).toBeVisible()
  await expect(ida.getByTestId('buddyThread.veil')).toHaveCount(0)
  await expect(ida.getByTestId('buddyThread.spoiler')).toHaveCount(0)
  await expect(ida.getByTestId('buddyThread.actions')).toHaveCount(0)
  await expect(ida.getByTestId('buddyThread.record')).toBeVisible()
  await ida.getByTestId('buddyThread.input').fill('Not a spoiler any more')
  await expect(ida.getByTestId('buddyThread.send')).toBeVisible()
  await ida.getByTestId('buddyThread.send').click()
  await expect(ida.getByTestId('buddyThread.bubble').filter({ hasText: 'Not a spoiler any more' })).toBeVisible()
  // What she wrote carries no mark: the app sends no `p_spoiler`, the column keeps its default.
  expect(await sql<{ spoiler: boolean }>(`select spoiler from public.buddy_messages where body = 'Not a spoiler any more'`)).toEqual([{ spoiler: false }])
})

test('Read together on a Book that is not in her Library adds it as Currently reading when the read is made; Home lists the read and its invitation @full', { tag: '@full' }, async ({ page }) => {
  test.slow()
  const ida = await signedIn(page)
  const anna = await signUpMember()
  await sql(`update auth.users set raw_user_meta_data = raw_user_meta_data || jsonb_build_object('name', 'Anna') where id = $1`, [anna.id])
  // A Catalogue Book in Anna's Library, not in Ida's.
  const theirs = await shelve(anna, 'The Entry Book')
  const bookId = theirs.book.id

  // The Book page of a Book she does not hold: the action is there, in the action area, not behind a menu.
  await goto(page, `/book/${bookId}`)
  await expect(page.getByTestId('book.add')).toBeVisible()
  await expect(page.getByTestId('book.actions').getByTestId('book.together.start')).toBeVisible()
  await expect(page.getByTestId('book.together.start')).toContainText(en.together.entry.start)
  await expect(page.getByTestId('book.together.adds')).toHaveText(en.together.entry.adds)
  await expectAccessible(page, 'a Book that is not in her Library, with Read together')

  // The sheet says so plainly; Cancel adds nothing.
  await page.getByTestId('book.together.start').click()
  await expect(page.getByTestId('buddySetup')).toBeVisible()
  await expect(page.getByTestId('buddySetup.adds')).toHaveText(en.together.setup.adds)
  await expectAccessible(page, 'the setup sheet, which adds the Book')
  await page.getByTestId('buddySetup.cancel').click()
  await expect(page.getByTestId('buddySetup')).toBeHidden()
  await expect(page.getByTestId('book.notInLibrary')).toBeVisible()
  await goto(page, '/')
  await expect(page.getByTestId('home.readingCard')).toHaveCount(0)

  // Start: Book, Sections, Invite, Start. The read is made and the Book is Currently reading.
  await goto(page, `/book/${bookId}`)
  await page.getByTestId('book.together.start').click()
  await expect(page.getByTestId('buddySetup.adds')).toBeVisible()
  await page.getByTestId('buddySetup.next').click()
  await page.getByTestId('buddySetup.next').click()
  await expect(page.getByTestId('buddySetup.addsAgain')).toBeVisible()
  await page.getByTestId('buddySetup.start').click()
  await expect(page.getByTestId('buddySetup.result')).toBeVisible()
  await page.getByTestId('buddySetup.open').click()
  await expect(page).toHaveURL(/\/together\/[0-9a-f-]{36}$/)
  await expect(page.getByTestId('together.title')).toContainText('The Entry Book')
  const roomUrl = page.url()

  // The Book is Currently reading (Home), and its page says "Open the buddy read" where the action was.
  await goto(page, '/')
  await expect(page.getByTestId('home.readingCard')).toContainText('The Entry Book')
  await goto(page, `/book/${bookId}`)
  await expect(page.getByTestId('book.status')).toHaveText(en.status.reading)
  await expect(page.getByTestId('book.together.open')).toContainText(en.together.entry.openRoom)
  await expect(page.getByTestId('book.together.start')).toHaveCount(0)
  await page.getByTestId('book.together.open').click()
  await expect(page).toHaveURL(roomUrl)

  // Anna writes in the room: Home's card says one is new, and the ⋯ of the card offers the room, not a second read.
  const readId = roomUrl.split('/').pop()!
  await follows(ida, anna)
  await joinRead(anna, (await buddyOf(ida).read(readId)).data!.linkToken!)
  const posted = await buddyOf(anna).post({ readId, sectionId: null, clientId: crypto.randomUUID(), body: 'Hello from the room' })
  if (posted.error) throw new Error(`Fixture failed: ${posted.error}`)
  await goto(page, '/')
  await expect(page.getByTestId('home.togetherRow')).toHaveCount(1)
  await expect(page.getByTestId('home.togetherRow')).toContainText('The Entry Book')
  await expect(page.getByTestId('home.togetherRow').getByTestId('together.unread')).toContainText('1')
  await page.getByTestId('home.together.more').click()
  await expect(page.getByTestId('homeTogetherMenu.open')).toBeVisible()
  await expect(page.getByTestId('homeTogetherMenu.start')).toHaveCount(0)
  await page.keyboard.press('Escape')

  // An invitation of Anna's waits above the rows.
  await follows(anna, ida)
  await startRead(anna, { title: 'Anna Picks', invite: [ida.id] })
  await goto(page, '/')
  await expect(page.getByTestId('buddyInvite.row')).toHaveCount(1)
  await expect(page.getByTestId('buddyInvite.row')).toContainText('Anna Picks')
})

/** The action in every state of the Book page: not in the Library, Want to read, Currently reading, Finished, given up (DNF), already in a read, and a Manual book. */
test('the Book page offers Read together in every state of the Book, and says why when it cannot @full', { tag: '@full' }, async ({ page }) => {
  test.slow()
  const ida = await signedIn(page)
  const library = createLibrary(ida.client)
  const today = new Date().toISOString().slice(0, 10)
  const add = async (title: string, options: Parameters<typeof library.addToLibrary>[1]) => {
    const added = await library.addToLibrary(catalogueEdition(title), options)
    if (added.error || !added.data) throw new Error(`Fixture failed: ${String(added.error)}`)
    return added.data
  }
  const want = await add('Want Book', { status: 'want_to_read' })
  const reading = await add('Reading Book', { status: 'reading', startedOn: today })
  const finished = await add('Finished Book', { status: 'finished', startedOn: today, endedOn: today })
  const dnf = await add('Given Up Book', { status: 'reading', startedOn: today })
  const gaveUp = await library.abandon(dnf.id, { endedOn: today })
  if (gaveUp.error) throw new Error(`Fixture failed: ${String(gaveUp.error)}`)
  const manual = await createManualBooks(ida.client).addManualBook({ title: runTitle('My Own Book'), author: 'Ida Beispiel' }, { status: 'reading', startedOn: today })
  if (manual.error || !manual.data) throw new Error(`Fixture failed: ${String(manual.error)}`)

  // Not in her Library, Want to read, Currently reading, Finished, given up: the action is in the action area every time.
  const other = await signUpMember()
  const foreign = await shelve(other, 'Not In Her Library')
  await goto(page, `/book/${foreign.book.id}`)
  await expect(page.getByTestId('book.actions').getByTestId('book.together.start')).toBeVisible()
  await expect(page.getByTestId('book.together.adds')).toBeVisible()
  for (const [name, entry] of [['want', want], ['reading', reading], ['finished', finished], ['given up', dnf]] as const) {
    await goto(page, `/book/${entry.book.id}`)
    await expect(page.getByTestId('book.actions').getByTestId('book.together.start'), name).toBeVisible()
    await expect(page.getByTestId('book.together.adds'), name).toHaveCount(0)
  }

  // A Manual book cannot be read together: the action is there, disabled, with the one line why.
  await goto(page, `/book/${manual.data.book.id}`)
  await expect(page.getByTestId('book.together.start')).toBeDisabled()
  await expect(page.getByTestId('book.together.unavailable')).toHaveText(en.together.entry.unavailable)

  // Already in a read: the same place says "Open the buddy read".
  const made = await buddyOf(ida).create({ bookId: reading.book.id, clientId: crypto.randomUUID(), sections: sectionsOf(3), invite: [], link: false })
  if (made.error) throw new Error(`Fixture failed: ${made.error}`)
  await goto(page, `/book/${reading.book.id}`)
  await expect(page.getByTestId('book.together.open')).toBeVisible()
  await expect(page.getByTestId('book.together.summary')).toContainText(en.together.where.section.replace('{n}', '1'))
  await expect(page.getByTestId('book.together.start')).toHaveCount(0)
})
