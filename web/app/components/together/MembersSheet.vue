<script setup lang="ts">
// Who is in a buddy read (W3): the members with their face, role and Section ("Section 3", "The whole book", "Not set": never a page or a
// percent, plan part 5.5), the people invited and not answered yet, and, for her, Leave. The Host gets a ⋯ on every other row: Remove (behind a
// confirm: whoever is removed stays out, even by the link, until she is invited again). A Host who leaves hands the read to the member who joined
// earliest; the last one to leave ends it (the confirm says so). Leaving can take her messages with her (`p_delete_messages`), asked in the
// confirm. Across a block a member's Section is not shown at all (`where` null): the row has no second line.
//
// Props: `readId`. v-model:open. Emits `left` once she left (the room is gone for her: the screen under it leaves too).
// Test ids: `buddyMembers` (+ `.cancel`, `.action`), `buddyMembers.row`, `.more`, `.leave`, `.error`, and the confirms `buddyRemove`, `buddyLeave`
// (`.confirm`, `.cancel`, `.deleteMine`).
import { useBuddyReadStore } from '~/stores/buddyRead'
import { useSessionStore } from '~/stores/session'
import type { BuddyErrorCode, BuddyMember, BuddyWhere } from '~/data/buddyReads'
import type { MemberCard } from '~/data/socialShapes'
import { buddyErrorKey } from '~/utils/buddyRead'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ readId: string }>()
const emit = defineEmits<{ left: [] }>()

const { t } = useI18n()
const store = useBuddyReadStore()
const session = useSessionStore()
const online = useOnline()

const read = computed(() => store.reads[props.readId] ?? null)
const me = computed(() => session.member?.id ?? null)
const isHost = computed(() => read.value?.role === 'host')
const active = computed(() => read.value?.status === 'active')

const busy = ref(false)
const error = ref<BuddyErrorCode | null>(null)
/** The member the Host is about to remove, and whether the sheet's own Leave is asked. */
const removing = ref<{ id: string; name: string; waiting: boolean } | null>(null)
const removeOpen = computed({ get: () => removing.value !== null, set: (v) => !v && (removing.value = null) })
const leaving = ref(false)
const deleteMine = ref(false)

watch(open, (isOpen) => {
  if (isOpen) {
    error.value = null
    void store.load(props.readId)
  } else {
    removing.value = null
    leaving.value = false
  }
})

const nameOf = (card: MemberCard) => card.name?.trim() || t('member.someone')
function whereText(where: BuddyWhere | null): string | null {
  if (!where) return null
  if (where.kind === 'section') return t('together.members.inSection', { n: where.section })
  return where.kind === 'end' ? t('together.members.wholeBook') : t('together.members.notSet')
}
const rows = computed(() =>
  (read.value?.members ?? []).map((m: BuddyMember) => ({ member: m, name: nameOf(m), self: m.id === me.value, where: whereText(m.where) })),
)
const waiting = computed(() => (read.value?.invited ?? []).map((card) => ({ card, name: nameOf(card) })))

function askRemove(card: MemberCard, name: string, waitingRow: boolean) {
  error.value = null
  removing.value = { id: card.id, name, waiting: waitingRow }
}
async function remove() {
  const target = removing.value
  if (!target || busy.value) return
  busy.value = true
  const answer = await store.remove(props.readId, target.id)
  busy.value = false
  if (answer.error) {
    error.value = answer.error
    return
  }
  error.value = null
  removing.value = null
}

function askLeave() {
  error.value = null
  deleteMine.value = false
  leaving.value = true
}
async function leave() {
  if (busy.value) return
  busy.value = true
  const answer = await store.leave(props.readId, deleteMine.value)
  busy.value = false
  if (answer.error) {
    error.value = answer.error
    return
  }
  leaving.value = false
  open.value = false
  emit('left')
}
const leaveText = computed(() =>
  isHost.value && (read.value?.members.length ?? 0) > 1 ? t('together.members.leaveHostText') : isHost.value ? t('together.members.leaveLastText') : t('together.members.leaveText'),
)
</script>

