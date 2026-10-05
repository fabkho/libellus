<script setup lang="ts">
// The top of a tab, laid out as iOS's Large Title bar: under the status bar
// (`bar-top`: at least `barTop` off the top edge, so in a browser tab the row
// stands clear of the browser's toolbar) a 44 pt controls row holding the avatar at the trailing
// edge (it opens the Profile, issue #78; while changes wait to sync, the quiet sync chip sits at the
// leading one, #93), then the title block `bar` (10) below it and `bar` above the page —
// a mono date eyebrow over the greeting on Home, a large title elsewhere. The
// pushed screens with a large title (Collections, Import) put theirs on the
// same row under their UiTopBar. The title's test ID is `<screen>.title`.
import { useSessionStore } from '~/stores/session'

withDefaults(defineProps<{ screen: string; title: string; size?: 'title' | 'large'; eyebrow?: string }>(), {
  size: 'large',
  eyebrow: undefined,
})

const { t } = useI18n()
const session = useSessionStore()
const initials = computed(() => initialsOf(session.member?.email ?? '', session.member?.name))
</script>

<template>
  <header class="bar-top relative z-20 px-screen" data-testid="shell.header">
    <div class="flex h-(--size-touch) items-center justify-between gap-sm">
      <ShellSyncChip />
      <NuxtLink
        to="/profile"
        :aria-label="t('shell.avatarLabel')"
        class="-mr-sm flex shrink-0 size-(--size-touch) items-center justify-center"
        data-testid="shell.avatar"
      >
        <UiAvatar :initials="initials" data-profile-avatar />
      </NuxtLink>
    </div>
    <div class="flex min-w-0 flex-col gap-sm py-bar">
      <p v-if="eyebrow" class="eyebrow" :data-testid="`${screen}.date`">{{ eyebrow }}</p>
      <h1 class="truncate" :class="size === 'title' ? 'text-title' : 'text-large-title'" :data-testid="`${screen}.title`">
        {{ title }}
      </h1>
    </div>
  </header>
</template>
