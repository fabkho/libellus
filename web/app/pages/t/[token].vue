<script setup lang="ts">
// A buddy read link (W3): `/t/<token>`, the address the Host sends her link as, the twin of `/f/<token>` (pages/f/[token].vue). Behind the sign-in:
// signed out, the token is kept through it (utils/pendingBuddyRead.ts, middleware/auth.global.ts) and she comes back here.
//
// What it shows, in order: the join card (`buddy_read_target`): the Book, who hosts it, who is in, how many Sections and the day it
// starts, with Join and Not now. Join → `join_buddy_read`, then "Which copy are you reading?" (components/together/EntryPicker.vue: which of her entries
// her Section follows), then the room. A member who is in already is told so and offered the room. A link that does not work, whatever the reason (a
// bad token, renewed, off, the read ended or full, she is blocked with someone in it or was removed) is one answer: "This link doesn't work anymore".
// Offline nothing is asked: the offline line and Try again. No tab bar: it is a moment, like the follow link.
import type { BuddyErrorCode, BuddyTarget } from '~/data/buddyReads'
import { useBuddyReadStore } from '~/stores/buddyRead'
import { buddyErrorKey } from '~/utils/buddyRead'
import { roomPath } from '~/utils/buddyRoute'
import { isBuddyReadToken, PENDING_BUDDY_READ_KEY } from '~/utils/pendingBuddyRead'

definePageMeta({ layout: false, screen: 'buddyLink' })

type Outcome = 'loading' | 'card' | 'member' | 'copy' | 'missing' | 'offline' | 'error'

const { t } = useI18n()
const route = useRoute()
const store = useBuddyReadStore()
const online = useOnline()
const coverHosts = { ...useCoverHosts(), proxy: false }

// The address carries the link's token: no request this page makes (covers, the API) says where it was opened from (public/_headers does the same for the document).
useHead({ title: () => `${t('together.link.pageTitle')} · ${t('app.name')}`, meta: [{ name: 'referrer', content: 'no-referrer' }] })

const token = computed(() => String(route.params.token ?? ''))
const outcome = ref<Outcome>('loading')
const target = ref<BuddyTarget | null>(null)
const joining = ref(false)
const refusal = ref<BuddyErrorCode | null>(null)

async function open() {
  outcome.value = 'loading'
  refusal.value = null
  // The link she is on is the one that counts: a kept one from before is spent.
  window.localStorage.removeItem(PENDING_BUDDY_READ_KEY)
  if (!isBuddyReadToken(token.value)) return void (outcome.value = 'missing')
  if (!online.value) return void (outcome.value = 'offline')

  const mine = token.value
  const result = await store.target(mine)
  // She moved on while it was asked.
  if (token.value !== mine) return
  if (result.error === 'offline') return void (outcome.value = 'offline')
  if (result.error) return void (outcome.value = 'error')
  if (!result.data) return void (outcome.value = 'missing')
  target.value = result.data
  outcome.value = result.data.state === 'member' ? 'member' : 'card'
  // The token has done its work in the address: the history, a share sheet and a screenshot of the bar need not carry it (the join uses the one in memory).
  window.history.replaceState(window.history.state, '', '/t/')
}

async function join() {
  if (!target.value || joining.value) return
  joining.value = true
  refusal.value = null
  const answer = await store.join(token.value)
  joining.value = false
  if (answer.error) {
    // The one answer for a link that stopped working between the card and the tap.
    if (answer.error === 'not_found') return void (outcome.value = 'missing')
    refusal.value = answer.error
    return
  }
  outcome.value = 'copy'
}

const goRoom = () => navigateTo(roomPath(target.value!.id), { replace: true })
const goHome = () => navigateTo('/', { replace: true })

const heading = useTemplateRef<HTMLElement>('heading')
// Moving from one state to the next hands focus to the new heading: the card, the copy question, the answer.
watch(outcome, async () => {
  await nextTick()
  heading.value?.focus()
})

const host = computed(() => target.value?.host?.name?.trim() || t('member.someone'))
const names = computed(() => (target.value?.members ?? []).map((m) => m.name?.trim() || t('member.someone')))
const faces = computed(() => (target.value?.members ?? []).map((m, i) => ({ initials: initialsOf('', m.name), photo: m.photo, label: names.value[i]! })))

onMounted(open)
</script>