<template>
  <UiSheet v-model:open="open" :title="t('together.members.title')" :action="t('together.setup.done')" :cancel="false" testid="buddyMembers" @action="open = false">
    <div v-if="read" class="flex flex-col gap-md pt-xs pb-lg">
      <ul class="flex flex-col divide-y divide-hairline" :aria-label="t('together.members.title')">
        <li v-for="row in rows" :key="row.member.id" class="flex min-h-(--size-row) items-center gap-ms py-xs" data-testid="buddyMembers.row">
          <FriendsAvatar :card="row.member" />
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="truncate text-body">{{ row.name }}<span v-if="row.self" class="text-ink-muted"> · {{ t('together.members.you') }}</span></span>
            <span class="truncate text-caption text-ink-muted">
              <template v-if="row.member.role === 'host'">{{ t('together.members.host') }}</template>
              <template v-if="row.member.role === 'host' && row.where"> · </template>
              <template v-if="row.where">{{ row.where }}</template>
            </span>
          </div>
          <button
            v-if="isHost && !row.self && active"
            type="button"
            :aria-label="t('together.members.moreLabel', { name: row.name })"
            class="-mr-sm flex size-(--size-touch) shrink-0 items-center justify-center text-ink-faint active:text-ink"
            data-testid="buddyMembers.more"
            @click="askRemove(row.member, row.name, false)"
          >
            <UiIcon name="more" :size="20" />
          </button>
        </li>
      </ul>

      <section v-if="waiting.length" class="flex flex-col gap-xs">
        <h2 class="eyebrow">{{ t('together.members.invited') }}</h2>
        <ul class="flex flex-col divide-y divide-hairline" :aria-label="t('together.members.invited')">
          <li v-for="row in waiting" :key="row.card.id" class="flex min-h-(--size-row) items-center gap-ms py-xs" data-testid="buddyMembers.invitedRow">
            <FriendsAvatar :card="row.card" />
            <span class="min-w-0 flex-1 truncate text-body">{{ row.name }}</span>
            <button
              v-if="isHost && active"
              type="button"
              :aria-label="t('together.members.moreLabel', { name: row.name })"
              class="-mr-sm flex size-(--size-touch) shrink-0 items-center justify-center text-ink-faint active:text-ink"
              data-testid="buddyMembers.invitedMore"
              @click="askRemove(row.card, row.name, true)"
            >
              <UiIcon name="more" :size="20" />
            </button>
          </li>
        </ul>
      </section>

      <p class="text-footnote text-ink-faint">{{ t('together.members.privacy') }}</p>
      <p v-if="error && !removing && !leaving" class="text-caption text-error" role="alert" data-testid="buddyMembers.error">{{ t(buddyErrorKey(error)) }}</p>

      <UiButton tone="danger" block :offline="!online" :disabled="busy" data-testid="buddyMembers.leave" @click="askLeave">{{ t('together.members.leave') }}</UiButton>
    </div>
  </UiSheet>

  <UiConfirm
    v-model:open="removeOpen"
    :title="removing?.waiting ? t('together.members.withdrawTitle', { name: removing?.name ?? '' }) : t('together.members.removeTitle', { name: removing?.name ?? '' })"
    :text="removing?.waiting ? t('together.members.withdrawText') : t('together.members.removeText')"
    :action="removing?.waiting ? t('together.members.withdraw') : t('together.members.remove')"
    :busy="busy"
    :offline="!online"
    :error="error ? t(buddyErrorKey(error)) : null"
    testid="buddyRemove"
    @confirm="remove"
  />

  <UiConfirm
    v-model:open="leaving"
    :title="t('together.members.leaveTitle')"
    :text="leaveText"
    :action="t('together.members.leave')"
    :busy="busy"
    :offline="!online"
    :error="error ? t(buddyErrorKey(error)) : null"
    testid="buddyLeave"
    @confirm="leave"
  >
    <UiCheckbox v-model="deleteMine" data-testid="buddyLeave.deleteMine">{{ t('together.members.deleteMine') }}</UiCheckbox>
  </UiConfirm>
</template>
