<script setup lang="ts">
// Her privacy (social v1, U1; Profile → Friends → Privacy). Private account first: on by default, she
// approves each follower; turning it off asks first (it accepts every request waiting) and turning it
// on writes at once. Then what followers see, seven switches written one by one as she turns them,
// what never shows, and Blocked, which opens the list of members she blocked. Every change is what the
// database answered (stores/social.ts); offline the switches say so and wait.
import { SOCIAL_SECTIONS } from '~/data/social'
import { useSocialStore } from '~/stores/social'
import { blockedValue, privateChange } from '~/utils/friendsRows'

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const social = useSocialStore()
const online = useOnline()

watch(open, (isOpen) => {
  if (!isOpen) return
  social.clearError('privacy')
  void social.load()
  void social.loadBlocked()
})

const disabled = computed(() => !online.value || social.busy || !social.mine)
const blockedOpen = ref(false)
const goingPublic = ref(false)

async function togglePrivate() {
  if (!social.mine || disabled.value) return
  const change = privateChange(social.mine.private, !social.mine.private)
  if (change === 'confirm') {
    social.clearError('privacy')
    goingPublic.value = true
  } else if (change === 'write') void social.setPrivate(true)
}
async function goPublic() {
  if (await social.setPrivate(false)) goingPublic.value = false
}
function toggle(section: (typeof SOCIAL_SECTIONS)[number]) {
  if (!social.mine || disabled.value) return
  void social.setSections({ [section]: !social.mine.sections[section] })
}

const blockedCount = computed(() => blockedValue(social.blocked?.length ?? null))
const error = computed(() => (social.errors.privacy && social.errors.privacy !== 'offline' ? t('privacy.error') : null))
</script>

<template>
  <UiSheet v-model:open="open" :title="t('privacy.title')" :action="t('privacy.done')" testid="privacy" @action="open = false">
    <div class="flex flex-col gap-lg pt-xs pb-lg">
      <div class="flex flex-col gap-sm">
        <UiRowGroup>
          <UiRow
            as="button"
            role="switch"
            :aria-checked="social.mine?.private ?? true"
            :label="t('privacy.private')"
            :disabled="disabled"
            class="disabled:opacity-50"
            data-testid="privacy.private"
            @click="togglePrivate"
          >
            <span v-if="!online" class="text-ink-muted">{{ t('common.offline') }}</span>
            <UiSwitch v-else :on="social.mine?.private ?? true" />
          </UiRow>
        </UiRowGroup>
        <p class="px-xs text-footnote text-ink-faint">{{ t('privacy.privateHint') }}</p>
      </div>

      <div class="flex flex-col gap-sm">
        <span class="eyebrow">{{ t('privacy.sections') }}</span>
        <UiRowGroup>
          <UiRow
            v-for="section in SOCIAL_SECTIONS"
            :key="section"
            as="button"
            role="switch"
            :aria-checked="social.mine?.sections[section] ?? true"
            :label="t(`privacy.section.${section}`)"
            :disabled="disabled"
            class="disabled:opacity-50"
            :data-testid="`privacy.section.${section}`"
            @click="toggle(section)"
          >
            <span v-if="!online" class="text-ink-muted">{{ t('common.offline') }}</span>
            <UiSwitch v-else :on="social.mine?.sections[section] ?? true" />
          </UiRow>
        </UiRowGroup>
        <p class="px-xs text-footnote text-ink-faint">{{ t('privacy.never') }}</p>
      </div>

      <p v-if="error && !goingPublic" class="text-footnote text-error" role="alert" data-testid="privacy.error">{{ error }}</p>

      <UiRowGroup>
        <UiRow
          as="button"
          :label="t('privacy.blocked')"
          :disabled="!social.blocked && !!social.errors.blocked"
          class="disabled:opacity-50"
          chevron
          data-testid="privacy.blocked"
          @click="blockedOpen = true"
        >
          <span v-if="social.blocked" class="text-ink-muted" data-testid="privacy.blockedValue">{{ blockedCount ?? t('privacy.blockedNone') }}</span>
          <span v-else-if="!online" class="text-ink-muted" data-testid="privacy.blockedOffline">{{ t('common.offline') }}</span>
        </UiRow>
      </UiRowGroup>
    </div>
  </UiSheet>

  <FriendsBlockedSheet v-model:open="blockedOpen" />

  <UiConfirm
    v-model:open="goingPublic"
    :title="t('privacy.goPublicTitle')"
    :text="t('privacy.goPublicText')"
    :action="t('privacy.goPublicConfirm')"
    tone="primary"
    :busy="social.busy"
    :offline="!online"
    :error="error"
    testid="goPublic"
    @confirm="goPublic"
  />
</template>
