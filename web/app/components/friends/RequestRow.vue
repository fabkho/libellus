<script setup lang="ts">
// One follow request (social v1, U3): People's Requests segment and, `compact`, the top of Home's
// Your circle (feed mock, screen 1). Drawing only: the page that shows it answers the emits through
// stores/social.ts (`answer(id, accept)`, `follow(id)`) and decides when the row leaves.
//
// Props:
//  - `request`  the member (MemberCard) and `askedAt` (ISO time of the ask);
//  - `state`    'asked' (waiting: Accept and Decline), 'accepted' (she said yes: "follows you now" and
//               Follow back), 'following' (and she followed back: nothing more), 'requested' (she asked
//               back: Requested). Default 'asked'; `compact` only knows 'asked';
//  - `compact`  Home's: one raised, rounded row (the Shelf mock's), the avatar with the lamp dot, her name and
//               "asked to follow you" under it in muted ink, Accept and a ✕ Decline (no date, no Follow back);
//  - `offline`  no connection: the buttons give way to one disabled Offline button;
//  - `busy`     a write on its way: the buttons wait.
// Emits `accept`, `decline`, `followBack`. Test ids: `people.row`, `people.accept`, `people.decline`,
// `people.followBack` (compact: `home.circleRequest`, `home.circleAccept`, `home.circleDecline`).
import type { MemberCard } from '~/data/socialShapes'
import type { RequestState } from '~/utils/people'

const props = withDefaults(
  defineProps<{ request: MemberCard & { askedAt: string }; state?: RequestState; compact?: boolean; offline?: boolean; busy?: boolean }>(),
  { state: 'asked', compact: false, offline: false, busy: false },
)
defineEmits<{ accept: []; decline: []; followBack: [] }>()

const { t, locale } = useI18n()
const name = computed(() => props.request.name?.trim() || t('member.someone'))
// Counted against the moment the row was drawn, as the app writes days elsewhere.
const shownAt = Date.now()
const asked = computed(() => t('people.askedOn', { when: relativeTime(new Date(props.request.askedAt), shownAt, locale.value) }))
const id = (people: string, home: string) => (props.compact ? home : people)
</script>

<template>
  <div
    class="flex items-center gap-ms"
    :class="compact ? 'min-h-(--size-touch) rounded-md bg-surface-raised px-ms py-xs edge-faint' : 'min-h-(--size-row) py-xs'"
    :data-testid="id('people.row', 'home.circleRequest')"
  >
    <!-- Home's row: the lamp dot on the avatar's upper right edge, ringed in the raised colour. -->
    <span v-if="compact" class="relative flex shrink-0">
      <FriendsAvatar :card="request" />
      <span class="request-dot pointer-events-none absolute rounded-pill bg-accent" aria-hidden="true" />
    </span>
    <FriendsAvatar v-else :card="request" />

    <div class="flex min-w-0 flex-1 flex-col">
      <span class="truncate" :class="compact ? 'text-subhead font-medium' : 'text-body'">{{ name }}</span>
      <span class="truncate text-caption text-ink-muted">{{
        compact ? t('circle.askedLine') : state === 'asked' ? asked : t('people.followsYouNow')
      }}</span>
    </div>

    <template v-if="state === 'asked'">
      <UiButton v-if="offline" tone="secondary" size="sm" offline :data-testid="id('people.accept', 'home.circleAccept')" />
      <template v-else>
        <UiButton
          size="sm"
          :disabled="busy"
          :aria-label="compact ? t('circle.acceptLabel', { name }) : t('people.acceptLabel', { name })"
          :data-testid="id('people.accept', 'home.circleAccept')"
          @click="$emit('accept')"
        >
          {{ compact ? t('circle.accept') : t('people.accept') }}
        </UiButton>
        <button
          v-if="compact"
          type="button"
          :aria-label="t('circle.declineLabel', { name })"
          :disabled="busy"
          class="-mr-xs flex size-(--size-touch) shrink-0 items-center justify-center rounded-pill text-ink-muted disabled:opacity-50"
          data-testid="home.circleDecline"
          @click="$emit('decline')"
        >
          <UiIcon name="close" :size="18" />
        </button>
        <UiButton v-else tone="plain" size="sm" :disabled="busy" :aria-label="t('people.declineLabel', { name })" data-testid="people.decline" @click="$emit('decline')">
          {{ t('people.decline') }}
        </UiButton>
      </template>
    </template>
    <UiButton
      v-else-if="state === 'accepted'"
      tone="secondary"
      size="sm"
      :disabled="busy"
      :offline="offline"
      data-testid="people.followBack"
      @click="$emit('followBack')"
    >
      {{ t('people.followBack') }}
    </UiButton>
    <span v-else-if="state === 'requested'" class="shrink-0 px-sm text-caption text-ink-muted" data-testid="people.requested">{{ t('member.requested') }}</span>
  </div>
</template>

<style scoped>
/* The lamp dot, as on the header's avatar (shell/Header.vue), ringed in the row's raised colour. */
.request-dot {
  top: 0;
  right: 0;
  width: var(--spacing-sm);
  height: var(--spacing-sm);
  border: var(--stroke-rule) solid var(--color-surface-raised);
}
</style>
