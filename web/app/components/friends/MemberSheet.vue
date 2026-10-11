<script setup lang="ts">
// What she can do about a member (social v1, U3): People's ⋯ on a row and, later, the ⋯ on a member's
// profile. A bottom sheet titled with the member's name: Unfollow (when she follows the member),
// Remove as follower (when the member follows her), Block in the danger colour, and a note under them
// that the member isn't told. Unfollow and Remove act at once; Block asks first (`blockConfirm`).
// Each action is done through stores/social.ts, which reads her lists again afterwards. Offline the
// rows say Offline and wait.
//
// API:
//   <FriendsMemberSheet v-model:open="open" :member="card" :following="…" :follower="…" @changed="…" />
//  - `v-model:open`  shown or not. Closes itself after an action went through (or on Cancel).
//  - `member`        the MemberCard the sheet is about; null while none is chosen (nothing shows).
//  - `following`     she follows the member (offers Unfollow).
//  - `follower`      the member follows her (offers Remove as follower).
//  - `@changed`      `(action: 'unfollow' | 'remove' | 'block')` once the database accepted it, so the
//                    screen under the sheet can update (a profile goes back to its Follow button; the
//                    People lists are already read again by the store).
// Which rows a relation gets is `memberActions` (utils/people.ts). Test ids: `memberSheet` (`.cancel`,
// `.unfollow`, `.remove`, `.block`, `.error`), and the confirm `blockConfirm` (`.confirm`, `.cancel`).
import type { MemberCard } from '~/data/socialShapes'
import { useSocialStore } from '~/stores/social'
import { memberActions, type MemberAction } from '~/utils/people'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ member: MemberCard | null; following: boolean; follower: boolean }>()
const emit = defineEmits<{ changed: [action: MemberAction] }>()

const { t } = useI18n()
const social = useSocialStore()
const online = useOnline()

const name = computed(() => props.member?.name?.trim() || t('member.someone'))
const actions = computed(() => memberActions({ following: props.following, follower: props.follower }))
const confirming = ref(false)
const working = ref(false)
const failed = ref(false)

watch(open, (isOpen) => {
  if (isOpen) {
    failed.value = false
    social.clearError('follow')
  } else confirming.value = false
})

const disabled = computed(() => !online.value || working.value)

/** Runs one action; true when the database accepted it (the sheet then closes). */
async function run(action: MemberAction): Promise<boolean> {
  const id = props.member?.id
  if (!id || disabled.value) return false
  working.value = true
  failed.value = false
  const result = await (action === 'unfollow' ? social.unfollow(id) : action === 'remove' ? social.removeFollower(id) : social.block(id)).finally(
    () => (working.value = false),
  )
  if (result.error) {
    failed.value = result.error !== 'offline'
    return false
  }
  open.value = false
  emit('changed', action)
  return true
}
</script>

<template>
  <UiSheet v-model:open="open" :title="name" testid="memberSheet">
    <div class="flex flex-col gap-sm pt-xs pb-lg">
      <UiRowGroup>
        <UiRow
          v-if="actions.includes('unfollow')"
          as="button"
          icon="minus"
          :label="t('people.unfollow')"
          :disabled="disabled"
          class="disabled:opacity-50"
          data-testid="memberSheet.unfollow"
          @click="run('unfollow')"
        >
          <span v-if="!online" class="text-ink-muted">{{ t('common.offline') }}</span>
        </UiRow>
        <UiRow
          v-if="actions.includes('remove')"
          as="button"
          icon="close"
          :label="t('people.remove')"
          :disabled="disabled"
          class="disabled:opacity-50"
          data-testid="memberSheet.remove"
          @click="run('remove')"
        >
          <span v-if="!online" class="text-ink-muted">{{ t('common.offline') }}</span>
        </UiRow>
        <UiRow
          as="button"
          icon="slash"
          tone="danger"
          :label="t('people.block')"
          :disabled="disabled"
          class="disabled:opacity-50"
          data-testid="memberSheet.block"
          @click="((failed = false), (confirming = true))"
        >
          <span v-if="!online" class="text-ink-muted">{{ t('common.offline') }}</span>
        </UiRow>
      </UiRowGroup>
      <p class="px-xs text-footnote text-ink-faint">{{ t('people.sheetNote', { name }) }}</p>
      <p v-if="failed && !confirming" class="px-xs text-footnote text-error" role="alert" data-testid="memberSheet.error">{{ t('people.error') }}</p>
    </div>
  </UiSheet>

  <UiConfirm
    v-model:open="confirming"
    :title="t('people.blockTitle', { name })"
    :text="t('people.blockText')"
    :action="t('people.blockConfirm')"
    :busy="working"
    :offline="!online"
    :error="failed ? t('people.error') : null"
    testid="blockConfirm"
    @confirm="run('block')"
  />
</template>
