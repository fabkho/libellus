<script setup lang="ts">
// The buddy read invitations waiting for her, as rows at the top of Friends (W3; the twin of Home's follow request): Join or Not now on each.
// Join answers `answer_buddy_invite` and goes on to "Which copy are you reading?" in a sheet, then to the room; Not now leaves the invitation
// (nobody is told). Draws nothing while no invitation waits: the list is
// the light store's (stores/buddyInvites.ts), read when the page opens and whenever the app comes back to the foreground.
import type { BuddyInvitation } from '~/data/buddyReads'
import { buddyErrorKey } from '~/utils/buddyRead'
import { roomPath } from '~/utils/buddyRoute'
import { useBuddyInvitesStore } from '~/stores/buddyInvites'
import { useBuddyReadStore } from '~/stores/buddyRead'

// Props: `bare` (inside Home's "Reading together" card, which has its own heading and spacing: no padding of its own, the heading is spoken only),
// `load` (default true: read the list on mounting; Home reads `my_buddy_reads()` itself and hands the answer over, so it passes false),
// v-model:copying (the copy question's sheet is open).
const props = withDefaults(defineProps<{ bare?: boolean; load?: boolean }>(), { bare: false, load: true })

const { t } = useI18n()
const invites = useBuddyInvitesStore()
const store = useBuddyReadStore()
const online = useOnline()

onMounted(() => props.load && void invites.load({ force: true }))

const busy = ref<string | null>(null)
const error = ref<string | null>(null)
/** The invitation she accepted: its copy question is open. */
const joined = ref<BuddyInvitation | null>(null)
/** The "Which copy are you reading?" sheet is open. v-model:copying lets a card that holds this component stay while it is (Home's hides itself with nothing to show). */
const copyOpen = defineModel<boolean>('copying', { default: false })

async function accept(invitation: BuddyInvitation) {
  if (busy.value) return
  busy.value = invitation.id
  error.value = null
  const answer = await store.answerInvite(invitation.id, true)
  busy.value = null
  if (answer.error) {
    error.value = t(buddyErrorKey(answer.error))
    // It is not there any more (the host removed it, the read ended): the row goes.
    if (answer.error === 'not_found') invites.drop(invitation.id)
    return
  }
  invites.drop(invitation.id)
  joined.value = invitation
  copyOpen.value = true
}
async function decline(invitation: BuddyInvitation) {
  if (busy.value) return
  busy.value = invitation.id
  error.value = null
  const answer = await store.answerInvite(invitation.id, false)
  busy.value = null
  if (answer.error && answer.error !== 'not_found') return void (error.value = t(buddyErrorKey(answer.error)))
  invites.drop(invitation.id)
}

function done() {
  copyOpen.value = false
  if (joined.value) void navigateTo(roomPath(joined.value.id))
}
</script>

<template>
  <section v-if="invites.count" class="flex flex-col gap-xs" :class="!bare && 'px-screen pt-sm'" :aria-label="t('together.invitation.section')" data-testid="buddyInvites">
    <h2 :class="bare ? 'sr-only' : 'eyebrow'">{{ t('together.invitation.section') }}</h2>
    <ul class="flex flex-col gap-sm">
      <TogetherInvitationRow
        v-for="invitation in invites.waiting"
        :key="invitation.id"
        :invitation="invitation"
        :offline="!online"
        :busy="busy !== null"
        @accept="accept(invitation)"
        @decline="decline(invitation)"
      />
    </ul>
    <p v-if="error" class="text-caption text-error" role="alert" data-testid="buddyInvites.error">{{ error }}</p>
  </section>

  <UiSheet v-model:open="copyOpen" :title="t('together.title')" testid="buddyInvitesCopy">
    <div v-if="joined" class="pt-xs pb-lg">
      <TogetherEntryPicker :read-id="joined.id" :book="joined.book" @done="done" />
    </div>
  </UiSheet>
</template>
