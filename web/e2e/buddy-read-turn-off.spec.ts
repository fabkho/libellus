import { expect, test } from './fixtures'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { BUDDY_READS_KEY } from '../app/utils/buddyReadsSwitch'
import { buddyOf, follows, joinRead, startRead } from '../tests/support/buddy'
import { signUpMember } from '../tests/support/member'
import { sql } from '../tests/support/stack'
import { expectAccessible, goto, openProfile, signedIn, untilStill } from './support'

/**
 * Buddy reads, turning them off (docs/plans/buddy-read-shared.md 4.6 and 5.5): the switch cannot go off while she is in a room unasked.
 * Anna joins Ida's read by its link and writes in it (through the RPCs: the room's screens are another flow's), her switch is on. In
 * Profile → Account a line says she is in one buddy read; she flips the switch off: the confirm "Leave your buddy reads and turn off?"
 * names the one room and offers "Also delete my messages", unticked. "Keep on" changes nothing, the switch reads on and she is still a
 * member. She flips it again and confirms: she leaves, her message stays in the room (she did not tick), the switch is off, the
 * line is gone, the room is not hers any more and its address leads her Home (there is no card for it on Home yet: that is a later
 * screen's). The rules (the order, the delete option, a refusal half way, the invitations) are Vitest's (tests/buddy-turn-off.test.ts);
 * this is the screens joined up. The accessibility scan is axe's, in the dark theme, over the open confirm.
 *
 * Tagged @full (docs/TESTING.md): it runs in the release run and on a pull request with the `full-e2e` label.
 */

test.use({ colorScheme: 'dark' })

test('Anna cannot turn Buddy reads off while she is in a room: the confirm, Keep on, then Leave and turn off @full', { tag: '@full' }, async ({ page: anna }) => {
  test.slow()
  // On once, when the tab opens: a later load must not put it back on (the init script runs at every load).
  await anna.addInitScript((key) => {
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    localStorage.setItem(key, 'on')
  }, BUDDY_READS_KEY)
  const annaMember = await signedIn(anna)
  const ida = await signUpMember()
  await follows(ida, annaMember)
  const made = await startRead(ida, { title: 'The Turn Off Flow', link: true })
  await joinRead(annaMember, made.linkToken!)
  // She wrote in the room: the message is hers and is not ticked away when she leaves.
  const wrote = await buddyOf(annaMember).post({ readId: made.id, sectionId: null, clientId: crypto.randomUUID(), body: 'A word before I go', replyTo: null, spoiler: false })
  expect(wrote.error).toBeNull()
  const messages = () => sql<{ n: string }>(`select count(*) as n from public.buddy_messages where buddy_read_id = $1 and author_id = $2`, [made.id, annaMember.id])
  const members = () => sql<{ n: string }>(`select count(*) as n from public.buddy_read_members where buddy_read_id = $1 and member_id = $2`, [made.id, annaMember.id])

  await openProfile(anna)
  const row = anna.getByTestId('profile.buddyReads')
  await row.scrollIntoViewIfNeeded()
  await expect(row).toHaveAttribute('aria-checked', 'true')
  await expect(anna.getByTestId('profile.buddyReadsIn')).toHaveText(en.profile.account.buddyReadsIn.split(' | ')[0].replace('{count}', '1'))

  // Turning it off asks: one buddy read, the messages option unticked, Keep on and Leave and turn off.
  await row.click()
  const confirm = anna.getByTestId('buddyReadsOff')
  await expect(confirm).toBeVisible()
  await expect(confirm).toContainText(en.profile.buddyReadsOff.title)
  await expect(confirm).toContainText(en.profile.buddyReadsOff.rooms.split(' | ')[0].replace('{count}', '1'))
  await expect(anna.getByTestId('buddyReadsOff.deleteMine')).not.toBeChecked()
  await expect(anna.getByTestId('buddyReadsOff.deleteHint')).toHaveText(en.profile.buddyReadsOff.deleteHint)
  await expect(anna.getByTestId('buddyReadsOff.cancel')).toHaveText(en.profile.buddyReadsOff.keep)
  await expect(anna.getByTestId('buddyReadsOff.confirm')).toHaveText(en.profile.buddyReadsOff.action)
  await expectAccessible(anna, 'the turn-off confirm')
  // Nothing happened to her yet: the switch reads on, she is in the room.
  await expect(row).toHaveAttribute('aria-checked', 'true')
  expect((await members())[0]!.n).toBe('1')

  // Keep on: nothing changes.
  await anna.getByTestId('buddyReadsOff.cancel').click()
  await expect(confirm).toBeHidden()
  await untilStill(anna)
  await expect(row).toHaveAttribute('aria-checked', 'true')
  expect((await members())[0]!.n).toBe('1')
  expect(await anna.evaluate((key) => localStorage.getItem(key), BUDDY_READS_KEY)).toBe('on')

  // Again, and Leave and turn off: she leaves (her message stays), the switch is off and the line under it is gone.
  await row.click()
  await expect(confirm).toBeVisible()
  await expect(anna.getByTestId('buddyReadsOff.deleteMine')).not.toBeChecked()
  await anna.getByTestId('buddyReadsOff.confirm').click()
  await expect(confirm).toBeHidden()
  await expect(row).toHaveAttribute('aria-checked', 'false')
  await expect(anna.getByTestId('profile.buddyReadsIn')).toHaveCount(0)
  expect(await anna.evaluate((key) => localStorage.getItem(key), BUDDY_READS_KEY)).toBeNull()
  expect((await members())[0]!.n).toBe('0')
  expect((await messages())[0]!.n).toBe('1')
  const mine = await buddyOf(annaMember).mine()
  expect(mine.data?.reads).toEqual([])

  // The room is gone for her: its address leads Home (her switch is off), where nothing of buddy reads is drawn.
  await goto(anna, `/together/${made.id}`)
  await expect(anna).toHaveURL(/\/$/)
  await expect(anna.getByTestId('home.title')).toBeVisible()
  await expect(anna.getByTestId('together.title')).toHaveCount(0)

  // With no room she turns it on and off again at once: no question.
  await openProfile(anna)
  await anna.getByTestId('profile.buddyReads').scrollIntoViewIfNeeded()
  await anna.getByTestId('profile.buddyReads').click()
  await expect(anna.getByTestId('profile.buddyReads')).toHaveAttribute('aria-checked', 'true')
  await anna.getByTestId('profile.buddyReads').click()
  await expect(anna.getByTestId('profile.buddyReads')).toHaveAttribute('aria-checked', 'false')
  await expect(anna.getByTestId('buddyReadsOff')).toHaveCount(0)
})