<template>
  <main class="screen-inset flex min-h-dvh flex-col px-lg" data-testid="buddyLink">
    <p class="pt-lg text-center font-serif text-callout lowercase italic text-ink-muted">{{ t('app.name') }}</p>

    <div v-if="outcome === 'loading'" class="flex flex-1 items-center justify-center" role="status" data-testid="buddyLink.loading">
      <p class="text-subhead text-ink-muted">{{ t('together.link.loading') }}</p>
    </div>

    <!-- A link that does not work, whatever the reason: one answer. -->
    <FriendsNote v-else-if="outcome === 'missing'" heading :title="t('together.link.missingTitle')" :text="t('together.link.missing')" class="flex-1 justify-center" data-testid="buddyLink.missing">
      <UiButton to="/" tone="secondary" size="md" data-testid="buddyLink.home">{{ t('tabs.home') }}</UiButton>
    </FriendsNote>

    <!-- The join card. -->
    <div v-else-if="outcome === 'card' && target" class="flex flex-1 flex-col justify-center gap-md py-xl" data-testid="buddyLink.card">
      <div class="flex justify-center">
        <UiCover
          decorative
          :title="target.book.title"
          :authors="target.book.authors"
          v-bind="coverImage(target.book, 'md', coverHosts)"
          :thumbhash="target.book.coverThumbhash"
          :colors="target.book.coverColors"
          size="md"
        />
      </div>
      <div class="flex flex-col items-center gap-xs text-center">
        <p class="eyebrow">{{ t('together.link.eyebrow') }}</p>
        <h1 ref="heading" tabindex="-1" class="book-title text-title outline-none" data-testid="buddyLink.title">{{ target.book.title }}</h1>
        <p class="text-subhead text-ink-muted">{{ formatAuthors(target.book.authors, t('common.etAl')) }}</p>
      </div>
      <p class="text-center text-body text-ink-muted">
        {{ target.state === 'invited' ? t('together.link.invitedBy', { name: host }) : t('together.link.hostedBy', { name: host }) }}
      </p>
      <div class="flex flex-col items-center gap-xs">
        <UiAvatarStack :faces="faces" :max="5" :label="names.join(t('common.listSeparator'))">
          <template #face="{ index }"><FriendsAvatar :card="target.members[index]!" /></template>
        </UiAvatarStack>
        <p class="text-caption text-ink-muted" data-testid="buddyLink.meta">
          {{ t('together.count.readers', { count: target.memberCount }, target.memberCount) }}<span aria-hidden="true"> · </span><span class="sr-only">, </span>{{ t('together.count.sections', { count: target.sections }, target.sections) }}
        </p>
      </div>
      <p class="text-center text-footnote text-ink-faint">{{ t('together.hint') }}</p>
      <p v-if="refusal" class="text-center text-caption text-error" role="alert" data-testid="buddyLink.error">{{ t(buddyErrorKey(refusal)) }}</p>
      <UiButton block :disabled="joining" :offline="!online" :aria-busy="joining" data-testid="buddyLink.join" @click="join">
        {{ joining ? t('together.link.joining') : t('together.link.join') }}
      </UiButton>
      <UiButton block tone="plain" :disabled="joining" data-testid="buddyLink.notNow" @click="goHome">{{ t('together.link.notNow') }}</UiButton>
    </div>

    <!-- Already in. -->
    <div v-else-if="outcome === 'member' && target" class="flex flex-1 flex-col justify-center gap-md py-xl" data-testid="buddyLink.member">
      <h1 ref="heading" tabindex="-1" class="book-title text-center text-title outline-none">{{ t('together.link.memberTitle') }}</h1>
      <p class="text-center text-body text-ink-muted">{{ t('together.link.memberText', { title: target.book.title }) }}</p>
      <UiButton block data-testid="buddyLink.room" @click="goRoom">{{ t('together.link.openRoom') }}</UiButton>
    </div>

    <!-- Joined: which copy. -->
    <div v-else-if="outcome === 'copy' && target" class="flex flex-1 flex-col justify-center gap-md py-xl" data-testid="buddyLink.copy">
      <h1 ref="heading" tabindex="-1" class="book-title text-center text-title outline-none">{{ t('together.link.joinedTitle', { title: target.book.title }) }}</h1>
      <TogetherEntryPicker :read-id="target.id" :book="target.book" @done="goRoom" />
    </div>

    <template v-else>
      <h1 class="sr-only">{{ t('app.name') }}</h1>
      <FriendsNote :text="outcome === 'offline' ? t('readingPage.offline') : t('readingPage.error')" role="status" class="flex-1 justify-center" data-testid="buddyLink.error">
        <UiButton tone="secondary" size="md" data-testid="buddyLink.retry" @click="open">{{ t('readingPage.retry') }}</UiButton>
      </FriendsNote>
    </template>
  </main>
</template>
