<script setup lang="ts">
// The top of a tab, laid out as iOS's Large Title bar: under the status bar
// (`bar-top`: at least `barTop` off the top edge, so in a browser tab the row
// stands clear of the browser's toolbar) a 44 pt controls row holding the avatar at the trailing
// edge (it opens the Profile, issue #78; while changes wait to sync, the quiet sync chip sits at the
// leading one, #93), then the title block `bar` (10) below it and `bar` above the page —
// a mono date eyebrow over the greeting on Home, a large title elsewhere. The
// pushed screens with a large title (Collections, Import) put theirs on the
// same row under their UiTopBar. The title's test ID is `<screen>.title`. The
// avatar shows her photo (the small copy, #156) where she has one. While a follow request waits
// (social v1, U3) a small lamp-coloured dot sits on the avatar and its name says so: no number, no
// badge; a buddy read invitation (W3, stores/buddyInvites.ts) lights the same dot. Her settings (which carry the count) are read once when the shell starts and again whenever
// the app comes back to the foreground, online only (stores/social.ts).
import { useAvatarStore } from '~/stores/avatar'
import { useBuddyInvitesStore } from '~/stores/buddyInvites'
import { useSessionStore } from '~/stores/session'
import { useSocialStore } from '~/stores/social'

withDefaults(defineProps<{ screen: string; title: string; size?: 'title' | 'large'; eyebrow?: string }>(), {
  size: 'large',
  eyebrow: undefined,
})

const { t } = useI18n()
const session = useSessionStore()
const initials = computed(() => initialsOf(session.member?.email ?? '', session.member?.name))
const avatar = useAvatarStore()
onMounted(() => void avatar.load())

const social = useSocialStore()
const online = useOnline()
// A buddy read invitation lights the same lamp (only in a build with buddy reads, and only while she has them on: the store asks nothing else).
const invites = useBuddyInvitesStore()
const requestWaits = computed(() => social.requests > 0)
const inviteWaits = computed(() => invites.count > 0)
const avatarLabel = computed(() =>
  requestWaits.value && inviteWaits.value
    ? t('shell.avatarBoth', { initials: initials.value })
    : requestWaits.value
      ? t('shell.avatarRequest', { initials: initials.value })
      : inviteWaits.value
        ? t('shell.avatarInvite', { initials: initials.value })
        : t('shell.avatarLabel', { initials: initials.value }),
)
function refreshRequests() {
  if (document.visibilityState !== 'visible' || !online.value) return
  void social.load(true)
  void invites.load()
}
onMounted(() => {
  if (online.value) {
    void social.load()
    void invites.load()
  }
  document.addEventListener('visibilitychange', refreshRequests)
})
onUnmounted(() => document.removeEventListener('visibilitychange', refreshRequests))
</script>

<template>
  <header class="bar-top relative z-20 px-screen" data-testid="shell.header">
    <div class="flex h-(--size-touch) items-center justify-between gap-sm">
      <ShellSyncChip />
      <!-- A tab's own button (the Friends tab's People) sits beside the avatar, at the trailing edge. -->
      <div class="flex shrink-0 items-center">
        <slot name="actions" />
        <!-- Her initials are what is drawn on the avatar, so they are what its name starts with: a voice user says
             what she sees (WCAG 2.5.3, label in name). -->
        <NuxtLink
          to="/profile"
          :aria-label="avatarLabel"
          class="-mr-sm flex shrink-0 size-(--size-touch) items-center justify-center"
          data-testid="shell.avatar"
        >
          <span class="relative flex">
            <UiAvatar :initials="initials" :photo="avatar.small" data-profile-avatar />
            <Transition name="dot">
              <span v-if="requestWaits || inviteWaits" class="request-dot pointer-events-none absolute rounded-pill bg-accent" aria-hidden="true" data-testid="shell.avatarDot" />
            </Transition>
          </span>
        </NuxtLink>
      </div>
    </div>
    <div class="flex min-w-0 flex-col gap-sm py-bar">
      <p v-if="eyebrow" class="eyebrow" :data-testid="`${screen}.date`">{{ eyebrow }}</p>
      <h1 class="truncate" :class="size === 'title' ? 'text-title' : 'text-large-title'" :data-testid="`${screen}.title`">
        {{ title }}
      </h1>
    </div>
  </header>
</template>

<style scoped>
/* A lamp dot on the avatar's upper right edge, ringed in the room colour so it reads on a photo too. */
.request-dot {
  top: 0;
  right: 0;
  width: var(--spacing-sm);
  height: var(--spacing-sm);
  border: var(--stroke-rule) solid var(--color-surface);
}
.dot-enter-active,
.dot-leave-active {
  transition: opacity var(--duration-quick) var(--ease-standard);
}
.dot-enter-from,
.dot-leave-to {
  opacity: 0;
}
</style>
