<script setup lang="ts">
// The top of the Profile (issue #78, B's hero): the member's initials large in
// a ring, her name (or the address while she has none), since when she reads
// here, and the Library in one mono line — read · reading · want to read.
import { useSessionStore } from '~/stores/session'

defineProps<{ since: string | null; read: number; reading: number; want: number }>()

const { t } = useI18n()
const session = useSessionStore()
const { count, monthYear } = useFigures()
const initials = computed(() => initialsOf(session.member?.email ?? '', session.member?.name))
</script>

<template>
  <section class="relative flex flex-col items-center px-xl pt-sm text-center" data-testid="profile.hero">
    <span
      class="ring figures flex items-center justify-center rounded-pill bg-surface-raised text-title text-ink-muted shadow-cover edge"
      aria-hidden="true"
      data-testid="profile.initials"
    >
      {{ initials }}
    </span>
    <h1 class="mt-md max-w-full truncate text-title" data-testid="profile.title">{{ session.member?.name ?? session.member?.email ?? '' }}</h1>
    <p v-if="since" class="mt-xs text-body text-ink-muted" data-testid="profile.since">{{ t('profile.since', { date: monthYear(since) }) }}</p>
    <p class="eyebrow mt-sm" data-testid="profile.library">
      {{ t('profile.library', { read: count(read), reading: count(reading), want: count(want) }) }}
    </p>
  </section>
</template>

<style scoped>
.ring {
  width: var(--size-cover-md);
  height: var(--size-cover-md);
}
</style>
