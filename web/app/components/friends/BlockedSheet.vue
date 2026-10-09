<script setup lang="ts">
// Who she blocked (social v1, U1; Privacy → Blocked): one row per member with Unblock, or a line saying
// there is none. Unblocking changes nobody's follow: it only lets that member find her link again.
import { useSocialStore } from '~/stores/social'
import type { MemberCard } from '~/data/socialShapes'

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const social = useSocialStore()
const online = useOnline()

watch(open, (isOpen) => {
  if (!isOpen) return
  said.value = ''
  social.clearError('unblock')
  void social.loadBlocked(true)
})

/** What the last Unblock did, said politely: the row just leaves (a11y). */
const said = ref('')
const body = useTemplateRef<HTMLElement>('body')
const nameOf = (member: MemberCard) => member.name?.trim() || t('member.someone')

/** Unblock; the row leaves, so focus goes to the one that takes its place, or to the line saying there are none. */
async function unblock(member: MemberCard) {
  const rows = [...(body.value?.querySelectorAll<HTMLElement>('[data-testid="blocked.row"]') ?? [])]
  const at = rows.findIndex((row) => row.contains(document.activeElement))
  const rest = rows.filter((_, index) => index !== at)
  const next = rest[at] ?? rest[at - 1]
  if (!(await social.unblock(member.id))) return
  said.value = t('blocked.unblocked', { name: nameOf(member) })
  if (at < 0) return
  await nextTick()
  const target = next?.querySelector<HTMLElement>('[data-testid="blocked.unblock"]') ?? body.value?.querySelector<HTMLElement>('[data-testid="blocked.empty"]')
  target?.focus()
}

const disabled = computed(() => !online.value || social.busy)
const error = computed(() => (social.errors.unblock && social.errors.unblock !== 'offline' ? t('privacy.error') : null))
</script>

<template>
  <UiSheet v-model:open="open" :title="t('blocked.title')" testid="blocked">
    <div ref="body" class="flex flex-col gap-md pt-xs pb-lg">
      <p class="sr-only" role="status" data-testid="blocked.status">{{ said }}</p>
      <UiRowGroup v-if="social.blocked?.length">
        <UiListMotion still tag="ul">
          <li
            v-for="member in social.blocked"
            :key="member.id"
            class="flex min-h-(--size-row) items-center gap-ms border-hairline px-inset py-xs not-first:border-t"
            data-testid="blocked.row"
          >
            <FriendsAvatar :card="member" />
            <span class="min-w-0 flex-1 truncate text-body">{{ nameOf(member) }}</span>
            <UiButton
              tone="secondary"
              size="sm"
              :disabled="disabled"
              :offline="!online"
              :aria-label="online ? t('blocked.unblockLabel', { name: nameOf(member) }) : undefined"
              data-testid="blocked.unblock"
              @click="unblock(member)"
            >
              {{ t('blocked.unblock') }}
            </UiButton>
          </li>
        </UiListMotion>
      </UiRowGroup>
      <p v-else-if="social.blocked" tabindex="-1" class="py-md text-center text-subhead text-ink-muted" data-testid="blocked.empty">{{ t('blocked.empty') }}</p>
      <p v-if="error" class="text-footnote text-error" role="alert" data-testid="blocked.error">{{ error }}</p>
    </div>
  </UiSheet>
</template>
