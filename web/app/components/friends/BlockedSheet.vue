<script setup lang="ts">
// Who she blocked (social v1, U1; Privacy → Blocked): one row per member with Unblock, or a line saying
// there is none. Unblocking changes nobody's follow: it only lets that member find her link again.
import { useSocialStore } from '~/stores/social'
import { initialsOf } from '~/utils/initials'

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const social = useSocialStore()
const online = useOnline()

watch(open, (isOpen) => {
  if (!isOpen) return
  social.clearError('unblock')
  void social.loadBlocked(true)
})

const disabled = computed(() => !online.value || social.busy)
const error = computed(() => (social.errors.unblock && social.errors.unblock !== 'offline' ? t('privacy.error') : null))
</script>

<template>
  <UiSheet v-model:open="open" :title="t('blocked.title')" testid="blocked">
    <div class="flex flex-col gap-md pt-xs pb-lg">
      <UiListMotion v-if="social.blocked?.length" still tag="ul" class="overflow-hidden rounded-md bg-fill edge-faint">
        <li
          v-for="member in social.blocked"
          :key="member.id"
          class="flex min-h-(--size-row) items-center gap-ms border-hairline-strong px-inset py-xs not-first:border-t"
          data-testid="blocked.row"
        >
          <UiAvatar :initials="initialsOf('', member.name)" />
          <span class="min-w-0 flex-1 truncate text-body">{{ member.name ?? t('member.someone') }}</span>
          <UiButton
            tone="secondary"
            size="sm"
            :disabled="disabled"
            :offline="!online"
            :aria-label="online ? t('blocked.unblockLabel', { name: member.name?.trim() || t('member.someone') }) : undefined"
            data-testid="blocked.unblock"
            @click="social.unblock(member.id)"
          >
            {{ t('blocked.unblock') }}
          </UiButton>
        </li>
      </UiListMotion>
      <p v-else-if="social.blocked" class="py-md text-center text-subhead text-ink-muted" data-testid="blocked.empty">{{ t('blocked.empty') }}</p>
      <p v-if="error" class="text-footnote text-error" role="alert" data-testid="blocked.error">{{ error }}</p>
    </div>
  </UiSheet>
</template>
