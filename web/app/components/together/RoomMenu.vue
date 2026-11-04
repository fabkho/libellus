<script setup lang="ts">
// The room's ⋯ (docs/plans/buddy-read-shared.md part B, 3): "Where are you?" for everybody, and for the host "Finish this buddy read"
// (threads stay writable, the link and invitations stop) and "Archive" (read-only for good). Each of the host's two asks first and says
// what it does (UiConfirm); a refusal stays in the question, worded. The sheet's own rows are one `UiRowGroup`; the `members` slot,
// above it, is where the setup work puts what is not this screen's: Invite, Members (Remove for the host) and Leave (W3,
// docs/plans/buddy-read-shared.md part 3, "W3"). Nothing here calls a buddy RPC until she chooses a row.
import type { BuddyErrorCode, BuddyRead } from '~/data/buddyReads'
import { buddyErrorKey } from '~/utils/buddyRead'
import { useBuddyReadStore } from '~/stores/buddyRead'

const props = defineProps<{ read: BuddyRead }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ marker: []; done: [what: 'finished' | 'archived'] }>()
defineSlots<{ members?: () => unknown }>()

const { t } = useI18n()
const store = useBuddyReadStore()
const online = useOnline()

const host = computed(() => props.read.canManage)
const canFinish = computed(() => host.value && props.read.status === 'active')
const canArchive = computed(() => host.value && props.read.status !== 'archived')

const asking = ref<'finish' | 'archive' | null>(null)
const confirming = computed({
  get: () => asking.value !== null,
  set: (value) => {
    if (!value) asking.value = null
  },
})
// Kept while the question slides away.
const which = ref<'finish' | 'archive'>('finish')
const busy = ref(false)
const error = ref<BuddyErrorCode | null>(null)

function ask(what: 'finish' | 'archive') {
  which.value = what
  error.value = null
  open.value = false
  asking.value = what
}

async function confirm() {
  if (busy.value) return
  busy.value = true
  error.value = null
  const what = which.value
  const answer = what === 'finish' ? await store.finish(props.read.id) : await store.archive(props.read.id)
  busy.value = false
  if (answer.error) {
    error.value = answer.error
    return
  }
  asking.value = null
  emit('done', what === 'finish' ? 'finished' : 'archived')
}

function marker() {
  open.value = false
  emit('marker')
}
</script>

<template>
  <UiSheet v-model:open="open" :title="t('together.menu.title')" testid="together.menu">
    <div class="flex flex-col gap-md pt-xs pb-lg">
      <slot name="members" />
      <UiRowGroup>
        <UiRow v-if="read.status !== 'archived'" as="button" icon="pin" :label="t('together.marker.open')" data-testid="together.menu.marker" @click="marker" />
        <UiRow
          v-if="canFinish"
          as="button"
          icon="checkCircle"
          :label="t('together.menu.finish')"
          :value="online ? undefined : t('common.offline')"
          :disabled="!online"
          data-testid="together.menu.finish"
          @click="ask('finish')"
        />
        <UiRow
          v-if="canArchive"
          as="button"
          icon="lock"
          :label="t('together.menu.archive')"
          :value="online ? undefined : t('common.offline')"
          :disabled="!online"
          data-testid="together.menu.archive"
          @click="ask('archive')"
        />
      </UiRowGroup>
      <p v-if="host && read.status !== 'archived'" class="px-inset text-footnote text-ink-faint" data-testid="together.menu.hint">{{ t('together.menu.hint') }}</p>
    </div>
  </UiSheet>

  <UiConfirm
    v-model:open="confirming"
    :title="t(`together.${which}.title`)"
    :text="t(`together.${which}.text`)"
    :action="busy ? t(`together.${which}.busy`) : t(`together.${which}.action`)"
    :busy="busy"
    :error="error ? t(buddyErrorKey(error)) : null"
    :offline="!online"
    :tone="which === 'archive' ? 'danger' : 'primary'"
    :testid="`together.${which}`"
    @confirm="confirm"
  />
</template>
