<script setup lang="ts">
// The top of the Profile (issue #78, B's hero): the member's initials large in
// a ring, her name (or the address while she has none), since when she reads
// here, and the Library in one mono line — read · reading · want to read.
// While the reading record loads (`loading`) the two lines under the name
// are placeholders; the "since" line closes if it turns out to have nothing
// to say (docs/MOTION.md, Loading).
import { useSessionStore } from '~/stores/session'

const props = withDefaults(
  defineProps<{
    since: string | null
    read: number
    reading: number
    want: number
    loading?: boolean
    /** Whether a "since" line is likely while loading (a member with something finished). */
    expectSince?: boolean
  }>(),
  { loading: false, expectSince: true },
)
const arriving = useArrival(() => props.loading)

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
      data-profile-avatar
      data-testid="profile.initials"
    >
      {{ initials }}
    </span>
    <h1 class="mt-md max-w-full truncate text-title" data-testid="profile.title">{{ session.member?.name ?? session.member?.email ?? '' }}</h1>
    <UiReveal :show="(loading && expectSince) || !!since" class="w-full">
      <p v-if="since" class="mt-xs text-body text-ink-muted" :class="{ arrive: arriving }" data-testid="profile.since">{{ t('profile.since', { date: monthYear(since) }) }}</p>
      <p v-else class="line body-line mt-xs" aria-hidden="true"><span class="skeleton wave w-1/2" /></p>
    </UiReveal>
    <p v-if="loading" class="line eyebrow-line mt-sm w-full" aria-hidden="true"><span class="skeleton wave w-2/3" :style="{ '--wave': 0.1 }" /></p>
    <p v-else class="eyebrow mt-sm" :class="{ arrive: arriving }" data-testid="profile.library">
      {{ t('profile.library', { read: count(read), reading: count(reading), want: count(want) }) }}
    </p>
  </section>
</template>

<style scoped>
/* A placeholder line at the height of the text it stands for, centred like it. */
.line {
  display: flex;
  align-items: center;
  justify-content: center;
}
.line > * {
  height: 62%;
}
.body-line {
  height: var(--text-body--line-height);
}
.eyebrow-line {
  height: var(--text-eyebrow--line-height);
}
.ring {
  width: var(--size-cover-md);
  height: var(--size-cover-md);
}
</style>
