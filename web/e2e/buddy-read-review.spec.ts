import type { BrowserContextOptions, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { buddyOf, follows, joinRead, shelve } from '../tests/support/buddy'
import { sql } from '../tests/support/stack'
import { goto, signedIn } from './support'

/**
 * What the review of the buddy read screens asked to be shown in a browser (docs/parity.md, "Buddy read, a thread" and "Buddy read link", *after the
 * review*): a refused message can be deleted, and the refusal is gone after a reload; hostile names, titles, Section labels and comments are text and
 * nothing else; a message that arrives live into a Section she has not opened puts nothing on the screen, no dot, and asks for none of its words until
 * "Show anyway". Two members, each in a browser of her own.
 *
 * Tagged @full (docs/TESTING.md): it runs in the release run and on a pull request with the `full-e2e` label.
 */

test.use({ colorScheme: 'dark' })

/** What a hostile member would write: markup that runs if it is ever drawn as markup, and a link that runs if it is ever an address. */
const IMG = '<img src=x onerror=window.__xss=1>'
const SCRIPT = '<script>window.__xss=2</script>'
const JS_LINK = 'javascript:window.__xss=3'

async function expectNothingRan(page: Page) {
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined()
  await expect(page.locator('img[src="x"]')).toHaveCount(0)
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0)
}

test('a refused message can be deleted and does not come back after a reload; hostile words are only ever text @full', { tag: '@full' }, async ({ page: ida, browser }) => {
  test.slow()
  const context = await browser.newContext(test.info().project.use as BrowserContextOptions)
  try {
    const anna = await context.newPage()
    const idaMember = await signedIn(ida)
    const annaMember = await signedIn(anna)
    // The names are the members' own words: Ida's is markup.
    await sql(`update auth.users set raw_user_meta_data = raw_user_meta_data || jsonb_build_object('name', $2::text) where id = $1`, [idaMember.id, IMG])
    await sql(`update auth.users set raw_user_meta_data = raw_user_meta_data || jsonb_build_object('name', $2::text) where id = $1`, [annaMember.id, 'Anna'])

    // A read whose Book, Sections and comments are hostile.
    await follows(idaMember, annaMember)
    const entry = await shelve(idaMember, `${IMG} The Hostile Book`)
    const created = await buddyOf(idaMember).create({
      bookId: entry.book.id,
      clientId: crypto.randomUUID(),
      sections: [
        { kind: 'part', label: IMG, toFraction: 0.5 },
        { kind: 'part', label: JS_LINK, toFraction: 1 },
        { kind: 'end', label: SCRIPT, toFraction: 1 },
      ],
      link: true,
    })
    if (created.error) throw new Error(`Fixture failed: ${created.error}`)
    await joinRead(annaMember, created.data.linkToken!)
    for (const body of [IMG, JS_LINK, SCRIPT, `[click](${JS_LINK})`]) {
      const posted = await buddyOf(idaMember).post({ readId: created.data.id, sectionId: null, clientId: crypto.randomUUID(), body })
      if (posted.error) throw new Error(`Fixture failed: ${posted.error}`)
    }

    // Anna's room: the Book, the host's name and the Sections are text.
    await goto(anna, `/together/${created.data.id}`)
    await expect(anna.getByTestId('together.title')).toContainText(`${IMG} The Hostile Book`)
    await expect(anna.getByTestId('together.with')).toContainText(IMG)
    await expect(anna.getByTestId('together.section.row')).toHaveCount(3)
    await expectNothingRan(anna)

    // The room's thread: every comment is its own words.
    await anna.getByTestId('together.room.row').click()
    // (The link's text is inside the markdown line as well, so that body is in two bubbles.)
    for (const body of [IMG, JS_LINK, SCRIPT, `[click](${JS_LINK})`]) await expect(anna.getByTestId('buddyThread.bubble').filter({ hasText: body }).first()).toBeVisible()
    await expectNothingRan(anna)

    // A message the database refuses (for good): the bubble says why, offers no "Try again", and can be deleted.
    await anna.route(/\/rpc\/post_buddy_message/, (route) =>
      route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: '22023', message: 'message_body_invalid', details: null, hint: null }) }),
    )
    await anna.getByTestId('buddyThread.input').fill('This one is refused')
    await anna.getByTestId('buddyThread.send').click()
    const refused = anna.getByTestId('buddyThread.bubble').filter({ hasText: 'This one is refused' })
    await expect(refused).toBeVisible()
    await expect(anna.getByTestId('buddyThread.failed')).toContainText(en.buddyRead.error.message_body_invalid)
    await expect(anna.getByTestId('buddyThread.failed')).toContainText(en.together.thread.notSentFinal)
    await expect(anna.getByTestId('buddyThread.retry')).toHaveCount(0)
    await expect(anna.getByTestId('buddyThread.discard')).toBeVisible()
    await expect(anna.getByTestId('buddyThread.discard')).toHaveAccessibleName(en.together.thread.discardLabel)

    // A reload: the refusal is still there (it is kept on the device, never silently dropped) …
    await anna.reload()
    await expect(anna.getByTestId('buddyThread.bubble').filter({ hasText: 'This one is refused' })).toBeVisible()
    await expect(anna.getByTestId('buddyThread.discard')).toBeVisible()
    // … until she deletes it: then it is gone, and a reload does not bring it back.
    await anna.getByTestId('buddyThread.discard').click()
    await expect(anna.getByTestId('buddyThread.bubble').filter({ hasText: 'This one is refused' })).toHaveCount(0)
    await anna.reload()
    await expect(anna.getByTestId('buddyThread.thread')).toBeVisible()
    await expect(anna.getByTestId('buddyThread.bubble').filter({ hasText: IMG })).toHaveCount(1)
    await expect(anna.getByTestId('buddyThread.bubble').filter({ hasText: 'This one is refused' })).toHaveCount(0)
    await expect(anna.getByTestId('buddyThread.discard')).toHaveCount(0)
    expect(await anna.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('libellus.buddyRead.queue')).map((k) => localStorage.getItem(k)).join(''))).not.toContain('This one is refused')
    await expectNothingRan(anna)
  } finally {
    await context.close()
  }
})

