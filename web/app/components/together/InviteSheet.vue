<script setup lang="ts">
// Inviting to a buddy read, the host's (W3): the link (on or off, Share, Copy, a New link behind a confirm: the old one dies at once) and the
// people she follows who are not in yet (`TogetherPicker`), invited in one go. Whoever the database skips (blocked with a member of the read)
// is said, never why. The read is the store's (stores/buddyRead.ts: the room screen loaded it); a member who is not the host sees nothing to do
// (the room does not open the sheet for her; the database refuses anyway: `not_host`).
//
// Props: `readId`. v-model:open. Test ids: `buddyInvite` (+ `.cancel`, `.action`), `buddyInvite.linkOn`, `.link.*`, `.renew`, `.picker`, `.send`, `.error`,
// `.skipped`, and the confirm `buddyRenew`.
import { useBuddyReadStore } from '~/stores/buddyRead'
import type { BuddyErrorCode } from '~/data/buddyReads'
import { buddyErrorKey } from '~/utils/buddyRead'
import { buddyLink, MAX_INVITES } from '~/utils/buddySetup'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ readId: string }>()

const { t } = useI18n()
const store = useBuddyReadStore()
const online = useOnline()

const read = computed(() => store.reads[props.readId] ?? null)
const token = computed(() => read.value?.linkToken ?? null)
const url = computed(() => (token.value && import.meta.client ? buddyLink(window.location.origin, token.value) : null))
const ended = computed(() => !!read.value && (read.value.status !== 'active'))

const picked = ref<string[]>([])
const busy = ref(false)
const error = ref<BuddyErrorCode | null>(null)
const skipped = ref(0)
const sent = ref(0)
const renewing = ref(false)

watch(open, (isOpen) => {
  if (!isOpen) {
    renewing.value = false
    return
  }
  picked.value = []
  error.value = null
  skipped.value = 0
  sent.value = 0
  void store.load(props.readId)
})

/** Someone already in, or already invited, is not offered again. */
const exclude = computed(() => [...(read.value?.members.map((m) => m.id) ?? []), ...(read.value?.invited.map((m) => m.id) ?? [])])
/** A read holds 12: the host, the joined and the waiting count. */
const room = computed(() => Math.max(0, Math.min(MAX_INVITES, 12 - exclude.value.length)))

const linkOn = computed({
  get: () => token.value !== null,
  set: (on) => void setLink(on),
})
async function setLink(on: boolean, renew = false) {
  if (busy.value) return
  busy.value = true
  error.value = null
  const answer = await store.setLink(props.readId, on, renew)
  busy.value = false
  if (answer.error) error.value = answer.error
}
async function renew() {
  await setLink(true, true)
  if (!error.value) renewing.value = false
}

async function send() {
  if (busy.value || !picked.value.length) return
  busy.value = true
  error.value = null
  const answer = await store.invite(props.readId, picked.value)
  busy.value = false
  if (answer.error) {
    error.value = answer.error
    return
  }
  sent.value = answer.data.invited.length
  skipped.value = answer.data.skipped.length
  picked.value = []
}
</script>

<template>
  <UiSheet v-model:open="open" :title="t('together.invite.title')" :action="t('together.setup.done')" :cancel="false" testid="buddyInvite" @action="open = false">
    <div v-if="read" class="flex flex-col gap-md pt-xs pb-lg">
      <p v-if="ended" class="text-body text-ink-muted" data-testid="buddyInvite.ended">{{ t('buddyRead.error.buddy_read_ended') }}</p>
      <template v-else>
        <section class="flex flex-col gap-sm" :aria-label="t('together.invite.linkSection')">
          <h2 class="eyebrow">{{ t('together.invite.linkSection') }}</h2>
          <UiRowGroup>
            <UiSwitchRow v-model="linkOn" icon="link" :label="t('together.invite.linkSwitch')" testid="buddyInvite.linkOn" />
          </UiRowGroup>
          <template v-if="linkOn">
            <p class="text-footnote text-ink-faint">{{ t('together.invite.linkOn') }}</p>
            <TogetherLink :url="url" :text="t('together.link.shareText', { title: read.bookCard.title })" testid="buddyInvite.link" />
            <UiButton tone="secondary" size="md" :disabled="busy" :offline="!online" data-testid="buddyInvite.renew" @click="renewing = true">{{ t('together.invite.renew') }}</UiButton>
          </template>
          <p v-else class="text-footnote text-ink-faint">{{ t('together.invite.linkOff') }}</p>
        </section>

        <section class="flex flex-col gap-sm" :aria-label="t('together.invite.friendsSection')">
          <h2 class="eyebrow">{{ t('together.invite.friendsSection') }}</h2>
          <p v-if="!room" class="text-subhead text-ink-muted" data-testid="buddyInvite.full">{{ t('buddyRead.error.buddy_read_full') }}</p>
          <template v-else>
            <TogetherPicker v-model="picked" :exclude="exclude" :max="room" :label="t('together.setup.invite.label')" testid="buddyInvite.picker" />
            <UiButton block :disabled="busy || !picked.length" :offline="!online" :aria-busy="busy" data-testid="buddyInvite.send" @click="send">
              {{ picked.length ? t('together.invite.send', { count: picked.length }, picked.length) : t('together.invite.sendNone') }}
            </UiButton>
          </template>
          <p class="min-h-(--text-footnote--line-height) text-footnote text-ink-muted" role="status" data-testid="buddyInvite.sent">
            {{ sent ? t('together.setup.invitedCount', { count: sent }, sent) : '' }}
            {{ skipped ? t('together.setup.skippedCount', { count: skipped }, skipped) : '' }}
          </p>
        </section>
      </template>
      <p v-if="error" class="text-caption text-error" role="alert" data-testid="buddyInvite.error">{{ t(buddyErrorKey(error)) }}</p>
    </div>
  </UiSheet>

  <UiConfirm
    v-model:open="renewing"
    :title="t('together.invite.renewTitle')"
    :text="t('together.invite.renewText')"
    :action="t('together.invite.renew')"
    :busy="busy"
    :offline="!online"
    :error="error ? t(buddyErrorKey(error)) : null"
    testid="buddyRenew"
    @confirm="renew"
  />
</template>
