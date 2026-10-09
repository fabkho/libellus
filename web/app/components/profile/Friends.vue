<script setup lang="ts">
// Profile → Friends (social v1, U1): her side of following. Your circle (the feed: always reachable here,
// also when Home shows no Your circle), then three rows. People (how many requests
// wait, else nothing; to the People page), Your follow link (opens its sheet) and Privacy (Private or
// Public; opens the privacy sheet, which holds what followers see and who she blocked). Read when the
// Profile opens, before Share.
import { useSocialStore } from '~/stores/social'
import { privacyValueKey, requestsValue } from '~/utils/friendsRows'

const { t } = useI18n()
const social = useSocialStore()
const linkOpen = ref(false)
const privacyOpen = ref(false)
onMounted(() => void social.load())

const waiting = computed(() => requestsValue(social.mine))
const privacy = computed(() => privacyValueKey(social.mine))
</script>

<template>
  <section id="friends" class="flex flex-col gap-sm" data-testid="profile.friends">
    <h2 class="eyebrow">{{ t('friends.section') }}</h2>
    <UiRowGroup>
      <UiRow to="/friends" icon="stack" :label="t('circle.title')" chevron data-testid="profile.circle" />
      <UiRow to="/friends/people" icon="people" :label="t('friends.people')" chevron data-testid="profile.people">
        <span v-if="waiting" class="text-ink-muted" data-testid="profile.peopleValue">{{ t('friends.peopleRequests', { count: waiting }, waiting) }}</span>
      </UiRow>
      <UiRow as="button" icon="share" :label="t('friends.followLink')" chevron data-testid="profile.followLink" @click="linkOpen = true" />
      <UiRow as="button" icon="lock" :label="t('friends.privacy')" chevron data-testid="profile.privacy" @click="privacyOpen = true">
        <span v-if="privacy" class="text-ink-muted" data-testid="profile.privacyValue">{{ t(privacy) }}</span>
      </UiRow>
    </UiRowGroup>
    <FriendsLinkSheet v-model:open="linkOpen" />
    <FriendsPrivacySheet v-model:open="privacyOpen" />
  </section>
</template>
