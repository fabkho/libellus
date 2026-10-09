<script setup lang="ts">
// A follow link (social v1, §B 7): `/f/<token>`, the address a member sends her follow link as.
// Signed in, the token resolves (`follow_target`, stores/social.ts) and the page replaces itself in
// the history with her profile (`/friends/<id>`, which shows her card or her reading and Follow /
// Ask to follow); her own link goes to Profile. A dead link (renewed, unknown, or she blocked the
// visitor: the database answers null for all of them alike) says so, with a way Home. Offline
// nothing is asked: the app's offline line and Try again.
//
// Signed out, the link never gets this far: the auth middleware keeps the token on the device and
// sends the visitor to Sign in, and brings her back here once she is in (utils/pendingFollow.ts).
// Like the share target it has no tab bar: it is a moment's redirect.
import { useSocialStore } from '~/stores/social'
import { isFollowToken, PENDING_FOLLOW_KEY } from '~/utils/pendingFollow'

definePageMeta({ layout: false, screen: 'follow' })

type Outcome = 'loading' | 'missing' | 'offline' | 'error'

const { t } = useI18n()
const route = useRoute()
const social = useSocialStore()
const online = useOnline()

useHead({ title: () => t('app.name') })

const token = computed(() => String(route.params.token ?? ''))
const outcome = ref<Outcome>('loading')

async function open() {
  outcome.value = 'loading'
  // The link she is on is the one that counts: a kept one from before is spent.
  window.localStorage.removeItem(PENDING_FOLLOW_KEY)
  if (!isFollowToken(token.value)) return void (outcome.value = 'missing')
  if (!online.value) return void (outcome.value = 'offline')

  const mine = token.value
  const result = await social.target(mine)
  // She moved on while it was asked.
  if (token.value !== mine) return
  if (result.error === 'offline') return void (outcome.value = 'offline')
  if (result.error) return void (outcome.value = 'error')
  if (!result.data) return void (outcome.value = 'missing')
  await navigateTo(result.data.state === 'self' ? '/profile' : `/friends/${result.data.member.id}`, { replace: true })
}

onMounted(open)
</script>

<template>
  <main class="screen-inset flex min-h-dvh flex-col px-lg" data-testid="follow">
    <p class="pt-lg text-center font-serif text-callout lowercase italic text-ink-muted">{{ t('app.name') }}</p>

    <div v-if="outcome === 'loading'" class="flex flex-1 items-center justify-center" role="status" data-testid="follow.loading">
      <p class="text-subhead text-ink-muted">{{ t('follow.loading') }}</p>
    </div>

    <div v-else-if="outcome === 'missing'" class="flex flex-1 flex-col justify-center gap-sm py-xxl" data-testid="follow.missing">
      <h1 class="book-title text-title">{{ t('follow.missingTitle') }}</h1>
      <p class="text-body text-ink-muted">{{ t('follow.missing') }}</p>
      <UiButton to="/" tone="secondary" size="md" class="mt-md self-start" data-testid="follow.home">{{ t('tabs.home') }}</UiButton>
    </div>

    <div v-else class="flex flex-1 flex-col items-center justify-center gap-md text-center" role="status" data-testid="follow.error">
      <h1 class="sr-only">{{ t('app.name') }}</h1>
      <p class="text-subhead text-ink-muted">{{ outcome === 'offline' ? t('readingPage.offline') : t('readingPage.error') }}</p>
      <UiButton tone="secondary" size="md" data-testid="follow.retry" @click="open">{{ t('readingPage.retry') }}</UiButton>
    </div>
  </main>
</template>
