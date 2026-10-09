<script setup lang="ts">
// The top of another member's profile (social v1, U4): the Profile's hero for someone else. Her avatar
// large (FriendsAvatar, `size="large"`: her 512 px photo over her initials, from the device's copy,
// stores/memberPhotos.ts), her name, since when she reads here and the Library line, the counts she
// shows. A new component beside the Profile's own Hero (components/profile/Hero.vue), which stays hers:
// it is the signed-in member's, its ring is the button for her photo and it reads the placeholders of
// her own record. The slot is for what goes under the name (a private account's lock and text).
import type { MemberCard } from '~/data/social'

const props = defineProps<{ card: MemberCard; since?: string | null; library?: string | null }>()

const { t } = useI18n()
const { monthYear } = useFigures()
const name = computed(() => props.card.name ?? t('member.someone'))
</script>

<template>
  <section class="relative flex flex-col items-center px-xl pt-sm text-center" data-testid="member.hero">
    <!-- The avatar's ring at the hero's size: its own size token raised for this one, its initials with it. -->
    <span class="ring rounded-pill" data-testid="member.avatar">
      <FriendsAvatar :card="card" size="large" />
    </span>
    <h1 class="mt-md max-w-full truncate text-title" data-testid="member.name">{{ name }}</h1>
    <p v-if="since" class="mt-xs text-body text-ink-muted" data-testid="member.since">{{ t('member.since', { month: monthYear(since) }) }}</p>
    <p v-if="library" class="eyebrow mt-sm" data-testid="member.library">{{ library }}</p>
    <slot />
  </section>
</template>

<style scoped>
.ring {
  --size-avatar: var(--size-cover-md);
  display: block;
  width: var(--size-cover-md);
  height: var(--size-cover-md);
}
.ring :deep(> span) {
  font-size: var(--text-title);
  line-height: var(--text-title--line-height);
}
</style>