test('a message that arrives live into a Section she has not opened shows nothing, asks for nothing, until Show anyway @full', { tag: '@full' }, async ({ page: ida, browser }) => {
  test.slow()
  const context = await browser.newContext(test.info().project.use as BrowserContextOptions)
  try {
    const anna = await context.newPage()
    const idaMember = await signedIn(ida)
    const annaMember = await signedIn(anna)
    await follows(idaMember, annaMember)

    const entry = await shelve(idaMember, 'The Veiled Book')
    const created = await buddyOf(idaMember).create({
      bookId: entry.book.id,
      clientId: crypto.randomUUID(),
      sections: [
        { kind: 'part', label: 'Part 1', toFraction: 0.5 },
        { kind: 'part', label: 'Part 2', toFraction: 1 },
        { kind: 'end', label: 'The whole book', toFraction: 1 },
      ],
      link: true,
    })
    if (created.error) throw new Error(`Fixture failed: ${created.error}`)
    await joinRead(annaMember, created.data.linkToken!)
    const second = (await buddyOf(annaMember).read(created.data.id)).data!.chapters.find((c) => c.position === 2)!

    // Which of her requests ask for the words of that Section.
    const asked: string[] = []
    anna.on('request', (request) => {
      if (/rpc\/buddy_read_messages/.test(request.url()) && (request.postData() ?? '').includes(second.id)) asked.push(request.postData() ?? '')
    })

    // Anna is in the room: the channel is live. Ida says something in Section 2, which is veiled for Anna (her marker is at none).
    await goto(anna, `/together/${created.data.id}`)
    await expect(anna.getByTestId('together.title')).toContainText('The Veiled Book')
    const row = anna.getByTestId('together.section.row').nth(1)
    await expect(row).toHaveAttribute('data-veiled', 'true')
    await expect(anna.getByTestId('together.section.count').nth(1)).toHaveText('0')
    const secret = 'The butler did it, in chapter two'
    const posted = await buddyOf(idaMember).post({ readId: created.data.id, sectionId: second.id, clientId: crypto.randomUUID(), body: secret })
    if (posted.error) throw new Error(`Fixture failed: ${posted.error}`)

    // It arrived (the count follows it) …
    await expect(anna.getByTestId('together.section.count').nth(1)).toHaveText('1')
    // … and nothing of it is on the screen: no words, no title, no unread dot, no one on its row.
    expect(await anna.content()).not.toContain(secret)
    await expect(row).toHaveAttribute('data-veiled', 'true')
    await expect(anna.getByTestId('together.section.title').nth(1)).toHaveText('')
    await expect(anna.getByTestId('together.section.unread')).toHaveCount(0)
    expect(asked, 'the words of a veiled Section are not asked for').toEqual([])

    // The address does not open it either; "Show anyway" does, and asks for the words only then.
    await goto(anna, `/together/${created.data.id}/${second.id}`)
    await expect(anna.getByTestId('together.thread.veiled')).toBeVisible()
    expect(await anna.content()).not.toContain(secret)
    expect(asked).toEqual([])
    await anna.getByTestId('together.thread.showAnyway').click()
    await anna.getByTestId('together.showAnyway.confirm').click()
    await expect(anna.getByTestId('buddyThread.bubble').filter({ hasText: secret })).toBeVisible()
    expect(asked.length).toBeGreaterThan(0)
    // Focus is where she can write, not at the top of the page.
    await expect(anna.getByTestId('buddyThread.input')).toBeFocused()
  } finally {
    await context.close()
  }
})
